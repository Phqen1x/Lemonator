#!/usr/bin/env tsx
/**
 * Auto-Iteration Test Loop
 * 
 * Runs Wikipedia extraction tests in a loop, analyzes failures,
 * and logs issues for manual or automated fixing
 * 
 * Usage: tsx src/tests/auto-iterate-wikipedia.ts [duration_minutes]
 */

import { runAllTests } from './wikipedia-test'
import { extractIssuesFromTest, generateFixForIssue, applyFix } from './auto-fix-wikipedia'
import * as fs from 'fs'
import * as path from 'path'
import { execSync } from 'child_process'

const ITERATION_LOG = path.join(__dirname, 'wikipedia-iteration-log.md')
const DURATION_MINUTES = parseInt(process.argv[2] || '60')
const DURATION_MS = DURATION_MINUTES * 60 * 1000

interface IterationResult {
  iteration: number
  timestamp: string
  passed: number
  failed: number
  total: number
  duration: number
  issues: string[]
}

const iterations: IterationResult[] = []

function analyzeFailures(results: any[]): string[] {
  const issues: string[] = []
  const failedTests = results.filter(r => !r.passed)
  
  for (const test of failedTests) {
    if (test.reason?.includes('invalid names')) {
      // Extract the bad patterns
      const badNames = test.details?.badNames || []
      const patterns = new Set<string>()
      
      for (const name of badNames) {
        if (name.startsWith('List ') || name.startsWith('Lists ')) {
          patterns.add('List/Lists prefix')
        }
        if (name.includes(' actors') || name.includes(' actresses')) {
          patterns.add('Category suffix (actors/actresses)')
        }
        if (name.includes(' musicians')) {
          patterns.add('Category suffix (musicians)')
        }
        if (name.includes(' players')) {
          patterns.add('Category suffix (players)')
        }
        if (name.includes(' by ') || name.includes(' in ')) {
          patterns.add('Meta page connector (by/in)')
        }
        if (name.length > 40) {
          patterns.add('Name too long (>40 chars)')
        }
      }
      
      issues.push(`Invalid names detected: ${Array.from(patterns).join(', ')}`)
      issues.push(`  Examples: ${badNames.slice(0, 3).join('; ')}`)
    }
    
    if (test.reason?.includes('names have spaces')) {
      const namesWithoutSpaces = test.details?.namesWithoutSpaces || []
      issues.push(`Too many single-word names (not typical person names)`)
      issues.push(`  Examples: ${namesWithoutSpaces.slice(0, 5).join(', ')}`)
    }
    
    if (test.reason?.includes('at least')) {
      issues.push(`Insufficient names extracted: ${test.reason}`)
    }
  }
  
  return issues
}

function generateReport(iteration: IterationResult) {
  const header = `
## Iteration ${iteration.iteration} - ${iteration.timestamp}
**Results:** ${iteration.passed}/${iteration.total} passed (${((iteration.passed/iteration.total)*100).toFixed(1)}%)
**Duration:** ${(iteration.duration/1000).toFixed(1)}s

`
  
  const issueSection = iteration.issues.length > 0 
    ? `### Issues Found:\n${iteration.issues.map(i => `- ${i}`).join('\n')}\n\n`
    : '### All tests passed! ✓\n\n'
  
  return header + issueSection + '---\n\n'
}

function initializeLog() {
  const header = `# Wikipedia Extraction - Auto-Iteration Log
Started: ${new Date().toISOString()}
Duration: ${DURATION_MINUTES} minutes

---

`
  fs.writeFileSync(ITERATION_LOG, header, 'utf-8')
  console.log(`Log file initialized: ${ITERATION_LOG}`)
}

function appendToLog(content: string) {
  fs.appendFileSync(ITERATION_LOG, content, 'utf-8')
}

async function runIteration(iterationNum: number): Promise<IterationResult> {
  const startTime = Date.now()
  
  console.log(`\n${'═'.repeat(80)}`)
  console.log(`ITERATION ${iterationNum} - ${new Date().toLocaleTimeString()}`)
  console.log('═'.repeat(80))
  
  const summary = await runAllTests()
  const duration = Date.now() - startTime
  
  const issues = analyzeFailures(summary.results)
  
  const result: IterationResult = {
    iteration: iterationNum,
    timestamp: new Date().toISOString(),
    passed: summary.passed,
    failed: summary.failed,
    total: summary.total,
    duration,
    issues
  }
  
  iterations.push(result)
  appendToLog(generateReport(result))
  
  // Auto-fix if failures detected
  if (summary.failed > 0 && iterationNum % 5 === 0) { // Only try to fix every 5 iterations
    console.log('\n🔧 Auto-fix triggered...')
    try {
      const testIssues = extractIssuesFromTest()
      if (testIssues.length > 0) {
        for (const issue of testIssues) {
          const fix = generateFixForIssue(issue)
          if (fix) {
            console.log(`  Applying fix: ${fix}`)
            const applied = applyFix(fix)
            if (applied) {
              // Rebuild
              console.log('  Rebuilding...')
              execSync('npm run build', {
                cwd: path.join(__dirname, '../..'),
                stdio: 'pipe'
              })
              console.log('  ✓ Fix applied and rebuilt')
              appendToLog(`### Auto-fix applied: ${fix}\n\n`)
            }
          }
        }
      }
    } catch (e) {
      console.error('  ✗ Auto-fix failed:', e)
    }
  }
  
  return result
}

function generateSummary() {
  console.log('\n' + '═'.repeat(80))
  console.log('AUTO-ITERATION COMPLETE')
  console.log('═'.repeat(80))
  
  const totalIterations = iterations.length
  const avgPassed = iterations.reduce((sum, i) => sum + i.passed, 0) / totalIterations
  const avgFailed = iterations.reduce((sum, i) => sum + i.failed, 0) / totalIterations
  const totalTests = iterations.length * iterations[0].total
  
  console.log(`Total iterations: ${totalIterations}`)
  console.log(`Average success rate: ${((avgPassed / iterations[0].total) * 100).toFixed(1)}%`)
  console.log(`Total tests run: ${totalTests}`)
  
  // Find most common issues
  const allIssues = iterations.flatMap(i => i.issues)
  const issueFrequency = new Map<string, number>()
  
  for (const issue of allIssues) {
    const key = issue.split(':')[0] // Get issue type
    issueFrequency.set(key, (issueFrequency.get(key) || 0) + 1)
  }
  
  if (issueFrequency.size > 0) {
    console.log('\nMost common issues:')
    Array.from(issueFrequency.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .forEach(([issue, count]) => {
        console.log(`  - ${issue}: ${count} occurrences`)
      })
  }
  
  // Add summary to log
  const summaryText = `
# FINAL SUMMARY
- **Total iterations:** ${totalIterations}
- **Average success rate:** ${((avgPassed / iterations[0].total) * 100).toFixed(1)}%
- **Total tests executed:** ${totalTests}

## Common Issues:
${Array.from(issueFrequency.entries())
  .sort((a, b) => b[1] - a[1])
  .map(([issue, count]) => `- ${issue}: ${count} occurrences`)
  .join('\n')}
`
  
  appendToLog(summaryText)
  console.log(`\nFull log saved to: ${ITERATION_LOG}`)
}

async function main() {
  console.log(`Starting auto-iteration for ${DURATION_MINUTES} minutes...`)
  console.log(`Tests will run continuously until ${new Date(Date.now() + DURATION_MS).toLocaleTimeString()}`)
  
  initializeLog()
  
  const startTime = Date.now()
  let iterationNum = 0
  
  while (Date.now() - startTime < DURATION_MS) {
    iterationNum++
    
    try {
      const result = await runIteration(iterationNum)
      
      // Log progress
      const elapsed = Math.floor((Date.now() - startTime) / 1000 / 60)
      const remaining = DURATION_MINUTES - elapsed
      console.log(`\n⏱️  Progress: ${elapsed}/${DURATION_MINUTES} minutes (${remaining} min remaining)`)
      
      // Wait 10 seconds between iterations to avoid hammering Wikipedia API
      if (Date.now() - startTime < DURATION_MS) {
        console.log('Waiting 10s before next iteration...')
        await new Promise(resolve => setTimeout(resolve, 10000))
      }
      
    } catch (error) {
      console.error(`Error in iteration ${iterationNum}:`, error)
      appendToLog(`\n## Iteration ${iterationNum} - ERROR\n${error}\n\n`)
    }
  }
  
  generateSummary()
}

// Run the loop
main().catch(error => {
  console.error('Fatal error:', error)
  process.exit(1)
})
