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

3. For "PROBABLY" answers: Extract with lower confidence (0.7-0.8)
   Example: "Is male?" + "probably" → {"key": "gender", "value": "male", "confidence": 0.75}

4. Match question topic PRECISELY - extract ONLY what the question asks about
   - Question about actors? → Extract category trait
   - Question about fictional? → Extract fictional trait  
   - Question about powers? → Extract has_powers trait
   - DON'T infer unrelated traits!

5. Important distinctions:
   - "fictional" means made-up character (Spider-Man, Harry Potter)
   - "actors" are REAL people who act in movies (Tom Hanks, Meryl Streep)
   - Movie characters are fictional, actors are NOT fictional
   
6. Return null if question doesn't clearly map to any available trait

**EXAMPLES:**
Q: "Is your character an actor?" A: "No" → {"key": "category", "value": "NOT_actors", "confidence": 0.9}
Q: "Is your character fictional?" A: "Yes" → {"key": "fictional", "value": "true", "confidence": 0.95}
Q: "Is your character male?" A: "Probably" → {"key": "gender", "value": "male", "confidence": 0.75}
Q: "Does your character have superpowers?" A: "Yes" → {"key": "has_powers", "value": "true", "confidence": 0.95}
Q: "Is your character known for football?" A: "No" → {"key": "sport", "value": "NOT_football", "confidence": 0.8} OR null (sport not in available keys)`

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
  const remainingCandidates = filterCharactersByTraits(traits)
  console.info(`[Detective-RAG] ${remainingCandidates.length} candidates match confirmed traits`)

  // CRITICAL: Detect contradictory traits (0 candidates)
  if (remainingCandidates.length === 0 && traits.length > 0) {
    console.error('[Detective-RAG] ERROR: No candidates match all confirmed traits!')
    console.error('[Detective-RAG] This usually means contradictory answers or database mismatch')
    console.error('[Detective-RAG] Confirmed traits:', JSON.stringify(traits, null, 2))
    
    // Try to identify the contradiction
    const traitSummary = traits.map(t => `${t.key}=${t.value}`).join(', ')
    console.error(`[Detective-RAG] Looking for character with: ${traitSummary}`)
    
    return {
      question: `I couldn't find any characters matching your answers (${traitSummary}). Did you answer all questions correctly? Should we start over?`,
      topGuesses: []
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
    turns.map(t => t.question)
  )

  if (strategicQuestion && remainingCandidates.length > 5) {
    console.info('[Detective-RAG] Using strategic question from RAG:', strategicQuestion)
    
    return {
      question: strategicQuestion,
      topGuesses: ragGuesses.map(g => ({ name: g.name, confidence: g.confidence }))
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
${remainingCandidates.length <= 2 
  ? 'Very few candidates remain! Ask a final distinguishing question or make your guess.'
  : remainingCandidates.length <= 10
    ? 'Getting close! Ask a specific question about achievements, works, or distinctive features.'
    : 'Many candidates remain. Ask a high-information question that eliminates ~50% of candidates.'}

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
