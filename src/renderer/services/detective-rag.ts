/**
 * RAG-Enhanced Detective Service
 * 
 * Uses character-knowledge.json via RAG to dramatically improve guessing accuracy.
 * Target: Guess any character in knowledge base within 10 questions.
 * 
 * From turn 5+: Supplements with Wikipedia search for "top 50 X" characters.
 */

import { z } from 'zod'
import { chatCompletion } from './lemonade'
import { DETECTIVE_MODEL, CONFIDENCE_THRESHOLD, ENABLE_WIKIPEDIA_SEARCH } from '../../shared/constants'
import type { Trait, Guess, AnswerValue } from '../types/game'
import type { CharacterData } from './character-rag'
import {
  loadCharacterKnowledge,
  filterCharactersByTraits,
  filterCharactersFuzzy,
  getAllCharacters,
  getTopGuesses as getRagTopGuesses,
  getCandidateContext,
  getMostInformativeQuestion,
  getCharacterByName,
  generateDynamicQuestion,
  scoreCharacterMatch,
  shouldSkipQuestion
} from './character-rag'
import { getWikipediaSupplementalCharacters } from './wikipedia'

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

// Zod schemas for LLM output validation
const TraitSchema = z.object({
  key: z.string(),
  value: z.string(),
  confidence: z.number().min(0).max(1)
})

const GuessSchema = z.object({
  name: z.string(),
  confidence: z.number().min(0).max(1)
})

const TraitsArraySchema = z.array(TraitSchema)
const GuessesArraySchema = z.array(GuessSchema)

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
 * Extract and validate structured JSON from LLM response using Zod
 */
function extractJSON(text: string): any {
  try {
    // Look for JSON object or array in the response
    const jsonMatch = text.match(/\{[\s\S]*\}|\[[\s\S]*\]/)
    if (jsonMatch) {
      return JSON.parse(jsonMatch[0])
    }
    return JSON.parse(text)
  } catch {
    return null
  }
}

/**
 * Validate and parse trait extraction response
 * Returns traits without turnAdded (caller will add it)
 */
function parseTraits(llmResponse: string): Omit<Trait, 'turnAdded'>[] {
  const json = extractJSON(llmResponse)
  if (!json) return []
  
  try {
    // Support both single trait object and array of traits
    const data = Array.isArray(json) ? json : [json]
    const result = TraitsArraySchema.safeParse(data)
    
    if (result.success) {
      return result.data
    } else {
      console.warn('[Detective-RAG] Trait validation failed:', result.error)
      return []
    }
  } catch (error) {
    console.error('[Detective-RAG] Error parsing traits:', error)
    return []
  }
}

// ===== QUESTION TOPIC TRACKING — semantic duplicate detection =====
// Maps topic keys to keyword lists. Questions sharing a topic are considered semantically equivalent.
const QUESTION_TOPICS: Record<string, string[]> = {
  'setting/workplace':   ['office', 'corporate', 'workplace', 'cubicle', 'desk', 'works in', 'business setting', 'professional setting'],
  'trait/fictional':     ['fictional', 'real person', 'made up', 'made-up', 'imaginary'],
  'trait/gender':        ['male', 'female', 'man', 'woman', 'boy', 'girl', 'his gender', 'her gender'],
  'trait/powers':        ['superpower', 'super power', 'powers', 'abilities', 'magic', 'supernatural', 'fly ', 'teleport'],
  'trait/alignment':     ['villain', 'hero', 'protagonist', 'antagonist', 'evil', 'bad guy'],
  'trait/age_era':       ['born before', 'active in the', 'died before', 'historical figure', '20th century', '21st century'],
  'trait/alive':         ['still alive', 'alive today', 'living today', 'currently alive', 'is your character dead', 'passed away'],
  'trait/nationality':   ['american', 'british', 'english', 'japanese', 'french', 'german', 'european', 'united kingdom', 'from the uk', 'from england', 'from britain', 'from japan', 'from france', 'nationality', 'from which country'],
  'trait/species':       ['human', 'alien', 'robot', 'animal', 'creature'],
  'trait/intelligence':  ['intelligent', 'genius', 'smart', 'wisdom', 'clever'],
  'trait/humor':         ['comedy', 'comedic', 'funny', 'humor', 'known for comedy', 'comedy movies', 'comedy shows', 'comedy films'],
  'trait/drama':         ['dramatic role', 'serious role', 'known for drama', 'drama films', 'dramatic films', 'serious movies', 'dramatic movie', 'known for serious', 'known for dramatic', 'serious roles', 'dramatic roles'],
  'trait/team':          ['work with a team', 'works alone', 'part of a group', 'duo', 'sidekick'],
  'category/actor':      ['is your character an actor', 'is your character an actress', 'is your character in acting'],
  'category/musician':   ['musician', 'singer', 'band', 'music', 'song', 'album', 'rapper', 'hip-hop'],
  'category/athlete':    ['athlete', 'sport', 'plays sports', 'championship'],
  'category/politician': ['politician', 'president', 'senator', 'politics', 'elected', 'govern'],
  'category/superhero':  ['superhero', 'super hero', 'marvel', 'dc comics', 'avengers'],
  'category/anime':      ['anime', 'manga', 'japanese animation', 'originate in an anime', 'originate in a manga'],
  'category/videogame':  ['video game', 'videogame', 'game character', 'originate in a video game'],
  'media/tv':            ['tv show', 'television', 'sitcom', 'drama series', 'originate in a tv', 'originate in a sitcom', 'originate in a drama'],
  'media/movie':         ['movie franchise', 'film franchise', 'blockbuster'],
  'media/animation':     ['animated show', 'animated series', 'cartoon'],
  'media/comic':         ['comic book', 'graphic novel'],
  'achievement/award':   ['award', 'oscar', 'emmy', 'grammy', 'golden globe', 'nominated'],
  'appearance/clothing': ['costume', 'uniform', 'outfit', 'mask'],
  'appearance/physical': ['hair', 'physical appearance', 'distinctive feature'],
}

function extractTopicsFromQuestion(question: string): string[] {
  const lower = question.toLowerCase()
  const topics: string[] = []
  for (const [topic, keywords] of Object.entries(QUESTION_TOPICS)) {
    if (keywords.some(kw => lower.includes(kw))) {
      topics.push(topic)
    }
  }
  return topics
}

function isTopicAlreadyCovered(
  newQuestion: string,
  previousTurns: Array<{ question: string; answer: AnswerValue }>
): { covered: boolean; matchedTopic: string | null; matchedQuestion: string | null } {
  const newTopics = extractTopicsFromQuestion(newQuestion)
  if (newTopics.length === 0) return { covered: false, matchedTopic: null, matchedQuestion: null }

  for (const turn of previousTurns) {
    const prevTopics = extractTopicsFromQuestion(turn.question)
    const overlap = newTopics.filter(t => prevTopics.includes(t))
    if (overlap.length > 0) {
      return { covered: true, matchedTopic: overlap[0], matchedQuestion: turn.question }
    }
  }
  return { covered: false, matchedTopic: null, matchedQuestion: null }
}

// ===== TOOL DEFINITION — lets the LLM query asked-question history =====

const GET_ASKED_QUESTIONS_TOOL = {
  type: 'function' as const,
  function: {
    name: 'get_asked_questions',
    description:
      'Returns the history of every question asked so far, the user\'s answers, and which semantic topics each question covered. ' +
      'Call this BEFORE generating your question to avoid asking about topics already covered.',
    parameters: {
      type: 'object' as const,
      properties: {} as Record<string, unknown>,
      required: [] as string[],
    },
  },
}

const GET_REMAINING_CANDIDATES_TOOL = {
  type: 'function' as const,
  function: {
    name: 'get_remaining_candidates',
    description:
      'Returns how many candidate characters are still in contention, their names, and a ' +
      '"discriminating_traits" map showing how each trait splits the pool ' +
      '(e.g., {"nationality": {"american": 10, "british": 2}}). ' +
      'Call this to see who is still possible and which trait would best divide them.',
    parameters: {
      type: 'object' as const,
      properties: {} as Record<string, unknown>,
      required: [] as string[],
    },
  },
}

const GET_BEST_QUESTION_TOOL = {
  type: 'function' as const,
  function: {
    name: 'get_best_question',
    description:
      'Returns the statistically optimal yes/no question computed by Shannon-entropy analysis ' +
      'of the remaining candidates. You may adopt this question or override it with your own. ' +
      'Returns null if no optimal question could be determined.',
    parameters: {
      type: 'object' as const,
      properties: {} as Record<string, unknown>,
      required: [] as string[],
    },
  },
}

const LOOKUP_CHARACTER_TOOL = {
  type: 'function' as const,
  function: {
    name: 'lookup_character',
    description:
      'Looks up a specific character by name in the knowledge base. ' +
      'Returns whether the character exists, their full trait set, and a compatibility score (0–1) ' +
      'against the confirmed traits so far. Use this to sanity-check a potential guess.',
    parameters: {
      type: 'object' as const,
      properties: {
        name: {
          type: 'string',
          description: 'The full character name to look up (case-insensitive)',
        },
      },
      required: ['name'] as string[],
    },
  },
}

const GET_CHARACTER_SAMPLE_TOOL = {
  type: 'function' as const,
  function: {
    name: 'get_character_sample',
    description:
      'Get detailed information about up to 3 specific characters by name. ' +
      'Use this to inspect and compare top candidates to identify discriminating questions. ' +
      'Example: If top 5 includes "Tom Hanks" and "Tom Cruise", call this to see their full data ' +
      '(works, nationality, genres) and identify a good discriminating question.',
    parameters: {
      type: 'object' as const,
      properties: {
        names: {
          type: 'array',
          items: { type: 'string' },
          description: 'Character names to inspect (up to 3)',
          maxItems: 3,
        },
      },
      required: ['names'] as string[],
    },
  },
}

const GET_DISCRIMINATING_TRAITS_TOOL = {
  type: 'function' as const,
  function: {
    name: 'get_discriminating_traits',
    description:
      'Automatically analyze what traits differ between the top remaining candidates. ' +
      'Returns the most important differences and suggests good discriminating questions. ' +
      'Use this when you have multiple top candidates and need to identify the best question to ask.',
    parameters: {
      type: 'object' as const,
      properties: {
        top_n: {
          type: 'number',
          description: 'Number of top candidates to analyze (default 5, max 10)',
          default: 5,
        },
      },
    },
  },
}

function buildDiscriminatingTraitsToolResponse(
  topN: number,
  remainingCandidates: CharacterData[]
): string {
  const n = Math.min(Math.max(1, topN || 5), 10)
  const topCandidates = remainingCandidates.slice(0, n)

  if (topCandidates.length === 0) {
    return JSON.stringify({ discriminators: [], note: 'No candidates remaining' })
  }

  if (topCandidates.length === 1) {
    return JSON.stringify({
      discriminators: [],
      note: `Only 1 candidate remains: ${topCandidates[0].name}`,
      suggestion: 'Make a guess now',
    })
  }

  const discriminators: Array<{
    trait: string
    split: string
    suggested_question: string
    priority: number
  }> = []

  // Check alive/dead split
  const alive = topCandidates.filter(c => c.traits.alive === true).length
  const dead = topCandidates.filter(c => c.traits.alive === false).length
  if (alive > 0 && dead > 0) {
    discriminators.push({
      trait: 'alive',
      split: `${alive} alive, ${dead} deceased`,
      suggested_question: 'Is your character still alive today?',
      priority: 1,
    })
  }

  // Check gender split
  const male = topCandidates.filter(c => c.traits.gender === 'male').length
  const female = topCandidates.filter(c => c.traits.gender === 'female').length
  if (male > 0 && female > 0) {
    discriminators.push({
      trait: 'gender',
      split: `${male} male, ${female} female`,
      suggested_question: 'Is your character male?',
      priority: 1,
    })
  }

  // Check nationality split
  const nationalities = new Map<string, number>()
  topCandidates.forEach(c => {
    const nat = c.traits.nationality || 'unknown'
    nationalities.set(nat, (nationalities.get(nat) || 0) + 1)
  })
  if (nationalities.size > 1 && !nationalities.has('unknown')) {
    const splits = Array.from(nationalities.entries())
      .sort((a, b) => b[1] - a[1])
      .map(([nat, count]) => `${count} ${nat}`)
      .join(', ')
    const mostCommon = Array.from(nationalities.entries()).sort((a, b) => b[1] - a[1])[0][0]
    discriminators.push({
      trait: 'nationality',
      split: splits,
      suggested_question: `Is your character ${mostCommon === 'United States' ? 'American' : mostCommon}?`,
      priority: 2,
    })
  }

  // Check category split
  const categories = new Map<string, number>()
  topCandidates.forEach(c => {
    categories.set(c.category, (categories.get(c.category) || 0) + 1)
  })
  if (categories.size > 1) {
    const splits = Array.from(categories.entries())
      .sort((a, b) => b[1] - a[1])
      .map(([cat, count]) => `${count} ${cat}`)
      .join(', ')
    const mostCommon = Array.from(categories.entries()).sort((a, b) => b[1] - a[1])[0][0]
    discriminators.push({
      trait: 'category',
      split: splits,
      suggested_question: `Is your character ${mostCommon === 'actors' ? 'an actor' : mostCommon === 'athletes' ? 'an athlete' : 'a ' + mostCommon.slice(0, -1)}?`,
      priority: 1,
    })
  }

  // Check birth decade split (for real people)
  const decades = new Map<number, number>()
  topCandidates.forEach(c => {
    if (c.traits.birth_decade != null) {
      decades.set(c.traits.birth_decade, (decades.get(c.traits.birth_decade) || 0) + 1)
    }
  })
  if (decades.size >= 2) {
    const splits = Array.from(decades.entries())
      .sort((a, b) => a[0] - b[0])
      .map(([decade, count]) => `${count} born ${decade}s`)
      .join(', ')
    const medianDecade = Array.from(decades.keys()).sort((a, b) => a - b)[Math.floor(decades.size / 2)]
    const threshold = medianDecade + (medianDecade < 1980 ? 20 : 0)
    discriminators.push({
      trait: 'birth_decade',
      split: splits,
      suggested_question: `Was this person born before ${threshold}?`,
      priority: 2,
    })
  }

  // Sort by priority (1 = highest)
  discriminators.sort((a, b) => a.priority - b.priority)

  return JSON.stringify({
    analyzed_candidates: topCandidates.map(c => c.name),
    discriminators: discriminators.slice(0, 5),  // Return top 5 discriminators
    recommendation:
      discriminators.length > 0
        ? `Best question: "${discriminators[0].suggested_question}" (splits: ${discriminators[0].split})`
        : 'Top candidates are very similar. Ask about specific works or characteristics.',
  }, null, 2)
}

function buildCharacterSampleToolResponse(names: string[]): string {
  if (!names || names.length === 0) {
    return JSON.stringify({ error: 'names parameter is required and must be a non-empty array' })
  }

  if (names.length > 3) {
    return JSON.stringify({ error: 'Maximum 3 characters allowed per request' })
  }

  const results = names.map(name => {
    const char = getCharacterByName(name)
    if (!char) {
      return { name, found: false }
    }

    return {
      found: true,
      name: char.name,
      category: char.category,
      traits: {
        fictional: char.traits.fictional,
        gender: char.traits.gender,
        nationality: char.traits.nationality,
        alive: char.traits.alive,
        birth_decade: char.traits.birth_decade,
      },
      distinctive_facts: char.distinctive_facts.slice(0, 3),
      signature_works: char.signature_works.slice(0, 3).map(w => ({
        name: w.name,
        type: w.type,
        year: w.year,
      })),
      relationships: {
        spouse: char.relationships?.spouse || [],
        children: char.relationships?.children || [],
        in_db: char.relationships?.in_db || [],
      },
      sitelink_count: char.sitelink_count,
    }
  })

  return JSON.stringify({ characters: results }, null, 2)
}

function buildQuestionHistoryToolResponse(
  turns: Array<{ question: string; answer: AnswerValue }>
): string {
  if (turns.length === 0) {
    return JSON.stringify({
      questions_asked: 0,
      covered_topics: [],
      available_topics: Object.keys(QUESTION_TOPICS).slice(0, 10),
      suggestion: 'No questions asked yet. Start with broad categories: fictional status, gender, category (actor/athlete/musician/etc.)',
    })
  }

  const coveredTopicSet = new Set<string>()
  const history = turns.map((t, i) => {
    const topics = extractTopicsFromQuestion(t.question)
    topics.forEach(tp => coveredTopicSet.add(tp))
    return { number: i + 1, question: t.question, answer: t.answer, topics }
  })

  const coveredTopics = Array.from(coveredTopicSet)
  const avoidance = coveredTopics.map(topic => {
    const keywords = QUESTION_TOPICS[topic] || []
    return `"${topic}" — avoid words like: ${keywords.slice(0, 4).join(', ')}`
  })
  const uncoveredTopics = Object.keys(QUESTION_TOPICS).filter(t => !coveredTopicSet.has(t))

  return JSON.stringify({
    questions_asked: turns.length,
    history,
    covered_topics: coveredTopics,
    do_not_ask_about: avoidance,
    available_topics: uncoveredTopics.slice(0, 12),
    instruction: 'Your next question MUST be about one of the available_topics, NOT the covered_topics.',
  }, null, 2)
}

function buildRemainingCandidatesToolResponse(
  remainingCandidates: CharacterData[]
): string {
  if (remainingCandidates.length === 0) {
    return JSON.stringify({ count: 0, names: [], discriminating_traits: {} })
  }

  // Tally each trait value across all remaining candidates
  const tally: Record<string, Record<string, number>> = {}

  for (const char of remainingCandidates) {
    // Top-level category field
    if (char.category) {
      tally['category'] = tally['category'] || {}
      tally['category'][char.category] = (tally['category'][char.category] || 0) + 1
    }
    // All fields inside .traits — guard against null/undefined traits
    if (char.traits) {
      for (const [key, val] of Object.entries(char.traits)) {
        if (val === null || val === undefined) continue
        const strVal = String(val)
        tally[key] = tally[key] || {}
        tally[key][strVal] = (tally[key][strVal] || 0) + 1
      }
    }
  }

  // Only include traits that actually vary (more than one distinct value)
  // For large pools, also cap to at most 8 most-balanced discriminating traits
  const discriminating: Record<string, Record<string, number>> = {}
  const n = remainingCandidates.length
  const traitEntries = Object.entries(tally).filter(([, values]) => Object.keys(values).length > 1)
  // Sort by how evenly the trait splits the pool (closest to 50/50 = most useful)
  traitEntries.sort(([, aVals], [, bVals]) => {
    const aMax = Math.max(...Object.values(aVals))
    const bMax = Math.max(...Object.values(bVals))
    // Lower max = more balanced split = better discriminator
    return aMax - bMax
  })
  for (const [key, values] of traitEntries.slice(0, 8)) {
    discriminating[key] = values
  }

  // For large pools (>50), omit names to keep the token footprint small
  const names = n <= 50
    ? remainingCandidates.slice(0, 30).map(c => c.name)
    : []
  const note = n > 50
    ? `Too many candidates to enumerate (${n}). Use discriminating_traits to pick the next question.`
    : undefined

  return JSON.stringify({
    count: n,
    ...(note ? { note } : {}),
    names,
    discriminating_traits: discriminating,
  }, null, 2)
}

function buildBestQuestionToolResponse(
  strategicQuestion: string | null,
  remainingCandidates: CharacterData[],
  turns: Array<{ question: string; answer: AnswerValue }>
): string {
  if (!strategicQuestion) {
    return JSON.stringify({
      question: null,
      reason: 'No optimal question found — candidates may be too few or all entropy questions already asked.',
      candidates_remaining: remainingCandidates.length,
    })
  }
  const approxSplit = Math.round(remainingCandidates.length / 2)
  return JSON.stringify({
    question: strategicQuestion,
    reason:
      `Shannon-entropy optimal for ${remainingCandidates.length} remaining candidates. ` +
      `Expected to split approximately ${approxSplit} yes / ${remainingCandidates.length - approxSplit} no.`,
    candidates_remaining: remainingCandidates.length,
    turns_asked: turns.length,
  })
}

function buildLookupCharacterToolResponse(
  name: string,
  traits: Trait[]
): string {
  if (!name.trim()) {
    return JSON.stringify({ error: 'name parameter is required' })
  }
  const char = getCharacterByName(name)
  if (!char) {
    return JSON.stringify({
      found: false,
      name,
      message: `"${name}" is not in the character knowledge base.`,
    })
  }
  const score = scoreCharacterMatch(char, traits)
  return JSON.stringify({
    found: true,
    name: char.name,
    category: char.category,
    traits: char.traits,
    distinctive_facts: char.distinctive_facts.slice(0, 5),
    signature_works: char.signature_works.slice(0, 5).map(w => ({
      name: w.name,
      type: w.type,
      year: w.year,
    })),
    compatibility_score: Math.round(score * 100) / 100,
    compatibility_label:
      score >= 0.8 ? 'strong match' : score >= 0.5 ? 'partial match' : 'weak match',
  }, null, 2)
}

/**
 * System prompt for RAG-enhanced detective
 */
const RAG_DETECTIVE_SYSTEM_PROMPT = `You are an expert detective in a character-guessing game (like Akinator). You have access to a knowledge base of 530 characters and must guess the user's character in ~10 questions.

**CRITICAL RULES:**
1. Ask ONLY yes/no questions about TRAITS or CATEGORIES — NEVER name a specific character in your question
2. Use the "Remaining Candidates" context to focus your questions
3. Ask questions that eliminate ~50% of remaining candidates (information gain)
4. When you have 3-5 candidates left, ask SPECIFIC differentiating questions about TRAITS, not character names
5. Make a guess when confidence ≥ 0.95 OR remaining candidates ≤ 2
6. **DO NOT ask about:** Specific dates, specific physical features (too specific, can't be tracked)
7. **For awards:** "Has your character won an Oscar?" is a good question for actors (most players know Oscar winners). Avoid other awards (Emmy, Grammy, Golden Globe) — too obscure.
8. **For ACTORS:** Ask about Oscar status, alive/dead, genres (comedy/drama/sci-fi), and nationality. Examples: "Has your character won an Oscar?", "Is your character still alive today?", "Is your character known for comedy?", "Is your character from the United Kingdom?"
9. **ONLY ask about:** Category, fictional status, gender, powers, alignment, origin medium, team membership, nationality (broad - American/British/European only), movie genres, franchises, time period (e.g., "active before 2000?")
10. **NEVER ask "Is your character [Character Name]?"** — naming a specific character is a GUESS, not a question. Only the game system makes guesses.
11. **NEVER ask questions that contradict previous answers.** If user confirmed "sitcom", do NOT ask about "drama". If user confirmed "basketball", do NOT ask about "soccer".

**CATEGORY LOGIC (CRITICAL):**
Once a character's primary category is confirmed (e.g., actor, athlete, musician, politician):
- **DO NOT ask about other categories** unless narrowing down is stuck
- Example: If confirmed "actor" → don't ask "athlete?", "musician?", "politician?"
- Exception: Some characters have overlapping roles (actor/musician) - only ask if top candidates suggest this
- Focus on traits within that category: era, specific works, characteristics, teams

**MUTUAL EXCLUSIVITY:**
Don't ask contradictory questions:
- If sitcom confirmed → don't ask about drama or animated shows
- If drama confirmed → don't ask about sitcoms or animated shows
- If superhero confirmed → focus on DC/Marvel, not other categories

**CROSS-TRAIT LOGICAL INFERENCE (CRITICAL):**
- If fictional=false (real person): NEVER ask about superpowers, supernatural abilities, magic, secret identity, anime/comic/video game origins
- If character confirmed STILL ALIVE: NEVER ask "Is your character a historical figure (died before 1950)?" or any question implying they are dead/deceased
- If character confirmed DEAD/DECEASED: NEVER ask "Is your character still alive?" or "currently active/in office"
- If has_powers=false: NEVER ask about flight, teleportation, super strength, telepathy, magic, or any superpower
- If fictional=true: NEVER ask about winning real awards (Oscar, Grammy), being elected to real political office

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
- Once category is known: Focus on discriminating within that category

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
- media_origin (anime, movie, tv, video-game, comic-book)
- has_powers (true/false) - Supernatural/superhuman abilities
- alignment (hero, villain)
- species (human, alien, robot, god, animal, etc.)
- age_group (child, teenager, adult)
- nationality (american, british, japanese, etc.)
- has_oscar (true/false) — Has the actor/real person won an Academy Award/Oscar
- is_alive (true/false) — Is the real person currently alive (not deceased)

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
   - "Won an Oscar?" + "no" → {"key": "has_oscar", "value": "false", "confidence": 0.85}
   - "Still alive?" + "no" → {"key": "is_alive", "value": "false", "confidence": 0.85}

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
     * media_origin=movie (from Marvel movies)
     * category=superheroes (a superhero character)
   - Someone thinking of the character (not the actor) would say "yes" to fictional
   - Someone thinking of Robert Downey Jr. (the actor) would say "no" to fictional
   - Both interpretations are valid!
   
6. Return null if question doesn't clearly map to any available trait
   
7. **Handle complex/negative questions:**
   - "Does your character originate from a country other than X?" → Return null (too specific, no geography trait)
   - "Is your character known for X or Y?" → Extract the main category
   - If question is overly complex or compound, return null

**EXAMPLES (note: some questions can extract MULTIPLE traits):**
Q: "Is your character American?" A: "Yes" → [{"key": "nationality", "value": "american", "confidence": 0.95}]
Q: "Is your character American?" A: "No" → [{"key": "nationality", "value": "NOT_american", "confidence": 0.9}]
Q: "Is your character British?" A: "Yes" → [{"key": "nationality", "value": "british", "confidence": 0.95}]
Q: "Is your character an actor?" A: "Yes" → [{"key": "category", "value": "actors", "confidence": 0.95}]
Q: "Is your character an actor?" A: "No" → [{"key": "category", "value": "NOT_actors", "confidence": 0.9}]
Q: "Is your character an athlete?" A: "Yes" → [{"key": "category", "value": "athletes", "confidence": 0.95}]
Q: "Is your character an athlete?" A: "No" → [{"key": "category", "value": "NOT_athletes", "confidence": 0.9}]
Q: "Is your character a musician or singer?" A: "No" → [{"key": "category", "value": "NOT_musicians", "confidence": 0.9}]
Q: "Is your character fictional?" A: "Yes" → [{"key": "fictional", "value": "true", "confidence": 0.95}]
Q: "Is your character fictional?" A: "No" → [{"key": "fictional", "value": "false", "confidence": 0.95}]
Q: "Is your character male?" A: "Yes" → [{"key": "gender", "value": "male", "confidence": 0.95}]
Q: "Is your character male?" A: "No" → [{"key": "gender", "value": "female", "confidence": 0.9}]
Q: "Is your character male?" A: "Probably" → [{"key": "gender", "value": "male", "confidence": 0.75}]
Q: "Is your character male?" A: "Probably not" → [{"key": "gender", "value": "female", "confidence": 0.70}]
Q: "Is your character still alive today?" A: "Yes" → [{"key": "is_alive", "value": "true", "confidence": 0.85}]
Q: "Is your character still alive today?" A: "No" → [{"key": "is_alive", "value": "false", "confidence": 0.85}]
Q: "Is your character from the UK?" A: "Yes" → [{"key": "nationality", "value": "british", "confidence": 0.95}]
Q: "Is your character Japanese?" A: "Yes" → [{"key": "nationality", "value": "japanese", "confidence": 0.95}]
Q: "Was your character active before 2000?" A: "Yes" → [] (no era trait available — return empty)
Q: "Was your character active before 2000?" A: "No" → [] (no era trait available — return empty)
Q: "Was your character active in the 2000s or later?" A: "Yes" → [] (no era trait available — return empty)
Q: "Was your character active in the 2000s or later?" A: "No" → [] (no era trait available — return empty)
Q: "Does your character have superpowers?" A: "Yes" → [{"key": "has_powers", "value": "true", "confidence": 0.95}]
Q: "Does your character have superpowers?" A: "Probably not" → [{"key": "has_powers", "value": "false", "confidence": 0.70}]
Q: "Is your character known for football?" A: "No" → [] (sport trait not available)
Q: "Has your character won an Oscar?" A: "Yes" → [{"key": "has_oscar", "value": "true", "confidence": 0.9}]
Q: "Has your character won an Oscar?" A: "No" → [{"key": "has_oscar", "value": "false", "confidence": 0.85}]
Q: "Has your character won an Academy Award?" A: "Yes" → [{"key": "has_oscar", "value": "true", "confidence": 0.9}]
Q: "Is your character known for dramatic or serious roles?" A: "Yes" → [] (no genre trait available — return empty)
Q: "Is your character known for dramatic or serious roles?" A: "No" → [] (no genre trait available — return empty)
Q: "Is your character known for comedy movies or shows?" A: "Yes" → [] (no genre trait available — return empty)
Q: "Is your character known for comedy movies or shows?" A: "No" → [] (no genre trait available — return empty)
Q: "Has your character appeared in a crime or thriller movie?" A: "Yes" → [] (no genre trait available — return empty)
Q: "Has your character starred in a war or historical movie?" A: "Yes" → [] (no genre trait available — return empty)
Q: "Is your character primarily known for action movies?" A: "Yes" → [] (no genre trait available — return empty)
Q: "Has your character appeared in a sci-fi or fantasy movie?" A: "Yes" → [] (no genre trait available — return empty)
Q: "Does your character originate from a country other than the United States?" A: "Yes" → [{"key": "nationality", "value": "NOT_american", "confidence": 0.8}]
Q: "Is your character American?" A: "No" → [{"key": "nationality", "value": "NOT_american", "confidence": 0.9}]
Q: "Did your character originate in an anime or manga?" A: "Yes" → [{"key": "category", "value": "anime", "confidence": 0.95}]
Q: "Did your character originate in an anime or manga?" A: "Yes" → [{"key": "category", "value": "anime", "confidence": 0.95}]
Q: "Did your character originate in a TV show?" A: "Yes" → [{"key": "category", "value": "tv-characters", "confidence": 0.95}]
Q: "Did your character originate in a sitcom?" A: "Yes" → [{"key": "category", "value": "tv-characters", "confidence": 0.9}, {"key": "tv_show_type", "value": "sitcom", "confidence": 0.9}]
Q: "Did your character originate in an animated show?" A: "Yes" → [{"key": "category", "value": "tv-characters", "confidence": 0.9}, {"key": "tv_show_type", "value": "animated", "confidence": 0.9}]
Q: "Did your character originate in a drama series?" A: "Yes" → [{"key": "category", "value": "tv-characters", "confidence": 0.9}, {"key": "tv_show_type", "value": "drama", "confidence": 0.9}]
Q: "Did your character originate in a video game?" A: "Yes" → [{"key": "category", "value": "video-games", "confidence": 0.95}]

MULTI-TRAIT EXTRACTION: If the question or answer implies multiple traits, extract ALL of them:
Q: "Is your character a Marvel superhero?" A: "Yes" → [{"key": "category", "value": "superheroes", "confidence": 0.95}, {"key": "publisher", "value": "marvel", "confidence": 0.9}]
Q: "Is your character a male athlete?" A: "Yes" → [{"key": "category", "value": "athletes", "confidence": 0.95}, {"key": "gender", "value": "male", "confidence": 0.95}]

Return an array of traits (can be empty []). Always prefer extracting MORE traits when information is available.`

/**
 * Extract traits from question + answer (can return multiple traits)
 */
async function extractTraits(
  question: string,
  answer: AnswerValue,
  turnAdded: number,
  validTraitKeys?: string[],
  existingTraits?: Trait[]
): Promise<Trait[]> {
  if (answer === 'dont_know') {
    console.warn('[Detective-RAG] User answered "dont_know", skipping trait extraction')
    return []
  }

  let contextualHint = ''
  if (validTraitKeys && validTraitKeys.length > 0) {
    contextualHint = `\n\nVALID TRAIT KEYS (only use these): ${validTraitKeys.join(', ')}`
  }

  // Add existing traits context to prevent contradictions
  let existingTraitsContext = ''
  if (existingTraits && existingTraits.length > 0) {
    const traitsList = existingTraits
      .map(t => `${t.key}=${t.value}`)
      .join(', ')
    existingTraitsContext = `\n\nEXISTING TRAITS (DO NOT contradict these): ${traitsList}

CRITICAL: If the new answer contradicts existing traits, return an empty array []. For example:
- If category=actors exists, DO NOT extract category=NOT_actors
- If gender=male exists, DO NOT extract gender=female
- If fictional=true exists, DO NOT extract fictional=false`
  }

  const prompt = `Question: "${question}"
Answer: "${ANSWER_LABELS[answer]}"

CRITICAL: Match the question topic precisely. Don't infer unrelated traits.
Extract trait(s) as a JSON array.${contextualHint}${existingTraitsContext}`

  // Debug logging to verify existing traits are being passed
  if (existingTraits && existingTraits.length > 0) {
    console.info(`[Detective-RAG] 🛡️ Contradiction protection active - existing traits:`, 
                 existingTraits.map(t => `${t.key}=${t.value}`).join(', '))
  }

  try {
    const response = await chatCompletion({
      model: DETECTIVE_MODEL,
      messages: [
        { role: 'system', content: TRAIT_EXTRACTOR_PROMPT },
        { role: 'user', content: prompt }
      ],
      temperature: 0.1,
      max_tokens: 150,
    })

    const raw = response.choices[0]?.message?.content || ''
    console.info('[Detective-RAG] extractTraits raw:', raw)
    
    let traits = parseTraits(raw)

    if (traits.length === 0) {
      console.warn('[Detective-RAG] No valid traits extracted from:', raw)
      return []
    }

    // REAL PERSON GUARD: if fictional=false is already established, filter out
    // impossible traits like has_powers=true (real people don't have superpowers).
    // This prevents the LLM from hallucinating powers from "appeared in sci-fi movie".
    const fictionalIsKnownFalse = existingTraits?.some(
      t => t.key === 'fictional' && t.value === 'false' && t.confidence >= 0.85
    )
    if (fictionalIsKnownFalse) {
      const before = traits.length
      traits = traits.filter(t => !(t.key === 'has_powers' && t.value === 'true'))
      if (traits.length < before) {
        console.warn('[Detective-RAG] 🚫 Filtered has_powers=true for confirmed real person')
      }
    }

    // CRITICAL: Validate extracted traits don't contradict existing traits
    if (existingTraits && existingTraits.length > 0) {
      const contradictions = traits.filter(newTrait => {
        return existingTraits.some(existingTrait => {
          // Same key but different value (for single-valued traits)
          if (newTrait.key === existingTrait.key && newTrait.key !== 'category' && newTrait.key !== 'media_origin') {
            // Allow same value (redundant but not contradictory)
            if (newTrait.value === existingTrait.value) return false
            
            console.warn(`[Detective-RAG] ❌ CONTRADICTION: Existing ${existingTrait.key}=${existingTrait.value}, new ${newTrait.key}=${newTrait.value}`)
            return true
          }
          
          // For category/media_origin: check NOT_X vs X contradictions
          if (newTrait.key === existingTrait.key && (newTrait.key === 'category' || newTrait.key === 'media_origin')) {
            const newIsNegative = newTrait.value.startsWith('NOT_')
            const existingIsNegative = existingTrait.value.startsWith('NOT_')
            const newBase = newIsNegative ? newTrait.value.slice(4) : newTrait.value
            const existingBase = existingIsNegative ? existingTrait.value.slice(4) : existingTrait.value
            
            // Contradiction: NOT_X conflicts with X (or vice versa)
            if (newBase === existingBase && newIsNegative !== existingIsNegative) {
              console.warn(`[Detective-RAG] ❌ CONTRADICTION: Existing ${existingTrait.key}=${existingTrait.value}, new ${newTrait.key}=${newTrait.value}`)
              return true
            }
          }
          
          return false
        })
      })
      
      if (contradictions.length > 0) {
        console.error('[Detective-RAG] 🚨 Rejected contradictory traits:', contradictions.map(t => `${t.key}=${t.value}`).join(', '))
        return []  // Return empty array if ANY contradiction found
      }
    }
    
    // Add turnAdded to all traits
    const traitsWithTurn = traits.map(t => ({ ...t, turnAdded }))
    
    console.info(`[Detective-RAG] ✅ Extracted ${traitsWithTurn.length} trait(s):`, 
                 traitsWithTurn.map(t => `${t.key}=${t.value}`).join(', '))
    
    return traitsWithTurn
  } catch (error) {
    console.error('[Detective-RAG] FAILED to extract traits:', error)
    return []
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
 * Detect if a question is naming a specific character rather than asking about a trait.
 * Questions like "Is your character Dennis the Menace?" or "Is your character Spider-Man?"
 * should be treated as guesses, not questions. Only the formal guess logic should do this.
 */
function isCharacterNameQuestion(question: string): boolean {
  // Match pattern: "Is your character [Name]?" where Name is NOT a trait descriptor
  // Enhanced regex to support hyphens, apostrophes, numbers, and single letters
  const guessMatch = question.match(/^Is your character (.+)\?$/i)
  if (!guessMatch) return false

  const captured = guessMatch[1].trim()

  // List of trait keywords — if the captured part contains these, it's a trait question, not a name
  const traitKeywords = [
    'american', 'male', 'female', 'fictional', 'real',
    'an actor', 'an athlete', 'a musician', 'a politician', 'a superhero',
    'from a', 'from an', 'from the', 'known for', 'alive', 'dead', 'still alive',
    'a villain', 'a hero', 'a leader', 'in a band', 'a rapper',
    'a basketball', 'a soccer', 'a baseball', 'a combat',
    'well-known', 'internationally', 'primarily',
    'associated with', 'part of', 'based on',
    'historical', 'a historical', 'figure', 'person', 'individual',
    'someone', 'anybody', 'character who', 'character that',
    'active', 'famous', 'known', 'celebrated', 'renowned',
  ]

  const capturedLower = captured.toLowerCase()
  // Use word-boundary matching to avoid false positives like "male" matching "Malek"
  if (traitKeywords.some(kw => {
    const escaped = kw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    return new RegExp('\\b' + escaped + '\\b').test(capturedLower)
  })) {
    return false // It's a trait question
  }

  // Enhanced pattern to match names with hyphens, apostrophes, numbers, single letters
  // Examples: "Spider-Man", "O'Neill", "C-3PO", "X", "Mary-Jane Watson"
  const hasNamePattern = /^[A-Z][A-Za-z0-9'-]*(?:\s+[A-Z][A-Za-z0-9'-]*)*$/.test(captured) ||
                        /^[A-Z]$/.test(captured)  // Single capital letter names like "X" or "L"
  const looksLikeName = hasNamePattern && captured.split(/\s+/).length <= 6

  // Also check the knowledge base
  const knownCharacter = getCharacterByName(captured)

  if (knownCharacter || looksLikeName) {
    return true
  }

  return false
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
  // OPTIMIZATION: Try strict filtering first (fast), fall back to fuzzy if needed
  let remainingCandidates = filterCharactersByTraits(traits)
  console.info(`[Detective-RAG] ${remainingCandidates.length} candidates match with strict filtering`)
  
  // WIKIPEDIA AUGMENTATION: Only after a positive category is determined
  // This expands beyond the 407-character database to find additional matches
  // We need a confirmed category (not NOT_X) to build meaningful Wikipedia queries
  // Controlled by ENABLE_WIKIPEDIA_SEARCH flag in constants.ts
  let wikipediaNames: string[] = []
  if (ENABLE_WIKIPEDIA_SEARCH) {
    const hasPositiveCategory = traits.some(t =>
      t.key === 'category' &&
      !t.value.startsWith('NOT_') &&
      t.confidence >= 0.85
    )

    if (turns.length >= 5 && hasPositiveCategory) {
      console.info('[Detective-RAG] Positive category confirmed: Fetching supplemental characters from Wikipedia...')
      try {
        wikipediaNames = await getWikipediaSupplementalCharacters(traits)
        if (wikipediaNames.length > 0) {
          console.info(`[Wikipedia] ✓ Found ${wikipediaNames.length} supplemental characters`)
          console.info(`[Wikipedia] Sample names:`, wikipediaNames.slice(0, 10).join(', '))
        }
      } catch (error) {
        console.warn('[Wikipedia] Failed to fetch supplemental characters:', error)
      }
    } else if (turns.length >= 5) {
      console.info('[Detective-RAG] No positive category yet - skipping Wikipedia search')
    }
  }
  
  // If strict filtering returns too few results, use fuzzy matching
  if (remainingCandidates.length === 0 && traits.length > 2) {
    console.info('[Detective-RAG] Strict filtering found 0 candidates, trying fuzzy matching...')
    remainingCandidates = filterCharactersFuzzy(traits, 0.7)
    console.info(`[Detective-RAG] Fuzzy matching (0.7): ${remainingCandidates.length} candidates`)
  }

  // CRITICAL: Handle 0 candidates - character not in database
  // Use LLM guessing after sufficient questions (15-20+) instead of waiting for 30+
  if (remainingCandidates.length === 0 && traits.length > 0) {
    console.warn('[Detective-RAG] WARNING: No matches even with fuzzy matching')
    console.warn('[Detective-RAG] Character may not be in knowledge base')
    console.warn('[Detective-RAG] Confirmed traits:', JSON.stringify(traits, null, 2))
    
    // Try even more relaxed fuzzy matching
    const veryRelaxedCandidates = filterCharactersFuzzy(traits, 0.5)
    console.warn(`[Detective-RAG] Very relaxed fuzzy (0.5 threshold): ${veryRelaxedCandidates.length} candidates`)
    
    const traitSummary = traits.map(t => `${t.key}=${t.value}`).join(', ')
    console.warn(`[Detective-RAG] Looking for character with: ${traitSummary}`)
    
    // STRATEGY: Use LLM guessing after moderate questioning (15+), not as absolute last resort
    // Database characters should NOT be prioritized over non-database characters
    const shouldUseLLMGuessing = turns.length >= 15
    
    // Try filtering with fewer traits (relax most recent trait)
    if (traits.length > 1 && !shouldUseLLMGuessing && veryRelaxedCandidates.length === 0) {
      const relaxedTraits = traits.slice(0, -1)
      const relaxedCandidates = filterCharactersByTraits(relaxedTraits)
      console.info(`[Detective-RAG] Strict filtering with fewer traits: ${relaxedCandidates.length} candidates with ${relaxedTraits.length} traits`)
      
      if (relaxedCandidates.length > 0) {
        // Continue with relaxed filtering - try to narrow down further
        const relaxedGuesses = getRagTopGuesses(relaxedTraits, 5)
        console.info('[Detective-RAG] Using relaxed filtering to continue game')
        console.info('[Detective-RAG] Top guesses with relaxed traits:', relaxedGuesses.map(g => g.name))
        
        // If we have very few candidates, make a direct guess
        // CRITICAL: Be conservative - need MANY turns before guessing from relaxed filtering
        // Relaxed filtering means we dropped a trait, so we have LESS information
        if (relaxedCandidates.length <= 3 && turns.length >= 18) {
          console.info('[Detective-RAG] Very few candidates with relaxed filtering, making direct guess')
          const topGuess = relaxedGuesses[0]
          if (topGuess) {
            return {
              question: `Is your character ${topGuess.name}?`,
              topGuesses: [{ 
                name: topGuess.name, 
                confidence: topGuess.confidence * 0.6  // Reduced confidence due to relaxed filtering
              }]
            }
          }
        }
        
        // Otherwise, try to ask a strategic question to narrow down
        const strategicQuestion = getMostInformativeQuestion(
          relaxedCandidates,
          turns.map(t => t.question),
          traits,  // Pass traits for logical inference
          turns    // Pass full turn history for contradiction detection
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
        
        // Fallback: make a direct guess only after MANY questions
        // This path means we have 0 exact matches and no strategic question available
        // Should only guess as absolute last resort
        if (turns.length >= 22) {
          const topGuess = relaxedGuesses[0]
          if (topGuess) {
            console.info('[Detective-RAG] No strategic question available, making last-resort guess')
            return {
              question: `Is your character ${topGuess.name}?`,
              topGuesses: [{ 
                name: topGuess.name, 
                confidence: topGuess.confidence * 0.5  // Very low confidence - desperate guess
              }]
            }
          }
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
      
      // Pick a broad question not yet asked AND logically consistent
      const askedQuestions = turns.map(t => t.question.toLowerCase())
      const hasFictionalFalse = traits.some(t => t.key === 'fictional' && t.value === 'false')
      const hasFictionalTrue = traits.some(t => t.key === 'fictional' && t.value === 'true')
      
      const nextBroadQuestion = broadQuestions.find(q => {
        const qLower = q.toLowerCase()
        // Skip if already asked
        if (askedQuestions.some(asked => asked.includes(qLower.slice(0, 20)))) {
          return false
        }
        // Skip questions that violate logical implication rules
        if (shouldSkipQuestion(q, traits, turns)) {
          console.info(`[Detective-RAG] Skipping broad question (logical implication): "${q}"`)
          return false
        }
        // Skip "based on real person" if we know they're NOT fictional (i.e., they ARE real)
        if (qLower.includes('based on a real person') && hasFictionalFalse) {
          console.info('[Detective-RAG] Skipping "based on real person" - already know character is NOT fictional (i.e., is real)')
          return false
        }
        // Skip "based on real person" if we know they ARE fictional
        if (qLower.includes('based on a real person') && hasFictionalTrue) {
          console.info('[Detective-RAG] Skipping "based on real person" - already know character IS fictional')
          return false
        }
        return true
      })
      
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
        !askedQuestions.some(asked => asked.includes(q.toLowerCase().slice(0, 15))) &&
        !shouldSkipQuestion(q, traits, turns)
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
      const isFictional = traits.some(t => t.key === 'fictional' && t.value === 'true')
      const isNotFictional = traits.some(t => t.key === 'fictional' && t.value === 'false')
      const hasMale = traits.some(t => t.key === 'gender' && t.value === 'male')
      const hasFemale = traits.some(t => t.key === 'gender' && t.value === 'female')
      
      // Only ask about fictional if we don't already know
      if (!hasFictional) {
        dynamicQuestions.push('Is your character entirely fictional or based on a real person?')
      }
      
      // Fiction-specific questions (only if confirmed fictional)
      if (isFictional) {
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
        !askedQuestions.some(asked => asked.includes(q.toLowerCase().slice(0, 20))) &&
        !shouldSkipQuestion(q, traits, turns)
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
      
      // Make a single direct guess with the top candidate
      const topGuess = guesses[0]
      if (topGuess) {
        return {
          question: `Is your character ${topGuess.name}?`,
          topGuesses: [topGuess]
        }
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

  // Get top guesses from RAG (database) - pass fuzzy-filtered candidates  
  const ragGuessesRaw = getRagTopGuesses(traits, 5, remainingCandidates)
    .filter(g => !rejectedGuesses.some(r => r.toLowerCase() === g.name.toLowerCase()))
  
  // Convert to simple Guess format for consistency with LLM guesses
  const ragGuesses: Guess[] = ragGuessesRaw.map(g => ({ name: g.name, confidence: g.confidence }))
  
  console.info('[Detective-RAG] RAG top guesses:', ragGuesses.map(g => `${g.name} (${Math.round(g.confidence * 100)}%)`))

  // HYBRID APPROACH: Mix database, Wikipedia, and LLM guesses for better coverage
  // But be conservative - only use LLM when database has limited options
  let hybridGuesses: Guess[] = ragGuesses
  
  // Add Wikipedia names with varying confidence based on trait matching
  // Use a simple heuristic: check if name appears in database first for trait scoring
  if (wikipediaNames.length > 0) {
    const wikipediaGuesses: Guess[] = wikipediaNames
      .filter(name => !rejectedGuesses.some(r => r.toLowerCase() === name.toLowerCase()))
      .filter(name => !ragGuesses.some(g => g.name.toLowerCase() === name.toLowerCase()))
      .slice(0, 20) // Check top 20 Wikipedia names
      .map((name, index) => {
        // Try to find in database for trait-based scoring
        const dbChar = getCharacterByName(name)
        let confidence: number
        
        if (dbChar) {
          // Character is in database - use trait-based scoring
          const score = scoreCharacterMatch(dbChar, traits)
          confidence = Math.max(0.45, Math.min(0.70, score)) // Clamp 0.45-0.70
        } else {
          // Not in database - use position-based heuristic with more variance
          // Earlier in list = higher confidence (Wikipedia lists are usually ordered by prominence)
          const positionScore = 1.0 - (index / 20) // 1.0 → 0.0 over 20 items
          confidence = 0.50 + (positionScore * 0.15) // Range: 0.50-0.65
        }
        
        return { name, confidence }
      })
      .sort((a, b) => b.confidence - a.confidence) // Sort by confidence
      .slice(0, 10) // Take top 10 after scoring
    
    if (wikipediaGuesses.length > 0) {
      console.info(`[Wikipedia] Adding ${wikipediaGuesses.length} Wikipedia characters to guess pool`)
      console.info(`[Wikipedia] Top names:`, wikipediaGuesses.slice(0, 5).map(g => `${g.name} (${Math.round(g.confidence * 100)}%)`))
      
      // Merge Wikipedia guesses with database guesses
      const combined = [...ragGuesses, ...wikipediaGuesses]
      const uniqueNames = new Set<string>()
      hybridGuesses = combined
        .filter(g => {
          const lower = g.name.toLowerCase()
          if (uniqueNames.has(lower)) return false
          uniqueNames.add(lower)
          return true
        })
        .sort((a, b) => b.confidence - a.confidence)
        .slice(0, 10) // Keep top 10 overall
      
      console.info('[Detective-RAG] Hybrid guesses (DB + Wikipedia):', hybridGuesses.slice(0, 5).map(g => `${g.name} (${Math.round(g.confidence * 100)}%)`))
    }
  }
  
  // Only augment with LLM if:
  // 1. We have sufficient turns/traits (20+/7+)
  // 2. Database has few candidates (≤3) OR we've rejected many guesses
  const shouldAugmentWithLLM = (
    turns.length >= 20 && 
    traits.length >= 7 && 
    (ragGuesses.length <= 3 || rejectedGuesses.length >= 3)
  )
  
  if (shouldAugmentWithLLM) {
    console.info('[Detective-RAG] Limited database guesses, augmenting with LLM')
    try {
      const llmGuesses = await guessCharacterBeyondDatabase(traits, turns)
      if (llmGuesses && llmGuesses.length > 0) {
        // Mix database and LLM guesses, keeping unique names
        const combined = [...ragGuesses, ...llmGuesses]
        const uniqueNames = new Set<string>()
        hybridGuesses = combined
          .filter(g => {
            const lower = g.name.toLowerCase()
            if (uniqueNames.has(lower)) return false
            uniqueNames.add(lower)
            return true
          })
          .sort((a, b) => b.confidence - a.confidence)
          .slice(0, 5)
        
        console.info('[Detective-RAG] Hybrid guesses (DB + LLM):', hybridGuesses.map(g => `${g.name} (${Math.round(g.confidence * 100)}%)`))
      }
    } catch (error) {
      console.warn('[Detective-RAG] LLM guess augmentation failed:', error)
    }
  }

  // Get context about remaining candidates for the AI
  // Pass turn number for progressive detail (minimal early game, full details late game)
  const candidateContext = getCandidateContext(remainingCandidates, 5, turns.length)

  // CRITICAL: Detect logically unique trait combinations that identify a single person
  // Examples:
  // - "U.S. President" + "currently in office" = only 1 possible person
  // - "Pope" + "currently in office" = only 1 possible person
  // - Any current unique position + confirmation = immediate guess
  // 
  // IMPORTANT: Only use logical deduction if we haven't recently rejected guesses
  // If user rejected a guess, they might have made a mistake or the data is wrong
  // In that case, ask more discriminating questions instead of blindly guessing again
  const askedQuestions = turns.map(t => t.question.toLowerCase())
  const answers = turns.map(t => t.answer.toLowerCase())
  
  // Check if we recently rejected guesses
  const hasRecentRejections = rejectedGuesses.length > 0
  const shouldUseLogicalDeduction = !hasRecentRejections || rejectedGuesses.length > 3
  
  if (shouldUseLogicalDeduction) {
    // Check for "currently in office" pattern with presidents
    const askedAboutPresident = askedQuestions.some(q => 
      q.includes('president') && (q.includes('u.s.') || q.includes('american'))
    )
    const confirmedPresident = askedAboutPresident && turns.some((t, i) => 
      askedQuestions[i].includes('president') && 
      (answers[i] === 'yes' || answers[i] === 'true')
    )
    const currentYear = new Date().getFullYear()
    const askedCurrentlyInOffice = askedQuestions.some(q => 
      (q.includes('currently in office') || q.includes('in office now')) && q.includes(String(currentYear))
    )
    const confirmedCurrentlyInOffice = askedCurrentlyInOffice && turns.some((t, i) => 
      (askedQuestions[i].includes('currently in office') || askedQuestions[i].includes('in office now')) &&
      (answers[i] === 'yes' || answers[i] === 'true')
    )
    
    // If they are the current U.S. president in 2026, there's only ONE person!
    if (confirmedPresident && confirmedCurrentlyInOffice && hybridGuesses.length > 0) {
      console.info('[Detective-RAG] ⚡ LOGICAL DEDUCTION: Current U.S. President in 2026 = unique identification!')
      console.info('[Detective-RAG] Remaining candidates:', remainingCandidates.length)
      console.info('[Detective-RAG] Top candidates:', hybridGuesses.slice(0, 3).map(g => g.name).join(', '))
      console.info('[Detective-RAG] Making immediate guess based on logical uniqueness')
      const topGuess = hybridGuesses[0]
      return {
        question: `Is your character ${topGuess.name}?`,
        topGuesses: [{ 
          name: topGuess.name, 
          confidence: Math.min(0.95, topGuess.confidence) // Cap at 0.95 for logical deduction
        }]
      }
    }
    
    // Check for other uniquely identifying positions with more flexible patterns
    const uniquePositionPatterns = [
      { role: /\bpope\b/i, currently: 'currently' },
      { role: /\bdalai\s+lama\b/i, currently: 'current' },
      { role: /\bsecretary\s+general\b/i, currently: 'current' },
      { role: /\bprime\s+minister\b.*\b(uk|united\s+kingdom|british)\b/i, currently: 'current' },
    ]
    
    for (const pattern of uniquePositionPatterns) {
      const askedAboutRole = askedQuestions.some(q => pattern.role.test(q))
      const confirmedRole = askedAboutRole && turns.some((t, i) => 
        pattern.role.test(askedQuestions[i]) &&
        (answers[i] === 'yes' || answers[i] === 'true')
      )
      const askedCurrent = askedQuestions.some(q => q.includes(pattern.currently))
      const confirmedCurrent = askedCurrent && turns.some((t, i) => 
        askedQuestions[i].includes(pattern.currently) &&
        (answers[i] === 'yes' || answers[i] === 'true')
      )
      
      if (confirmedRole && confirmedCurrent && hybridGuesses.length > 0) {
        console.info(`[Detective-RAG] ⚡ LOGICAL DEDUCTION: Current position = unique identification!`)
        console.info('[Detective-RAG] Making immediate guess based on logical uniqueness')
        const topGuess = hybridGuesses[0]
        return {
          question: `Is your character ${topGuess.name}?`,
          topGuesses: [{ 
            name: topGuess.name, 
            confidence: Math.min(0.95, topGuess.confidence)
          }]
        }
      }
    }
  } else {
    console.info('[Detective-RAG] Skipping logical deduction - recent rejections suggest data may be incorrect or user made mistake')
    console.info('[Detective-RAG] Rejected guesses:', rejectedGuesses)
  }

  // Check if we should use a strategic question based on information theory
  const strategicQuestion = getMostInformativeQuestion(
    remainingCandidates,
    turns.map(t => t.question),
    traits,  // Pass traits for logical inference
    turns    // Pass full turn history for contradiction detection
  )

  if (strategicQuestion && remainingCandidates.length > 10) {
    const askedQuestions = turns.map(t => t.question.toLowerCase())
    const isDuplicate = askedQuestions.includes(strategicQuestion.toLowerCase())
    const topicCheck = isTopicAlreadyCovered(strategicQuestion, turns)

    console.info(`[Detective-RAG] [PATH: strategic] question="${strategicQuestion}" duplicate=${isDuplicate} topicOverlap=${topicCheck.covered ? topicCheck.matchedTopic : 'none'}`)

    if (isDuplicate) {
      console.warn('[Detective-RAG] Strategic question already asked — falling through to LLM')
    } else if (topicCheck.covered) {
      console.warn(`[Detective-RAG] Strategic question topic already covered (${topicCheck.matchedTopic}) — falling through to LLM`)
    } else {
      return {
        question: strategicQuestion,
        topGuesses: hybridGuesses.map(g => ({ name: g.name, confidence: g.confidence }))
      }
    }
  }
  
  // If we have ≤10 candidates and enough discriminating traits, make guesses
  // CRITICAL: Don't guess with only 2-3 broad traits (e.g., "American + Male")
  // Need at least 7 traits OR (6 traits + category) for good discrimination
  // Also need enough turns to have asked discriminating questions
  const hasEnoughTraits = traits.length >= 7 || 
                          (traits.length >= 6 && traits.some(t => t.key === 'category' && !t.value.startsWith('NOT_')))
  
  // CRITICAL: Don't guess if we just rejected guesses recently
  // After rejection, ask at least 4-5 more questions before trying again
  // Track the turn number where the last rejection occurred using guessAttempts
  const rejectedAttempts = turns.filter(t => {
    // Find if this turn resulted in a rejected guess
    const turnNum = turns.indexOf(t) + 1
    return rejectedGuesses.includes(t.question.match(/^Is your character (.+)\?$/)?.[1] || '')
  })
  const lastRejectedTurn = rejectedAttempts.length > 0 ?
    Math.max(...rejectedAttempts.map(t => turns.indexOf(t) + 1)) : -1
  const turnsSinceLastRejection = lastRejectedTurn >= 0 ? 
    turns.length - lastRejectedTurn : 999
  const enoughTurnsSinceRejection = turnsSinceLastRejection >= 5 || rejectedGuesses.length === 0
  
  // IMPROVED STRATEGY: Only make direct guesses when highly confident or down to very few candidates
  // Otherwise, ask discriminating questions to narrow down similar candidates
  const shouldMakeDirectGuess = (
    remainingCandidates.length <= 2 ||  // Only 1-2 candidates left
    (remainingCandidates.length <= 3 && turns.length >= 12) ||  // 3 candidates after enough questions
    (hybridGuesses[0]?.confidence >= 0.85 && remainingCandidates.length <= 5) ||  // Very high confidence with small pool
    (turns.length >= 18 && remainingCandidates.length <= 5)  // Many questions asked, small pool
  ) && hasEnoughTraits && enoughTurnsSinceRejection
  
  if (shouldMakeDirectGuess) {
    console.info('[Detective-RAG] Making direct guess')
    console.info(`[Detective-RAG] Candidates: ${remainingCandidates.length}, Confidence: ${Math.round((hybridGuesses[0]?.confidence || 0) * 100)}%`)
    
    // Make a single direct guess with the top candidate
    const topGuess = hybridGuesses[0]
    if (topGuess) {
      console.info(`[Detective-RAG] Direct guess: ${topGuess.name} (${Math.round(topGuess.confidence * 100)}%)`)
      return {
        question: `Is your character ${topGuess.name}?`,
        topGuesses: [{ name: topGuess.name, confidence: topGuess.confidence }]
      }
    }
  }
  
  // If we have 3-10 similar candidates, ask discriminating questions instead of guessing
  if (remainingCandidates.length >= 3 && remainingCandidates.length <= 10) {
    console.info(`[Detective-RAG] ${remainingCandidates.length} similar candidates - asking discriminating question instead of guessing`)
    console.info('[Detective-RAG] Candidates:', remainingCandidates.map(c => c.name).slice(0, 10))
  }
  
  // If small pool but insufficient traits, keep asking strategic questions
  if (remainingCandidates.length <= 10 && !hasEnoughTraits) {
    console.info('[Detective-RAG] Small pool but only', traits.length, 'traits - need more discrimination')
  }
  
  // If we have rejected guesses recently, ask more questions instead of guessing again
  if (!enoughTurnsSinceRejection) {
    console.info('[Detective-RAG] Recent rejections - asking more questions before guessing again')
  }

  // Build context for AI
  const traitsList = traits.map(t => `- ${t.key}: ${t.value} (${Math.round(t.confidence * 100)}%)`).join('\n')
  // Truncate turn history to avoid local-LLM context overflow on long games.
  // Keep the most recent 12 turns; earlier context is already captured in traits.
  const turnsToShow = turns.length > 15 ? turns.slice(-12) : turns
  const turnOffset = turns.length - turnsToShow.length
  const turnsList = turnsToShow.map((t, i) => `${turnOffset + i + 1}. Q: "${t.question}" A: ${t.answer}`).join('\n')

  // Check which categorical questions have been asked
  const askedQuestionsLower = turns.map(t => t.question.toLowerCase())
  const categoryQuestionMap: Record<string, string[]> = {
    'actors': ['actor', 'actress', 'acting', 'acted', 'perform', 'film', 'movie'],
    'musicians': ['musician', 'singer', 'band', 'music', 'song'],
    'athletes': ['athlete', 'sport', 'play', 'team'],
    'politicians': ['politician', 'president', 'politics', 'office', 'govern'],
    'scientists': ['scientist', 'science', 'research', 'discover'],
    'writers': ['writer', 'author', 'wrote', 'book', 'novel'],
  }
  
  const askedCategories = new Set<string>()
  for (const [category, keywords] of Object.entries(categoryQuestionMap)) {
    if (askedQuestionsLower.some(q => keywords.some(kw => q.includes(kw)))) {
      askedCategories.add(category)
    }
  }
  
  console.log('[Detective-RAG] Asked categories:', Array.from(askedCategories))

  // Check if category is confirmed (positive category trait exists)
  const confirmedCategory = traits.find(t => 
    t.key === 'category' && 
    !t.value.startsWith('NOT_') &&
    t.confidence >= 0.85
  )
  
  // Build guidance about confirmed sub-categories to prevent contradictory questions
  // e.g., if "sitcom" was confirmed, don't ask about "drama"
  const confirmedAnswers = turns
    .filter(t => t.answer === 'yes' || t.answer === 'probably')
    .map(t => t.question.toLowerCase())

  const contradictionRules: string[] = []
  const subCategoryConflicts: Record<string, string[]> = {
    'sitcom': ['drama', 'animated show', 'horror', 'thriller'],
    'drama': ['sitcom', 'comedy', 'animated show'],
    'animated': ['live-action', 'sitcom'],
    'basketball': ['soccer', 'football', 'baseball', 'tennis', 'golf', 'hockey', 'boxing', 'mma'],
    'soccer': ['basketball', 'baseball', 'tennis', 'golf', 'hockey', 'boxing', 'mma'],
    'football': ['basketball', 'baseball', 'tennis', 'golf', 'hockey', 'boxing', 'mma'],
    'baseball': ['basketball', 'soccer', 'football', 'tennis', 'golf', 'hockey', 'boxing', 'mma'],
    'rapper': ['rock', 'pop singer', 'country', 'classical'],
    'rock': ['rapper', 'hip-hop', 'pop singer', 'country', 'classical'],
    'pop': ['rapper', 'hip-hop', 'rock', 'country', 'classical'],
    'dc comics': ['marvel'],
    'marvel': ['dc comics'],
    'dragon ball': ['naruto', 'one piece', 'bleach', 'attack on titan'],
    'naruto': ['dragon ball', 'one piece', 'bleach', 'attack on titan'],
    'one piece': ['dragon ball', 'naruto', 'bleach', 'attack on titan'],
    // Nationality/geography (mutually exclusive for most characters)
    'american': ['british', 'uk', 'united kingdom', 'european', 'european country', 'from europe'],
    'british': ['american', 'usa', 'united states'],
    'uk': ['american', 'usa', 'united states'],
    'united kingdom': ['american', 'usa', 'united states'],
  }

  for (const confirmedQ of confirmedAnswers) {
    for (const [keyword, conflicts] of Object.entries(subCategoryConflicts)) {
      if (confirmedQ.includes(keyword)) {
        contradictionRules.push(`User confirmed "${keyword}" — do NOT ask about: ${conflicts.join(', ')}`)
      }
    }
  }
  
  // FICTIONALITY LOGIC: Add contradiction rules based on fictional status
  const fictionalTrait = traits.find(t => t.key === 'fictional')
  if (fictionalTrait && fictionalTrait.value === 'false' && fictionalTrait.confidence >= 0.85) {
    contradictionRules.push(
      `Character is REAL (not fictional) — do NOT ask about: Marvel, DC Comics, anime, manga, video games, TV shows (as origin), movie characters, book characters, comics, superpowers, supernatural abilities, magic powers`
    )
    console.log('[Detective-RAG] Added fictionality rule: Character is real → no fictional origins or superpowers')
  } else if (fictionalTrait && fictionalTrait.value === 'true' && fictionalTrait.confidence >= 0.85) {
    const originMediums = traits.filter(t => t.key === 'media_origin' && !t.value.startsWith('NOT_'))
    if (originMediums.length > 0) {
      contradictionRules.push(
        `Character is from ${originMediums[0].value} — focus on questions about this origin`
      )
    }
  }
  
  // ALIVE/DEAD LOGIC: Check if character is still alive
  const aliveQuestions = confirmedAnswers.filter(q => 
    q.includes('still alive') || q.includes('alive today') || q.includes('living today')
  )
  const deadQuestions = confirmedAnswers.filter(q =>
    (q.includes('died before') || q.includes('dead')) && !q.includes('still alive')
  )
  
  if (aliveQuestions.length > 0) {
    contradictionRules.push(
      `Character is STILL ALIVE — do NOT ask about: death dates, died before, historical figures who died, deceased, passed away`
    )
    console.log('[Detective-RAG] Added alive rule: Character is alive → no death questions')
  } else if (deadQuestions.length > 0) {
    contradictionRules.push(
      `Character is DECEASED — do NOT ask about: still alive, living today, currently active`
    )
    console.log('[Detective-RAG] Added deceased rule: Character is dead → no alive questions')
  }

  if (contradictionRules.length > 0) {
    console.log('[Detective-RAG] Contradiction rules generated:', contradictionRules)
  } else {
    console.log('[Detective-RAG] No contradiction rules (confirmed answers:', confirmedAnswers, ')')
  }

  const contradictionGuidance = contradictionRules.length > 0
    ? `\n\n**CONTRADICTIONS TO AVOID (based on confirmed answers):**\n${contradictionRules.join('\n')}`
    : ''

  const categoryGuidance = confirmedCategory
    ? `\n\n**IMPORTANT:** Category is confirmed as "${confirmedCategory.value}".
DO NOT ask about other categories (actor/athlete/musician/politician/etc.) unless absolutely necessary.
Focus on discriminating questions within this category (era, specific works, characteristics, teams).`
    : ''
  
  // Build prerequisite guidance - don't ask specific questions before broader category questions
  const prerequisiteGuidance = !confirmedCategory && askedCategories.size === 0
    ? `\n\n**QUESTION HIERARCHY:** 
You have NOT yet asked about any broad categories (actor, musician, athlete, etc.).
DO NOT ask specific questions like "Was your character active in movies before 2000s?" or "Does your character play basketball?"
First determine the BROAD category, then ask specific questions within that category.

Examples of what NOT to ask yet:
- "Was your character active in movies before the 2000s?" (ask "Is your character an actor?" first)
- "Does your character play basketball?" (ask "Is your character an athlete?" first)
- "Did your character win a Grammy?" (ask "Is your character a musician?" first)`
    : ''

  const contextPrompt = `
**Current Game State:**
Turn: ${turns.length + 1}
Confirmed traits:
${traitsList || '(none yet)'}${categoryGuidance}${prerequisiteGuidance}${contradictionGuidance}

**Previous Q&A:**
${turnsList || '(no questions yet)'}

**Remaining Candidates:**
${candidateContext}

**Your Task:**
${remainingCandidates.length <= 5 
  ? 'Very few candidates remain! Ask ONE simple yes/no question about ONE trait.'
  : remainingCandidates.length <= 25
    ? 'Ask ONE simple yes/no question about a GENERAL trait. Examples: "Is your character American?" or "Does your character have superpowers?"'
    : 'Ask ONE simple yes/no question that splits candidates roughly 50/50.'}

CRITICAL RULES:
1. Questions MUST be under 15 words
2. Ask about ONE trait only (NOT compound questions with "and" or "or")
3. Keep it broad and simple - NO specific details about team members, abilities, etc.
4. If stuck, try a DIFFERENT type of question (era, appearance, personality, origin)
5. NEVER name a specific character in your question — "Is your character [Name]?" is a GUESS, not a question
6. NEVER ask questions that contradict confirmed answers (e.g., don't ask "drama?" after "sitcom" was confirmed)
7. For actors: "Has your character won an Oscar?" is a GOOD question — most people know Oscar winners. Avoid other awards (Emmy, Grammy, Golden Globe). Also good: "Is your character still alive today?", "Is your character known for comedy?", "Is your character from the UK?"

BAD: "Is your character Dennis the Menace?" (this is a guess, not a question!)
BAD: "Is your character from a drama?" (after user confirmed sitcom)
BAD: "Has your character won a Grammy?" (too obscure)
BAD: "Is your character part of a team that includes a member known for having a high level of agility?"
GOOD: "Has your character won an Oscar?"
GOOD: "Is your character still alive today?"
GOOD: "Does your character work with a team?"
GOOD: "Is your character known for comedy?"
GOOD: "Has your character starred in a famous movie franchise?"

Return your response as JSON.`

  // ===== LLM CALL WITH MULTI-TOOL SUPPORT =====
  // The LLM may call any combination of tools to inform its question choice:
  //   get_asked_questions      — see topic history, avoid repeats
  //   get_remaining_candidates — see who's still in contention + discriminating traits
  //   get_best_question        — get the Shannon-entropy-optimal question as a hint
  //   lookup_character(name)   — verify a candidate against confirmed traits before guessing
  //
  // The loop runs until the model produces a direct JSON answer or a safety cap is reached.
  // Falls back to a no-tools call if the local model doesn't support tool calling at all.

  const ALL_TOOLS = [
    GET_ASKED_QUESTIONS_TOOL,
    GET_REMAINING_CANDIDATES_TOOL,
    GET_BEST_QUESTION_TOOL,
    LOOKUP_CHARACTER_TOOL,
    GET_CHARACTER_SAMPLE_TOOL,
    GET_DISCRIMINATING_TRAITS_TOOL,
  ]
  const KNOWN_TOOL_NAMES = new Set(ALL_TOOLS.map(t => t.function.name))
  const MAX_TOOL_ROUNDS = 5

  let raw = ''

  try {
    const baseMessages = [
      { role: 'system' as const, content: RAG_DETECTIVE_SYSTEM_PROMPT },
      { role: 'user' as const, content: contextPrompt },
    ]

    console.info(`[Detective-RAG] [PATH: llm] candidates=${remainingCandidates.length} turn=${turns.length + 1} — sending tool-enabled request`)

    let messages: typeof baseMessages = baseMessages

    for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
      const isLastRound = round === MAX_TOOL_ROUNDS - 1

      const response = await chatCompletion({
        model: DETECTIVE_MODEL,
        messages,
        temperature: 0.3,
        max_tokens: round === 0 ? 300 : 150,
        // On the last round, omit tools to force a direct answer
        tools: isLastRound ? undefined : ALL_TOOLS,
        tool_choice: isLastRound ? undefined : 'auto',
      })

      const choice = response.choices?.[0]
      console.info(
        `[Detective-RAG] Tool loop round ${round}: finish_reason=${choice?.finish_reason}` +
        ` | tool_calls=${choice?.message?.tool_calls?.length ?? 0}` +
        ` | content=${choice?.message?.content?.slice(0, 60)}`
      )

      // If the model gave a direct answer (or response had no choices), exit the loop
      if (!choice || choice.finish_reason !== 'tool_calls' || !choice.message.tool_calls?.length) {
        raw = choice?.message?.content || ''
        break
      }

      // Append the assistant's tool-call message to the conversation
      messages = [
        ...messages,
        {
          role: 'assistant' as const,
          content: choice.message.content,
          tool_calls: choice.message.tool_calls,
        } as any,
      ]

      // Resolve every tool call in this round (model may batch multiple calls)
      let allUnknown = true
      for (const toolCall of choice.message.tool_calls) {
        const toolName = toolCall.function.name
        let toolResult: string

        if (toolName === 'get_asked_questions') {
          toolResult = buildQuestionHistoryToolResponse(turns)
          const parsed = JSON.parse(toolResult) as { covered_topics: string[]; available_topics: string[] }
          console.group('%c🔧 TOOL: get_asked_questions', 'color: #a78bfa; font-weight: bold')
          console.info('  covered  :', parsed.covered_topics)
          console.info('  available:', parsed.available_topics)
          console.groupEnd()
          allUnknown = false

        } else if (toolName === 'get_remaining_candidates') {
          toolResult = buildRemainingCandidatesToolResponse(remainingCandidates)
          const parsed = JSON.parse(toolResult) as { count: number; names: string[] }
          console.group('%c🔧 TOOL: get_remaining_candidates', 'color: #34d399; font-weight: bold')
          console.info('  count:', parsed.count)
          console.info('  names:', parsed.names.slice(0, 10))
          console.groupEnd()
          allUnknown = false

        } else if (toolName === 'get_best_question') {
          toolResult = buildBestQuestionToolResponse(strategicQuestion, remainingCandidates, turns)
          const parsed = JSON.parse(toolResult) as { question: string | null; reason: string }
          console.group('%c🔧 TOOL: get_best_question', 'color: #60a5fa; font-weight: bold')
          console.info('  question:', parsed.question)
          console.info('  reason  :', parsed.reason)
          console.groupEnd()
          allUnknown = false

        } else if (toolName === 'lookup_character') {
          let parsedArgs: { name?: string } = {}
          try { parsedArgs = JSON.parse(toolCall.function.arguments || '{}') } catch { /* ignore */ }
          const lookupName = parsedArgs.name || ''
          toolResult = buildLookupCharacterToolResponse(lookupName, traits)
          const parsed = JSON.parse(toolResult) as { found: boolean; compatibility_score?: number; compatibility_label?: string }
          console.group('%c🔧 TOOL: lookup_character', 'color: #f472b6; font-weight: bold')
          console.info('  name         :', lookupName)
          console.info('  found        :', parsed.found)
          console.info('  compatibility:', parsed.compatibility_label, `(${parsed.compatibility_score})`)
          console.groupEnd()
          allUnknown = false

        } else if (toolName === 'get_character_sample') {
          let parsedArgs: { names?: string[] } = {}
          try { parsedArgs = JSON.parse(toolCall.function.arguments || '{}') } catch { /* ignore */ }
          const names = parsedArgs.names || []
          toolResult = buildCharacterSampleToolResponse(names)
          const parsed = JSON.parse(toolResult) as { characters?: Array<{name: string, found: boolean}> }
          console.group('%c🔧 TOOL: get_character_sample', 'color: #10b981; font-weight: bold')
          console.info('  requested    :', names.join(', '))
          console.info('  found        :', parsed.characters?.filter(c => c.found).map(c => c.name).join(', ') || 'none')
          console.groupEnd()
          allUnknown = false

        } else if (toolName === 'get_discriminating_traits') {
          let parsedArgs: { top_n?: number } = {}
          try { parsedArgs = JSON.parse(toolCall.function.arguments || '{}') } catch { /* ignore */ }
          const topN = parsedArgs.top_n || 5
          toolResult = buildDiscriminatingTraitsToolResponse(topN, remainingCandidates)
          const parsed = JSON.parse(toolResult) as { discriminators?: Array<{trait: string, suggested_question: string}> }
          console.group('%c🔧 TOOL: get_discriminating_traits', 'color: #8b5cf6; font-weight: bold')
          console.info('  analyzing    :', `top ${topN} candidates`)
          console.info('  discriminators:', parsed.discriminators?.length || 0)
          if (parsed.discriminators && parsed.discriminators.length > 0) {
            console.info('  top suggestion:', parsed.discriminators[0].suggested_question)
          }
          console.groupEnd()
          allUnknown = false

        } else {
          console.warn(`[Detective-RAG] Unknown tool "${toolName}" — returning error to model`)
          toolResult = JSON.stringify({
            error: `Unknown function "${toolName}". Available: ${Array.from(KNOWN_TOOL_NAMES).join(', ')}`,
          })
        }

        messages = [
          ...messages,
          {
            role: 'tool' as const,
            content: toolResult,
            tool_call_id: toolCall.id,
          } as any,
        ]
      }

      // If every call in this round was unknown, the model is fully hallucinating —
      // use any text content it already produced and stop looping.
      if (allUnknown) {
        raw = choice.message.content || ''
        console.warn('[Detective-RAG] All tool calls unknown — using direct content')
        break
      }
    }

    // If the tool loop produced an empty response (model overloaded / context too long),
    // retry once with a minimal no-tools prompt so we still get a real question.
    if (!raw) {
      console.warn('[Detective-RAG] Tool loop returned empty — retrying with minimal no-tools prompt')
      try {
        const retryResponse = await chatCompletion({
          model: DETECTIVE_MODEL,
          messages: [
            { role: 'system', content: RAG_DETECTIVE_SYSTEM_PROMPT },
            { role: 'user', content: contextPrompt },
          ],
          temperature: 0.4,
          max_tokens: 150,
        })
        raw = retryResponse.choices[0]?.message?.content || ''
        console.info('[Detective-RAG] No-tools retry response:', raw)
      } catch (retryErr) {
        console.warn('[Detective-RAG] No-tools retry also failed:', retryErr)
      }
    }
  } catch (toolError) {
    console.warn('[Detective-RAG] Tool calling threw an error — falling back to no-tools call:', toolError)
    const response = await chatCompletion({
      model: DETECTIVE_MODEL,
      messages: [
        { role: 'system', content: RAG_DETECTIVE_SYSTEM_PROMPT },
        { role: 'user', content: contextPrompt },
      ],
      temperature: 0.3,
      max_tokens: 150,
    })
    raw = response.choices[0]?.message?.content || ''
    console.info('[Detective-RAG] Fallback (no-tools) answer:', raw)
  }

  try {  // validation block — parse and validate the LLM-generated question
    console.info('[Detective-RAG] askNextQuestion raw:', raw)

    const json = extractJSON(raw)
    if (!json || !json.question) {
      console.warn('[Detective-RAG] Invalid response, using fallback question')
      return {
        question: getFallbackQuestion(turns.map(t => t.question), traits, turns),
        topGuesses: ragGuesses.map(g => ({ name: g.name, confidence: g.confidence }))
      }
    }

    // Validate question length - reject overly long/complex questions
    const questionText = String(json.question)
    const wordCount = questionText.split(/\s+/).length
    if (wordCount > 20) {
      console.warn(`[Detective-RAG] Question too long (${wordCount} words), using fallback`)
      return {
        question: getFallbackQuestion(turns.map(t => t.question), traits, turns),
        topGuesses: ragGuesses.map(g => ({ name: g.name, confidence: g.confidence }))
      }
    }
    
    // CRITICAL: Detect if question names a specific character
    // Questions like "Is your character Dennis the Menace?" should trigger a guess, not be asked
    const characterNamePattern = /is your character ([A-Z][a-z]+(?:\s+[A-Z][a-z]+)*)\?/i
    const characterMatch = questionText.match(characterNamePattern)
    if (characterMatch) {
      const characterName = characterMatch[1]
      console.warn(`[Detective-RAG] ⚠️ Question names specific character: "${characterName}"`)
      console.warn('[Detective-RAG] This should be a formal guess, not a question!')
      
      // Check if this character is in our top guesses
      const matchingGuess = ragGuesses.find(g => 
        g.name.toLowerCase() === characterName.toLowerCase()
      )
      
      if (matchingGuess && matchingGuess.confidence >= CONFIDENCE_THRESHOLD) {
        console.info('[Detective-RAG] Converting to formal guess')
        return {
          question: `Is your character ${matchingGuess.name}?`,
          topGuesses: [{ name: matchingGuess.name, confidence: Math.min(0.95, matchingGuess.confidence) }]
        }
      } else {
        console.warn('[Detective-RAG] Character not in top guesses or low confidence - using fallback question')
        return {
          question: getFallbackQuestion(turns.map(t => t.question), traits, turns),
          topGuesses: ragGuesses.map(g => ({ name: g.name, confidence: g.confidence }))
        }
      }
    }

    // CRITICAL: Detect character-name questions from LLM
    // The LLM should NEVER ask "Is your character [Specific Name]?" — that's a guess, not a question
    // Only the game's formal guess logic should do that
    if (isCharacterNameQuestion(questionText)) {
      console.warn(`[Detective-RAG] LLM tried to ask character-name question: "${questionText}" — rejecting`)
      console.warn('[Detective-RAG] Character-name questions must go through formal guess logic, not LLM questions')
      return {
        question: getFallbackQuestion(turns.map(t => t.question), traits, turns),
        topGuesses: ragGuesses.map(g => ({ name: g.name, confidence: g.confidence }))
      }
    }

    // CRITICAL: Check if this question was already asked
    // This prevents duplicate questions when trait extraction fails
    const askedQuestions = turns.map(t => t.question.toLowerCase())
    const normalizedQuestion = normalizeQuestion(questionText)
    const isDuplicate = askedQuestions.some(asked => {
      const normalizedAsked = normalizeQuestion(asked)
      return normalizedAsked === normalizedQuestion
    })
    if (isDuplicate) {
      console.warn(`[Detective-RAG] Duplicate question detected: "${questionText}"`)
      console.warn('[Detective-RAG] Using fallback to avoid repeat')
      return {
        question: getFallbackQuestion(turns.map(t => t.question), traits, turns),
        topGuesses: ragGuesses.map(g => ({ name: g.name, confidence: g.confidence }))
      }
    }

    // SEMANTIC TOPIC CHECK: Catches questions like "office setting" after "corporate office" was already asked
    const topicCheck = isTopicAlreadyCovered(questionText, turns)
    if (topicCheck.covered) {
      console.group('%c⚠️ Semantic topic duplicate blocked', 'color: #f59e0b; font-weight: bold')
      console.warn('  new question :', questionText)
      console.warn('  topic        :', topicCheck.matchedTopic)
      console.warn('  already asked:', topicCheck.matchedQuestion)
      console.groupEnd()
      return {
        question: getFallbackQuestion(turns.map(t => t.question), traits, turns),
        topGuesses: ragGuesses.map(g => ({ name: g.name, confidence: g.confidence }))
      }
    }

    // CRITICAL: Post-LLM validation — reject questions that violate logical implications
    // The LLM may ignore prompt instructions, so enforce rules in code
    if (shouldSkipQuestion(questionText, traits, turns)) {
      console.warn(`[Detective-RAG] LLM question violates logical implication rules: "${questionText}"`)
      console.warn('[Detective-RAG] Using fallback to avoid illogical question')
      return {
        question: getFallbackQuestion(turns.map(t => t.question), traits, turns),
        topGuesses: ragGuesses.map(g => ({ name: g.name, confidence: g.confidence }))
      }
    }

    return {
      question: questionText,
      topGuesses: ragGuesses.map(g => ({ name: g.name, confidence: g.confidence }))
    }
  } catch (error) {
    console.error('[Detective-RAG] askNextQuestion error:', error)
    return {
      question: getFallbackQuestion(turns.map(t => t.question), traits, turns),
      topGuesses: ragGuesses.map(g => ({ name: g.name, confidence: g.confidence }))
    }
  }
}

/**
 * Normalize a question for duplicate detection
 * Handles semantic variations (Oscar vs Academy Award, etc.)
 */
function normalizeQuestion(question: string): string {
  let normalized = question.toLowerCase().trim()
  
  // Remove punctuation
  normalized = normalized.replace(/[?.!,]/g, '')
  
  // Normalize common variations
  const replacements: Record<string, string> = {
    'academy award': 'oscar',
    'golden globe': 'golden globe award',
    'emmy award': 'emmy',
    'grammy award': 'grammy',
    'nobel prize': 'nobel',
    'super powers': 'superpowers',
    'super hero': 'superhero',
    'tv show': 'television',
    'tv series': 'television',
    'movie': 'film',
    'comic book': 'comics',
    'video game': 'videogame',
    'anime or manga': 'anime',
    'originate in a': 'from a',
    'originate in an': 'from an',
    'did your character originate': 'is your character from',
    'known for': 'famous for',
    'best actor': 'best actor award',
    'best actress': 'best actress award',
  }
  
  for (const [from, to] of Object.entries(replacements)) {
    normalized = normalized.replace(new RegExp(from, 'g'), to)
  }
  
  // Remove extra whitespace
  normalized = normalized.replace(/\s+/g, ' ').trim()
  
  return normalized
}

/**
 * Simple fallback questions - diverse types to avoid getting stuck
 */
const FALLBACK_QUESTIONS = [
  // Basic traits
  'Is your character fictional?',
  'Is your character male?',
  'Is your character American?',

  // Categories
  'Did your character originate in an anime or manga?',
  'Is your character a superhero?',
  'Is your character an athlete?',
  'Is your character a musician?',
  'Is your character an actor?',
  'Is your character a politician?',
  'Did your character originate in a TV show?',
  'Did your character originate in a video game?',

  // Actor-specific (comes before generic era questions — actors are always modern)
  'Has your character won an Oscar?',
  'Is your character still alive today?',
  'Is your character known for dramatic or serious roles?',
  'Is your character known for comedy movies or shows?',
  'Is your character from the United Kingdom?',
  'Has your character starred in a famous movie franchise?',
  'Has your character appeared in a sci-fi or fantasy movie?',
  'Has your character appeared in a crime or thriller movie?',
  'Has your character starred in a war or historical movie?',

  // Era/Time
  'Did your character live before 1950?',
  'Was your character active in the 2000s or later?',

  // Characteristics
  'Does your character have superpowers?',
  'Is your character known for comedy?',
  'Does your character work with a team?',
  'Is your character a villain?',

  // Appearance/Physical
  'Does your character wear a costume or uniform?',
  'Does your character have distinctive hair?',

  // Origin/Source
  'Did your character originate in a comic book?',
  'Does your character come from Japanese media?',

  // Achievement/Role
  'Is your character a leader?',
  'Has your character won major awards?',

  // Actor deep-dive (additional discrimination for actor-confirmed games)
  'Is your character known primarily for action movies?',
  'Has your character worked with director Martin Scorsese?',
  'Has your character played a real historical person on screen?',
  'Has your character starred in a romantic drama or love story?',
  'Is your character known for playing morally ambiguous characters?',
  'Has your character appeared in a Quentin Tarantino film?',
  'Has your character starred in a superhero movie?',
  'Is your character known for their voice acting?',
  'Has your character directed a film in addition to acting?',
  'Is your character primarily known for independent films?',
  'Has your character appeared in a Steven Spielberg film?',
  'Is your character known for playing tough or gritty characters?',
  'Has your character won a Golden Globe award?',
  'Is your character over 60 years old?',
  'Was your character a major star before the year 2000?',
  'Is your character known for playing charismatic or charming roles?',
  'Has your character had a major role in a biographical film?',

  // Ultimate fallbacks (rotate through these if all above are exhausted)
  'Is your character well-known internationally?',
  'Is your character associated with a specific location or place?',
  'Does your character have a distinctive personality trait?',
  'Is your character known for a specific catchphrase or saying?',
  'Has your character appeared in more than 10 major films?',
  'Is your character known for serious dramatic performances?',
  'Does your character have a signature acting style?',
  'Is your character considered a Hollywood legend?',
]

function getFallbackQuestion(askedQuestions: string[], traits: Trait[] = [], turns?: Array<{ question: string; answer: AnswerValue }>): string {
  const askedNormalized = askedQuestions.map(q => normalizeQuestion(q))

  // Check if category is confirmed
  const confirmedCategory = traits.find(t =>
    t.key === 'category' &&
    !t.value.startsWith('NOT_') &&
    t.confidence >= 0.85
  )

  // Category questions to skip if category is already confirmed
  const categoryQuestions = [
    'is your character from an anime or manga?',
    'is your character a superhero?',
    'is your character an athlete?',
    'is your character a musician?',
    'is your character an actor?',
    'is your character a politician?',
    'is your character from a tv show?',
    'is your character from a video game?'
  ].map(q => normalizeQuestion(q))

  for (const q of FALLBACK_QUESTIONS) {
    const qNormalized = normalizeQuestion(q)

    // Skip if already asked (using same normalization as duplicate detection)
    if (askedNormalized.includes(qNormalized)) {
      continue
    }

    // Skip category questions if category is already confirmed
    if (confirmedCategory && categoryQuestions.includes(qNormalized)) {
      console.log(`[Detective-RAG] Skipping category question "${q}" - category already confirmed as ${confirmedCategory.value}`)
      continue
    }

    // Skip questions that violate logical implication rules
    if (shouldSkipQuestion(q, traits, turns)) {
      console.log(`[Detective-RAG] Skipping fallback question (logical implication): "${q}"`)
      continue
    }

    // Skip questions whose topic has already been covered
    if (turns && isTopicAlreadyCovered(q, turns).covered) {
      console.log(`[Detective-RAG] Skipping fallback question (topic covered): "${q}"`)
      continue
    }

    return q
  }

  // All fallback questions exhausted — use a rotating emergency pool so we never
  // repeat the exact same question indefinitely. The pool questions are intentionally
  // open-ended and span dimensions not covered by the structured list above.
  const EMERGENCY_POOL = [
    'Is your character considered one of the greatest in their field?',
    'Is your character associated with a specific decade?',
    'Is your character known for a single defining work or role?',
    'Has your character ever won a lifetime achievement award?',
    'Is your character known for collaborating with the same creative partners repeatedly?',
    'Is your character primarily known in their home country rather than internationally?',
    'Has your character ever made a highly anticipated comeback or return?',
    'Is your character known for a very long career spanning multiple decades?',
    'Has your character ever been considered controversial or polarizing?',
    'Is your character known for transforming their appearance for roles?',
  ]
  console.warn('[Detective-RAG] All fallback questions exhausted! Using emergency pool rotation.')
  // Pick an emergency question not yet asked
  const askedNorm = askedQuestions.map(q => normalizeQuestion(q))
  const unusedEmergency = EMERGENCY_POOL.find(q => !askedNorm.includes(normalizeQuestion(q)))
  return unusedEmergency ?? EMERGENCY_POOL[askedQuestions.length % EMERGENCY_POOL.length]
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

  const newTraits: (Trait & TurnAdded)[] = []
  let updatedRejectedGuesses = [...rejectedGuesses]

  // Step 1: Extract trait from the most recent turn
  // If previousQuestion/answer are not provided, get them from the last turn
  let questionToAnalyze = previousQuestion
  let answerToAnalyze = answer
  
  if (!questionToAnalyze && turns.length > 0) {
    const lastTurn = turns[turns.length - 1]
    questionToAnalyze = lastTurn.question
    answerToAnalyze = lastTurn.answer
  }
  
  console.info('[Detective-RAG] Previous question:', questionToAnalyze)
  console.info('[Detective-RAG] Answer:', answerToAnalyze)

  // Step 2: Check if previous question was a character guess or extract trait
  if (questionToAnalyze && answerToAnalyze) {
    // Match "Is your character X?" pattern
    const guessMatch = questionToAnalyze.match(/^Is your character (.+)\?$/i)
    const capturedText = guessMatch?.[1]?.trim()

    // Delegate to isCharacterNameQuestion for consistent, comprehensive detection.
    // This handles 'a villain', 'a hero', 'from Japanese media', etc. correctly.
    const isCharacterGuess = capturedText && isCharacterNameQuestion(questionToAnalyze)

    console.info(`[Detective-RAG] Question analysis: "${questionToAnalyze}"`)
    console.info(`[Detective-RAG]   Captured: "${capturedText}"`)
    console.info(`[Detective-RAG]   Is character guess: ${!!isCharacterGuess}`)
    
    if (isCharacterGuess && capturedText) {
      if (answerToAnalyze === 'no' || answerToAnalyze === 'probably_not') {
        console.info(`[Detective-RAG] ✗ User rejected guess: ${capturedText}`)
        if (!updatedRejectedGuesses.some(r => r.toLowerCase() === capturedText.toLowerCase())) {
          updatedRejectedGuesses.push(capturedText)
        }
      } else if (answerToAnalyze === 'yes') {
        console.info(`[Detective-RAG] ✓ User confirmed guess: ${capturedText}!`)
        // This is handled by useGameLoop with CONFIRM_GUESS
      }
    } else {
      // Regular question - extract traits (can be multiple!)
      console.info('[Detective-RAG] Extracting traits from Q&A...')
      const validTraitKeys = ['category', 'fictional', 'gender', 'media_origin', 'has_powers', 'alignment', 'species', 'age_group', 'tv_show_type', 'publisher', 'nationality', 'has_oscar', 'is_alive']
      const extractedTraits = await extractTraits(questionToAnalyze, answerToAnalyze, turnAdded, validTraitKeys, traits)
      if (extractedTraits.length > 0) {
        newTraits.push(...extractedTraits)
        console.info(`[Detective-RAG] ✓ Extracted ${extractedTraits.length} trait(s):`, 
                     extractedTraits.map(t => `${t.key}=${t.value} (${Math.round(t.confidence * 100)}%)`).join(', '))
      } else {
        console.warn('[Detective-RAG] ✗ No traits extracted from answer')
      }
    }
  }

  // LOGICAL DEDUCTION: Fictionality implications
  // If character is NOT fictional (real person), they CANNOT be from fictional origins
  const allTraits = [...traits, ...newTraits]
  const fictionalTrait = allTraits.find(t => t.key === 'fictional')
  
  if (fictionalTrait && fictionalTrait.value === 'false' && fictionalTrait.confidence >= 0.85) {
    console.info('[Detective-RAG] 💡 LOGICAL DEDUCTION: Character is real → ruling out fictional origins')
    
    // Real people cannot be from these fictional origins
    const impossibleOrigins = [
      'marvel', 'dc', 'anime', 'manga', 'video-game', 'tv-show', 
      'movie-character', 'book-character', 'comic'
    ]
    
    // Add NOT_X traits for each impossible origin if not already present
    for (const origin of impossibleOrigins) {
      const alreadyHasNegation = allTraits.some(t => 
        t.key === 'media_origin' && t.value === `NOT_${origin}`
      )
      const alreadyHasPositive = allTraits.some(t =>
        t.key === 'media_origin' && t.value === origin
      )
      
      if (!alreadyHasNegation && !alreadyHasPositive) {
        const deducedTrait: Trait & TurnAdded = {
          key: 'media_origin',
          value: `NOT_${origin}`,
          confidence: 0.95,
          turnAdded: turnAdded
        }
        newTraits.push(deducedTrait)
        console.info(`[Detective-RAG]   → Deduced: media_origin=NOT_${origin} (real person can't be from ${origin})`)
      }
    }
  }
  
  // LOGICAL DEDUCTION: Origin medium implications
  // If character IS from a fictional origin, they must be fictional
  const originMediumTraits = allTraits.filter(t => t.key === 'media_origin' && !t.value.startsWith('NOT_'))
  const hasFictionalOrigin = originMediumTraits.some(t => 
    ['marvel', 'dc', 'anime', 'manga', 'video-game', 'tv-show', 'movie-character', 'book-character', 'comic'].includes(t.value)
  )
  
  if (hasFictionalOrigin && !fictionalTrait) {
    console.info('[Detective-RAG] 💡 LOGICAL DEDUCTION: Character from fictional origin → must be fictional')
    const deducedTrait: Trait & TurnAdded = {
      key: 'fictional',
      value: 'true',
      confidence: 0.95,
      turnAdded: turnAdded
    }
    newTraits.push(deducedTrait)
    console.info(`[Detective-RAG]   → Deduced: fictional=true (from ${originMediumTraits[0].value})`)
  }

  // Step 2: Get next question with updated traits
  const updatedTraits = [...traits, ...newTraits]
  console.info('[Detective-RAG] Updated traits for filtering:', updatedTraits.length, updatedTraits)
  
  // Build complete turn history including the current turn (if we have it)
  const completeTurnHistory = questionToAnalyze 
    ? [...turns, { question: questionToAnalyze, answer: answerToAnalyze || 'yes' }]
    : turns
  
  const { question, topGuesses } = await askNextQuestion(updatedTraits, completeTurnHistory, updatedRejectedGuesses)

  console.info('[Detective-RAG] ===== RESULTS =====')
  console.info('[Detective-RAG] Next question:', question)
  console.info('[Detective-RAG] New traits to return:', newTraits.length, newTraits)
  console.info('[Detective-RAG] Top guesses to return:', topGuesses.length, topGuesses)

  return { question, newTraits, topGuesses }
}
