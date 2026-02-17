import { generateImage } from './lemonade'
import { IMAGE_MODEL } from '../../shared/constants'

const NEGATIVE_PROMPT = 'blurry text, watermark, logo, low quality, deformed, disfigured, extra limbs, bad anatomy, worst quality'

/**
 * Generate simple text-to-image portrait (fast, no img2img)
 * Used for mid-game guesses - prioritizes speed over accuracy
 */
export async function renderSimplePortrait(
  characterName: string,
  seed: number,
  appearanceDetails?: string,
): Promise<string> {
  console.info(`[Artist] Generating simple portrait for: ${characterName}`)
  
  const details = appearanceDetails || characterName
  const prompt = `portrait of ${characterName}, ${details}, professional photo, high quality, detailed face, recognizable, clear features`
  
  console.info(`[Artist] Prompt: ${prompt}`)
  
  const response = await generateImage({
    model: IMAGE_MODEL,
    prompt,
    negative_prompt: NEGATIVE_PROMPT,
    seed,
    steps: 4, // SDXL-Turbo works best with 4 steps
    cfg_scale: 1.0, // Turbo models need low cfg_scale
    width: 512,
    height: 512,
  })
  
  const base64 = response.data?.[0]?.b64_json
  if (!base64) throw new Error('No image returned from Artist')
  
  console.info(`[Artist] ✓ Simple portrait generated successfully`)
  return `data:image/png;base64,${base64}`
}

/**
 * Generate caricature from reference image
 * Used for BOTH mid-game (top guess) and hero (final guess) images
 */
export async function renderCaricature(
  characterName: string,
  referenceImage: string,
  seed: number,
  appearanceDetails?: string,
): Promise<string> {
  console.info(`[Artist] Generating caricature for: ${characterName}`)
  if (appearanceDetails) {
    console.info(`[Artist] Appearance details: ${appearanceDetails}`)
  }
  
  // Caricature prompt - emphasize recognizable features
  const details = appearanceDetails || characterName
  const caricaturePrompt = `caricature art style of ${characterName}, ${details}, exaggerated features, fun cartoon style, vibrant colors, recognizable likeness, professional illustration, high quality, accurate depiction, clearly identifiable`
  
  console.info(`[Artist] Prompt: ${caricaturePrompt}`)
  
  const response = await generateImage({
    model: IMAGE_MODEL,
    prompt: caricaturePrompt,
    negative_prompt: NEGATIVE_PROMPT,
    seed,
    image: referenceImage,
    denoising_strength: 0.6, // Balance between likeness and caricature style
    steps: 8, // Reduced from 15 for speed
    cfg_scale: 2.0, // Strong adherence to prompt for accurate depiction
    width: 512,
    height: 512,
  })
  
  const base64 = response.data?.[0]?.b64_json
  if (!base64) throw new Error('No caricature image returned from Artist')
  
  console.info(`[Artist] ✓ Caricature of ${characterName} generated successfully`)
  return `data:image/png;base64,${base64}`
}
