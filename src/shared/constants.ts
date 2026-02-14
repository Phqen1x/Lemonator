export const LEMONADE_BASE_URL = 'http://localhost:8000'
export const CHAT_ENDPOINT = `${LEMONADE_BASE_URL}/v1/chat/completions`
export const IMAGE_ENDPOINT = `${LEMONADE_BASE_URL}/v1/images/generations`
export const HEALTH_ENDPOINT = `${LEMONADE_BASE_URL}/health`

export const DETECTIVE_MODEL = 'Phi-4-mini-instruct-GGUF'
export const VISUALIST_MODEL = 'Phi-4-mini-instruct-GGUF'
export const IMAGE_MODEL = 'SDXL-Turbo'

export const CONFIDENCE_THRESHOLD = 0.9
export const MAX_TURNS = 25

// SDXL-Turbo progressive quality: low cfg_scale (turbo models work best near 1.0)
// Steps ramp from 2 (fast/blurry) to 6 (sharp) over turns
export const getImageParams = (turn: number) => {
  const progress = Math.min(turn / 15, 1)
  return {
    steps: Math.round(2 + progress * 4),    // 2 → 6
    cfg_scale: 1.0 + progress * 0.5,        // 1.0 → 1.5
    width: 512,
    height: 512,
  }
}
