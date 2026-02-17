/**
 * Character Image Search Service
 * 
 * Searches for reference images of characters online
 * Uses DuckDuckGo image search (no API key required)
 */

/**
 * Search for character images using DuckDuckGo
 * Returns the first high-quality result
 */
export async function searchCharacterImage(characterName: string): Promise<string | null> {
  try {
    console.info('[ImageSearch] Searching for:', characterName)
    
    // DuckDuckGo image search URL
    // We'll use their vqd-based API which doesn't require authentication
    const searchQuery = encodeURIComponent(`${characterName} portrait photo`)
    
    // Step 1: Get vqd token
    const vqdUrl = `https://duckduckgo.com/?q=${searchQuery}&iax=images&ia=images`
    const vqdResponse = await fetch(vqdUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
      }
    })
    
    if (!vqdResponse.ok) {
      console.error('[ImageSearch] Failed to get vqd token:', vqdResponse.status)
      return null
    }
    
    const vqdText = await vqdResponse.text()
    const vqdMatch = vqdText.match(/vqd=['"]([^'"]+)['"]/)
    
    if (!vqdMatch) {
      console.error('[ImageSearch] Could not extract vqd token')
      return null
    }
    
    const vqd = vqdMatch[1]
    console.info('[ImageSearch] Got vqd token')
    
    // Step 2: Get image results
    const resultsUrl = `https://duckduckgo.com/i.js?q=${searchQuery}&o=json&vqd=${vqd}&f=,,,,,&p=1&v7=1`
    const resultsResponse = await fetch(resultsUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
      }
    })
    
    if (!resultsResponse.ok) {
      console.error('[ImageSearch] Failed to get results:', resultsResponse.status)
      return null
    }
    
    const results = await resultsResponse.json()
    
    if (!results.results || results.results.length === 0) {
      console.error('[ImageSearch] No results found')
      return null
    }
    
    // Get the first high-quality result
    const firstResult = results.results[0]
    const imageUrl = firstResult.image
    
    console.info('[ImageSearch] Found image:', imageUrl)
    return imageUrl
    
  } catch (error) {
    console.error('[ImageSearch] Search failed:', error)
    return null
  }
}

/**
 * Fetch an image from URL and convert to base64 data URI
 * This is needed for img2img generation
 */
export async function fetchImageAsBase64(imageUrl: string): Promise<string | null> {
  try {
    console.info('[ImageSearch] Fetching image from:', imageUrl)
    
    const response = await fetch(imageUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
      }
    })
    
    if (!response.ok) {
      console.error('[ImageSearch] Failed to fetch image:', response.status)
      return null
    }
    
    const blob = await response.blob()
    
    // Convert blob to base64
    return new Promise((resolve, reject) => {
      const reader = new FileReader()
      reader.onloadend = () => {
        const base64 = reader.result as string
        console.info('[ImageSearch] Image converted to base64')
        resolve(base64)
      }
      reader.onerror = reject
      reader.readAsDataURL(blob)
    })
    
  } catch (error) {
    console.error('[ImageSearch] Failed to fetch image:', error)
    return null
  }
}

/**
 * Search for character and return base64 reference image
 * This is the main function to use for getting reference images
 */
export async function getCharacterReferenceImage(characterName: string): Promise<string | null> {
  const imageUrl = await searchCharacterImage(characterName)
  
  if (!imageUrl) {
    console.warn('[ImageSearch] No image found for:', characterName)
    return null
  }
  
  const base64Image = await fetchImageAsBase64(imageUrl)
  
  if (!base64Image) {
    console.warn('[ImageSearch] Could not fetch image for:', characterName)
    return null
  }
  
  console.info('[ImageSearch] Successfully obtained reference image for:', characterName)
  return base64Image
}
