import type { Trait } from '../types/game'

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
      return null // doesn't affect visuals
    default:
      // For any other visual descriptors the LLM adds
      if (v && v !== 'unknown' && v !== 'unclear') return v
      return null
  }
}

const BASE_EARLY = 'digital painting, character portrait, mysterious silhouette, soft glow, neutral dark background, concept art'
const BASE_MID = 'digital painting, character portrait, professional concept art, detailed features'
const BASE_LATE = 'digital painting, character portrait, professional concept art, highly detailed, sharp focus, dramatic lighting'

export function buildImagePrompt(traits: Trait[], turn: number): string {
  // Determine detail level based on turn
  let base: string
  if (turn <= 3) base = BASE_EARLY
  else if (turn <= 8) base = BASE_MID
  else base = BASE_LATE

  // Convert confirmed traits to visual descriptors
  const descriptors = traits
    .filter(t => t.confidence >= 0.5)
    .sort((a, b) => b.confidence - a.confidence)
    .map(traitToDescriptor)
    .filter((d): d is string => d !== null)

  // Remove duplicates
  const unique = [...new Set(descriptors)]

  if (unique.length === 0) {
    return base
  }

  // Combine: base + trait descriptors (keep under ~75 tokens)
  const traitStr = unique.slice(0, 12).join(', ')
  return `${base}, ${traitStr}`
}
