/**
 * Wikipedia Extraction Test Suite
 * 
 * Tests Wikipedia name extraction logic with real API calls
 * Validates filtering, name recognition, and confidence scoring
 */

import { getWikipediaSupplementalCharacters } from '../renderer/services/wikipedia'
import type { Trait } from '../renderer/types/game'

interface TestResult {
  name: string
  passed: boolean
  reason?: string
  details?: any
}

const results: TestResult[] = []

function logResult(test: TestResult) {
  results.push(test)
  const icon = test.passed ? '✓' : '✗'
  const color = test.passed ? '\x1b[32m' : '\x1b[31m'
  console.log(`${color}${icon}\x1b[0m ${test.name}`)
  if (!test.passed && test.reason) {
    console.log(`  └─ ${test.reason}`)
  }
  if (test.details) {
    console.log(`  └─ Details:`, test.details)
  }
}

// Test cases with known good/bad patterns
const testCases = [
  {
    name: 'American actors - should extract real names',
    traits: [
      { key: 'category', value: 'actors', confidence: 0.95 },
      { key: 'nationality', value: 'american', confidence: 0.90 }
    ] as Trait[],
    expectations: {
      minNames: 10,
      maxNames: 50,
      shouldNotContain: [
        'List of',
        'Lists of',
        'American male actors',
        'American male film actors',
        'Category:',
        'Portal:',
        'Template:',
        'disambiguation'
      ],
      shouldContainSpace: true, // Most names have spaces
      maxNameLength: 40
    }
  },
  {
    name: 'American musicians - should extract real names',
    traits: [
      { key: 'category', value: 'musicians', confidence: 0.95 },
      { key: 'nationality', value: 'american', confidence: 0.90 }
    ] as Trait[],
    expectations: {
      minNames: 10,
      shouldNotContain: ['List of', 'Lists of', 'musicians', 'Category:', 'Portal:'],
      shouldContainSpace: true
    }
  },
  {
    name: 'British actors - should extract real names',
    traits: [
      { key: 'category', value: 'actors', confidence: 0.95 },
      { key: 'nationality', value: 'british', confidence: 0.90 }
    ] as Trait[],
    expectations: {
      minNames: 10,
      shouldNotContain: ['List of', 'Lists of', 'British actors', 'Category:'],
      shouldContainSpace: true
    }
  },
  {
    name: 'Athletes - should handle sports categories',
    traits: [
      { key: 'category', value: 'athletes', confidence: 0.95 },
      { key: 'nationality', value: 'american', confidence: 0.90 }
    ] as Trait[],
    expectations: {
      minNames: 5,
      shouldNotContain: ['List of', 'players', 'athletes', 'Category:'],
      shouldContainSpace: true
    }
  }
]

async function runTest(testCase: any): Promise<TestResult> {
  try {
    console.log(`\n${'─'.repeat(60)}`)
    console.log(`Testing: ${testCase.name}`)
    console.log('─'.repeat(60))
    
    const names = await getWikipediaSupplementalCharacters(testCase.traits)
    
    console.log(`Extracted ${names.length} names`)
    console.log(`First 10:`, names.slice(0, 10).join(', '))
    
    const exp = testCase.expectations
    
    // Check minimum names
    if (names.length < exp.minNames) {
      return {
        name: testCase.name,
        passed: false,
        reason: `Expected at least ${exp.minNames} names, got ${names.length}`,
        details: { extractedNames: names }
      }
    }
    
    // Check maximum names (if specified)
    if (exp.maxNames && names.length > exp.maxNames) {
      return {
        name: testCase.name,
        passed: false,
        reason: `Expected at most ${exp.maxNames} names, got ${names.length}`,
        details: { extractedCount: names.length }
      }
    }
    
    // Check for bad patterns
    const badNames: string[] = []
    for (const name of names) {
      for (const badPattern of exp.shouldNotContain) {
        if (name.includes(badPattern)) {
          badNames.push(name)
          break
        }
      }
      
      // Check name length
      if (exp.maxNameLength && name.length > exp.maxNameLength) {
        badNames.push(name)
      }
      
      // Additional strict validation for person names
      // Names that are clearly not people:
      const lowerName = name.toLowerCase()
      
      // Contains qualifying words that indicate concepts not people
      const conceptKeywords = [
        'acid house', 'african americans', 'aardman animations',
        'afro-cuban', 'african methodist', 'african theological',
        'dominican republic', 'episcopal church', 'seminary',
        'archministry', 'creole', '(song)', '(album)', '(band)',
        '(film)', '(company)', 'animations', ' jazz', ' church',
        ' genre', ' movement', ' style'
      ]
      
      for (const keyword of conceptKeywords) {
        if (lowerName.includes(keyword)) {
          badNames.push(name)
          break
        }
      }
      
      // Check if it's a company/organization (ends with typical suffixes)
      const orgSuffixes = [' animations', ' studios', ' productions', ' records',
                          ' entertainment', ' media', ' inc', ' llc', ' corporation']
      for (const suffix of orgSuffixes) {
        if (lowerName.endsWith(suffix)) {
          badNames.push(name)
          break
        }
      }
    }
    
    if (badNames.length > 0) {
      return {
        name: testCase.name,
        passed: false,
        reason: `Found ${badNames.length} invalid names (meta pages, not person names)`,
        details: { badNames: badNames.slice(0, 10) }
      }
    }
    
    // Check that most names have spaces (real person names)
    if (exp.shouldContainSpace) {
      const namesWithSpaces = names.filter(n => n.includes(' ')).length
      const percentage = (namesWithSpaces / names.length) * 100
      
      if (percentage < 70) { // At least 70% should have spaces
        return {
          name: testCase.name,
          passed: false,
          reason: `Only ${percentage.toFixed(0)}% of names have spaces (expected >70% for person names)`,
          details: { namesWithoutSpaces: names.filter(n => !n.includes(' ')).slice(0, 10) }
        }
      }
    }
    
    return {
      name: testCase.name,
      passed: true,
      details: { 
        extractedCount: names.length,
        sampleNames: names.slice(0, 5)
      }
    }
    
  } catch (error) {
    return {
      name: testCase.name,
      passed: false,
      reason: `Exception: ${error instanceof Error ? error.message : String(error)}`,
      details: { error }
    }
  }
}

async function runAllTests() {
  console.log('\n' + '='.repeat(60))
  console.log('WIKIPEDIA EXTRACTION TEST SUITE')
  console.log('='.repeat(60))
  
  for (const testCase of testCases) {
    const result = await runTest(testCase)
    logResult(result)
  }
  
  console.log('\n' + '='.repeat(60))
  console.log('TEST SUMMARY')
  console.log('='.repeat(60))
  
  const passed = results.filter(r => r.passed).length
  const failed = results.filter(r => !r.passed).length
  const total = results.length
  
  console.log(`Passed: ${passed}/${total}`)
  console.log(`Failed: ${failed}/${total}`)
  console.log(`Success Rate: ${((passed / total) * 100).toFixed(1)}%`)
  
  if (failed > 0) {
    console.log('\nFailed tests:')
    results.filter(r => !r.passed).forEach(r => {
      console.log(`  - ${r.name}`)
      console.log(`    ${r.reason}`)
    })
  }
  
  return { passed, failed, total, results }
}

// Run tests
if (require.main === module) {
  runAllTests()
    .then(summary => {
      process.exit(summary.failed > 0 ? 1 : 0)
    })
    .catch(error => {
      console.error('Test suite error:', error)
      process.exit(1)
    })
}

export { runAllTests, testCases }
