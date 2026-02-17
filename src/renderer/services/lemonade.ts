import { CHAT_ENDPOINT, IMAGE_ENDPOINT, HEALTH_ENDPOINT } from '../../shared/constants'
import type { ChatCompletionRequest, ChatCompletionResponse, ImageGenerationRequest, ImageGenerationResponse } from '../types/api'

async function fetchJSON<T>(url: string, body: unknown, timeoutMs = 180000): Promise<T> {
  console.log(`[Lemonade] POST ${url}`)
  
  const controller = new AbortController()
  const timeoutId = setTimeout(() => {
    console.error(`[Lemonade] Request timeout after ${timeoutMs}ms`)
    controller.abort()
  }, timeoutMs)
  
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: controller.signal,
    })
    
    clearTimeout(timeoutId)
    
    if (!res.ok) {
      const text = await res.text().catch(() => '')
      console.error(`[Lemonade] API error ${res.status}:`, text.substring(0, 200))
      throw new Error(`Lemonade API error ${res.status}: ${text}`)
    }
    
    const data = await res.json()
    console.log(`[Lemonade] Response received from ${url}`)
    return data
  } catch (e) {
    clearTimeout(timeoutId)
    if (e instanceof Error && e.name === 'AbortError') {
      throw new Error(`Request timeout after ${timeoutMs}ms. Lemonade server may be overloaded.`)
    }
    throw e
  }
}

export async function chatCompletion(req: ChatCompletionRequest): Promise<ChatCompletionResponse> {
  return fetchJSON<ChatCompletionResponse>(CHAT_ENDPOINT, req)
}

export async function generateImage(req: ImageGenerationRequest): Promise<ImageGenerationResponse> {
  // Use longer timeout for image generation (120 seconds) to allow SDXL-turbo time to generate
  console.log('[Lemonade] === IMAGE GENERATION REQUEST ===')
  console.log('[Lemonade] Model:', req.model)
  console.log('[Lemonade] Steps:', req.steps)
  console.log('[Lemonade] CFG Scale:', req.cfg_scale)
  console.log('[Lemonade] Seed:', req.seed)
  console.log('[Lemonade] Prompt:', req.prompt?.substring(0, 150) + '...')
  console.log('[Lemonade] Negative:', req.negative_prompt?.substring(0, 150) + '...')
  console.log('[Lemonade] Full Request Body:', JSON.stringify(req, null, 2))
  console.log('[Lemonade] ================================')
  return fetchJSON<ImageGenerationResponse>(IMAGE_ENDPOINT, req, 120000)
}

export async function checkHealth(): Promise<boolean> {
  // Skip health check - just return true and let actual API calls handle errors
  // The Lemonade router can be slow/unresponsive on health endpoints
  console.log('[Lemonade] Skipping health check (assuming server is available)')
  return true
  
  /* Original health check - disabled due to router being unresponsive
  try {
    console.log('[Lemonade] Checking health at:', HEALTH_ENDPOINT)
    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), 15000)
    
    const res = await fetch(HEALTH_ENDPOINT, { 
      signal: controller.signal,
      method: 'GET',
    })
    clearTimeout(timeoutId)
    
    const isHealthy = res.ok
    console.log('[Lemonade] Health check result:', isHealthy, 'Status:', res.status)
    
    if (!isHealthy) {
      const contentType = res.headers.get('content-type')
      console.log('[Lemonade] Response content-type:', contentType)
      const text = await res.text().catch(() => 'Unable to read response')
      console.log('[Lemonade] Response body:', text.substring(0, 200))
    }
    
    return isHealthy
  } catch (e) {
    console.error('[Lemonade] Health check failed:', e)
    return false
  }
  */
}
