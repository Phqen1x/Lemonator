/**
 * Setup script to generate Lemon mascot expressions
 * Run this once to pre-generate all lemon character images
 * 
 * Usage: npm run setup:lemon
 */

import { generateImage } from '../src/renderer/services/lemonade'
import { IMAGE_MODEL } from '../src/shared/constants'
import * as fs from 'fs'
import * as path from 'path'

type LemonExpression = 'neutral' | 'yes' | 'no' | 'probably' | 'probably_not' | 'dont_know'

type ExpressionPrompt = {
  positive: string
  negative: string
}

const EXPRESSION_PROMPTS: Record<LemonExpression, ExpressionPrompt> = {
  neutral: {
    positive: 'COMPLETELY NEUTRAL, simple black dot eyes, perfectly straight horizontal line for mouth NO CURVE, standing still, ZERO emotion, robotic blank stare',
    negative: 'frowning, sad, angry, crying, laughing, smiling, grinning, happy, cheerful, any emotion, curved mouth, upturned lips',
  },
  yes: {
    positive: 'EXTREMELY HAPPY, MASSIVE GRIN WITH MOUTH CURVED UPWARD, eyes wide open sparkling, both arms raised HIGH above head waving, jumping off ground, pure joy',
    negative: 'sad, frowning, crying, disappointed, neutral, calm, serious, tired, straight mouth',
  },
  no: {
    positive: 'SAD FROWNING UPSET, MOUTH CURVED DOWNWARD IN FROWN, eyebrows angled down, single tear, arms at sides drooping, head tilted down, NO SMILING AT ALL',
    negative: 'smiling, grinning, happy, cheerful, laughing, positive, excited, upturned mouth, curved up lips, any smile',
  },
  probably: {
    positive: 'THINKING HARD, one finger on chin, small UPWARD CURVED SMILE showing optimism, one eyebrow raised, eyes looking up, considering',
    negative: 'laughing, huge grin, sad, crying, very confused, angry, deep frown, neutral face',
  },
  probably_not: {
    positive: 'SKEPTICAL FROWNING, MOUTH CURVED DOWNWARD, both eyebrows DOWN and inward, arms CROSSED, squinting eyes, head shaking NO, distrustful scowl, NO SMILE',
    negative: 'smiling, grinning, happy, laughing, cheerful, positive, upturned mouth, curved up lips, any smile whatsoever',
  },
  dont_know: {
    positive: 'CONFUSED BEWILDERED, eyes looking DIFFERENT DIRECTIONS crossed, mouth open WIDE in O shape, both hands on sides of head, shoulders SHRUGGED UP, question mark above head, NO SMILE JUST CONFUSION',
    negative: 'smiling, happy, confident, certain, laughing, cheerful, grinning, upturned mouth, any smile, content',
  },
}

const BASE_PROMPT = `professional 3D CGI render of anthropomorphic glass of lemonade character, 
transparent glass pitcher body filled with bright yellow lemonade liquid, ice cubes floating inside the glass, 
fresh lemon slice garnish on rim, condensation water droplets on glass, 
white cartoon gloved hands and arms attached to glass, white shoes on cartoon legs, 
3D animation style, high quality render, studio lighting, plain white background, vibrant colors`

const BASE_NEGATIVE = 'blurry, low quality, deformed, disfigured, extra limbs, bad anatomy, realistic photo, photograph, dark, gloomy, text, watermark, logo, multiple characters, horror, scary'

const LEMON_ASSETS_DIR = path.join(process.cwd(), 'public', 'lemon-assets')

function ensureAssetsDirectory() {
  if (!fs.existsSync(LEMON_ASSETS_DIR)) {
    fs.mkdirSync(LEMON_ASSETS_DIR, { recursive: true })
    console.info('[Lemon] Created assets directory:', LEMON_ASSETS_DIR)
  }
}

function getCachedImagePath(expression: LemonExpression): string {
  return path.join(LEMON_ASSETS_DIR, `lemon-${expression}.png`)
}

function isExpressionCached(expression: LemonExpression): boolean {
  return fs.existsSync(getCachedImagePath(expression))
}

function areAllExpressionsCached(): boolean {
  const expressions: LemonExpression[] = ['neutral', 'yes', 'no', 'probably', 'probably_not', 'dont_know']
  return expressions.every(isExpressionCached)
}

async function generateLemonExpression(expression: LemonExpression, seed: number): Promise<string> {
  console.info(`[Lemon] Generating ${expression} expression...`)
  
  const expressionPrompt = EXPRESSION_PROMPTS[expression]
  const fullPrompt = `${BASE_PROMPT}, ${expressionPrompt.positive}`
  const fullNegativePrompt = `${BASE_NEGATIVE}, ${expressionPrompt.negative}`
  
  console.info(`[Lemon] Prompt: ${fullPrompt.substring(0, 120)}...`)
  console.info(`[Lemon] Negative: ${fullNegativePrompt.substring(0, 80)}...`)
  
  // Map expressions to very different seed offsets to get diverse results
  const seedOffsets: Record<LemonExpression, number> = {
    neutral: 0,
    yes: 10000,
    no: 20000,
    probably: 30000,
    probably_not: 40000,
    dont_know: 50000,
  }
  
  const finalSeed = seed + seedOffsets[expression]
  console.info(`[Lemon] Using seed: ${finalSeed}`)
  
  try {
    const response = await generateImage({
      model: IMAGE_MODEL,
      prompt: fullPrompt,
      negative_prompt: fullNegativePrompt,
      seed: finalSeed,
      steps: 4, // SDXL-turbo optimal: 1-4 steps
      cfg_scale: 1.5, // Increased from 1.0 to 1.5 for better prompt adherence
      width: 512,
      height: 512,
    })
    
    const base64 = response.data?.[0]?.b64_json
    if (!base64) throw new Error(`No image returned for ${expression}`)
    
    console.info(`[Lemon] ✓ Generated ${expression} expression`)
    return base64
  } catch (error) {
    console.error(`[Lemon] Failed to generate ${expression}:`, error)
    throw error
  }
}

function saveImageToDisk(base64Data: string, filePath: string) {
  const buffer = Buffer.from(base64Data, 'base64')
  fs.writeFileSync(filePath, buffer)
  console.info(`[Lemon] Saved to disk: ${filePath}`)
}

async function generateAndCacheExpression(expression: LemonExpression, seed: number = 42): Promise<void> {
  ensureAssetsDirectory()
  
  if (isExpressionCached(expression)) {
    console.info(`[Lemon] ${expression} already cached, skipping generation`)
    return
  }
  
  const base64 = await generateLemonExpression(expression, seed)
  const filePath = getCachedImagePath(expression)
  saveImageToDisk(base64, filePath)
  
  console.info(`[Lemon] ✓ Cached ${expression} expression`)
}

async function generateAllLemonExpressions(seed: number = 42): Promise<void> {
  console.info('[Lemon] ==========================================')
  console.info('[Lemon] Generating Lemon mascot expressions')
  console.info('[Lemon] ==========================================')
  
  ensureAssetsDirectory()
  
  const expressions: LemonExpression[] = ['neutral', 'yes', 'no', 'probably', 'probably_not', 'dont_know']
  const uncached = expressions.filter(expr => !isExpressionCached(expr))
  
  if (uncached.length === 0) {
    console.info('[Lemon] All expressions already cached!')
    return
  }
  
  console.info(`[Lemon] Need to generate ${uncached.length} expressions: ${uncached.join(', ')}`)
  
  for (const expression of uncached) {
    try {
      await generateAndCacheExpression(expression, seed)
    } catch (error) {
      console.error(`[Lemon] Failed to generate ${expression}, continuing with others...`)
    }
  }
  
  console.info('[Lemon] ==========================================')
  console.info('[Lemon] Lemon mascot generation complete!')
  console.info('[Lemon] ==========================================')
}

async function main() {
  console.log('\n🍋 Lemon Mascot Setup\n')
  
  if (areAllExpressionsCached()) {
    console.log('✅ All lemon expressions already exist!')
    console.log('   To regenerate, delete the public/lemon-assets/ folder and run this again.')
    process.exit(0)
  }
  
  console.log('⚠️  Make sure your Lemonade server is running with sdxl-turbo loaded!')
  console.log('   Expected endpoint: http://localhost:8000')
  console.log('')
  console.log('Generating 6 lemon expressions (this may take 30-60 seconds)...\n')
  
  try {
    await generateAllLemonExpressions(42) // Use fixed seed for consistency
    console.log('\n✅ Setup complete! Lemon mascot is ready to go.')
    console.log('   Images saved to: public/lemon-assets/')
  } catch (error) {
    console.error('\n❌ Setup failed:', error)
    console.error('\nTroubleshooting:')
    console.error('  1. Ensure Lemonade server is running: curl http://localhost:8000/health')
    console.error('  2. Verify sdxl-turbo model is loaded')
    console.error('  3. Check GPU memory (SDXL needs ~6GB VRAM)')
    process.exit(1)
  }
}

main()
