import { chatCompletion } from './lemonade'
import { DETECTIVE_MODEL } from '../../shared/constants'
import { DETECTIVE_SYSTEM_PROMPT, TRAIT_EXTRACTOR_PROMPT } from '../prompts/detective-system'
import type { Trait, Guess, AnswerValue } from '../types/game'

const ANSWER_LABELS: Record<AnswerValue, string> = {
  yes: 'yes',
  no: 'no',
  probably: 'probably',
  probably_not: 'probably_not',
  dont_know: 'dont_know',
}

// Words that carry no topical meaning — ignored when fingerprinting questions
const STOP_WORDS = new Set([
  'is', 'your', 'character', 'a', 'an', 'the', 'does', 'did', 'do', 'are', 'was', 'were',
  'from', 'of', 'in', 'to', 'for', 'at', 'by', 'with', 'has', 'have', 'had', 'be', 'been',
  'this', 'that', 'it', 'its', 'they', 'their', 'or', 'and', 'not', 'any', 'ever',
  'primarily', 'mainly', 'mostly', 'based', 'known', 'typically', 'often', 'usually',
])

// Extract the topical keywords from a question
function topicWords(question: string): Set<string> {
  return new Set(
    question.toLowerCase()
      .replace(/[^a-z0-9\s]/g, '')
      .split(/\s+/)
      .filter(w => w.length > 2 && !STOP_WORDS.has(w))
  )
}

// Returns true if newQ is topically too similar to an already-asked question
function isDuplicateTopic(newQ: string, prevQuestions: string[]): boolean {
  const newWords = topicWords(newQ)
  if (newWords.size === 0) return false
  for (const prev of prevQuestions) {
    const prevWords = topicWords(prev)
    // Count overlapping topic words
    let overlap = 0
    for (const w of newWords) {
      if (prevWords.has(w)) overlap++
    }
    // If 2+ topic words overlap, or the entire new question is covered, it's a repeat
    if (overlap >= 2 || (newWords.size <= 2 && overlap >= 1)) return true
  }
  return false
}

// Ordered fallback questions to use when the model repeats a topic
const FALLBACK_QUESTIONS = [
  'Is your character fictional?',
  'Is your character male?',
  'Is your character human?',
  'Did your character originate in an anime or manga series?',
  'Did your character originate in a video game?',
  'Did your character originate in a comic book?',
  'Did your character originate in a movie?',
  'Did your character originate in a TV show?',
  'Does your character have supernatural powers or abilities?',
  'Does your character have a distinctive hair color (not black or brown)?',
  'Does your character typically wear armor or a costume?',
  'Is your character known for being a villain or antagonist?',
  'Is your character part of a team or group?',
  'Does your character use a weapon?',
  'Is your character associated with a specific color or symbol?',
]

function pickFallback(prevQuestions: string[]): string {
  for (const q of FALLBACK_QUESTIONS) {
    if (!isDuplicateTopic(q, prevQuestions)) return q
  }
  return 'Does your character have any distinctive accessories?'
}

// Parse any JSON object out of a raw LLM response
function extractJSON(raw: string): Record<string, unknown> | null {
  const cleaned = raw
    .replace(/```(?:json)?\s*/gi, '')
    .replace(/```\s*/g, '')
    .trim()
  try {
    const match = cleaned.match(/\{[\s\S]*\}/)
    if (match) return JSON.parse(match[0])
  } catch { /* ignore */ }
  return null
}

// Call 1: Extract a single trait from the last answered question
async function extractTrait(
  question: string,
  answer: AnswerValue,
): Promise<Trait | null> {
  if (answer === 'dont_know') return null

  const response = await chatCompletion({
    model: DETECTIVE_MODEL,
    messages: [
      { role: 'system', content: TRAIT_EXTRACTOR_PROMPT },
      { role: 'user', content: `Q: "${question}" A: "${ANSWER_LABELS[answer]}"` },
    ],
    temperature: 0.1,
    max_tokens: 80,
  })

  const raw = response.choices[0]?.message?.content || ''
  console.info('[Detective] extractTrait raw:', raw)
  const json = extractJSON(raw)
  if (!json || !json.key || !json.value) return null

  const value = String(json.value).toLowerCase()
  const badValues = ['unknown', 'unclear', 'n/a', 'none', 'not_applicable', '{}', '']
  if (badValues.includes(value) || value.startsWith('not_') || value.startsWith('non_')) return null

  return {
    key: String(json.key),
    value: String(json.value),
    confidence: Math.min(Math.max(Number(json.confidence) || 0.7, 0.1), 0.99),
    turnAdded: 0,
  }
}

// Call 2: Ask the next question given all confirmed traits and history
async function askNextQuestion(
  traits: Trait[],
  turns: Array<{ question: string; answer: AnswerValue }>,
  rejectedGuesses: string[],
): Promise<{ question: string; topGuesses: Guess[] }> {
  const prevQuestions = turns.map(t => t.question)
  const parts: string[] = []

  if (traits.length > 0) {
    const confirmedKeys = traits.map(t => t.key).join(', ')
    const traitLines = traits.map(t => `  ${t.key} = ${t.value} (${Math.round(t.confidence * 100)}%)`).join('\n')
    parts.push(`Confirmed traits (DO NOT ask about these keys: ${confirmedKeys}):\n${traitLines}`)
  } else {
    parts.push('Confirmed traits: none yet')
  }

  if (prevQuestions.length > 0) {
    parts.push(`Questions already asked (DO NOT repeat or rephrase these):\n${prevQuestions.map((q, i) => `  ${i + 1}. ${q}`).join('\n')}`)
  }

  if (rejectedGuesses.length > 0) {
    parts.push(`Rejected guesses (never guess these): ${rejectedGuesses.join(', ')}`)
  }

  parts.push(`Turn: ${turns.length + 1}. Ask a NEW yes/no question about an unexplored topic. JSON only.`)

  const response = await chatCompletion({
    model: DETECTIVE_MODEL,
    messages: [
      { role: 'system', content: DETECTIVE_SYSTEM_PROMPT },
      { role: 'user', content: parts.join('\n\n') },
    ],
    temperature: 0.6,
    max_tokens: 150,
  })

  const raw = response.choices[0]?.message?.content || ''
  console.info('[Detective] askNextQuestion raw:', raw)
  const json = extractJSON(raw)

  let question: string = json?.question ? String(json.question) : ''

  // Fix "or" questions
  if (question.toLowerCase().includes(' or ')) {
    question = question.replace(/\s+or\s+[^?]*/i, '')
    if (!question.endsWith('?')) question += '?'
  }

  // Client-side duplicate check — fall back to a structured question if the model repeated
  if (!question || isDuplicateTopic(question, prevQuestions)) {
    const fallback = pickFallback(prevQuestions)
    console.warn('[Detective] Duplicate/empty question detected, using fallback:', fallback)
    question = fallback
  }

  const topGuesses: Guess[] = Array.isArray(json?.top_guesses)
    ? (json.top_guesses as any[])
        .filter(g => g.name && typeof g.confidence === 'number')
        .filter(g => !rejectedGuesses.some(r => r.toLowerCase() === String(g.name).toLowerCase()))
        .map(g => ({
          name: String(g.name),
          confidence: Math.min(Math.max(Number(g.confidence), 0.01), 0.99),
        }))
    : []

  return { question, topGuesses }
}

export async function askDetective(
  traits: Trait[],
  turns: Array<{ question: string; answer: AnswerValue }>,
  turnNumber: number,
  rejectedGuesses: string[] = [],
): Promise<{ question: string; newTraits: Trait[]; topGuesses: Guess[] }> {
  const lastTurn = turns[turns.length - 1]

  // Step 1: extract trait from last answered question
  const trait = lastTurn ? await extractTrait(lastTurn.question, lastTurn.answer) : null
  const newTraits: Trait[] = trait ? [{ ...trait, turnAdded: turnNumber }] : []

  console.info('[Detective] newTraits:', newTraits, '| all traits:', [...traits, ...newTraits])

  // Step 2: ask next question with updated trait list so model avoids confirmed topics
  const updatedTraits = trait
    ? [...traits.filter(t => t.key !== trait.key), { ...trait, turnAdded: turnNumber }]
    : traits

  const { question, topGuesses } = await askNextQuestion(updatedTraits, turns, rejectedGuesses)

  console.info('[Detective] question:', question, '| topGuesses:', topGuesses)

  return { question, newTraits, topGuesses }
}
