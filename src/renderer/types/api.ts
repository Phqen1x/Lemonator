export interface ChatToolCall {
  id: string
  type: 'function'
  function: { name: string; arguments: string }
}

export interface ChatTool {
  type: 'function'
  function: {
    name: string
    description: string
    parameters: Record<string, unknown>
  }
}

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool'
  content: string | null  // null when assistant message contains only tool_calls
  tool_calls?: ChatToolCall[]
  tool_call_id?: string    // required when role === 'tool'
}

export interface ChatCompletionRequest {
  model: string
  messages: ChatMessage[]
  temperature?: number
  max_tokens?: number
  tools?: ChatTool[]
  tool_choice?: 'auto' | 'none'
}

export interface ChatCompletionResponse {
  choices: Array<{
    message: {
      role: string
      content: string | null
      tool_calls?: ChatToolCall[]
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
