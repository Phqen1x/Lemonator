export const LEMONADE_BASE_URL = 'http://localhost:8000'
export const CHAT_ENDPOINT = `${LEMONADE_BASE_URL}/v1/chat/completions`
export const IMAGE_ENDPOINT = `${LEMONADE_BASE_URL}/v1/images/generations`
export const TTS_ENDPOINT = `${LEMONADE_BASE_URL}/v1/audio/speech`
export const HEALTH_ENDPOINT = `${LEMONADE_BASE_URL}/v1/models`

// Kokoro TTS model — fable voice suits the quirky detective character
export const TTS_MODEL = 'kokoro-v1'
export const TTS_VOICE = 'fable'

// Model selection for RAG-enhanced detective
// Qwen3-4B: Best balance of speed (fast NPU) and reasoning for RAG
// Phi-4: Good at creative visualization
export const DETECTIVE_MODEL = 'Qwen3-4B-Instruct-2507-GGUF'
export const VISUALIST_MODEL = 'Phi-4-mini-instruct-GGUF'
// SDXL-Turbo is too slow on CPU (hours per image)
// Image generation disabled until GPU acceleration is configured
export const IMAGE_MODEL = 'Flux-2-Klein-4B'

export const CONFIDENCE_THRESHOLD = 0.95  // Must be high enough to avoid false positives
export const MAX_TURNS = 100  // Allow extensive questioning to narrow down

// Set to false to disable Wikipedia mid-game character discovery
// When enabled, the detective searches Wikipedia after turn 5 for supplemental characters
// beyond the local knowledge base. Disable if Wikipedia results are noisy or slow.
export const ENABLE_WIKIPEDIA_SEARCH = false

// Set to false to disable image generation during detective testing
// DISABLED: Lemonade image generation takes 180+ seconds and times out
export const ENABLE_IMAGE_GENERATION = true

// Set to true to use LLM-based visualist (Phi-4-mini) instead of pure function
// When false, falls back to buildImagePrompt() for A/B testing
export const ENABLE_VISUALIST_LLM = true

// SDXL-Turbo progressive quality: low cfg_scale (turbo models work best near 1.0)
// Steps ramp from 2 (fast/blurry) to 6 (sharp) over turns
export const getImageParams = (turn: number) => {
  const progress = Math.min(turn / 15, 1)
  return {
    steps: Math.round(1 + progress * 3),
    cfg_scale: 1.0,
    width: 256,
    height: 256,
  }
}
