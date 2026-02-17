/**
 * Character Knowledge RAG System
 * 
 * Implements Retrieval Augmented Generation for character guessing.
 * Uses character-knowledge.json as the source of truth for all character data.
 */

export interface CharacterData {
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

export interface CharacterKnowledge {
  version: string
  character_count: number
  last_updated: string
  characters: {
    [key: string]: CharacterData
  }
}

export interface Trait {
  key: string
  value: string
  confidence: number
  turnAdded: number
}

// Singleton to hold loaded character knowledge
let characterKnowledge: CharacterKnowledge | null = null

/**
 * Load character knowledge from JSON file
 * Works in both browser (fetch) and Node.js (fs) environments
 */
export async function loadCharacterKnowledge(): Promise<CharacterKnowledge> {
  if (characterKnowledge) return characterKnowledge // Already loaded
  
  try {
    // Detect environment
    const isNode = typeof process !== 'undefined' && process.versions && process.versions.node
    
    if (isNode) {
      // Node.js environment - use filesystem
      const fs = await import('fs')
      const path = await import('path')
      const filePath = path.join(__dirname, '../../../public/character-knowledge.json')
      const data = fs.readFileSync(filePath, 'utf-8')
      characterKnowledge = JSON.parse(data)
    } else {
      // Browser environment - use fetch
      const response = await fetch('/character-knowledge.json')
      if (!response.ok) {
        throw new Error(`Failed to load character knowledge: ${response.status}`)
      }
      characterKnowledge = await response.json()
    }
    
    console.info(`[RAG] Loaded ${characterKnowledge?.character_count} characters from knowledge base`)
    if (!characterKnowledge) {
      throw new Error('[RAG] Invalid character knowledge structure')
    }
    return characterKnowledge
  } catch (error) {
    console.error('[RAG] Failed to load character knowledge:', error)
    throw error
  }
}

/**
 * Get all characters from knowledge base
 */
/**
 * Check if a character name is valid (not a disambiguation page or junk data)
 */
function isValidCharacterName(name: string): boolean {
  const lower = name.toLowerCase()
  
  // Filter out disambiguation pages
  if (lower.includes('disambiguation')) return false
  
  // Filter out list pages
  if (lower.startsWith('list of')) return false
  
  // Filter out pure numbers
  if (/^\d+$/.test(name.trim())) return false
  
  // Filter out very short names (likely errors)
  if (name.trim().length <= 2) return false
  
  return true
}

/**
 * Get all valid characters from knowledge base (excludes invalid entries)
 */
export function getAllCharacters(): CharacterData[] {
  if (!characterKnowledge) {
    throw new Error('[RAG] Character knowledge not loaded')
  }
  return Object.values(characterKnowledge.characters).filter(c => isValidCharacterName(c.name))
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
 * 
 * IMPORTANT: If a positive category exists, negative categories are ignored
 * (e.g., if category=actors, then NOT_musicians is redundant)
 */
export function filterCharactersByTraits(traits: Trait[]): CharacterData[] {
  const allChars = getAllCharacters()
  
  console.info('[RAG] Filtering characters with traits:', traits)
  
  if (traits.length === 0) {
    console.info('[RAG] No traits yet, returning all', allChars.length, 'characters')
    return allChars
  }
  
  // Check if we have a positive category trait
  const positiveCategory = traits.find(t => 
    t.key === 'category' && !t.value.startsWith('NOT_') && !t.value.startsWith('not_')
  )
  
  // If we have a positive category, filter out negative category traits (they're redundant)
  const effectiveTraits = positiveCategory 
    ? traits.filter(t => {
        if (t.key !== 'category') return true
        return !t.value.startsWith('NOT_') && !t.value.startsWith('not_')
      })
    : traits
  
  if (positiveCategory) {
    console.info(`[RAG] Positive category found: ${positiveCategory.value}, ignoring negative categories`)
    console.info(`[RAG] Effective traits after filtering: ${effectiveTraits.length} (was ${traits.length})`)
  }
  
  const filtered = allChars.filter(char => {
    // Check each confirmed trait
    for (const trait of effectiveTraits) {
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
  
  // Handle negative traits (NOT_xxx)
  const isNegative = lowerValue.startsWith('not_')
  const actualValue = isNegative ? lowerValue.substring(4) : lowerValue
  
  // fictional trait
  if (key === 'fictional') {
    const isFictional = actualValue === 'true' || actualValue === 'yes'
    const matches = isNegative ? char.traits.fictional !== isFictional : char.traits.fictional === isFictional
    if (!matches) {
      console.log(`[RAG] ${char.name} REJECTED: fictional mismatch (has: ${char.traits.fictional}, need: ${isNegative ? 'NOT ' : ''}${isFictional})`)
    }
    return matches
  }
  
  // category-based traits
  if (key === 'category' || key === 'occupation_category') {
    const categoryMatches = char.category.toLowerCase().includes(actualValue)
    const matches = isNegative ? !categoryMatches : categoryMatches
    if (!matches) {
      console.log(`[RAG] ${char.name} REJECTED: category mismatch (has: ${char.category}, need: ${isNegative ? 'NOT ' : ''}${actualValue})`)
    }
    return matches
  }
  
  // gender (infer from distinctive facts or name)
  if (key === 'gender') {
    const facts = char.distinctive_facts.join(' ').toLowerCase()
    const name = char.name.toLowerCase()
    
    if (lowerValue === 'male') {
      // Male indicators - check for 'actor' but NOT 'actress' to avoid substring match
      return facts.includes('he ') || facts.includes('his ') ||
             (facts.includes('actor') && !facts.includes('actress')) ||
             facts.includes('businessman')
    } else if (lowerValue === 'female') {
      // Female indicators
      return facts.includes('she ') || facts.includes('her ') ||
             facts.includes('actress') || facts.includes('businesswoman')
    }

    // If no clear gender indicators found, return false (don't match)
    return false
  }
  
  // origin_medium (anime, movie, tv, game, comic)
  if (key === 'origin_medium') {
    let mediumMatches = false

    if (actualValue === 'anime' || actualValue === 'manga') {
      mediumMatches = char.category === 'anime'
    } else if (actualValue === 'movie' || actualValue === 'film') {
      mediumMatches = char.category === 'actors' || char.distinctive_facts.some(f => f.toLowerCase().includes('movie') || f.toLowerCase().includes('film'))
    } else if (actualValue === 'tv' || actualValue === 'television') {
      mediumMatches = char.category === 'tv-characters' || char.distinctive_facts.some(f => f.toLowerCase().includes('television') || f.toLowerCase().includes('tv show'))
    } else if (actualValue === 'video game' || actualValue === 'game') {
      mediumMatches = char.category === 'video-games' || char.distinctive_facts.some(f => f.toLowerCase().includes('video game'))
    } else if (actualValue === 'comic book' || actualValue === 'comic') {
      mediumMatches = char.category === 'superheroes' || char.distinctive_facts.some(f => f.toLowerCase().includes('comic'))
    }

    const matches = isNegative ? !mediumMatches : mediumMatches
    if (!matches) {
      console.log(`[RAG] ${char.name} REJECTED: origin_medium mismatch (${isNegative ? 'NOT ' : ''}${actualValue})`)
    }
    return matches
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
 * Also applies logical inference to skip irrelevant questions
 */
export function getMostInformativeQuestion(
  remainingCandidates: CharacterData[],
  askedQuestions: string[],
  confirmedTraits: Trait[] = []
): string | null {
  if (remainingCandidates.length === 0) return null
  if (remainingCandidates.length === 1) return null // Ready to guess
  
  // Check if character is confirmed as non-fictional or fictional
  const isNotFictional = confirmedTraits.some(t => t.key === 'fictional' && t.value === 'false')
  const isFictional = confirmedTraits.some(t => t.key === 'fictional' && t.value === 'true')
  
  // Check which categories have been ruled out (NOT_category traits)
  const ruledOutCategories = new Set(
    confirmedTraits
      .filter(t => t.key === 'category' && t.value.startsWith('NOT_'))
      .map(t => t.value.replace('NOT_', ''))
  )
  
  // Also infer ruled-out categories from remaining candidates
  // If ALL remaining candidates are NOT in a category, that category is ruled out
  if (remainingCandidates.length > 0) {
    const categoriesInCandidates = new Set(remainingCandidates.map(c => c.category))
    const allPossibleCategories = ['anime', 'superheroes', 'tv-characters', 'actors', 'athletes', 'politicians', 'musicians', 'video-games', 'historical']
    
    for (const category of allPossibleCategories) {
      if (!categoriesInCandidates.has(category)) {
        ruledOutCategories.add(category)
      }
    }
  }
  
  console.log(`[RAG] Ruled out categories:`, Array.from(ruledOutCategories))
  
  const questions: Array<{q: string, test: (c: CharacterData) => boolean, fictionOnly?: boolean, realPersonOnly?: boolean, categoryRequired?: string}> = [
    { q: 'Is your character fictional?', test: (c: CharacterData) => c.traits.fictional, fictionOnly: false },
    { q: 'Is your character male?', test: (c: CharacterData) => inferGender(c) === 'male', fictionOnly: false },
    // Fiction-only questions (skip if character is confirmed as non-fictional)
    { q: 'Did your character originate in an anime or manga?', test: (c: CharacterData) => c.category === 'anime', fictionOnly: true },
    { q: 'Is your character a superhero?', test: (c: CharacterData) => c.category === 'superheroes', fictionOnly: true },
    { q: 'Did your character originate in a comic book?', test: (c: CharacterData) => c.category === 'superheroes', fictionOnly: true },
    { q: 'Is your character from a video game?', test: (c: CharacterData) => c.category === 'video-games', fictionOnly: true },
    { q: 'Is your character from a TV show?', test: (c: CharacterData) => c.category === 'tv-characters', fictionOnly: false },
    // Real person questions
    { q: 'Is your character an athlete?', test: (c: CharacterData) => c.category === 'athletes', fictionOnly: false, realPersonOnly: true },
    { q: 'Is your character a politician?', test: (c: CharacterData) => c.category === 'politicians', fictionOnly: false, realPersonOnly: true },
    { q: 'Is your character a musician or singer?', test: (c: CharacterData) => c.category === 'musicians', fictionOnly: false, realPersonOnly: true },
    { q: 'Is your character an actor?', test: (c: CharacterData) => c.category === 'actors', fictionOnly: false, realPersonOnly: true },
    { q: 'Is your character a historical figure (died before 1950)?', test: (c: CharacterData) => {
      const facts = c.distinctive_facts.join(' ')
      return /\d{4}–\d{4}/.test(facts) && facts.includes('195') === false && facts.includes('196') === false
    }, fictionOnly: false, realPersonOnly: true },
    // Additional broad questions for better splitting
    { q: 'Is your character American?', test: (c: CharacterData) => {
      const facts = c.distinctive_facts.join(' ').toLowerCase()
      return facts.includes('american') || facts.includes('united states') || facts.includes('u.s.')
    }, fictionOnly: false },
    { q: 'Is your character still alive today?', test: (c: CharacterData) => {
      const facts = c.distinctive_facts.join(' ')
      return !facts.includes('–') && !facts.includes('died')
    }, fictionOnly: false },
    { q: 'Is your character known primarily for comedy?', test: (c: CharacterData) => {
      const facts = c.distinctive_facts.join(' ').toLowerCase()
      return facts.includes('comedy') || facts.includes('comedian') || facts.includes('comic')
    }, fictionOnly: false },
    { q: 'Is your character known for action or physical roles?', test: (c: CharacterData) => {
      const facts = c.distinctive_facts.join(' ').toLowerCase()
      return facts.includes('action') || facts.includes('martial arts') || facts.includes('fighter')
    }, fictionOnly: false },
    
    // Category-specific discriminating questions
    // Politicians
    { q: 'Is your character from Europe?', test: (c: CharacterData) => {
      if (c.category !== 'politicians') return false
      const facts = c.distinctive_facts.join(' ').toLowerCase()
      return facts.includes('russia') || facts.includes('britain') || facts.includes('france') || 
             facts.includes('germany') || facts.includes('italy') || facts.includes('europe')
    }, fictionOnly: false, realPersonOnly: true, categoryRequired: 'politicians' },
    { q: 'Was your character a U.S. President?', test: (c: CharacterData) => {
      if (c.category !== 'politicians') return false
      const facts = c.distinctive_facts.join(' ').toLowerCase()
      return facts.includes('president of the united states') || facts.includes('44th president') || facts.includes('45th president')
    }, fictionOnly: false, realPersonOnly: true, categoryRequired: 'politicians' },
    { q: 'Was your character president in the 2000s or later?', test: (c: CharacterData) => {
      if (c.category !== 'politicians') return false
      const facts = c.distinctive_facts.join(' ').toLowerCase()
      return facts.includes('2000') || facts.includes('2010') || facts.includes('2020') || 
             facts.includes('obama') || facts.includes('trump') || facts.includes('biden')
    }, fictionOnly: false, realPersonOnly: true, categoryRequired: 'politicians' },
    { q: 'Was your character president before 2000?', test: (c: CharacterData) => {
      if (c.category !== 'politicians') return false
      const facts = c.distinctive_facts.join(' ').toLowerCase()
      return facts.includes('198') || facts.includes('199') || facts.includes('197') ||
             facts.includes('clinton') || facts.includes('reagan') || facts.includes('bush')
    }, fictionOnly: false, realPersonOnly: true, categoryRequired: 'politicians' },
    { q: 'Is your character currently in office (as of 2026)?', test: (c: CharacterData) => {
      if (c.category !== 'politicians') return false
      const facts = c.distinctive_facts.join(' ').toLowerCase()
      const name = c.name.toLowerCase()
      // Biden is current president in 2026
      return name.includes('biden')
    }, fictionOnly: false, realPersonOnly: true, categoryRequired: 'politicians' },
    
    // Athletes
    { q: 'Is your character a basketball player?', test: (c: CharacterData) => {
      if (c.category !== 'athletes') return false
      const facts = c.distinctive_facts.join(' ').toLowerCase()
      return facts.includes('basketball') || facts.includes('nba')
    }, fictionOnly: false, realPersonOnly: true, categoryRequired: 'athletes' },
    { q: 'Is your character a soccer/football player?', test: (c: CharacterData) => {
      if (c.category !== 'athletes') return false
      const facts = c.distinctive_facts.join(' ').toLowerCase()
      return facts.includes('soccer') || facts.includes('football') || facts.includes('fifa')
    }, fictionOnly: false, realPersonOnly: true, categoryRequired: 'athletes' },
    { q: 'Is your character a baseball player?', test: (c: CharacterData) => {
      if (c.category !== 'athletes') return false
      const facts = c.distinctive_facts.join(' ').toLowerCase()
      return facts.includes('baseball') || facts.includes('mlb')
    }, fictionOnly: false, realPersonOnly: true, categoryRequired: 'athletes' },
    { q: 'Is your character a combat sports athlete (boxing, MMA, wrestling)?', test: (c: CharacterData) => {
      if (c.category !== 'athletes') return false
      const facts = c.distinctive_facts.join(' ').toLowerCase()
      return facts.includes('boxing') || facts.includes('mma') || facts.includes('ufc') || 
             facts.includes('wrestling') || facts.includes('fighter') || facts.includes('martial arts')
    }, fictionOnly: false, realPersonOnly: true, categoryRequired: 'athletes' },
    
    // Actors
    { q: 'Is your character from the United Kingdom?', test: (c: CharacterData) => {
      if (c.category !== 'actors') return false
      const facts = c.distinctive_facts.join(' ').toLowerCase()
      return facts.includes('british') || facts.includes('english') || facts.includes('uk')
    }, fictionOnly: false, realPersonOnly: true, categoryRequired: 'actors' },
    { q: 'Did your character act in the Marvel Cinematic Universe?', test: (c: CharacterData) => {
      if (c.category !== 'actors') return false
      const facts = c.distinctive_facts.join(' ').toLowerCase()
      return facts.includes('marvel') || facts.includes('iron man') || facts.includes('avengers') || facts.includes('mcu')
    }, fictionOnly: false, realPersonOnly: true, categoryRequired: 'actors' },
    
    // Superheroes (fiction-only and category-specific)
    { q: 'Is your character from DC Comics?', test: (c: CharacterData) => {
      if (c.category !== 'superheroes') return false
      const facts = c.distinctive_facts.join(' ').toLowerCase()
      return facts.includes('dc comics') || facts.includes('batman') || facts.includes('justice league')
    }, fictionOnly: true, categoryRequired: 'superheroes' },
    { q: 'Is your character from Marvel Comics?', test: (c: CharacterData) => {
      if (c.category !== 'superheroes') return false
      const facts = c.distinctive_facts.join(' ').toLowerCase()
      return facts.includes('marvel') || facts.includes('spider-man') || facts.includes('x-men')
    }, fictionOnly: true, categoryRequired: 'superheroes' },
    { q: 'Does your character have superpowers?', test: (c: CharacterData) => {
      if (c.category !== 'superheroes') return false
      const facts = c.distinctive_facts.join(' ').toLowerCase()
      return facts.includes('power') || facts.includes('ability') || facts.includes('superhuman')
    }, fictionOnly: true, categoryRequired: 'superheroes' },
    
    // Anime (category-specific questions that require character to be anime category)
    { q: 'Is your character from Dragon Ball?', test: (c: CharacterData) => {
      if (c.category !== 'anime') return false
      const facts = c.distinctive_facts.join(' ').toLowerCase()
      return facts.includes('dragon ball')
    }, fictionOnly: true, categoryRequired: 'anime' },
    { q: 'Is your character from Naruto?', test: (c: CharacterData) => {
      if (c.category !== 'anime') return false
      const facts = c.distinctive_facts.join(' ').toLowerCase()
      return facts.includes('naruto')
    }, fictionOnly: true, categoryRequired: 'anime' },
    { q: 'Is your character from One Piece?', test: (c: CharacterData) => {
      if (c.category !== 'anime') return false
      const facts = c.distinctive_facts.join(' ').toLowerCase()
      return facts.includes('one piece')
    }, fictionOnly: true, categoryRequired: 'anime' },
    { q: 'Is your character a villain or antagonist?', test: (c: CharacterData) => {
      if (c.category !== 'anime' && c.category !== 'superheroes' && c.category !== 'tv-characters') return false
      const facts = c.distinctive_facts.join(' ').toLowerCase()
      return facts.includes('villain') || facts.includes('antagonist') || facts.includes('enemy') ||
             facts.includes('evil') || facts.includes('bad guy')
    }, fictionOnly: true },
    
    // Musicians
    { q: 'Is your character a rapper or hip-hop artist?', test: (c: CharacterData) => {
      if (c.category !== 'musicians') return false
      const facts = c.distinctive_facts.join(' ').toLowerCase()
      return facts.includes('rapper') || facts.includes('hip hop') || facts.includes('hip-hop')
    }, fictionOnly: false, realPersonOnly: true, categoryRequired: 'musicians' },
    { q: 'Is your character in a band?', test: (c: CharacterData) => {
      if (c.category !== 'musicians') return false
      const facts = c.distinctive_facts.join(' ').toLowerCase()
      return facts.includes('band') || facts.includes('beatles') || facts.includes('led zeppelin')
    }, fictionOnly: false, realPersonOnly: true, categoryRequired: 'musicians' },
    { q: 'Is your character a rock musician?', test: (c: CharacterData) => {
      if (c.category !== 'musicians') return false
      const facts = c.distinctive_facts.join(' ').toLowerCase()
      return facts.includes('rock') || facts.includes('guitar') 
    }, fictionOnly: false, realPersonOnly: true, categoryRequired: 'musicians' },
    { q: 'Is your character a pop singer?', test: (c: CharacterData) => {
      if (c.category !== 'musicians') return false
      const facts = c.distinctive_facts.join(' ').toLowerCase()
      return facts.includes('pop') && !facts.includes('hip hop') && !facts.includes('rock')
    }, fictionOnly: false, realPersonOnly: true, categoryRequired: 'musicians' },
    { q: 'Was your character popular in the 1960s-1980s?', test: (c: CharacterData) => {
      if (c.category !== 'musicians') return false
      const facts = c.distinctive_facts.join(' ').toLowerCase()
      return facts.includes('196') || facts.includes('197') || facts.includes('198')
    }, fictionOnly: false, realPersonOnly: true, categoryRequired: 'musicians' },
    
    // Actors
    { q: 'Has your character won an Oscar?', test: (c: CharacterData) => {
      if (c.category !== 'actors') return false
      const facts = c.distinctive_facts.join(' ').toLowerCase()
      return facts.includes('oscar') || facts.includes('academy award')
    }, fictionOnly: false, realPersonOnly: true, categoryRequired: 'actors' },
    { q: 'Is your character primarily known for action movies?', test: (c: CharacterData) => {
      if (c.category !== 'actors') return false
      const facts = c.distinctive_facts.join(' ').toLowerCase()
      return facts.includes('action') || facts.includes('martial arts')
    }, fictionOnly: false, realPersonOnly: true, categoryRequired: 'actors' },
    { q: 'Was your character active in movies before 2000?', test: (c: CharacterData) => {
      if (c.category !== 'actors') return false
      const facts = c.distinctive_facts.join(' ').toLowerCase()
      return facts.includes('198') || facts.includes('199')
    }, fictionOnly: false, realPersonOnly: true, categoryRequired: 'actors' },
    
    // TV Characters  
    { q: 'Is your character from a sitcom?', test: (c: CharacterData) => {
      if (c.category !== 'tv-characters') return false
      const facts = c.distinctive_facts.join(' ').toLowerCase()
      return facts.includes('sitcom') || facts.includes('friends') || facts.includes('seinfeld') || 
             facts.includes('office') || facts.includes('big bang')
    }, fictionOnly: true },
    { q: 'Is your character from a drama series?', test: (c: CharacterData) => {
      if (c.category !== 'tv-characters') return false
      const facts = c.distinctive_facts.join(' ').toLowerCase()
      return facts.includes('drama') || facts.includes('breaking bad') || facts.includes('game of thrones')
    }, fictionOnly: true },
    { q: 'Is your character from an animated show?', test: (c: CharacterData) => {
      if (c.category !== 'tv-characters') return false
      const facts = c.distinctive_facts.join(' ').toLowerCase()
      return facts.includes('animated') || facts.includes('simpsons') || facts.includes('family guy')
    }, fictionOnly: true }
  ]
  
  // Find question that splits candidates closest to 50/50
  let bestQuestion: string | null = null
  let bestScore = Infinity
  
  console.log(`[RAG] getMostInformativeQuestion called with ${askedQuestions.length} previously asked questions`)
  
  // Check for mutually exclusive confirmed traits
  // If sitcom=true, don't ask about drama
  // If drama=true, don't ask about sitcom or animated
  const hasSitcom = confirmedTraits.some(t => 
    t.key === 'tv_show_type' && t.value === 'sitcom' && t.confidence >= 0.7
  )
  const hasDrama = confirmedTraits.some(t => 
    t.key === 'tv_show_type' && t.value === 'drama' && t.confidence >= 0.7
  )
  const hasAnimated = confirmedTraits.some(t => 
    t.key === 'tv_show_type' && t.value === 'animated' && t.confidence >= 0.7
  )
  
  // Build exclusion list for mutually exclusive questions
  const excludedQuestions = new Set<string>()
  if (hasSitcom) {
    excludedQuestions.add('is your character from a drama series?')
    excludedQuestions.add('is your character from an animated show?')
  }
  if (hasDrama) {
    excludedQuestions.add('is your character from a sitcom?')
    excludedQuestions.add('is your character from an animated show?')
  }
  if (hasAnimated) {
    excludedQuestions.add('is your character from a sitcom?')
    excludedQuestions.add('is your character from a drama series?')
  }
  
  for (const {q, test, fictionOnly, realPersonOnly, categoryRequired} of questions) {
    // Skip fiction-only questions if character is confirmed as non-fictional
    if (fictionOnly && isNotFictional) {
      console.info(`[RAG] Skipping fiction-only question due to logical inference: "${q}"`)
      continue
    }
    
    // Skip real-person-only questions if character is confirmed as fictional
    if (realPersonOnly && isFictional) {
      console.info(`[RAG] Skipping real-person-only question due to logical inference: "${q}"`)
      continue
    }
    
    // Skip category-specific questions if that category has been ruled out
    if (categoryRequired && ruledOutCategories.has(categoryRequired)) {
      console.info(`[RAG] Skipping ${categoryRequired} question (category ruled out): "${q}"`)
      continue
    }
    
    // Skip mutually exclusive questions
    if (excludedQuestions.has(q.toLowerCase())) {
      console.info(`[RAG] Skipping mutually exclusive question: "${q}"`)
      continue
    }
    
    // Skip if already asked (check for similar questions, not just exact)
    const normalizedQ = q.toLowerCase().replace(/[()]/g, '').replace(/\s+/g, ' ').trim()
    const isAlreadyAsked = askedQuestions.some(aq => {
      const normalizedAq = aq.toLowerCase().replace(/[()]/g, '').replace(/\s+/g, ' ').trim()
      // Check if questions are very similar (share most key words)
      if (normalizedAq === normalizedQ) return true
      // Check if questions start the same way (e.g., "Is your character still alive...")
      if (normalizedQ.length > 20 && normalizedAq.startsWith(normalizedQ.slice(0, 25))) return true
      if (normalizedAq.length > 20 && normalizedQ.startsWith(normalizedAq.slice(0, 25))) return true
      return false
    })
    if (isAlreadyAsked) {
      console.log(`[RAG] Skipping already-asked question: "${q}"`)
      continue
    }
    
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
 * 
 * CRITICAL: Confidence should scale with trait count AND specificity
 * - Few traits (2-3) → Low confidence (30-50%)
 * - Medium traits (4-6) → Medium confidence (50-70%)
 * - Many traits (7+) → High confidence (70-90%)
 */
export function getTopGuesses(
  traits: Trait[],
  topN: number = 3
): Array<{ name: string; confidence: number; character: CharacterData }> {
  const candidates = filterCharactersByTraits(traits)
  
  if (candidates.length === 0) return []
  
  // Score each candidate based on how well they match the traits
  const guesses = candidates.map(char => {
    let matchScore = 0
    let totalWeight = 0
    
    for (const trait of traits) {
      const weight = trait.confidence || 0.9
      totalWeight += weight
      
      // Check if character matches this specific trait
      if (characterMatchesTrait(char, trait)) {
        matchScore += weight
      }
    }
    
    // Calculate match percentage
    const matchPercentage = totalWeight > 0 ? matchScore / totalWeight : 0
    
    // CRITICAL: Start with LOW base confidence
    // Only increase as we gather more discriminating traits
    let baseConfidence = 0.25 // Start at 25%
    
    // Scale confidence based on number of CONFIRMED traits
    // More traits = more confidence, but conservative scaling
    const traitCount = traits.length
    
    if (traitCount >= 8) {
      baseConfidence = 0.55 // 8+ traits → start at 55%
    } else if (traitCount >= 6) {
      baseConfidence = 0.45 // 6-7 traits → start at 45%
    } else if (traitCount >= 4) {
      baseConfidence = 0.35 // 4-5 traits → start at 35%
    }
    // else 2-3 traits → stay at 25%
    
    // Match quality bonus (if perfect match, add up to 30%)
    const matchBonus = matchPercentage * 0.3
    
    // Specificity bonus: Positive category traits are more discriminating than negative
    const hasPositiveCategory = traits.some(t => 
      t.key === 'category' && !t.value.startsWith('NOT_')
    )
    const specificityBonus = hasPositiveCategory ? 0.1 : 0
    
    // Narrow pool bonus: If very few candidates left, slightly more confident
    const candidatePoolBonus = candidates.length <= 5 ? 0.1 : 
                                candidates.length <= 10 ? 0.05 : 0
    
    // Prominence bonus (small - only 2-3%)
    let prominenceBonus = 0
    const facts = char.distinctive_facts.join(' ')
    if (facts.includes('201') || facts.includes('202')) {
      prominenceBonus += 0.01 // Recent figure
    }
    if (facts.includes('President') || facts.includes('award') || facts.includes('Olympic')) {
      prominenceBonus += 0.02 // High prominence
    }
    
    // Deterministic tiebreaker based on name (prevents random shuffling between calls)
    // Use character name hash to create consistent ordering
    let nameHash = 0
    for (let i = 0; i < char.name.length; i++) {
      nameHash = ((nameHash << 5) - nameHash) + char.name.charCodeAt(i)
      nameHash |= 0 // Convert to 32-bit integer
    }
    const deterministicTiebreaker = (Math.abs(nameHash) % 100) / 10000 // 0-0.01 range
    
    // Calculate final confidence
    const confidence = Math.min(
      baseConfidence + matchBonus + specificityBonus + candidatePoolBonus + prominenceBonus + deterministicTiebreaker,
      0.90 // Cap at 90% (never be 100% certain)
    )
    
    return {
      name: char.name,
      confidence,
      character: char
    }
  })
  
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
