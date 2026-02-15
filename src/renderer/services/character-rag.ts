/**
 * Character Knowledge RAG System
 * 
 * Implements Retrieval Augmented Generation for character guessing.
 * Uses character-knowledge.json as the source of truth for all character data.
 */

interface CharacterData {
  name: string
  category: string
  signature_works: string[]
  traits: {
    fictional: boolean
    [key: string]: any
  }
  distinctive_facts: string[]
  aliases: string[] | null
  appearance: string | null
  relationships: string | null
  source: string
  source_url: string
  last_updated: string
  confidence: number
}

interface CharacterKnowledge {
  version: string
  character_count: number
  last_updated: string
  characters: {
    [key: string]: CharacterData
  }
}

interface Trait {
  key: string
  value: string
  confidence: number
  turnAdded: number
}

// Singleton to hold loaded character knowledge
let characterKnowledge: CharacterKnowledge | null = null

/**
 * Load character knowledge from JSON file
 */
export async function loadCharacterKnowledge(): Promise<void> {
  if (characterKnowledge) return // Already loaded
  
  try {
    const response = await fetch('/character-knowledge.json')
    if (!response.ok) {
      throw new Error(`Failed to load character knowledge: ${response.status}`)
    }
    characterKnowledge = await response.json()
    console.info(`[RAG] Loaded ${characterKnowledge?.character_count} characters from knowledge base`)
  } catch (error) {
    console.error('[RAG] Failed to load character knowledge:', error)
    throw error
  }
}

/**
 * Get all characters from knowledge base
 */
export function getAllCharacters(): CharacterData[] {
  if (!characterKnowledge) {
    throw new Error('[RAG] Character knowledge not loaded')
  }
  return Object.values(characterKnowledge.characters)
}

/**
 * Get character by name (case-insensitive)
 */
export function getCharacterByName(name: string): CharacterData | null {
  if (!characterKnowledge) return null
  
  const key = name.toLowerCase().trim()
  return characterKnowledge.characters[key] || null
}

/**
 * Filter characters by confirmed traits
 * Returns characters that match ALL confirmed traits
 */
export function filterCharactersByTraits(traits: Trait[]): CharacterData[] {
  const allChars = getAllCharacters()
  
  console.info('[RAG] Filtering characters with traits:', traits)
  
  if (traits.length === 0) {
    console.info('[RAG] No traits yet, returning all', allChars.length, 'characters')
    return allChars
  }
  
  const filtered = allChars.filter(char => {
    // Check each confirmed trait
    for (const trait of traits) {
      if (!characterMatchesTrait(char, trait)) {
        return false
      }
    }
    return true
  })
  
  console.info(`[RAG] Filtered from ${allChars.length} to ${filtered.length} characters`)
  return filtered
}

/**
 * Check if a character matches a specific trait
 */
function characterMatchesTrait(char: CharacterData, trait: Trait): boolean {
  const { key, value } = trait
  const lowerValue = value.toLowerCase()
  
  // fictional trait
  if (key === 'fictional') {
    const isFictional = lowerValue === 'true' || lowerValue === 'yes'
    const matches = char.traits.fictional === isFictional
    if (!matches) {
      console.log(`[RAG] ${char.name} REJECTED: fictional mismatch (has: ${char.traits.fictional}, need: ${isFictional})`)
    }
    return matches
  }
  
  // category-based traits
  if (key === 'category' || key === 'occupation_category') {
    const matches = char.category.toLowerCase().includes(lowerValue)
    if (!matches) {
      console.log(`[RAG] ${char.name} REJECTED: category mismatch (has: ${char.category}, need: ${lowerValue})`)
    }
    return matches
  }
  
  // gender (infer from distinctive facts or name)
  if (key === 'gender') {
    const facts = char.distinctive_facts.join(' ').toLowerCase()
    const name = char.name.toLowerCase()
    
    if (lowerValue === 'male') {
      // Male indicators
      return facts.includes('he ') || facts.includes('his ') || 
             facts.includes('actor') || facts.includes('businessman') ||
             facts.includes('(born 1') || facts.includes('(1')
    } else if (lowerValue === 'female') {
      // Female indicators
      return facts.includes('she ') || facts.includes('her ') ||
             facts.includes('actress') || facts.includes('businesswoman')
    }
  }
  
  // origin_medium (anime, movie, tv, game, comic)
  if (key === 'origin_medium') {
    if (lowerValue === 'anime' || lowerValue === 'manga') {
      return char.category === 'anime'
    } else if (lowerValue === 'movie' || lowerValue === 'film') {
      return char.category === 'actors' || char.distinctive_facts.some(f => f.toLowerCase().includes('movie') || f.toLowerCase().includes('film'))
    } else if (lowerValue === 'tv' || lowerValue === 'television') {
      return char.category === 'tv-characters' || char.distinctive_facts.some(f => f.toLowerCase().includes('television') || f.toLowerCase().includes('tv show'))
    } else if (lowerValue === 'video game' || lowerValue === 'game') {
      return char.category === 'video-games' || char.distinctive_facts.some(f => f.toLowerCase().includes('video game'))
    } else if (lowerValue === 'comic book' || lowerValue === 'comic') {
      return char.category === 'superheroes' || char.distinctive_facts.some(f => f.toLowerCase().includes('comic'))
    }
  }
  
  // has_powers
  if (key === 'has_powers') {
    const hasPowers = lowerValue === 'true' || lowerValue === 'yes'
    
    if (hasPowers) {
      // Check if character has superpowers
      return char.category === 'superheroes' || 
             char.category === 'anime' ||
             char.distinctive_facts.some(f => {
               const lf = f.toLowerCase()
               return lf.includes('superhero') || lf.includes('superpower') || 
                      lf.includes('powers') || lf.includes('magic') || 
                      lf.includes('abilities')
             })
    } else {
      // No powers - exclude superheroes/anime unless explicitly stated otherwise
      return char.category !== 'superheroes' && 
             (char.category !== 'anime' || char.distinctive_facts.some(f => f.toLowerCase().includes('no powers')))
    }
  }
  
  // alignment (hero, villain)
  if (key === 'alignment') {
    const facts = char.distinctive_facts.join(' ').toLowerCase()
    if (lowerValue === 'hero') {
      return facts.includes('hero') || facts.includes('protagonist')
    } else if (lowerValue === 'villain') {
      return facts.includes('villain') || facts.includes('antagonist')
    }
  }
  
  // species (human by default for real people)
  if (key === 'species') {
    if (!char.traits.fictional) {
      // Real people are always human
      return lowerValue === 'human'
    }
    
    const facts = char.distinctive_facts.join(' ').toLowerCase()
    if (lowerValue === 'human') {
      return !facts.includes('alien') && !facts.includes('robot') && 
             !facts.includes('god') && !facts.includes('animal')
    } else {
      return facts.includes(lowerValue)
    }
  }
  
  // Default: search in distinctive facts
  const allText = [
    char.name,
    char.category,
    ...char.distinctive_facts,
    char.appearance || '',
    char.relationships || ''
  ].join(' ').toLowerCase()
  
  return allText.includes(lowerValue)
}

/**
 * Get the most distinctive questions to ask based on remaining candidates
 * Uses information theory to find questions that split candidates ~50/50
 */
export function getMostInformativeQuestion(
  remainingCandidates: CharacterData[],
  askedQuestions: string[]
): string | null {
  if (remainingCandidates.length === 0) return null
  if (remainingCandidates.length === 1) return null // Ready to guess
  
  const questions = [
    { q: 'Is your character fictional?', test: (c: CharacterData) => c.traits.fictional },
    { q: 'Is your character male?', test: (c: CharacterData) => inferGender(c) === 'male' },
    { q: 'Did your character originate in an anime or manga?', test: (c: CharacterData) => c.category === 'anime' },
    { q: 'Is your character a superhero?', test: (c: CharacterData) => c.category === 'superheroes' },
    { q: 'Is your character an athlete?', test: (c: CharacterData) => c.category === 'athletes' },
    { q: 'Is your character a politician?', test: (c: CharacterData) => c.category === 'politicians' },
    { q: 'Is your character a musician or singer?', test: (c: CharacterData) => c.category === 'musicians' },
    { q: 'Is your character an actor?', test: (c: CharacterData) => c.category === 'actors' },
    { q: 'Is your character from a TV show?', test: (c: CharacterData) => c.category === 'tv-characters' },
    { q: 'Is your character a historical figure (died before 1950)?', test: (c: CharacterData) => {
      const facts = c.distinctive_facts.join(' ')
      return /\d{4}–\d{4}/.test(facts) && facts.includes('195') === false && facts.includes('196') === false
    }},
  ]
  
  // Find question that splits candidates closest to 50/50
  let bestQuestion: string | null = null
  let bestScore = Infinity
  
  for (const {q, test} of questions) {
    // Skip if already asked
    if (askedQuestions.some(aq => aq.toLowerCase() === q.toLowerCase())) continue
    
    const yesCount = remainingCandidates.filter(test).length
    const noCount = remainingCandidates.length - yesCount
    
    // Score is deviation from 50/50 split
    const split = yesCount / remainingCandidates.length
    const score = Math.abs(0.5 - split)
    
    if (score < bestScore) {
      bestScore = score
      bestQuestion = q
    }
  }
  
  return bestQuestion
}

/**
 * Infer gender from character data
 */
function inferGender(char: CharacterData): 'male' | 'female' | 'unknown' {
  const facts = char.distinctive_facts.join(' ').toLowerCase()
  
  if (facts.includes('actress') || facts.includes('she ') || facts.includes('businesswoman')) {
    return 'female'
  }
  if (facts.includes('actor') || facts.includes('he ') || facts.includes('businessman')) {
    return 'male'
  }
  return 'unknown'
}

/**
 * Get top N character guesses based on confirmed traits
 * Returns characters sorted by how well they match the traits
 */
export function getTopGuesses(
  traits: Trait[],
  topN: number = 3
): Array<{ name: string; confidence: number; character: CharacterData }> {
  const candidates = filterCharactersByTraits(traits)
  
  if (candidates.length === 0) return []
  
  // Calculate confidence based on number of matching traits
  const totalTraits = traits.length
  const baseConfidence = totalTraits > 0 ? 0.3 + (totalTraits * 0.08) : 0.1
  
  // Sort candidates by confidence (characters with more specific data rank higher)
  const guesses = candidates.map(char => ({
    name: char.name,
    confidence: Math.min(baseConfidence + (char.distinctive_facts.length * 0.02), 0.95),
    character: char
  }))
  
  // Sort by confidence descending
  guesses.sort((a, b) => b.confidence - a.confidence)
  
  return guesses.slice(0, topN)
}

/**
 * Get relevant context about remaining candidates for the AI
 * Returns a summary of what differentiates the top candidates
 */
export function getCandidateContext(
  remainingCandidates: CharacterData[],
  topN: number = 5
): string {
  if (remainingCandidates.length === 0) {
    return 'No matching characters found in knowledge base.'
  }
  
  if (remainingCandidates.length === 1) {
    const char = remainingCandidates[0]
    return `Only one candidate remains: ${char.name} (${char.category})`
  }
  
  const topCandidates = remainingCandidates.slice(0, topN)
  
  const lines = [
    `${remainingCandidates.length} candidates remaining. Top ${Math.min(topN, remainingCandidates.length)}:`,
    ...topCandidates.map((char, i) => {
      const facts = char.distinctive_facts.slice(0, 2).join('; ')
      return `${i + 1}. ${char.name} (${char.category}): ${facts}`
    })
  ]
  
  return lines.join('\n')
}
