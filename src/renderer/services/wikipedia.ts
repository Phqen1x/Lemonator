/**
 * Wikipedia integration for expanding character database
 * Uses Wikipedia REST API and MediaWiki Action API
 */

const WIKIPEDIA_API = 'https://en.wikipedia.org/w/api.php'
const WIKIPEDIA_REST_API = 'https://en.wikipedia.org/api/rest_v1'

interface WikipediaSearchResult {
  title: string
  pageid: number
  snippet?: string
}

interface WikipediaListPage {
  title: string
  names: string[]
  source: 'wikipedia'
}

// Cache to avoid repeated API calls for same queries
const searchCache = new Map<string, WikipediaListPage>()

/**
 * Search for Wikipedia Category pages containing people
 * e.g., "American male actors" → "Category:American male actors"
 */
export async function searchWikipediaList(query: string): Promise<WikipediaListPage | null> {
  // Check cache first
  const cacheKey = query.toLowerCase().trim()
  if (searchCache.has(cacheKey)) {
    console.info(`[Wikipedia] Cache hit for: ${query}`)
    return searchCache.get(cacheKey)!
  }

  console.info(`[Wikipedia] Searching for category: ${query}`)

  try {
    // First, try direct category access
    const directNames = await extractNamesFromCategory(query)
    if (directNames.length >= 10) {
      const listPage: WikipediaListPage = {
        title: `Category:${query}`,
        names: directNames.slice(0, 50),
        source: 'wikipedia',
      }
      searchCache.set(cacheKey, listPage)
      console.info(`[Wikipedia] ✓ Found ${directNames.length} names from direct category`)
      return listPage
    }

    // If direct category fails, search for matching categories
    const searchUrl = new URL(WIKIPEDIA_API)
    searchUrl.searchParams.set('action', 'query')
    searchUrl.searchParams.set('format', 'json')
    searchUrl.searchParams.set('list', 'search')
    searchUrl.searchParams.set('srsearch', `incategory:"${query}"`)
    searchUrl.searchParams.set('srnamespace', '14') // Category namespace
    searchUrl.searchParams.set('srlimit', '5')
    searchUrl.searchParams.set('origin', '*') // CORS

    const searchResponse = await fetch(searchUrl.toString())
    if (!searchResponse.ok) {
      throw new Error(`Wikipedia search failed: ${searchResponse.status}`)
    }

    const searchData = await searchResponse.json()
    const searchResults = searchData.query?.search as WikipediaSearchResult[] | undefined

    if (!searchResults || searchResults.length === 0) {
      console.warn(`[Wikipedia] No category results for: ${query}`)
      return null
    }

    // Try each category result
    for (const result of searchResults) {
      console.info(`[Wikipedia] Trying category: ${result.title}`)
      const categoryName = result.title.replace('Category:', '')
      const names = await extractNamesFromCategory(categoryName)
      
      if (names.length >= 10) {
        const listPage: WikipediaListPage = {
          title: result.title,
          names: names.slice(0, 50), // Limit to top 50
          source: 'wikipedia',
        }
        
        // Cache the result
        searchCache.set(cacheKey, listPage)
        console.info(`[Wikipedia] ✓ Found ${names.length} names from: ${result.title}`)
        return listPage
      }
    }

    console.warn(`[Wikipedia] No suitable category found for: ${query}`)
    return null
  } catch (error) {
    console.error(`[Wikipedia] Search error:`, error)
    return null
  }
}

/**
 * Extract character/person names from a Wikipedia CATEGORY
 * Uses MediaWiki Action API to get category members (actual person pages)
 */
async function extractNamesFromCategory(categoryName: string): Promise<string[]> {
  try {
    console.info(`[Wikipedia] Fetching members from category: ${categoryName}`)
    
    // Use MediaWiki Action API to get category members
    const url = new URL(WIKIPEDIA_API)
    url.searchParams.set('action', 'query')
    url.searchParams.set('format', 'json')
    url.searchParams.set('list', 'categorymembers')
    url.searchParams.set('cmtitle', `Category:${categoryName}`)
    url.searchParams.set('cmlimit', '100') // Get up to 100 members
    url.searchParams.set('cmnamespace', '0') // Only main namespace (articles)
    url.searchParams.set('cmtype', 'page') // Only pages, not subcategories
    url.searchParams.set('origin', '*') // CORS
    
    const response = await fetch(url.toString())
    if (!response.ok) {
      throw new Error(`Failed to fetch category members: ${response.status}`)
    }
    
    const data = await response.json()
    const members = data.query?.categorymembers || []
    
    const names: string[] = []
    
    for (const member of members) {
      const title = member.title
      
      // Basic filtering for person names
      if (title.startsWith('List ') ||
          title.includes('disambiguation') ||
          title.includes('(') && !title.includes('(actor)') && !title.includes('(singer)') ||
          title.length < 3 ||
          title.length > 40) {
        continue
      }
      
      names.push(title)
    }
    
    console.info(`[Wikipedia] Extracted ${names.length} names from category`)
    return names
  } catch (error) {
    console.error(`[Wikipedia] Category extract error:`, error)
    return []
  }
}

/**
 * Extract character/person names from a Wikipedia page
 * Uses MediaWiki Action API to get category members or page links
 */
async function extractNamesFromPage(pageTitle: string): Promise<string[]> {
  // If it's a category, use category members instead
  if (pageTitle.startsWith('Category:')) {
    return extractNamesFromCategory(pageTitle.replace('Category:', ''))
  }
  
  try {
    console.info(`[Wikipedia] Fetching links from: ${pageTitle}`)
    
    // Use MediaWiki Action API to get all links from the page
    const url = new URL(WIKIPEDIA_API)
    url.searchParams.set('action', 'query')
    url.searchParams.set('format', 'json')
    url.searchParams.set('titles', pageTitle)
    url.searchParams.set('prop', 'links')
    url.searchParams.set('pllimit', '100') // Get up to 100 links
    url.searchParams.set('plnamespace', '0') // Only main namespace (articles)
    url.searchParams.set('origin', '*') // CORS
    
    const response = await fetch(url.toString())
    if (!response.ok) {
      throw new Error(`Failed to fetch page links: ${response.status}`)
    }
    
    const data = await response.json()
    const pages = data.query?.pages
    
    if (!pages) {
      console.warn(`[Wikipedia] No pages data for: ${pageTitle}`)
      return []
    }
    
    const names: string[] = []
    
    // Extract links from the page
    for (const pageId in pages) {
      const page = pages[pageId]
      const links = page.links || []
      
      for (const link of links) {
        const linkTitle = link.title
        
        // Filter out non-person links
        // Must be strict - only accept actual person names, not meta pages
        if (linkTitle.startsWith('List ') ||  // "List of X" or "Lists of X"
            linkTitle.startsWith('Category:') ||
            linkTitle.startsWith('Portal:') ||
            linkTitle.startsWith('Wikipedia:') ||
            linkTitle.startsWith('Template:') ||
            linkTitle.startsWith('File:') ||
            linkTitle.startsWith('Help:') ||
            linkTitle.includes('disambiguation') ||
            linkTitle.includes(' by ') ||  // "Actors by nationality"
            linkTitle.includes(' in ') ||  // "Films in 2020"
            linkTitle.includes(' of ') ||  // "Music of the United States"
            linkTitle.endsWith(' actors') ||  // "American male actors" (category)
            linkTitle.endsWith(' actresses') ||
            linkTitle.endsWith(' musicians') ||
            linkTitle.endsWith(' players') ||  // "American football players"
            linkTitle.endsWith(' athletes') ||
            linkTitle.endsWith(' music') ||
            linkTitle.endsWith(' football') ||
            linkTitle.endsWith(' basketball') ||
            linkTitle.endsWith(' baseball') ||
            linkTitle.endsWith(' racing') ||
            linkTitle.endsWith(' Prize') ||
            linkTitle.endsWith(' Award') ||
            linkTitle.endsWith(' Awards') ||
            linkTitle.includes(' song)') ||  // "(song)" suffix
            linkTitle.includes(' (song)') ||  // "Title (song)" format
            linkTitle.includes(' album)') ||  // "(album)" suffix
            linkTitle.includes(' film)') ||  // "(film)" suffix
            linkTitle.includes(' band)') ||  // "(band)" suffix
            linkTitle.includes(' company)') ||  // "(company)" suffix
            linkTitle.includes(' (magazine') ||  // "(magazine)" suffix
            linkTitle.includes(' (TV series') ||  // "(TV series)" suffix
            linkTitle.includes(' (novel') ||  // "(novel)" suffix
            linkTitle.includes(' (book') ||  // "(book)" suffix
            linkTitle.endsWith('s') && linkTitle.length < 10 ||  // Plural words < 10 chars (likely concepts)
            linkTitle === 'African Americans' ||  // Specific ethnic/demographic terms
            linkTitle === 'African-Americans' ||
            linkTitle.includes('English') && !linkTitle.includes(',') ||
            linkTitle.includes('American ') && !linkTitle.includes(',') ||  // "American football" but not "Smith, American actor"
            linkTitle.includes('African-American ') && !linkTitle.includes(',') ||
            linkTitle.includes('British ') && !linkTitle.includes(',') ||
            linkTitle.includes('-side ') ||  // "A-side and B-side"
            linkTitle.includes(' Colleges') ||
            linkTitle.includes(' list') ||
            linkTitle.length < 3 ||
            linkTitle.length > 40) {  // Person names rarely exceed 40 chars
          continue
        }
        
        // Additional validation: must look like a person name
        // (Contains at least one space, or is all caps like "SEAL")
        const hasSpace = linkTitle.includes(' ')
        const isAllCaps = linkTitle === linkTitle.toUpperCase() && linkTitle.length < 10
        const looksLikeName = hasSpace || isAllCaps
        
        if (!looksLikeName) {
          continue
        }
        
        // Additional filter: starts with number (likely year/ranking)
        if (/^\d/.test(linkTitle)) {
          continue
        }
        
        // Filter out common non-person patterns
        const lowerTitle = linkTitle.toLowerCase()
        const badWords = ['history', 'culture', 'genre', 'style', 'movement', 'period', 
                         'century', 'decade', 'era', 'age', 'music', 'art', 'literature',
                         'philosophy', 'politics', 'religion', 'language', 'country',
                         'state', 'city', 'organization', 'company', 'corporation',
                         'association', 'society', 'club', 'team', 'league', 'conference',
                         'animations', 'studios', 'productions', 'records', 'entertainment',
                         'media', 'jazz', 'church', 'seminary', 'republic', 'house', 'episcopal',
                         'theological', 'methodist', 'creole', 'gospel']
        
        let isBadWord = false
        for (const word of badWords) {
          if (lowerTitle.includes(word) && !lowerTitle.includes(',')) {
            isBadWord = true
            break
          }
        }
        
        if (isBadWord) {
          continue
        }
        
        // Clean up the name
        const cleanName = linkTitle.trim()
        
        if (cleanName.length > 0 && !names.includes(cleanName)) {
          names.push(cleanName)
        }
      }
    }

    console.info(`[Wikipedia] Extracted ${names.length} names from: ${pageTitle}`)
    return names.slice(0, 50) // Limit to 50

  } catch (error) {
    console.error(`[Wikipedia] Extract error for ${pageTitle}:`, error)
    return []
  }
}

/**
 * Build search query from confirmed traits
 * e.g., {category: "actors", nationality: "american"} → "American actors"
 */
export function buildWikipediaQuery(traits: Array<{ key: string; value: string }>): string | null {
  // Find positive category (not NOT_X)
  const category = traits.find(t => t.key === 'category' && !t.value.startsWith('NOT_'))
  const nationality = traits.find(t => t.key === 'nationality')
  const gender = traits.find(t => t.key === 'gender')

  if (!category) {
    return null // Need at least a category to search
  }

  // Map our categories to Wikipedia category patterns
  const categoryMap: Record<string, string> = {
    'actors': 'actors',
    'musicians': 'musicians',
    'singers': 'singers',
    'athletes': 'athletes',
    'politicians': 'politicians',
    'scientists': 'scientists',
    'writers': 'writers',
    'directors': 'film directors',
    'historical-figures': 'historical figures',
    'superheroes': 'superheroes',
    'video-game': 'video game characters',
    'anime': 'anime characters',
    'tv': 'television characters',
  }

  const mappedCategory = categoryMap[category.value] || category.value

  // Build query for Wikipedia category search
  // Format: "American male actors" to find "Category:American male actors"
  let query = ''
  if (nationality) {
    query += `${nationality.value} `
  }
  if (gender && (category.value === 'actors' || category.value === 'musicians')) {
    query += `${gender.value} `
  }
  query += mappedCategory

  console.info(`[Wikipedia] Built query: ${query}`)
  return query
}

/**
 * Get supplemental characters from Wikipedia based on confirmed traits
 * Called from turn 5 onwards to expand beyond the 407-character database
 */
export async function getWikipediaSupplementalCharacters(
  traits: Array<{ key: string; value: string }>
): Promise<string[]> {
  const query = buildWikipediaQuery(traits)
  
  if (!query) {
    console.info('[Wikipedia] Insufficient traits to build query')
    return []
  }

  const listPage = await searchWikipediaList(query)
  
  if (!listPage) {
    console.warn('[Wikipedia] No list page found')
    return []
  }

  console.info(`[Wikipedia] ✓ Retrieved ${listPage.names.length} supplemental characters`)
  return listPage.names
}
