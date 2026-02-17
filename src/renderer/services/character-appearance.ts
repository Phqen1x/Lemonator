/**
 * Character Appearance Knowledge Base
 * 
 * Provides visual descriptions for well-known characters to improve image generation.
 * This supplements the character database with detailed appearance information.
 */

interface AppearanceDescription {
  physicalFeatures: string[]
  clothing: string[]
  distinctiveTraits: string[]
  setting?: string
}

// Knowledge base of character appearances
const APPEARANCE_DB: Record<string, AppearanceDescription> = {
  // Politicians
  'Donald Trump': {
    physicalFeatures: ['elderly male', 'blonde hair', 'distinctive hairstyle', 'orange-tan complexion', 'heavyset build'],
    clothing: ['business suit', 'red tie', 'formal attire'],
    distinctiveTraits: ['confident expression', 'distinctive hand gestures'],
    setting: 'presidential office, White House, formal setting'
  },
  'Barack Obama': {
    physicalFeatures: ['middle-aged male', 'short black hair', 'brown skin', 'athletic build', 'tall'],
    clothing: ['business suit', 'blue tie', 'formal attire'],
    distinctiveTraits: ['warm smile', 'confident posture'],
    setting: 'presidential office, White House, formal setting'
  },
  'Joe Biden': {
    physicalFeatures: ['elderly male', 'white hair', 'blue eyes', 'lean build'],
    clothing: ['business suit', 'aviator sunglasses sometimes', 'formal attire'],
    distinctiveTraits: ['friendly smile', 'aviator glasses'],
    setting: 'presidential office, White House, formal setting'
  },
  
  // Actors
  'Leonardo DiCaprio': {
    physicalFeatures: ['blonde hair', 'blue eyes', 'clean-shaven or short beard', 'angular face'],
    clothing: ['elegant formal wear', 'tuxedo', 'casual upscale'],
    distinctiveTraits: ['movie star presence', 'charismatic expression'],
    setting: 'red carpet, elegant venue, cinematic lighting'
  },
  'Dwayne Johnson': {
    physicalFeatures: ['bald head', 'brown skin', 'extremely muscular build', 'tall', 'broad shoulders'],
    clothing: ['tight black shirt', 'casual athletic wear', 'action costume'],
    distinctiveTraits: ['raised eyebrow', 'confident smile', 'massive physique'],
    setting: 'gym, action scene, professional photoshoot'
  },
  
  // Musicians
  'Taylor Swift': {
    physicalFeatures: ['blonde hair', 'blue eyes', 'tall', 'slim build', 'fair skin'],
    clothing: ['sparkly concert outfit', 'elegant dress', 'stylish modern fashion'],
    distinctiveTraits: ['red lipstick', 'glamorous style'],
    setting: 'concert stage, spotlight, performance venue'
  },
  'Drake': {
    physicalFeatures: ['short black hair', 'beard', 'brown skin', 'athletic build'],
    clothing: ['designer streetwear', 'luxury fashion', 'chains and jewelry'],
    distinctiveTraits: ['confident pose', 'hip hop style'],
    setting: 'recording studio, urban setting, stage'
  },
  
  // Athletes
  'LeBron James': {
    physicalFeatures: ['black hair', 'beard', 'brown skin', 'extremely tall', 'athletic muscular build'],
    clothing: ['basketball jersey', 'athletic wear', 'Nike gear'],
    distinctiveTraits: ['powerful presence', 'basketball player physique'],
    setting: 'basketball court, arena, sports venue'
  },
  
  // Fictional Characters - Superheroes
  'Spider-Man': {
    physicalFeatures: ['athletic male', 'medium build', 'agile physique'],
    clothing: ['red and blue spider suit', 'web pattern', 'mask covering face', 'spider emblem'],
    distinctiveTraits: ['web-shooting pose', 'acrobatic stance'],
    setting: 'New York City skyline, rooftops, urban background'
  },
  'Batman': {
    physicalFeatures: ['muscular male', 'strong jaw', 'athletic build'],
    clothing: ['black bat suit', 'cape', 'cowl with pointed ears', 'utility belt', 'dark armor'],
    distinctiveTraits: ['dark brooding presence', 'intimidating stance'],
    setting: 'Gotham City, dark urban night, rooftop'
  },
  'Superman': {
    physicalFeatures: ['muscular male', 'black hair', 'strong jaw', 'heroic build'],
    clothing: ['blue suit with red cape', 'red and yellow S emblem', 'red boots'],
    distinctiveTraits: ['heroic pose', 'confident flying stance'],
    setting: 'sky, Metropolis, heroic background'
  },
  
  // Anime Characters
  'Goku': {
    physicalFeatures: ['spiky black hair', 'Asian features', 'very muscular', 'youthful face'],
    clothing: ['orange gi with blue undershirt', 'martial arts uniform', 'blue belt and wristbands'],
    distinctiveTraits: ['determined expression', 'fighting stance', 'golden aura sometimes'],
    setting: 'training ground, rocky landscape, dramatic sky'
  },
  'Naruto': {
    physicalFeatures: ['spiky blonde hair', 'blue eyes', 'whisker marks on cheeks', 'athletic build'],
    clothing: ['orange jumpsuit', 'ninja headband', 'black sandals'],
    distinctiveTraits: ['determined smile', 'ninja pose', 'energetic expression'],
    setting: 'Hidden Leaf Village, ninja landscape, Japanese architecture'
  }
}

/**
 * Get appearance description for a character
 */
export function getCharacterAppearance(characterName: string): AppearanceDescription | null {
  return APPEARANCE_DB[characterName] || null
}

/**
 * Build a detailed appearance prompt from the knowledge base
 */
export function buildAppearancePrompt(characterName: string): string {
  const appearance = getCharacterAppearance(characterName)
  
  if (!appearance) {
    return '' // No known appearance data
  }
  
  const parts: string[] = []
  
  // Add physical features
  if (appearance.physicalFeatures.length > 0) {
    parts.push(appearance.physicalFeatures.join(', '))
  }
  
  // Add clothing
  if (appearance.clothing.length > 0) {
    parts.push(appearance.clothing.join(', '))
  }
  
  // Add distinctive traits
  if (appearance.distinctiveTraits.length > 0) {
    parts.push(appearance.distinctiveTraits.join(', '))
  }
  
  // Add setting
  if (appearance.setting) {
    parts.push(appearance.setting)
  }
  
  return parts.join(', ')
}

/**
 * Check if we have appearance data for a character
 */
export function hasAppearanceData(characterName: string): boolean {
  return characterName in APPEARANCE_DB
}

/**
 * Get a list of all characters with appearance data
 */
export function getKnownCharacters(): string[] {
  return Object.keys(APPEARANCE_DB)
}
