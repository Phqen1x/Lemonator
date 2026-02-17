export interface ChatMessage {
  role: 'system' | 'user' | 'assistant'
  content: string
}

export interface ChatCompletionRequest {
  model: string
  messages: ChatMessage[]
  temperature?: number
  max_tokens?: number
}

export interface ChatCompletionResponse {
  choices: Array<{
    message: {
      role: string
      content: string
    }
    finish_reason: string
  }>
}

export interface ImageGenerationRequest {
  model?: string
  prompt: string
  negative_prompt?: string
  width?: number
  height?: number
  steps?: number
  cfg_scale?: number
  seed?: number
  image?: string  // Base64 image for img2img
  denoising_strength?: number  // 0.0-1.0, how much to change the input image
}

export interface ImageGenerationResponse {
  data: Array<{ b64_json: string }>
}

export interface DetectiveOutput {
  question: string
  new_traits: Array<{ key: string; value: string; confidence: number }>
  top_guesses: Array<{ name: string; confidence: number }>
  reasoning: string
}
