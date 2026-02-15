/**
 * RAG-Enhanced Detective Service
 * 
 * Uses character-knowledge.json via RAG to dramatically improve guessing accuracy.
 * Target: Guess any character in knowledge base within 10 questions.
 */

import { chatCompletion } from './lemonade'
import { DETECTIVE_MODEL } from '../../shared/constants'
import type { Trait, Guess, AnswerValue } from '../types/game'
import {
  loadCharacterKnowledge,
  filterCharactersByTraits,
  getAllCharacters,
  getTopGuesses as getRagTopGuesses,
  getCandidateContext,
  getMostInformativeQuestion,
  getCharacterByName
} from './character-rag'

const ANSWER_LABELS: Record<AnswerValue, string> = {
  yes: 'yes',
  no: 'no',
  probably: 'probably',
  probably_not: 'probably_not',
  dont_know: 'dont_know',
}

interface TurnAdded {
  turnAdded?: number
}

// Ensure character knowledge is loaded
let knowledgeLoaded = false
async function ensureKnowledgeLoaded(): Promise<void> {
  if (!knowledgeLoaded) {
    await loadCharacterKnowledge()
    knowledgeLoaded = true
  }
}

/**
 * Reset for new game
 */
export function resetSessionLearning(): void {
  // No session learning needed with RAG - knowledge base is the source of truth
  console.info('[Detective-RAG] Starting new game with character knowledge base')
}

/**
 * Record rejected guess (for future enhancements)
 */
export function recordRejectedGuess(characterName: string, traitsAtRejection: Trait[], turnAdded: number): void {
  console.info(`[Detective-RAG] User rejected guess: ${characterName} at turn ${turnAdded}`)
  // Future: Could use this to fine-tune confidence calculations
}

/**
 * Record ambiguous question (for future enhancements)
 */
export function recordAmbiguousQuestion(question: string, turnAdded: number): void {
  console.info(`[Detective-RAG] Ambiguous question at turn ${turnAdded}: ${question}`)
  // Future: Could use this to avoid similar questions
}

/**
 * Extract structured JSON from LLM response
 */
function extractJSON(text: string): any {
  try {
    // Look for JSON object in the response
    const jsonMatch = text.match(/\{[\s\S]*\}/)
    if (jsonMatch) {
      return JSON.parse(jsonMatch[0])
    }
    return JSON.parse(text)
  } catch {
    return null
  }
}

/**
 * System prompt for RAG-enhanced detective
 */
const RAG_DETECTIVE_SYSTEM_PROMPT = `You are an expert detective in a character-guessing game (like Akinator). You have access to a knowledge base of 400+ characters and must guess the user's character in ~10 questions.

**CRITICAL RULES:**
1. Ask ONLY yes/no questions
2. Use the "Remaining Candidates" context to focus your questions
3. Ask questions that eliminate ~50% of remaining candidates (information gain)
4. When you have 3-5 candidates left, ask SPECIFIC differentiating questions
5. Make a guess when confidence ≥ 0.75 OR remaining candidates ≤ 2

**OUTPUT FORMAT:**
Return ONLY valid JSON:
{
  "question": "your yes/no question here",
  "top_guesses": [
    {"name": "Character Name", "confidence": 0.75}
  ]
}

**STRATEGY:**
- Turns 1-3: Broad binaries (fictional, gender, category)
- Turns 4-7: Medium refinement (specific category, era, origin)  
- Turns 8+: Distinctive features (specific works, achievements, characteristics)

**WHEN TO GUESS:**
- Confidence ≥ 0.75: Make the guess!
- 1-2 candidates remain: Pick the best match
- Don't waste turns on generic questions when you're 75%+ sure`

/**
 * Trait extractor prompt
 */
const TRAIT_EXTRACTOR_PROMPT = `Extract a structured trait from this Q&A.

**AVAILABLE TRAIT KEYS:**
- fictional (true/false) - Is the character entirely made up vs a real person?
- gender (male/female)
- category (actors, athletes, musicians, politicians, historical, anime, superheroes, tv-characters, video-games, other)
- origin_medium (anime, movie, tv, video-game, comic-book)
- has_powers (true/false) - Supernatural/superhuman abilities
- alignment (hero, villain)
- species (human, alien, robot, god, animal, etc.)
- age_group (child, teenager, adult)
- era (ancient, medieval, modern, contemporary)

**OUTPUT:** Return ONLY valid JSON:
{"key": "trait_key", "value": "trait_value", "confidence": 0.95}

**CRITICAL EXTRACTION RULES:**
1. For "YES" answers: Extract POSITIVE traits
   Example: "Is actor?" + "yes" → {"key": "category", "value": "actors", "confidence": 0.95}

2. For "NO" answers: Use "NOT_" prefix to indicate EXCLUSION
   Example: "Is actor?" + "no" → {"key": "category", "value": "NOT_actors", "confidence": 0.9}
   
   **EXCEPTION: Binary traits with clear opposites:**
   - "Is male?" + "no" → {"key": "gender", "value": "female", "confidence": 0.9}
   - "Is female?" + "no" → {"key": "gender", "value": "male", "confidence": 0.9}
   - "Is fictional?" + "no" → {"key": "fictional", "value": "false", "confidence": 0.95}
   - "Is real?" + "no" → {"key": "fictional", "value": "true", "confidence": 0.95}

3. For "PROBABLY" answers: Extract with lower confidence (0.7-0.8)
   Example: "Is male?" + "probably" → {"key": "gender", "value": "male", "confidence": 0.75}

4. Match question topic PRECISELY - extract ONLY what the question asks about
   - Question about actors? → Extract category trait with value "actors" or "NOT_actors"
   - Question about athletes? → Extract category trait with value "athletes" or "NOT_athletes"
   - Question about musicians? → Extract category trait with value "musicians" or "NOT_musicians"
   - Question about fictional? → Extract fictional trait
   - Question about powers? → Extract has_powers trait
   - DON'T infer unrelated traits!

5. **CRITICAL: The trait VALUE must match a word from the QUESTION**
   - If question says "athlete", value MUST be "athletes" or "NOT_athletes"
   - If question says "actor", value MUST be "actors" or "NOT_actors"
   - NEVER extract "actors" when question asks about "athletes"!
   - NEVER extract "musicians" when question asks about "politicians"!

5. IMPORTANT: Characters can have overlapping traits
   - A character like "Iron Man" could be:
     * fictional=true (Tony Stark is a made-up character)
     * origin_medium=movie (from Marvel movies)
     * category=superheroes (a superhero character)
   - Someone thinking of the character (not the actor) would say "yes" to fictional
   - Someone thinking of Robert Downey Jr. (the actor) would say "no" to fictional
   - Both interpretations are valid!
   
6. Return null if question doesn't clearly map to any available trait

**EXAMPLES:**
Q: "Is your character an actor?" A: "Yes" → {"key": "category", "value": "actors", "confidence": 0.95}
Q: "Is your character an actor?" A: "No" → {"key": "category", "value": "NOT_actors", "confidence": 0.9}
Q: "Is your character an athlete?" A: "Yes" → {"key": "category", "value": "athletes", "confidence": 0.95}
Q: "Is your character an athlete?" A: "No" → {"key": "category", "value": "NOT_athletes", "confidence": 0.9}
Q: "Is your character a musician or singer?" A: "No" → {"key": "category", "value": "NOT_musicians", "confidence": 0.9}
Q: "Is your character fictional?" A: "Yes" → {"key": "fictional", "value": "true", "confidence": 0.95}
Q: "Is your character fictional?" A: "No" → {"key": "fictional", "value": "false", "confidence": 0.95}
Q: "Is your character male?" A: "Yes" → {"key": "gender", "value": "male", "confidence": 0.95}
Q: "Is your character male?" A: "No" → {"key": "gender", "value": "female", "confidence": 0.9}
Q: "Is your character male?" A: "Probably" → {"key": "gender", "value": "male", "confidence": 0.75}
Q: "Does your character have superpowers?" A: "Yes" → {"key": "has_powers", "value": "true", "confidence": 0.95}
Q: "Is your character known for football?" A: "No" → null (sport trait not available)`

/**
 * Extract trait from question + answer
 */
async function extractTrait(
  question: string,
  answer: AnswerValue,
  turnAdded: number
): Promise<Trait | null> {
  if (answer === 'dont_know') {
    console.warn('[Detective-RAG] User answered "dont_know", skipping trait extraction')
    return null
  }

  const prompt = `Question: "${question}"
Answer: "${ANSWER_LABELS[answer]}"

CRITICAL: Match the question topic precisely. Don't infer unrelated traits.
Extract the trait.`

  try {
    const response = await chatCompletion({
      model: DETECTIVE_MODEL,
      messages: [
        { role: 'system', content: TRAIT_EXTRACTOR_PROMPT },
        { role: 'user', content: prompt }
      ],
      temperature: 0.1,
      max_tokens: 100,
    })

    const raw = response.choices[0]?.message?.content || ''
    console.info('[Detective-RAG] extractTrait raw:', raw)
    
    const json = extractJSON(raw)
    if (!json || !json.key || !json.value) {
      console.warn('[Detective-RAG] FAILED extraction - invalid JSON:', raw)
      return null
    }

    // Validate value
    const value = String(json.value).toLowerCase()
    if (['unknown', 'unclear', 'n/a', 'none'].includes(value)) {
      console.warn('[Detective-RAG] FAILED extraction - unclear value:', value)
      return null
    }

    // CRITICAL: Validate that extracted value is related to the question
    // This prevents hallucinations like extracting "actors" when question is about "athletes"
    if (String(json.key) === 'category') {
      const questionLower = question.toLowerCase()
      const extractedValue = value.replace(/^not_/, '') // Strip NOT_ prefix for validation

      // Check if the extracted category appears in or is closely related to the question
      const isRelated =
        questionLower.includes(extractedValue) || // Direct match (e.g., "actor" in question, "actors" extracted)
        questionLower.includes(extractedValue.replace(/s$/, '')) || // Singular form
        extractedValue.includes(questionLower.match(/(?:actor|athlete|musician|politician|historical)/)?.[0] || '') // Key category word

      if (!isRelated) {
        console.warn(`[Detective-RAG] FAILED extraction - category "${extractedValue}" not related to question: "${question}"`)
        return null
      }
    }

    const trait = {
      key: String(json.key),
      value: String(json.value),
      confidence: Math.min(Math.max(Number(json.confidence) || 0.9, 0.1), 0.99),
      turnAdded
    }
    
    console.info(`[Detective-RAG] SUCCESS: ${trait.key} = ${trait.value} (conf: ${Math.round(trait.confidence * 100)}%)`)
    return trait
  } catch (error) {
    console.error('[Detective-RAG] extractTrait error:', error)
    return null
  }
}

/**
 * Guess character beyond database using LLM + web search
 * Used when no characters in database match the traits
 */
async function guessCharacterBeyondDatabase(
  traits: Trait[],
  turns: Array<{ question: string; answer: AnswerValue }>
): Promise<Guess[]> {
  console.info('[Detective-Beyond] Making educated guesses using LLM')
  
  const traitsList = traits.map(t => `- ${t.key}: ${t.value}`).join('\n')
  const turnsList = turns.map((t, i) => `${i + 1}. Q: "${t.question}" A: ${t.answer}`).join('\n')
  
  const prompt = `I'm playing a guessing game where I need to identify a character/person.
Here are the confirmed traits from the user's answers:

${traitsList}

Q&A History:
${turnsList}

Based on ONLY these traits and answers, who are the top 3 most likely characters/people?

Consider:
- Real people (historical figures, celebrities, athletes, politicians, etc.)
- Fictional characters (from movies, TV, books, games, anime, etc.)
- Anyone who could match ALL these traits

Return ONLY JSON array of guesses:
[
  {"name": "Full Name", "confidence": 0.85, "reason": "brief reason"},
  {"name": "Full Name", "confidence": 0.70, "reason": "brief reason"},
  {"name": "Full Name", "confidence": 0.60, "reason": "brief reason"}
]

IMPORTANT: Base guesses ONLY on the given traits. Don't make random guesses.`

  try {
    const response = await chatCompletion({
      model: DETECTIVE_MODEL,
      messages: [
        { role: 'system', content: 'You are an expert at identifying characters and people based on traits. You MUST return ONLY a valid JSON array, nothing else.' },
        { role: 'user', content: prompt }
      ],
      temperature: 0.5,  // Higher for more creative guessing
      max_tokens: 400,   // Allow more tokens for better responses
    })

    const raw = response.choices[0]?.message?.content || ''
    console.info('[Detective-Beyond] LLM response:', raw)
    
    // Try to extract JSON array even if wrapped in markdown or text
    let json = extractJSON(raw)
    
    // If extractJSON failed, try manual extraction
    if (!json || !Array.isArray(json)) {
      const arrayMatch = raw.match(/\[[\s\S]*\]/)
      if (arrayMatch) {
        try {
          json = JSON.parse(arrayMatch[0])
        } catch (e) {
          console.warn('[Detective-Beyond] Manual JSON extraction failed')
        }
      }
    }
    
    if (Array.isArray(json) && json.length > 0) {
      const guesses: Guess[] = json.slice(0, 5).map((item: any) => ({
        name: String(item.name || item.character || 'Unknown'),
        confidence: Math.min(Math.max(Number(item.confidence || 0.5), 0.1), 0.8) // Cap at 0.8 since not in database
      }))
      
      console.info('[Detective-Beyond] Generated guesses:', guesses)
      const validGuesses = guesses.filter(g => g.name !== 'Unknown' && g.name.length > 0)
      
      if (validGuesses.length > 0) {
        return validGuesses.slice(0, 3)  // Return top 3
      }
    }
    
    console.warn('[Detective-Beyond] Invalid JSON response:', raw)
    return []
  } catch (error) {
    console.error('[Detective-Beyond] Error making guesses:', error)
    return []
  }
}

/**
 * Ask the next question using RAG context
 */
async function askNextQuestion(
  traits: Trait[],
  turns: Array<{ question: string; answer: AnswerValue }>,
  rejectedGuesses: string[] = []
): Promise<{ question: string; topGuesses: Guess[] }> {
  await ensureKnowledgeLoaded()

  console.info('[Detective-RAG] ===== ASK NEXT QUESTION =====')
  console.info('[Detective-RAG] Confirmed traits:', traits.length, traits)
  console.info('[Detective-RAG] Turn:', turns.length + 1)

  // Use RAG to filter candidates based on confirmed traits
  // NOTE: This does strict AND filtering - all traits must match
  // Database limitation: characters are in single categories, but real-world
  // entities can be ambiguous (e.g., "Iron Man" could be superhero OR movie character)
  const remainingCandidates = filterCharactersByTraits(traits)
  console.info(`[Detective-RAG] ${remainingCandidates.length} candidates match confirmed traits`)

  // CRITICAL: Handle 0 candidates - character not in database
  // Only fall back to LLM guessing if we've asked MANY questions (30+)
  if (remainingCandidates.length === 0 && traits.length > 0) {
    console.warn('[Detective-RAG] WARNING: No exact matches in database')
    console.warn('[Detective-RAG] Character may not be in knowledge base')
    console.warn('[Detective-RAG] Confirmed traits:', JSON.stringify(traits, null, 2))
    
    // Try partial matching - relax the last trait added
    const traitSummary = traits.map(t => `${t.key}=${t.value}`).join(', ')
    console.warn(`[Detective-RAG] Looking for character with: ${traitSummary}`)
    
    // STRATEGY: Only use LLM guessing as LAST RESORT after extensive questioning
    const shouldUseLLMGuessing = turns.length >= 30
    
    // Try filtering with fewer traits (relax most recent trait)
    if (traits.length > 1) {
      const relaxedTraits = traits.slice(0, -1)
      const relaxedCandidates = filterCharactersByTraits(relaxedTraits)
      console.info(`[Detective-RAG] Relaxed filtering: ${relaxedCandidates.length} candidates with ${relaxedTraits.length} traits`)
      
      if (relaxedCandidates.length > 0) {
        // Continue with relaxed filtering - try to narrow down further
        const relaxedGuesses = getRagTopGuesses(relaxedTraits, 5)
        console.info('[Detective-RAG] Using relaxed filtering to continue game')
        console.info('[Detective-RAG] Top guesses with relaxed traits:', relaxedGuesses.map(g => g.name))
        
        // If we have very few candidates, just make guesses
        if (relaxedCandidates.length <= 10) {
          console.info('[Detective-RAG] Few candidates remaining, making direct guesses')
          return {
            question: 'Is your character one of these?',
            topGuesses: relaxedGuesses.slice(0, 3).map(g => ({ 
              name: g.name, 
              confidence: g.confidence * 0.6  // Reduced confidence due to relaxed filtering
            }))
          }
        }
        
        // Otherwise, try to ask a strategic question to narrow down
        const strategicQuestion = getMostInformativeQuestion(
          relaxedCandidates,
          turns.map(t => t.question),
          traits  // Pass traits for logical inference
        )
        
        if (strategicQuestion) {
          console.info('[Detective-RAG] Asking strategic question with relaxed candidates')
          return {
            question: strategicQuestion,
            topGuesses: relaxedGuesses.slice(0, 3).map(g => ({ 
              name: g.name, 
              confidence: g.confidence * 0.6 
            }))
          }
        }
        
        // Fallback: make guesses
        return {
          question: 'Is your character one of these?',
          topGuesses: relaxedGuesses.slice(0, 3).map(g => ({ 
            name: g.name, 
            confidence: g.confidence * 0.6 
          }))
        }
      }
    }
    
    // If still 0 and haven't asked enough questions yet, continue with broad questions
    if (!shouldUseLLMGuessing) {
      console.info('[Detective-RAG] Only', turns.length, 'questions asked. Continuing with broad questions.')
      
      // Ask broad informative questions even without candidates
      const broadQuestions = [
        'Is your character known internationally?',
        'Is your character still alive (or active in recent stories)?',
        'Is your character primarily known for their physical appearance?',
        'Is your character associated with a specific time period in history?',
        'Does your character have a distinctive personality trait?',
        'Is your character part of a famous duo or group?',
        'Is your character known for a catchphrase or signature move?',
        'Is your character based on a real person?',
        'Is your character associated with a specific country or region?',
        'Does your character have a unique physical feature?',
        'Is your character known for their intelligence or wisdom?',
        'Is your character associated with a particular profession?',
        'Does your character wear distinctive clothing or accessories?',
        'Is your character known for being heroic or villainous?',
        'Is your character associated with a specific genre (action, comedy, drama)?',
        'Does your character have a family or significant relationships?',
        'Is your character known for their physical strength?',
        'Does your character use technology or weapons?',
        'Is your character associated with nature or animals?',
        'Does your character have magical or mystical abilities?',
      ]
      
      // Pick a broad question not yet asked
      const askedQuestions = turns.map(t => t.question.toLowerCase())
      const nextBroadQuestion = broadQuestions.find(q => 
        !askedQuestions.some(asked => asked.includes(q.toLowerCase().slice(0, 20)))
      )
      
      if (nextBroadQuestion) {
        console.info('[Detective-RAG] Asking broad question:', nextBroadQuestion)
        return {
          question: nextBroadQuestion,
          topGuesses: []
        }
      }
      
      // If all broad questions exhausted but still under 30 turns, ask generic questions
      console.info('[Detective-RAG] All broad questions exhausted. Asking generic follow-up.')
      const genericQuestions = [
        'Does your character have any special talents or skills?',
        'Is your character associated with any specific achievements?',
        'Does your character have a memorable quote or saying?',
        'Is your character known for overcoming challenges or obstacles?',
        'Does your character have a distinctive voice or accent?',
        'Is your character associated with a particular color or symbol?',
        'Does your character work alone or with others?',
        'Is your character known for their appearance in a specific work (movie, book, show)?',
        'Does your character transform or change in some significant way?',
        'Is your character associated with a particular emotion (happiness, anger, etc.)?',
      ]
      
      const nextGenericQuestion = genericQuestions.find(q => 
        !askedQuestions.some(asked => asked.includes(q.toLowerCase().slice(0, 15)))
      )
      
      if (nextGenericQuestion) {
        console.info('[Detective-RAG] Asking generic question:', nextGenericQuestion)
        return {
          question: nextGenericQuestion,
          topGuesses: []
        }
      }
      
      // If STILL no questions and under 30 turns, generate dynamic questions based on existing traits
      console.info('[Detective-RAG] All questions exhausted. Generating dynamic question based on traits.')
      
      // Generate more specific follow-up questions based on confirmed traits
      const dynamicQuestions: string[] = []
      
      // Add trait-based dynamic questions
      const hasFictional = traits.some(t => t.key === 'fictional')
      const isNotFictional = traits.some(t => t.key === 'fictional' && t.value === 'false')
      const hasMale = traits.some(t => t.key === 'gender' && t.value === 'male')
      const hasFemale = traits.some(t => t.key === 'gender' && t.value === 'female')
      
      if (!hasFictional) {
        dynamicQuestions.push('Is your character entirely fictional or based on a real person?')
      }
      
      if (hasFictional && !isNotFictional) {
        dynamicQuestions.push('Does your character appear in multiple different works or adaptations?')
        dynamicQuestions.push('Is your character the main protagonist of their story?')
        dynamicQuestions.push('Does your character have a romantic relationship in their story?')
      }
      
      if (hasMale || hasFemale) {
        dynamicQuestions.push('Does your character have a title or honorific (Dr., Mr., Sir, etc.)?')
        dynamicQuestions.push('Is your character known for their sense of humor?')
      }
      
      // Generic fallbacks if no dynamic questions apply
      if (dynamicQuestions.length === 0) {
        dynamicQuestions.push(
          'Does your character have a mentor or guide figure?',
          'Is your character associated with any specific location or place?',
          'Does your character undergo significant character development or change?',
          'Is your character known for any catchphrase or memorable line?',
          'Does your character have a rival or arch-enemy?'
        )
      }
      
      const nextDynamicQuestion = dynamicQuestions.find(q =>
        !askedQuestions.some(asked => asked.includes(q.toLowerCase().slice(0, 20)))
      )
      
      if (nextDynamicQuestion) {
        console.info('[Detective-RAG] Asking dynamic question:', nextDynamicQuestion)
        return {
          question: nextDynamicQuestion,
          topGuesses: []
        }
      }
      
      // Absolute last resort - we've truly exhausted everything
      console.warn('[Detective-RAG] No more questions available, moving to LLM guessing early')
    }
    
    // If still 0 and asked 30+ questions (or exhausted all questions), NOW use LLM to make educated guesses
    console.warn('[Detective-RAG] Character not in database - using LLM to make guesses')
    console.warn('[Detective-RAG] Traits:', traitSummary)
    
    try {
      const guesses = await guessCharacterBeyondDatabase(traits, turns)
      
      // If LLM returned no guesses or invalid JSON, keep asking questions
      if (!guesses || guesses.length === 0) {
        console.warn('[Detective-RAG] LLM returned no guesses, asking another question')
        return {
          question: 'Let me ask one more thing - does your character have any unique abilities or talents?',
          topGuesses: []
        }
      }
      
      return {
        question: `Based on your answers, I think your character is one of these. Am I close?`,
        topGuesses: guesses
      }
    } catch (error) {
      console.error('[Detective-RAG] Failed to guess beyond database:', error)
      // Even on error, keep asking questions
      return {
        question: 'Tell me more - is your character known for a specific achievement?',
        topGuesses: []
      }
    }
  }

  // Get top guesses from RAG
  const ragGuesses = getRagTopGuesses(traits, 3)
    .filter(g => !rejectedGuesses.some(r => r.toLowerCase() === g.name.toLowerCase()))
  
  console.info('[Detective-RAG] RAG top guesses:', ragGuesses.map(g => `${g.name} (${Math.round(g.confidence * 100)}%)`))

  // Get context about remaining candidates for the AI
  const candidateContext = getCandidateContext(remainingCandidates, 5)

  // Check if we should use a strategic question based on information theory
  const strategicQuestion = getMostInformativeQuestion(
    remainingCandidates,
    turns.map(t => t.question),
    traits  // Pass traits for logical inference
  )

  if (strategicQuestion && remainingCandidates.length > 15) {
    console.info('[Detective-RAG] Using strategic question from RAG:', strategicQuestion)
    
    return {
      question: strategicQuestion,
      topGuesses: ragGuesses.map(g => ({ name: g.name, confidence: g.confidence }))
    }
  }
  
  // If we have ≤15 candidates and plenty of questions asked, just make guesses
  if (remainingCandidates.length <= 15 && turns.length >= 8) {
    console.info('[Detective-RAG] Small candidate pool (≤15), making direct guesses')
    return {
      question: 'Based on your answers, I think your character is one of these. Am I close?',
      topGuesses: ragGuesses.slice(0, 5).map(g => ({ name: g.name, confidence: g.confidence }))
    }
  }

  // Build context for AI
  const traitsList = traits.map(t => `- ${t.key}: ${t.value} (${Math.round(t.confidence * 100)}%)`).join('\n')
  const turnsList = turns.map((t, i) => `${i + 1}. Q: "${t.question}" A: ${t.answer}`).join('\n')

  const contextPrompt = `
**Current Game State:**
Turn: ${turns.length + 1}
Confirmed traits:
${traitsList || '(none yet)'}

**Previous Q&A:**
${turnsList || '(no questions yet)'}

**Remaining Candidates:**
${candidateContext}

**Your Task:**
${remainingCandidates.length <= 5 
  ? 'Very few candidates remain! Ask a final broad yes/no question.'
  : remainingCandidates.length <= 25
    ? 'Getting close! Ask a BROAD yes/no question about general traits (not specific achievements). Examples: "Is your character known for action roles?" or "Is your character American?"'
    : 'Many candidates remain. Ask a high-information yes/no question that splits candidates roughly 50/50. Keep it general.'}

IMPORTANT: Keep questions broad and answerable with yes/no. Avoid overly specific questions about dates, awards, or achievements.

Return your response as JSON.`

  try {
    const response = await chatCompletion({
      model: DETECTIVE_MODEL,
      messages: [
        { role: 'system', content: RAG_DETECTIVE_SYSTEM_PROMPT },
        { role: 'user', content: contextPrompt }
      ],
      temperature: 0.3,
      max_tokens: 150,
    })

    const raw = response.choices[0]?.message?.content || ''
    console.info('[Detective-RAG] askNextQuestion raw:', raw)

    const json = extractJSON(raw)
    if (!json || !json.question) {
      console.warn('[Detective-RAG] Invalid response, using fallback question')
      return {
        question: getFallbackQuestion(turns.map(t => t.question)),
        topGuesses: ragGuesses.map(g => ({ name: g.name, confidence: g.confidence }))
      }
    }

    return {
      question: String(json.question),
      topGuesses: ragGuesses.map(g => ({ name: g.name, confidence: g.confidence }))
    }
  } catch (error) {
    console.error('[Detective-RAG] askNextQuestion error:', error)
    return {
      question: getFallbackQuestion(turns.map(t => t.question)),
      topGuesses: ragGuesses.map(g => ({ name: g.name, confidence: g.confidence }))
    }
  }
}

/**
 * Simple fallback questions
 */
const FALLBACK_QUESTIONS = [
  'Is your character fictional?',
  'Is your character male?',
  'Is your character from an anime or manga?',
  'Is your character a superhero?',
  'Is your character an athlete?',
  'Is your character a musician?',
  'Is your character an actor?',
  'Is your character a politician?',
  'Is your character from a TV show?',
  'Did your character live before 1950?'
]

function getFallbackQuestion(askedQuestions: string[]): string {
  for (const q of FALLBACK_QUESTIONS) {
    if (!askedQuestions.some(aq => aq.toLowerCase().includes(q.toLowerCase().split(' ').slice(3).join(' ')))) {
      return q
    }
  }
  return 'Is your character well-known internationally?'
}

/**
 * Main detective function
 * Takes the user's last answer and returns the next question + new traits + top guesses
 */
export async function askDetective(
  traits: (Trait & TurnAdded)[],
  turns: Array<{ question: string; answer: AnswerValue }>,
  turnAdded: number,
  rejectedGuesses: string[] = [],
  previousQuestion?: string,
  answer?: AnswerValue
): Promise<{
  question: string
  newTraits: (Trait & TurnAdded)[]
  topGuesses: Guess[]
}> {
  await ensureKnowledgeLoaded()

  console.info('[Detective-RAG] ===== NEW TURN =====')
  console.info('[Detective-RAG] Turn number:', turnAdded)
  console.info('[Detective-RAG] Incoming traits:', traits.length, traits)
  console.info('[Detective-RAG] Previous question:', previousQuestion)
  console.info('[Detective-RAG] Answer:', answer)

  const newTraits: (Trait & TurnAdded)[] = []

  // Step 1: Extract trait from previous answer (if any)
  if (previousQuestion && answer) {
    console.info('[Detective-RAG] Extracting trait from Q&A...')
    const extractedTrait = await extractTrait(previousQuestion, answer, turnAdded)
    if (extractedTrait) {
      newTraits.push({ ...extractedTrait, turnAdded })
      console.info('[Detective-RAG] ✓ Extracted trait:', extractedTrait.key, '=', extractedTrait.value, `(confidence: ${Math.round(extractedTrait.confidence * 100)}%)`)
    } else {
      console.warn('[Detective-RAG] ✗ No trait extracted from answer')
    }
  }

  // Step 2: Get next question with updated traits
  const updatedTraits = [...traits, ...newTraits]
  console.info('[Detective-RAG] Updated traits for filtering:', updatedTraits.length, updatedTraits)
  
  const { question, topGuesses } = await askNextQuestion(updatedTraits, turns, rejectedGuesses)

  console.info('[Detective-RAG] ===== RESULTS =====')
  console.info('[Detective-RAG] Next question:', question)
  console.info('[Detective-RAG] New traits to return:', newTraits.length, newTraits)
  console.info('[Detective-RAG] Top guesses to return:', topGuesses.length, topGuesses)

  return { question, newTraits, topGuesses }
}
