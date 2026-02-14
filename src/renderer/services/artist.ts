import { generateImage } from './lemonade'
import { getImageParams, IMAGE_MODEL } from '../../shared/constants'

const NEGATIVE_PROMPT = 'blurry text, watermark, logo, low quality, deformed, disfigured, extra limbs, bad anatomy, worst quality'

export async function renderImage(
  prompt: string,
  seed: number,
  turn: number,
): Promise<string> {
  const params = getImageParams(turn)

  const response = await generateImage({
    model: IMAGE_MODEL,
    prompt,
    negative_prompt: NEGATIVE_PROMPT,
    seed,
    ...params,
  })

  const base64 = response.data?.[0]?.b64_json
  if (!base64) throw new Error('No image returned from Artist')

  return `data:image/png;base64,${base64}`
}

export async function renderHeroImage(
  prompt: string,
  seed: number,
): Promise<string> {
  const response = await generateImage({
    model: IMAGE_MODEL,
    prompt: `masterpiece, best quality, highly detailed, ${prompt}`,
    negative_prompt: NEGATIVE_PROMPT,
    seed,
    steps: 8,
    cfg_scale: 1.5,
    width: 512,
    height: 512,
  })

  const base64 = response.data?.[0]?.b64_json
  if (!base64) throw new Error('No image returned from Artist (hero render)')

  return `data:image/png;base64,${base64}`
}
