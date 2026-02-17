export const LEMONADE_BASE_URL = 'http://localhost:8000'
export const CHAT_ENDPOINT = `${LEMONADE_BASE_URL}/v1/chat/completions`
export const IMAGE_ENDPOINT = `${LEMONADE_BASE_URL}/v1/images/generations`
export const HEALTH_ENDPOINT = `${LEMONADE_BASE_URL}/v1/models`

// Model selection for RAG-enhanced detective
// Qwen3-4B: Best balance of speed (fast NPU) and reasoning for RAG
// Phi-4: Good at creative visualization
export const DETECTIVE_MODEL = 'Qwen3-4B-Instruct-2507-GGUF'
//export const DETECTIVE_MODEL = 'Qwen2.5-Coder-32B-Instruct-GGUF' // Not available on this system
export const VISUALIST_MODEL = 'Phi-4-mini-instruct-GGUF'
// SDXL-Turbo is too slow on CPU (hours per image)
// Image generation disabled until GPU acceleration is configured
export const IMAGE_MODEL = 'SDXL-Turbo'

export const CONFIDENCE_THRESHOLD = 0.95  // Lower for RAG (10 guess target)
export const MAX_TURNS = 100  // Allow extensive questioning to narrow down

// Set to false to disable image generation during detective testing
// DISABLED: Lemonade image generation takes 180+ seconds and times out
export const ENABLE_IMAGE_GENERATION = false

// Set to true to use LLM-based visualist (Phi-4-mini) instead of pure function
// When false, falls back to buildImagePrompt() for A/B testing
export const ENABLE_VISUALIST_LLM = false // Disabled - visualist-llm module not implemented

// SDXL-Turbo progressive quality: low cfg_scale (turbo models work best near 1.0)
// Steps ramp from 2 (fast/blurry) to 6 (sharp) over turns
export const getImageParams = (turn: number) => {
  const progress = Math.min(turn / 15, 1)
  return {
    steps: Math.round(1 + progress * 3),
    cfg_scale: 1.0,
    width: 512,
    height: 512,
  }
}
