import type { Trait } from '../types/game'
import { buildAppearancePrompt, hasAppearanceData } from './character-appearance'

// Visual trait keys that directly translate to image descriptors
const VISUAL_KEYS = new Set([
  'gender', 'species', 'hair_color', 'hair_style', 'clothing', 'eye_color',
  'skin_color', 'age_group', 'body_type', 'accessories', 'facial_hair',
  'has_powers', 'origin_medium', 'fictional',
])

// Map trait key+value pairs to SD-friendly visual descriptors
function traitToDescriptor(trait: Trait): string | null {
  const k = trait.key.toLowerCase()
  const v = trait.value.toLowerCase()

  switch (k) {
    case 'gender':
      return v === 'male' ? 'male character' : v === 'female' ? 'female character' : null
    case 'species':
      if (v === 'human') return 'human'
      return v // "robot", "elf", "alien", etc.
    case 'hair_color':
      return `${v} hair`
    case 'hair_style':
      return `${v} hair`
    case 'clothing':
      return `wearing ${v}`
    case 'eye_color':
      return `${v} eyes`
    case 'skin_color':
      return `${v} skin`
    case 'age_group':
      if (v.includes('child') || v.includes('young')) return 'young'
      if (v.includes('old') || v.includes('elder')) return 'elderly'
      return v
    case 'body_type':
      return v // "muscular", "slim", "large", etc.
    case 'accessories':
      return v // "glasses", "hat", "cape", etc.
    case 'facial_hair':
      if (v === 'none' || v === 'no') return null
      return v // "beard", "mustache", etc.
    case 'has_powers':
      if (v === 'yes' || v === 'true') return 'magical glowing aura'
      return null
    case 'origin_medium':
      if (v.includes('anime') || v.includes('manga')) return 'anime style'
      if (v.includes('cartoon')) return 'cartoon style'
      if (v.includes('comic')) return 'comic book style'
      if (v.includes('game') || v.includes('video')) return 'video game character'
      return null
    case 'fictional':
    case 'category':
    case 'era':
    case 'alignment':
      return null // non-visual traits
    default:
      // For any other visual descriptors the LLM adds
      if (v && v !== 'unknown' && v !== 'unclear') return v
      return null
  }
}

/**
 * Build a hero image prompt when we know the character name
 * This is ONLY used as supplemental text when we have a reference image
 */
export function buildHeroImagePrompt(
  characterName: string,
  traits: Trait[]
): string {
  // Check if we have detailed appearance data for this character
  if (hasAppearanceData(characterName)) {
    const appearanceDetails = buildAppearancePrompt(characterName)
    console.info('[Visualist] Using detailed appearance data for:', characterName)
    return appearanceDetails
  }
  
  // Fallback: basic description from traits
  console.info('[Visualist] No appearance data for:', characterName, '- using traits')
  
  const descriptors = traits
    .filter(t => t.confidence >= 0.5 && !t.value.startsWith('NOT_') && VISUAL_KEYS.has(t.key))
    .sort((a, b) => b.confidence - a.confidence)
    .map(traitToDescriptor)
    .filter((d): d is string => d !== null)
  
  return [...new Set(descriptors)].join(', ')
}

/**
 * Build simple image prompt for mid-game turns
 * Just shows generic placeholder images based on known traits
 */
export function buildImagePrompt(
  traits: Trait[], 
  turn: number,
): string {
  // Convert confirmed traits to visual descriptors
  const descriptors = traits
    .filter(t => t.confidence >= 0.5 && !t.value.startsWith('NOT_') && VISUAL_KEYS.has(t.key))
    .sort((a, b) => b.confidence - a.confidence)
    .map(traitToDescriptor)
    .filter((d): d is string => d !== null)

  const unique = [...new Set(descriptors)]

  if (unique.length === 0) {
    return 'mysterious character silhouette, dark background'
  }

  // Simple generic character image based on traits
  const traitStr = unique.join(', ')
  const result = `character portrait, ${traitStr}, simple illustration, neutral background`
  
  console.info(`[Visualist] Turn ${turn} simple prompt: ${result}`)
  return result
}
