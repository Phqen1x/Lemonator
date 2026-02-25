import { CHAT_ENDPOINT, IMAGE_ENDPOINT, TTS_ENDPOINT, HEALTH_ENDPOINT, TTS_MODEL, TTS_VOICE } from '../../shared/constants'
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
  // SDXL-Turbo on CPU takes 60-90 seconds per image
  return fetchJSON<ImageGenerationResponse>(IMAGE_ENDPOINT, req, 120000)
}

/**
 * Calls the Kokoro TTS model and returns the raw MP3 ArrayBuffer.
 * Pass an AbortSignal to cancel an in-flight request when the user answers
 * before the audio has finished loading.
 */
export async function textToSpeech(
  text: string,
  signal?: AbortSignal,
  voice = TTS_VOICE,
): Promise<ArrayBuffer> {
  const res = await fetch(TTS_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: TTS_MODEL, input: text, voice }),
    signal,
  })
  if (!res.ok) {
    const body = await res.text().catch(() => '')
    throw new Error(`TTS ${res.status}: ${body}`)
  }
  return res.arrayBuffer()
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
