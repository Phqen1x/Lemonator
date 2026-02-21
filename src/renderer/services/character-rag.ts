/**
 * Character Knowledge RAG System
 * 
 * Implements Retrieval Augmented Generation for character guessing.
 * Uses character-knowledge.json as the source of truth for all character data.
 */

export interface SignatureWork {
  name: string
  type: string
  year?: number
}

export interface Relationships {
  spouse?: string[]
  children?: string[]
  parents?: string[]
  siblings?: string[]
  in_db?: string[]
}

export interface CharacterData {
  name: string
  category: string
  signature_works: SignatureWork[]
  traits: {
    fictional: boolean
    nationality?: string
    gender?: string
    alive?: boolean
    media_origin?: string
    birth_decade?: number
    [key: string]: any
  }
  distinctive_facts: string[]
  aliases?: string[]
  appearance?: string
  relationships?: Relationships
  sitelink_count?: number
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
 * Uses Electron IPC in production, fetch in development
 */
export async function loadCharacterKnowledge(): Promise<CharacterKnowledge> {
  if (characterKnowledge) return characterKnowledge // Already loaded
  
  try {
    // Check if running in Electron (production)
    if (typeof window !== 'undefined' && (window as any).electronAPI?.loadCharacterKnowledge) {
      characterKnowledge = await (window as any).electronAPI.loadCharacterKnowledge()
    } else {
      // Development mode - use fetch
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
 * Get character by name or alias (case-insensitive)
 */
export function getCharacterByName(name: string): CharacterData | null {
  if (!characterKnowledge) return null

  const key = name.toLowerCase().trim()

  // First try direct name lookup (fast path)
  const direct = characterKnowledge.characters[key]
  if (direct) return direct

  // If not found, search by alias
  for (const char of Object.values(characterKnowledge.characters)) {
    if ((char.aliases ?? []).some(alias => alias.toLowerCase() === key)) {
      return char
    }
  }

  return null
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
    return matches
  }
  
  // category-based traits
  if (key === 'category' || key === 'occupation_category') {
    const categoryMatches = char.category.toLowerCase().includes(actualValue)
    const matches = isNegative ? !categoryMatches : categoryMatches
    return matches
  }
  
  // gender - use direct field from enriched database (v1.1.0)
  if (key === 'gender') {
    // Prefer direct gender field (92% coverage from Wikidata)
    if (char.traits.gender) {
      const isMale = char.traits.gender === 'male'
      return actualValue === 'male' ? isMale : !isMale
    }

    // Fallback: text inference for chars without the field
    const facts = char.distinctive_facts.join(' ').toLowerCase()
    if (actualValue === 'male') {
      return facts.includes('he ') || facts.includes('his ') ||
             (facts.includes('actor') && !facts.includes('actress')) ||
             facts.includes('businessman')
    } else if (actualValue === 'female') {
      return facts.includes('she ') || facts.includes('her ') ||
             facts.includes('actress') || facts.includes('businesswoman')
    }

    return false
  }
  
  // alive - use direct field from enriched database (v1.1.0)
  if (key === 'alive' || key === 'is_alive') {
    // Prefer direct alive field (62% coverage from Wikidata)
    if (char.traits.alive !== null && char.traits.alive !== undefined) {
      const wantAlive = actualValue === 'true' || actualValue === 'yes'
      const matches = char.traits.alive === wantAlive
      return isNegative ? !matches : matches
    }

    // Fallback: infer from birth-death date range in facts
    const factsText = char.distinctive_facts.join(' ')
    const hasDeathDate = /\d{4}[–\-]\d{4}/.test(factsText)
    const wantAlive = actualValue === 'true' || actualValue === 'yes'
    const inferredAlive = !hasDeathDate
    const matches = inferredAlive === wantAlive
    return isNegative ? !matches : matches
  }

  // origin_medium / media_origin - use direct field from enriched database (v1.1.0)
  if (key === 'origin_medium' || key === 'media_origin') {
    // Map extractor values to database media_origin values
    // Database uses: "manga/anime", "american_comic", "live_action_tv", "animated_tv"
    const mediaOriginMappings: Record<string, string[]> = {
      'anime': ['manga/anime'],
      'manga': ['manga/anime'],
      'manga/anime': ['manga/anime'],
      'comic': ['american_comic'],
      'american_comic': ['american_comic'],
      'comic book': ['american_comic'],
      'tv': ['live_action_tv', 'animated_tv'],
      'television': ['live_action_tv', 'animated_tv'],
      'live_action_tv': ['live_action_tv'],
      'animated_tv': ['animated_tv'],
    }

    // Prefer direct media_origin field (37% coverage - all 190 fictional characters)
    if (char.traits.media_origin) {
      const possibleMatches = mediaOriginMappings[actualValue] || [actualValue]
      const mediumMatches = possibleMatches.includes(char.traits.media_origin)
      return isNegative ? !mediumMatches : mediumMatches
    }

    // Fallback: infer from category and facts
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

    return isNegative ? !mediumMatches : mediumMatches
  }
  
  // tv_show_type (sitcom, drama, animated)
  if (key === 'tv_show_type') {
    const facts = char.distinctive_facts.join(' ').toLowerCase()
    let typeMatches = false
    
    if (actualValue === 'sitcom') {
      typeMatches = facts.includes('sitcom') || facts.includes('comedy series')
    } else if (actualValue === 'drama') {
      typeMatches = facts.includes('drama') && !facts.includes('sitcom')
    } else if (actualValue === 'animated') {
      typeMatches = facts.includes('animated') || facts.includes('cartoon')
    }
    
    const matches = isNegative ? !typeMatches : typeMatches
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
  
  // nationality (american, british, japanese, etc.)
  if (key === 'nationality') {
    const facts = char.distinctive_facts.join(' ').toLowerCase()
    const dbNationality = (char.traits.nationality || '').toLowerCase()

    // Map all variations of a nationality to a canonical group.
    // Both the trait value AND the database nationality field are resolved
    // to the same group so "american" matches "United States" and vice versa.
    const nationalityGroups: string[][] = [
      ['american', 'united states', 'u.s.', 'usa', 'america'],
      ['british', 'uk', 'united kingdom', 'england', 'english', 'scottish', 'welsh', 'great britain', 'united kingdom of great britain'],
      ['japanese', 'japan'],
      ['russian', 'russia', 'soviet', 'soviet union'],
      ['french', 'france'],
      ['german', 'germany', 'nazi germany'],
      ['italian', 'italy', 'republic of florence', 'duchy of florence', 'republic of genoa'],
      ['chinese', 'china', 'people\'s republic of china', 'republic of china'],
      ['korean', 'korea', 'north korea', 'south korea'],
      ['mexican', 'mexico'],
      ['australian', 'australia'],
      ['canadian', 'canada'],
      ['indian', 'india'],
      ['brazilian', 'brazil'],
      ['spanish', 'spain'],
    ]

    // Find which group the trait value belongs to
    const matchGroup = nationalityGroups.find(group =>
      group.some(variant => variant === actualValue)
    ) || [actualValue]

    // Check against distinctive_facts AND the database nationality field
    const nationalityMatches =
      matchGroup.some(kw => facts.includes(kw)) ||
      matchGroup.some(kw => dbNationality.includes(kw))

    const matches = isNegative ? !nationalityMatches : nationalityMatches
    return matches
  }
  
  // genre (drama, comedy, action, sci-fi, romance, war, crime, etc.)
  if (key === 'genre') {
    const facts = char.distinctive_facts.join(' ').toLowerCase()
    const genreTerms: Record<string, string[]> = {
      'drama':      ['drama', 'dramatic'],
      'comedy':     ['comedy', 'comedian', 'comic', 'funny'],
      'action':     ['action', 'martial arts'],
      'sci-fi':     ['sci-fi', 'science fiction', 'fantasy', 'star wars', 'matrix', 'terminator'],
      'romance':    ['romantic', 'romance', 'rom-com'],
      'horror':     ['horror'],
      'war':        ['war', 'world war', 'military', 'historical', 'braveheart', 'schindler'],
      'crime':      ['crime', 'criminal', 'detective', 'heist', 'thriller', 'gangster'],
      'thriller':   ['thriller', 'suspense'],
      'historical': ['historical', 'history', 'period'],
      'animation':  ['animated', 'animation', 'voice'],
    }
    const terms = genreTerms[actualValue] || [actualValue]
    const genreMatches = terms.some(t => facts.includes(t))
    return isNegative ? !genreMatches : genreMatches
  }

  // has_oscar (whether the actor has won an Academy Award)
  if (key === 'has_oscar') {
    const facts = char.distinctive_facts.join(' ').toLowerCase()
    const hasAward = facts.includes('oscar') || facts.includes('academy award')
    if (isNegative) return !hasAward
    return hasAward === (actualValue === 'true' || actualValue === 'yes')
  }

  // is_alive (whether the real person is currently alive; irrelevant for fictional characters)
  if (key === 'is_alive') {
    if (char.traits.fictional) return true  // fictional characters: no-op on this trait
    // Bio fact (index 0) contains birth-death year range like "American actor (1951–2014)" for deceased
    // En-dashes also appear in award names ("Best Actor – Motion Picture Drama"), so we must
    // specifically match the YEAR–YEAR pattern rather than any en-dash
    const bio = char.distinctive_facts[0] || ''
    const looksAlive = !/\d{4}[–\-]\d{4}/.test(bio) && !bio.toLowerCase().includes('died')
    if (isNegative) return !looksAlive
    return looksAlive === (actualValue === 'true' || actualValue === 'yes')
  }

  // has_signature_work - check if character appeared in a specific work
  if (key === 'has_signature_work') {
    return char.signature_works.some(w =>
      w.name.toLowerCase().includes(lowerValue)
    )
  }

  // birth_decade - era-based filtering for real people (null-safe - won't filter out unknowns)
  if (key === 'born_before_1980') {
    if (char.traits.birth_decade != null) {
      const wantBefore1980 = actualValue === 'true' || actualValue === 'yes'
      return wantBefore1980 ? char.traits.birth_decade < 1980 : char.traits.birth_decade >= 1980
    }
    return true  // Unknown - don't filter out
  }

  if (key === 'born_before_1960') {
    if (char.traits.birth_decade != null) {
      const wantBefore1960 = actualValue === 'true' || actualValue === 'yes'
      return wantBefore1960 ? char.traits.birth_decade < 1960 : char.traits.birth_decade >= 1960
    }
    return true  // Unknown - don't filter out
  }

  if (key === 'born_before_2000') {
    if (char.traits.birth_decade != null) {
      const wantBefore2000 = actualValue === 'true' || actualValue === 'yes'
      return wantBefore2000 ? char.traits.birth_decade < 2000 : char.traits.birth_decade >= 2000
    }
    return true  // Unknown - don't filter out
  }

  // relationships - check for famous family members
  if (key === 'has_famous_spouse') {
    const spouses = char.relationships?.spouse ?? []
    const wantSpouse = actualValue === 'true' || actualValue === 'yes'
    return wantSpouse ? spouses.length > 0 : spouses.length === 0
  }

  if (key === 'has_famous_children') {
    const children = char.relationships?.children ?? []
    const wantChildren = actualValue === 'true' || actualValue === 'yes'
    return wantChildren ? children.length > 0 : children.length === 0
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
 * Determine if a question should be skipped based on confirmed traits and game state.
 * Encodes logical implication rules to prevent nonsensical questions like:
 *   - "Does your character have superpowers?" when fictional=false (real people don't have superpowers)
 *   - "Is your character a historical figure (died before 1950)?" when character is confirmed alive
 *   - Award questions too early (most people don't know specific awards)
 */
export function shouldSkipQuestion(
  question: string,
  confirmedTraits: Trait[],
  turns?: Array<{ question: string; answer: string }>,
  remainingCandidateCount?: number
): boolean {
  const qLower = question.toLowerCase()
  const turnCount = turns ? turns.length : 0

  const realPersonCategories = ['actors', 'athletes', 'musicians', 'politicians', 'historical']
  const isNotFictional = confirmedTraits.some(t => t.key === 'fictional' && t.value === 'false' && t.confidence >= 0.7)
    || confirmedTraits.some(t => t.key === 'category' && realPersonCategories.includes(t.value) && t.confidence >= 0.7)
  const isFictional = confirmedTraits.some(t => t.key === 'fictional' && t.value === 'true' && t.confidence >= 0.7)
  const hasNoPowers = confirmedTraits.some(t => t.key === 'has_powers' && t.value === 'false' && t.confidence >= 0.7)
  const isHuman = confirmedTraits.some(t => t.key === 'species' && t.value === 'human' && t.confidence >= 0.7)

  // Build a set of ruled-out categories from NOT_ traits
  const ruledOutCategories = new Set(
    confirmedTraits
      .filter(t => t.key === 'category' && t.value.startsWith('NOT_') && t.confidence >= 0.7)
      .map(t => t.value.slice(4)) // strip "NOT_"
  )
  // Also infer: if a positive category is confirmed, all other categories are ruled out
  const confirmedCategory = confirmedTraits.find(
    t => t.key === 'category' && !t.value.startsWith('NOT_') && t.confidence >= 0.7
  )
  if (confirmedCategory) {
    for (const cat of ['actors', 'athletes', 'musicians', 'politicians', 'historical', 'anime', 'superheroes', 'tv-characters', 'video-games', 'other']) {
      if (cat !== confirmedCategory.value) ruledOutCategories.add(cat)
    }
  }

  // Determine alive/dead status from turn history (confirmed yes answers)
  let isAlive = false
  let isDead = false
  if (turns) {
    for (const turn of turns) {
      const tqLower = turn.question.toLowerCase()
      const isYes = turn.answer === 'yes' || turn.answer === 'probably'
      const isNo = turn.answer === 'no' || turn.answer === 'probably_not'
      if (isYes && (tqLower.includes('still alive') || tqLower.includes('alive today') || tqLower.includes('living today'))) {
        isAlive = true
      }
      if (isNo && (tqLower.includes('still alive') || tqLower.includes('alive today') || tqLower.includes('living today'))) {
        isDead = true
      }
      if (isYes && (tqLower.includes('died') || tqLower.includes('deceased') || tqLower.includes('passed away'))) {
        isDead = true
      }
      if (isNo && (tqLower.includes('died') || tqLower.includes('deceased'))) {
        isAlive = true
      }
    }
  }

  // --- Rule 1: Real people (fictional=false) can't have superpowers, magic, etc. ---
  if (isNotFictional) {
    const fictionalOnlyKeywords = [
      'superpower', 'super power', 'supernatural', 'magic', 'magical',
      'teleport', 'telepathy', 'telekinesis', 'superhuman', 'super strength',
      'super speed', 'invisibility', 'shapeshifting', 'regeneration', 'immortal',
      'fly ', 'flight', 'x-ray vision', 'laser', 'energy blast',
      'fire power', 'ice power', 'lightning power', 'mind reading',
      'secret identity', 'alter ego', 'transform', 'power up',
      'superhero', 'super hero',
    ]
    if (fictionalOnlyKeywords.some(kw => qLower.includes(kw))) {
      return true
    }
    // Real people don't originate from fictional media (as characters)
    const fictionalOriginKeywords = [
      'originate in an anime', 'originate in a manga', 'originate in a comic',
      'originate in a video game', 'originate in a cartoon',
      'originate in a tv show', 'originate in a sitcom', 'originate in a drama series',
      'originate in an animated', 'originate in a film', 'originate in a movie',
      'from an anime', 'from a manga', 'from a comic book',
      'from a video game', 'from a cartoon',
    ]
    if (fictionalOriginKeywords.some(kw => qLower.includes(kw))) {
      return true
    }
  }

  // --- Rule 1b: Skip "Is your character fictional?" when fictional status is already known ---
  // Asking actors "are you fictional?" after confirming category=actors is redundant and confusing
  if ((isNotFictional || isFictional) && /\bfictional\b/.test(qLower) && /^(is|was|are)\s+your\s+character\b/.test(qLower)) {
    return true
  }

  // --- Rule 2: Alive characters can't have died ---
  if (isAlive) {
    const deathKeywords = [
      'died before', 'died in', 'death', 'deceased', 'passed away',
      'historical figure (died', 'historical figure who died',
      'killed in', 'assassinated', 'executed',
    ]
    // Also catch "historical figure (died before 1950)" pattern
    if (deathKeywords.some(kw => qLower.includes(kw))) {
      return true
    }
    // "Is your character a historical figure?" with death implication
    if (qLower.includes('historical figure') && qLower.includes('died')) {
      return true
    }
  }

  // --- Rule 3: Dead characters can't be alive ---
  if (isDead) {
    const aliveKeywords = [
      'still alive', 'alive today', 'living today', 'currently active',
      'currently in office',
    ]
    if (aliveKeywords.some(kw => qLower.includes(kw))) {
      return true
    }
  }

  // --- Rule 4: Characters without powers ---
  if (hasNoPowers) {
    const powerKeywords = [
      'superpower', 'super power', 'supernatural', 'magic', 'magical',
      'fly ', 'flight', 'teleport', 'telepathy', 'telekinesis',
      'super strength', 'super speed', 'invisibility', 'shapeshifting',
      'time control', 'regeneration', 'immortal', 'superhuman',
      'mind reading', 'laser', 'energy blast', 'x-ray vision',
      'enhanced senses', 'fire power', 'ice power', 'lightning power',
    ]
    if (powerKeywords.some(kw => qLower.includes(kw))) {
      return true
    }
  }

  // --- Rule 5: Human characters aren't non-human species ---
  if (isHuman) {
    const nonHumanKeywords = [
      'alien', 'robot', 'android', 'cyborg', 'wings', 'tail',
      'scales', 'horns', 'fangs', 'claws', 'non-human', 'non human',
    ]
    if (nonHumanKeywords.some(kw => qLower.includes(kw))) {
      return true
    }
  }

  // --- Rule 6: Fictional characters don't hold real-world political office, win real awards,
  //             or belong to real-person database categories ---
  if (isFictional) {
    const realWorldKeywords = [
      'won an oscar', 'won a grammy', 'won an emmy', 'won a nobel',
      'academy award', 'grammy award', 'emmy award', 'nobel prize',
      'elected president', 'served as president', 'served in office',
      'currently in office',
      // Real-person category questions — fictional characters can't BE these
      'is your character a politician', 'is your character an actor',
      'is your character an actress', 'is your character an athlete',
      'is your character a musician', 'is your character a singer',
      'is your character a historical figure',
    ]
    if (realWorldKeywords.some(kw => qLower.includes(kw))) {
      return true
    }
  }

  // --- Rule 7: Defer obscure award questions to late game ---
  // Oscar/Academy Award is universally known — never defer it.
  // Grammy, Emmy, Golden Globe etc. are more obscure — defer until late or small pool.
  const isObscureAwardQuestion = /\b(emmy|grammy|golden globe|nobel|tony award|bafta|sag award|pulitzer)\b/.test(qLower)
    || (/\b(award|prize|trophy|accolade)\b/.test(qLower) && !/\b(oscar|academy award)\b/.test(qLower))
  if (isObscureAwardQuestion) {
    const candidatesSmall = remainingCandidateCount !== undefined && remainingCandidateCount <= 10
    if (turnCount < 15 && !candidatesSmall) {
      return true
    }
  }

  // --- Rule 8: Skip category-specific questions when that category is ruled out ---
  // e.g. NOT_actors → skip "starred in", "film", "movie role", Oscar, etc.
  // e.g. NOT_musicians → skip "album", "hit song", "Grammy", etc.
  if (ruledOutCategories.size > 0) {
    const categoryKeywords: Record<string, string[]> = {
      actors: [
        'starred in', 'star in', 'acted in', 'acting career', 'movie role', 'film role',
        'box office', 'box-office', 'blockbuster film', 'oscar', 'academy award',
        'golden globe', 'screen actors', 'on screen', 'on-screen', 'co-star',
        'leading role', 'supporting role', 'directed by', 'feature film',
        'movie franchise', 'film franchise', 'sitcom', 'tv show', 'television show',
        // role/performance phrasings
        ' role', 'known for dramatic', 'known for serious', 'known for comedy',
        'dramatic role', 'serious role', 'comedy role', 'dramatic performance',
        'known for drama', 'known for action', 'known for thriller',
        'drama films', 'comedy films', 'comedy movies', 'comedy shows',
        'dramatic films', 'serious films', 'action films', 'action movies',
      ],
      musicians: [
        'album', 'discography', 'hit song', 'music video', 'music career',
        'tour', 'on tour', 'concert', 'grammy', 'billboard', 'top 40',
        'record label', 'recording artist', 'debut album', 'released a song',
        'released an album', 'number one hit', 'band member', 'lead singer',
        'rapper', 'hip-hop artist', 'rock band',
      ],
      athletes: [
        'championship', 'world cup', 'olympic', 'olympics', 'sport', 'sports',
        'professional team', 'nba', 'nfl', 'mlb', 'nhl', 'premier league',
        'world record', 'gold medal', 'playing career', 'athlete',
        'retired from sport', 'scored', 'played for',
      ],
      politicians: [
        'elected', 'election', 'ran for', 'president', 'senator', 'governor',
        'prime minister', 'parliament', 'congress', 'political party', 'policy',
        'legislation', 'bill', 'campaign', 'in office', 'served in',
      ],
      superheroes: [
        'superpower', 'super power', 'superhero', 'super hero', 'villain',
        'secret identity', 'alter ego', 'marvel', 'dc comics', 'avengers',
        'justice league', 'cape', 'costume', 'sidekick', 'arch nemesis',
      ],
      anime: [
        'anime', 'manga', 'shonen', 'shojo', 'isekai', 'japanese animation',
        'japanese animated',
      ],
      'video-games': [
        'video game', 'videogame', 'gaming', 'playstation', 'xbox', 'nintendo',
        'rpg', 'first-person', 'open world',
      ],
    }
    for (const [cat, keywords] of Object.entries(categoryKeywords)) {
      if (ruledOutCategories.has(cat) && keywords.some(kw => qLower.includes(kw))) {
        return true
      }
    }
  }

  // --- Rule 9: Skip nationality questions once nationality is already confirmed ---
  // e.g. if nationality=american is known, don't ask "Is your character from the United Kingdom?"
  // (renamed from Rule 8 after new Rule 8 was added above)
  const confirmedNationality = confirmedTraits.find(t =>
    t.key === 'nationality' && !t.value.startsWith('NOT_') && t.confidence >= 0.7
  )
  if (confirmedNationality) {
    const nationalityKeywords = [
      'american', 'british', 'english', 'united kingdom', 'from the uk', 'from the u.k',
      'from england', 'from britain', 'from america', 'from the united states',
      'japanese', 'from japan', 'french', 'from france', 'german', 'from germany',
      'canadian', 'from canada', 'australian', 'from australia',
      'spanish', 'from spain', 'italian', 'from italy', 'russian', 'from russia',
      'chinese', 'from china', 'korean', 'from korea', 'indian', 'from india',
      'nationality', 'from which country', 'what country',
    ]
    if (nationalityKeywords.some(kw => qLower.includes(kw))) {
      return true
    }
  }

  return false
}

/**
 * Randomly sample an array for performance optimization
 */
function sampleArray<T>(arr: T[], size: number): T[] {
  if (arr.length <= size) return arr
  const shuffled = arr.slice().sort(() => Math.random() - 0.5)
  return shuffled.slice(0, size)
}

/**
 * Get the most distinctive questions to ask based on remaining candidates
 * Uses information theory to find questions that split candidates ~50/50
 * Also applies logical inference to skip irrelevant questions
 *
 * PERFORMANCE OPTIMIZATIONS:
 * - Early exit when excellent question found (entropy > 0.95)
 * - Candidate sampling when pool > 100 (test 50 instead of all)
 * - Question prioritization (test high-value questions first)
 */
export function getMostInformativeQuestion(
  remainingCandidates: CharacterData[],
  askedQuestions: string[],
  confirmedTraits: Trait[] = [],
  turns?: Array<{question: string, answer: string}>
): string | null {
  if (remainingCandidates.length === 0) return null
  if (remainingCandidates.length === 1) return null // Ready to guess

  // Performance optimization: Sample candidates if pool is large
  // Testing all candidates for all questions = O(questions × candidates) = expensive
  // Sample 50-80 candidates to estimate entropy instead (accurate enough for ranking)
  const SAMPLE_THRESHOLD = 100
  const SAMPLE_SIZE = 60
  const useSampling = remainingCandidates.length > SAMPLE_THRESHOLD
  const candidatesToTest = useSampling
    ? sampleArray(remainingCandidates, SAMPLE_SIZE)
    : remainingCandidates

  if (useSampling) {
    console.log(`[RAG] Performance: Sampling ${SAMPLE_SIZE}/${remainingCandidates.length} candidates for entropy calculation`)
  }
  
  // Check if character is confirmed as non-fictional or fictional
  // Real-person categories (actors, athletes, etc.) imply non-fictional even without explicit fictional=false
  const realPersonCats = ['actors', 'athletes', 'musicians', 'politicians', 'historical']
  const isNotFictional = confirmedTraits.some(t => t.key === 'fictional' && t.value === 'false')
    || confirmedTraits.some(t => t.key === 'category' && realPersonCats.includes(t.value) && t.confidence >= 0.7)
  const isFictional = confirmedTraits.some(t => t.key === 'fictional' && t.value === 'true')
  
  // Check which categories have been ruled out (NOT_category traits)
  const ruledOutCategories = new Set(
    confirmedTraits
      .filter(t => t.key === 'category' && t.value.startsWith('NOT_'))
      .map(t => t.value.replace('NOT_', ''))
  )
  
  // Check if we have a confirmed positive category
  const confirmedCategory = confirmedTraits.find(t => 
    t.key === 'category' && !t.value.startsWith('NOT_') && !t.value.startsWith('not_')
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
  if (confirmedCategory) {
    console.log(`[RAG] Confirmed positive category: ${confirmedCategory.value}`)
  }
  
  const questions: Array<{q: string, test: (c: CharacterData) => boolean, fictionOnly?: boolean, realPersonOnly?: boolean, categoryRequired?: string}> = [
    { q: 'Is your character fictional?', test: (c: CharacterData) => c.traits.fictional, fictionOnly: false },
    { q: 'Is your character male?', test: (c: CharacterData) => inferGender(c) === 'male', fictionOnly: false },
    // Fiction-only questions (skip if character is confirmed as non-fictional)
    { q: 'Did your character originate in an anime or manga?', test: (c: CharacterData) => c.category === 'anime', fictionOnly: true },
    { q: 'Is your character a superhero?', test: (c: CharacterData) => c.category === 'superheroes', fictionOnly: true },
    { q: 'Did your character originate in a comic book?', test: (c: CharacterData) => c.category === 'superheroes', fictionOnly: true },
    { q: 'Did your character originate in a video game?', test: (c: CharacterData) => c.category === 'video-games', fictionOnly: true },
    { q: 'Did your character originate in a TV show?', test: (c: CharacterData) => c.category === 'tv-characters', fictionOnly: true },
    // Real person category questions - mutually exclusive!
    { q: 'Is your character an athlete?', test: (c: CharacterData) => c.category === 'athletes', fictionOnly: false, realPersonOnly: true, categoryRequired: 'athletes' },
    { q: 'Is your character a politician?', test: (c: CharacterData) => c.category === 'politicians', fictionOnly: false, realPersonOnly: true, categoryRequired: 'politicians' },
    { q: 'Is your character a musician or singer?', test: (c: CharacterData) => c.category === 'musicians', fictionOnly: false, realPersonOnly: true, categoryRequired: 'musicians' },
    { q: 'Is your character an actor?', test: (c: CharacterData) => c.category === 'actors', fictionOnly: false, realPersonOnly: true, categoryRequired: 'actors' },
    { q: 'Is your character a historical figure (died before 1950)?', test: (c: CharacterData) => {
      // Use bio fact (index 0) — year–year pattern indicates deceased
      const bio = c.distinctive_facts[0] || ''
      return /\d{4}[–\-]\d{4}/.test(bio) && !bio.includes('195') && !bio.includes('196')
    }, fictionOnly: false, realPersonOnly: true },
    // Additional broad questions for better splitting
    { q: 'Is your character American?', test: (c: CharacterData) => {
      const facts = c.distinctive_facts.join(' ').toLowerCase()
      return facts.includes('american') || facts.includes('united states') || facts.includes('u.s.')
    }, fictionOnly: false },
    { q: 'Is your character still alive today?', test: (c: CharacterData) => {
      // Use bio fact (index 0) only — year–year pattern indicates deceased; awards use – too
      const bio = c.distinctive_facts[0] || ''
      return !/\d{4}[–\-]\d{4}/.test(bio) && !bio.toLowerCase().includes('died')
    }, fictionOnly: false },
    // Era questions (birth_decade) - efficiently split real people by generation
    { q: 'Was this person born before 1980?', test: (c: CharacterData) => {
      return c.traits.birth_decade != null && c.traits.birth_decade < 1980
    }, fictionOnly: false, realPersonOnly: true },
    { q: 'Was this person born before 1960?', test: (c: CharacterData) => {
      return c.traits.birth_decade != null && c.traits.birth_decade < 1960
    }, fictionOnly: false, realPersonOnly: true },
    { q: 'Was this person born before 2000?', test: (c: CharacterData) => {
      return c.traits.birth_decade != null && c.traits.birth_decade < 2000
    }, fictionOnly: false, realPersonOnly: true },
    // Relationship questions - link Jay-Z↔Beyoncé, Brad Pitt↔Angelina Jolie, etc.
    { q: 'Is this person married to someone famous?', test: (c: CharacterData) => {
      return (c.relationships?.spouse ?? []).length > 0
    }, fictionOnly: false, realPersonOnly: true },
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
    
    // Actors - prioritize movie/franchise/role questions over awards
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
    { q: 'Is your character known for dramatic or serious roles?', test: (c: CharacterData) => {
      if (c.category !== 'actors') return false
      const facts = c.distinctive_facts.join(' ').toLowerCase()
      return facts.includes('drama') || facts.includes('dramatic') || facts.includes('serious')
    }, fictionOnly: false, realPersonOnly: true, categoryRequired: 'actors' },
    { q: 'Has your character starred in a famous movie franchise or series?', test: (c: CharacterData) => {
      if (c.category !== 'actors') return false
      const facts = c.distinctive_facts.join(' ').toLowerCase()
      return facts.includes('franchise') || facts.includes('sequel') || facts.includes('trilogy') ||
             facts.includes('star wars') || facts.includes('harry potter') || facts.includes('fast') ||
             facts.includes('mission impossible') || facts.includes('james bond') || facts.includes('marvel') ||
             facts.includes('lord of the rings') || facts.includes('pirates')
    }, fictionOnly: false, realPersonOnly: true, categoryRequired: 'actors' },
    { q: 'Is your character known for comedy movies or shows?', test: (c: CharacterData) => {
      if (c.category !== 'actors') return false
      const facts = c.distinctive_facts.join(' ').toLowerCase()
      return facts.includes('comedy') || facts.includes('comedian') || facts.includes('comic') || facts.includes('funny')
    }, fictionOnly: false, realPersonOnly: true, categoryRequired: 'actors' },
    { q: 'Has your character appeared in a sci-fi or fantasy movie?', test: (c: CharacterData) => {
      if (c.category !== 'actors') return false
      const facts = c.distinctive_facts.join(' ').toLowerCase()
      return facts.includes('sci-fi') || facts.includes('science fiction') || facts.includes('fantasy') ||
             facts.includes('star wars') || facts.includes('matrix') || facts.includes('terminator') ||
             facts.includes('alien') || facts.includes('lord of the rings')
    }, fictionOnly: false, realPersonOnly: true, categoryRequired: 'actors' },
    { q: 'Has your character starred in a war or historical movie?', test: (c: CharacterData) => {
      if (c.category !== 'actors') return false
      const facts = c.distinctive_facts.join(' ').toLowerCase()
      return facts.includes('war') || facts.includes('historical') || facts.includes('world war') ||
             facts.includes('saving private ryan') || facts.includes('schindler') || facts.includes('braveheart')
    }, fictionOnly: false, realPersonOnly: true, categoryRequired: 'actors' },
    { q: 'Is your character known for romantic movies?', test: (c: CharacterData) => {
      if (c.category !== 'actors') return false
      const facts = c.distinctive_facts.join(' ').toLowerCase()
      return facts.includes('romantic') || facts.includes('romance') || facts.includes('rom-com') || facts.includes('love story')
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

    // Signature works-based questions (use structured data instead of text search)
    { q: 'Has your character appeared in a movie franchise (3+ films)?', test: (c: CharacterData) => {
      if (c.category !== 'actors') return false
      const filmCount = c.signature_works.filter(w => w.type === 'film').length
      return filmCount >= 3
    }, fictionOnly: false, realPersonOnly: true, categoryRequired: 'actors' },
    { q: 'Has your character appeared in TV shows?', test: (c: CharacterData) => {
      if (c.category !== 'actors') return false
      return c.signature_works.some(w => w.type === 'tv' || w.type === 'television')
    }, fictionOnly: false, realPersonOnly: true, categoryRequired: 'actors' },
    { q: 'Has your character worked across multiple decades?', test: (c: CharacterData) => {
      if (c.category !== 'actors' && c.category !== 'musicians') return false
      const years = c.signature_works.map(w => w.year).filter(Boolean) as number[]
      if (years.length < 2) return false
      return Math.max(...years) - Math.min(...years) >= 20
    }, fictionOnly: false, realPersonOnly: true },
    { q: 'Has your character released music albums?', test: (c: CharacterData) => {
      if (c.category !== 'musicians') return false
      return c.signature_works.some(w => w.type === 'album' || w.type === 'music')
    }, fictionOnly: false, realPersonOnly: true, categoryRequired: 'musicians' },
    { q: 'Has your character had work released in the 2010s or later?', test: (c: CharacterData) => {
      const recentWork = c.signature_works.some(w => w.year && w.year >= 2010)
      return recentWork
    }, fictionOnly: false, realPersonOnly: true },

    // TV Characters  
    { q: 'Did your character originate in a sitcom?', test: (c: CharacterData) => {
      if (c.category !== 'tv-characters') return false
      const facts = c.distinctive_facts.join(' ').toLowerCase()
      return facts.includes('sitcom') || facts.includes('friends') || facts.includes('seinfeld') ||
             facts.includes('office') || facts.includes('big bang')
    }, fictionOnly: true },
    { q: 'Did your character originate in a drama series?', test: (c: CharacterData) => {
      if (c.category !== 'tv-characters') return false
      const facts = c.distinctive_facts.join(' ').toLowerCase()
      return facts.includes('drama') || facts.includes('breaking bad') || facts.includes('game of thrones')
    }, fictionOnly: true },
    { q: 'Did your character originate in an animated show?', test: (c: CharacterData) => {
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

  // Build mutual exclusivity rules from turn history (for nationality, sports, music genres, etc.)
  const skipKeywordsFromTurns = new Set<string>()
  if (turns) {
    const confirmedAnswers = turns
      .filter(t => t.answer === 'yes' || t.answer === 'probably')
      .map(t => t.question.toLowerCase())
    
    const deniedAnswers = turns
      .filter(t => t.answer === 'no' || t.answer === 'probably_not')
      .map(t => t.question.toLowerCase())
    
    const subCategoryConflicts: Record<string, string[]> = {
      // Nationality/geography (mutually exclusive for most characters)
      'american': ['british', 'uk', 'united kingdom', 'european', 'europe', 'from europe', 'from the uk', 'from the united kingdom'],
      'british': ['american', 'usa', 'united states', 'from america'],
      'uk': ['american', 'usa', 'united states', 'from america'],
      'united kingdom': ['american', 'usa', 'united states', 'from america'],
      'europe': ['american', 'usa', 'united states', 'from america'],
      'european': ['american', 'usa', 'united states', 'from america'],
      'japanese': ['american', 'british', 'uk', 'european'],
      // Sports
      'basketball': ['soccer', 'football', 'baseball', 'tennis', 'golf', 'hockey', 'boxing', 'mma'],
      'soccer': ['basketball', 'baseball', 'tennis', 'golf', 'hockey', 'boxing', 'mma'],
      'football': ['basketball', 'baseball', 'tennis', 'golf', 'hockey', 'boxing', 'mma'],
      'baseball': ['basketball', 'soccer', 'football', 'tennis', 'golf', 'hockey', 'boxing', 'mma'],
      'tennis': ['basketball', 'soccer', 'football', 'baseball', 'golf', 'hockey', 'boxing', 'mma'],
      'golf': ['basketball', 'soccer', 'football', 'baseball', 'tennis', 'hockey', 'boxing', 'mma'],
      // Music genres
      'rapper': ['rock', 'pop', 'country', 'classical'],
      'rock': ['rapper', 'hip-hop', 'pop', 'country', 'classical'],
      'pop': ['rapper', 'hip-hop', 'rock', 'country', 'classical'],
      'country': ['rapper', 'hip-hop', 'rock', 'pop', 'classical'],
      // Comic publishers
      'dc': ['marvel'],
      'marvel': ['dc'],
      // Anime series
      'dragon ball': ['naruto', 'one piece'],
      'naruto': ['dragon ball', 'one piece'],
      'one piece': ['dragon ball', 'naruto'],
    }

    // For confirmed (yes/probably) answers, exclude conflicting keywords
    for (const confirmedQ of confirmedAnswers) {
      for (const [keyword, conflicts] of Object.entries(subCategoryConflicts)) {
        if (confirmedQ.includes(keyword)) {
          conflicts.forEach(conflict => skipKeywordsFromTurns.add(conflict))
          console.log(`[RAG] Confirmed "${keyword}" → excluding questions about: ${conflicts.join(', ')}`)
        }
      }
    }
    
    // For denied (no/probably_not) answers, exclude the keyword itself
    for (const deniedQ of deniedAnswers) {
      for (const keyword of Object.keys(subCategoryConflicts)) {
        if (deniedQ.includes(keyword)) {
          skipKeywordsFromTurns.add(keyword)
          console.log(`[RAG] Denied "${keyword}" → excluding questions about: ${keyword}`)
        }
      }
    }
  }

  // Performance optimization: Prioritize questions by value
  // Category and universal questions are more likely to be good, test them first
  // With early exit, we'll usually find a good question in the first 10-20
  const prioritizedQuestions = [
    // High value: Category questions (actors, musicians, superheroes, etc.)
    ...questions.filter(q => q.categoryRequired),
    // Medium value: Universal questions (fictional, gender, alive, etc.)
    ...questions.filter(q => !q.categoryRequired && !q.fictionOnly && !q.realPersonOnly),
    // Lower value: Specific questions (fiction-only, real-person-only)
    ...questions.filter(q => !q.categoryRequired && (q.fictionOnly || q.realPersonOnly)),
  ]

  // Early exit threshold: Stop if we find a question with >95% of max entropy
  const GOOD_ENOUGH_ENTROPY = 0.95
  let questionsEvaluated = 0

  for (const {q, test, fictionOnly, realPersonOnly, categoryRequired} of prioritizedQuestions) {
    // Skip questions that violate logical implication rules (e.g., superpowers for real people, death for alive, awards too early)
    if (shouldSkipQuestion(q, confirmedTraits, turns, remainingCandidates.length)) {
      continue
    }

    // Skip fiction-only questions if character is confirmed as non-fictional
    if (fictionOnly && isNotFictional) {
      continue
    }

    // Skip real-person-only questions if character is confirmed as fictional
    if (realPersonOnly && isFictional) {
      continue
    }
    
    // Skip category-specific questions if that category has been ruled out OR if a different category is confirmed
    if (categoryRequired) {
      if (ruledOutCategories.has(categoryRequired)) {
        continue
      }
      // If we have a confirmed positive category, skip questions for OTHER categories
      if (confirmedCategory && categoryRequired !== confirmedCategory.value) {
        continue
      }
    }
    
    // Skip mutually exclusive questions
    if (excludedQuestions.has(q.toLowerCase())) {
      continue
    }

    // Skip questions containing keywords from turn-based mutual exclusivity  
    // Use word boundary checks to avoid false positives (e.g., "actor" in "action")
    const qLower = q.toLowerCase()
    const shouldSkipFromTurns = Array.from(skipKeywordsFromTurns).some(kw => {
      const regex = new RegExp(`\\b${kw}\\b`, 'i')
      return regex.test(qLower)
    })
    if (shouldSkipFromTurns) {
      continue
    }

    // Skip if already asked (check for similar questions, not just exact)
    const normalizedQ = q.toLowerCase().replace(/[()]/g, '').replace(/\s+/g, ' ').trim()
    
    // Semantic inverse detection: "Is your character male?" ↔ "Is your character female?"
    const semanticInverses: Array<[RegExp, RegExp]> = [
      [/\bmale\b/, /\bfemale\b/],
      [/\bfemale\b/, /\bmale\b/],
      [/\bfictional\b/, /\breal\b/],
      [/\breal\b/, /\bfictional\b/],
      [/\balive\b/, /\bdead\b/],
      [/\bdead\b/, /\balive\b/],
      [/\bhero\b/, /\bvillain\b/],
      [/\bvillain\b/, /\bhero\b/],
    ]
    
    const isAlreadyAsked = askedQuestions.some(aq => {
      const normalizedAq = aq.toLowerCase().replace(/[()]/g, '').replace(/\s+/g, ' ').trim()
      
      // Check exact match
      if (normalizedAq === normalizedQ) return true
      
      // Check if questions start the same way (e.g., "Is your character still alive...")
      if (normalizedQ.length > 20 && normalizedAq.startsWith(normalizedQ.slice(0, 25))) return true
      if (normalizedAq.length > 20 && normalizedQ.startsWith(normalizedAq.slice(0, 25))) return true
      
      // Check semantic inverses
      for (const [pattern1, pattern2] of semanticInverses) {
        if (pattern1.test(normalizedQ) && pattern2.test(normalizedAq)) {
          // Both questions are about the same topic, just inverted
          const baseQ = normalizedQ.replace(pattern1, '').trim()
          const baseAq = normalizedAq.replace(pattern2, '').trim()
          if (baseQ === baseAq) return true
        }
      }
      
      return false
    })
    if (isAlreadyAsked) {
      continue
    }

    // Performance: Use sampled candidates for entropy estimation (accurate enough for ranking)
    const yesCount = candidatesToTest.filter(test).length
    const noCount = candidatesToTest.length - yesCount

    // Use Shannon entropy for information gain (more accurate than absolute deviation)
    // Entropy = -p*log2(p) - (1-p)*log2(1-p), higher entropy = more information
    const split = yesCount / candidatesToTest.length

    // Avoid log(0) errors
    const p = Math.max(0.001, Math.min(0.999, split))
    const entropy = -(p * Math.log2(p) + (1 - p) * Math.log2(1 - p))

    // Higher entropy = better question (closer to 50/50 split)
    // Convert to score where lower is better for consistency with old code
    const score = 1 - entropy  // Max entropy is 1.0, so invert

    questionsEvaluated++

    if (score < bestScore) {
      bestScore = score
      bestQuestion = q

      // Performance: Early exit if we found an excellent question (>95% of max entropy)
      // This dramatically reduces search time since most turns find a good question in first 20-30 evaluated
      if (entropy >= GOOD_ENOUGH_ENTROPY) {
        console.log(`[RAG] Early exit: Found excellent question (entropy=${entropy.toFixed(3)}) after evaluating ${questionsEvaluated} questions`)
        break
      }
    }
  }

  console.log(`[RAG] Evaluated ${questionsEvaluated} questions, best entropy: ${(1 - bestScore).toFixed(3)}`)
  
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
 * Get top N character guesses from pre-filtered candidates
 * Returns characters sorted by how well they match the traits
 * 
 * CRITICAL: Confidence should scale with trait count AND specificity
 * - Few traits (2-3) → Low confidence (30-50%)
 * - Medium traits (4-6) → Medium confidence (50-70%)
 * - Many traits (7+) → High confidence (70-90%)
 */
export function getTopGuesses(
  traits: Trait[],
  topN: number = 3,
  preFilteredCandidates?: CharacterData[]
): Array<{ name: string; confidence: number; character: CharacterData }> {
  // Use pre-filtered candidates if provided, otherwise filter strictly
  const candidates = preFilteredCandidates || filterCharactersByTraits(traits)
  
  if (candidates.length === 0) return []
  
  // Score each candidate based on how well they match the traits
  const guesses = candidates.map(char => {
    let matchScore = 0
    let totalWeight = 0

    for (const trait of traits) {
      // Deduced NOT_ traits provide very little discriminating power
      // (e.g., all non-fictional characters pass NOT_anime equally)
      // Weight them minimally so they don't drown out real trait signals
      const isDeducedNegative = trait.value.startsWith('NOT_')
      const weight = isDeducedNegative ? 0.1 : (trait.confidence || 0.9)
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

    // Scale confidence based on number of DISCRIMINATING traits
    // Don't count deduced NOT_ traits — they inflate the count without adding
    // real discriminating power (e.g., fictional=false deduces 9 NOT_media_origin
    // traits that all non-fictional characters pass equally)
    const traitCount = traits.filter(t => !t.value.startsWith('NOT_')).length
    
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
 *
 * PROGRESSIVE DETAIL: Shows minimal info early game, full details late game
 * - Early (turn < 5 OR many candidates): Just name, category, facts (~80 chars/candidate)
 * - Late (turn >= 5 AND < 20 candidates): Add works and relationships (~180 chars/candidate)
 * This reduces token count by 40% early game while preserving detail when it matters
 */
export function getCandidateContext(
  remainingCandidates: CharacterData[],
  topN: number = 5,
  turn: number = 0
): string {
  if (remainingCandidates.length === 0) {
    return 'No matching characters found in knowledge base.'
  }

  if (remainingCandidates.length === 1) {
    const char = remainingCandidates[0]
    return `Only one candidate remains: ${char.name} (${char.category})`
  }

  const topCandidates = remainingCandidates.slice(0, topN)

  // Determine detail level based on turn and candidate pool size
  const showFullDetails = turn >= 5 && remainingCandidates.length <= 20

  const lines = [
    `${remainingCandidates.length} candidates remaining. Top ${Math.min(topN, remainingCandidates.length)}:`,
    ...topCandidates.map((char, i) => {
      const facts = char.distinctive_facts.slice(0, 2).join('; ')

      // Early game or many candidates: minimal context
      if (!showFullDetails) {
        return `${i + 1}. ${char.name} (${char.category}): ${facts}`
      }

      // Late game with few candidates: full details
      const works = char.signature_works
        .slice(0, 2)  // Reduced from 3 to 2
        .map(w => w.name.length > 25 ? w.name.slice(0, 22) + '...' : w.name)  // Truncate long names
        .join(', ')

      // Only show prominence for top 2 if very famous (>200 wiki links)
      const prominence = i < 2 && char.sitelink_count && char.sitelink_count > 200 ? ' ⭐' : ''

      // Show only first related character, not all
      const inDb = char.relationships?.in_db ?? []
      const relNote = inDb.length > 0 ? ` | Family: ${inDb[0]}` : ''

      return `${i + 1}. ${char.name} (${char.category}${prominence}): ${facts}${works ? ` | Works: ${works}` : ''}${relNote}`
    })
  ]

  return lines.join('\n')
}

/**
 * Score how well a character matches the given traits (fuzzy matching)
 * Returns a score from 0.0 to 1.0
 */
export function scoreCharacterMatch(char: CharacterData, traits: Trait[]): number {
  if (traits.length === 0) return 1.0 // No traits to match against
  
  let totalScore = 0
  let totalWeight = 0
  
  for (const trait of traits) {
    const matches = characterMatchesTrait(char, trait)
    // Weight by confidence
    const weight = trait.confidence
    totalWeight += weight

    if (matches) {
      totalScore += weight
    }
  }

  const baseScore = totalWeight > 0 ? totalScore / totalWeight : 0

  // Add prominence bonus based on Wikipedia sitelink count
  // More famous characters (more Wikipedia language versions) get a slight boost
  // Einstein (319 links) → +0.15, minor character (20 links) → +0.01
  const sitelinkCount = char.sitelink_count ?? 0
  const prominenceBonus = Math.min(0.15, sitelinkCount / 2000)

  return Math.min(1.0, baseScore + prominenceBonus)
}

/**
 * Filter characters with fuzzy matching - returns candidates above threshold
 * More forgiving than strict filterCharactersByTraits
 */
export function filterCharactersFuzzy(traits: Trait[], threshold: number = 0.7): CharacterData[] {
  const allChars = getAllCharacters()
  
  console.info(`[RAG-Fuzzy] Filtering ${allChars.length} characters with fuzzy matching (threshold: ${threshold})`)
  
  if (traits.length === 0) {
    return allChars
  }
  
  const scored = allChars.map(char => ({
    char,
    score: scoreCharacterMatch(char, traits)
  }))
  
  const filtered = scored
    .filter(({ score }) => score >= threshold)
    .sort((a, b) => b.score - a.score)
    .map(({ char }) => char)
  
  console.info(`[RAG-Fuzzy] Filtered from ${allChars.length} to ${filtered.length} characters (threshold: ${threshold})`)
  
  return filtered
}

/**
 * Generate a dynamic question to discriminate between 5-10 similar candidates
 * Uses LLM to craft a question that splits the candidate pool effectively
 */
export async function generateDynamicQuestion(
  candidates: CharacterData[],
  askedQuestions: string[]
): Promise<string | null> {
  if (candidates.length < 5 || candidates.length > 10) {
    console.warn(`[RAG-Dynamic] Candidate pool size ${candidates.length} not optimal for dynamic questions (5-10 ideal)`)
    return null
  }
  
  console.info(`[RAG-Dynamic] Generating dynamic question for ${candidates.length} candidates`)
  
  // For now, return null to use static questions
  // TODO: Implement LLM-based dynamic question generation
  // This would pass candidate distinctive_facts to LLM and ask it to generate
  // a discriminating question
  
  return null
}
