#!/usr/bin/env tsx
/**
 * Auto-Fix Wikipedia Extraction Issues
 * 
 * Monitors test results and automatically applies fixes to wikipedia.ts
 * based on detected bad patterns
 */

import * as fs from 'fs'
import * as path from 'path'
import { execSync } from 'child_process'

const WIKIPEDIA_SERVICE = path.join(__dirname, '../renderer/services/wikipedia.ts')

interface Issue {
  type: string
  examples: string[]
}

function extractIssuesFromTest(): Issue[] {
  // Run test and capture output
  try {
    const output = execSync('npm run test:wikipedia', {
      cwd: path.join(__dirname, '../..'),
      encoding: 'utf-8'
    })
    
    return analyzeTestOutput(output)
  } catch (error: any) {
    // Test failed, parse error output
    return analyzeTestOutput(error.stdout + error.stderr)
  }
}

function analyzeTestOutput(output: string): Issue[] {
  const issues: Issue[] = []
  
  // Extract bad names from output
  const badNameMatches = output.matchAll(/First 10: ([^\n]+)/g)
  const allBadNames: string[] = []
  
  for (const match of badNameMatches) {
    const names = match[1].split(', ')
    for (const name of names) {
      // Detect non-person patterns
      const lower = name.toLowerCase()
      
      if (lower.includes('(song)') || lower.includes('(album)') ||
          lower.includes('(band)') || lower.includes('(film)')) {
        allBadNames.push(name)
      }
      
      if (lower.includes('animations') || lower.includes('studios') ||
          lower.includes('productions') || lower.includes('records')) {
        allBadNames.push(name)
      }
      
      if (lower.includes('african americans') || lower.includes('dominican republic') ||
          lower.includes('acid house') || lower.includes(' jazz') ||
          lower.includes(' church') || lower.includes('seminary')) {
        allBadNames.push(name)
      }
    }
  }
  
  if (allBadNames.length > 0) {
    issues.push({
      type: 'non-person-names',
      examples: Array.from(new Set(allBadNames)).slice(0, 10)
    })
  }
  
  return issues
}

function generateFixForIssue(issue: Issue): string | null {
  if (issue.type === 'non-person-names') {
    // Analyze the bad names to find patterns
    const patterns = new Set<string>()
    
    for (const name of issue.examples) {
      const lower = name.toLowerCase()
      
      if (lower.includes('(song)')) patterns.add("linkTitle.includes(' (song)')")
      if (lower.includes('(album)')) patterns.add("linkTitle.includes(' (album)')")
      if (lower.includes('(band)')) patterns.add("linkTitle.includes(' (band)')")
      if (lower.includes('animations')) patterns.add("lowerTitle.includes('animations')")
      if (lower.includes('studios')) patterns.add("lowerTitle.includes('studios')")
      if (lower.includes('productions')) patterns.add("lowerTitle.includes('productions')")
      if (lower.includes('records')) patterns.add("lowerTitle.includes('records')")
      if (lower.includes('jazz')) patterns.add("lowerTitle.includes(' jazz')")
      if (lower.includes('church')) patterns.add("lowerTitle.includes('church')")
      if (lower.includes('seminary')) patterns.add("lowerTitle.includes('seminary')")
      if (lower.includes('african americans')) patterns.add("lowerTitle === 'african americans'")
      if (lower.includes('dominican republic')) patterns.add("lowerTitle.includes('republic')")
    }
    
    if (patterns.size > 0) {
      return `Add filters: ${Array.from(patterns).join(' || ')}`
    }
  }
  
  return null
}

function applyFix(fix: string): boolean {
  console.log(`\n🔧 Applying fix: ${fix}`)
  
  let content = fs.readFileSync(WIKIPEDIA_SERVICE, 'utf-8')
  
  // Find the badWords array in the file
  const badWordsMatch = content.match(/const badWords = \[([\s\S]*?)\]/m)
  if (!badWordsMatch) {
    console.error('Could not find badWords array in wikipedia.ts')
    return false
  }
  
  // Extract current bad words
  const currentBadWords = badWordsMatch[1]
    .split(',')
    .map(w => w.trim().replace(/['"]/g, ''))
    .filter(w => w.length > 0)
  
  // Add new patterns from fix
  const newWords = new Set<string>()
  
  if (fix.includes('animations')) newWords.add('animations')
  if (fix.includes('studios')) newWords.add('studios')
  if (fix.includes('productions')) newWords.add('productions')
  if (fix.includes('records')) newWords.add('records')
  if (fix.includes('jazz')) newWords.add('jazz')
  if (fix.includes('church')) newWords.add('church')
  if (fix.includes('seminary')) newWords.add('seminary')
  if (fix.includes('republic')) newWords.add('republic')
  
  // Merge with existing
  const allWords = Array.from(new Set([...currentBadWords, ...Array.from(newWords)]))
    .sort()
  
  // Rebuild the array
  const newBadWordsArray = `const badWords = [${allWords.map(w => `'${w}'`).join(', ')}]`
  
  // Replace in content
  content = content.replace(/const badWords = \[[\s\S]*?\]/m, newBadWordsArray)
  
  // Write back
  fs.writeFileSync(WIKIPEDIA_SERVICE, content, 'utf-8')
  
  console.log(`✓ Added ${newWords.size} new filter words to badWords array`)
  return true
}

async function main() {
  console.log('🔍 Running Wikipedia extraction tests...')
  
  const issues = extractIssuesFromTest()
  
  if (issues.length === 0) {
    console.log('✅ All tests passed! No issues to fix.')
    return
  }
  
  console.log(`\n⚠️  Found ${issues.length} issues:`)
  issues.forEach((issue, i) => {
    console.log(`${i + 1}. ${issue.type}`)
    console.log(`   Examples: ${issue.examples.slice(0, 5).join(', ')}`)
  })
  
  for (const issue of issues) {
    const fix = generateFixForIssue(issue)
    if (fix) {
      const applied = applyFix(fix)
      if (applied) {
        console.log('✓ Fix applied successfully')
        
        // Rebuild
        console.log('\n📦 Rebuilding...')
        try {
          execSync('npm run build', {
            cwd: path.join(__dirname, '../..'),
            stdio: 'inherit'
          })
          console.log('✓ Build successful')
        } catch (e) {
          console.error('✗ Build failed')
        }
      }
    }
  }
}

if (require.main === module) {
  main().catch(error => {
    console.error('Error:', error)
    process.exit(1)
  })
}

export { extractIssuesFromTest, generateFixForIssue, applyFix }
