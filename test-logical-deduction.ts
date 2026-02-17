#!/usr/bin/env tsx
/**
 * Test logical deduction for uniquely identifying trait combinations
 * Example: "U.S. President" + "currently in office in 2026" = only 1 person
 */

import { simulateGame } from './src/tests/integration-test'

async function testLogicalDeduction() {
  console.log('=== TESTING LOGICAL DEDUCTION ===')
  console.log('Character: Donald Trump (current U.S. President in 2026)')
  console.log('Expected: After confirming "U.S. President" + "currently in office", should guess immediately')
  console.log('')
  
  const character = 'Donald Trump'
  
  try {
    const result = await simulateGame(character, {
      maxTurns: 25,
      timeoutMs: 5 * 60 * 1000, // 5 minutes
    })
    
    console.log('\n=== TEST RESULTS ===')
    console.log(`Character: ${character}`)
    console.log(`Success: ${result.success}`)
    console.log(`Final guess: ${result.finalGuess}`)
    console.log(`Turns taken: ${result.turns.length}`)
    console.log(`Questions asked: ${result.turns.map((t: any, i: number) => `${i+1}. ${t.question}`).join('\n')}`)
    
    if (result.success) {
      console.log('\n✅ SUCCESS: Logical deduction worked!')
    } else {
      console.log('\n❌ FAILED: Did not correctly identify character')
    }
    
    return result
  } catch (error) {
    console.error('Test failed with error:', error)
    throw error
  }
}

// Run the test
testLogicalDeduction()
  .then(() => {
    console.log('\n=== Test completed ===')
    process.exit(0)
  })
  .catch(error => {
    console.error('\n=== Test failed ===')
    console.error(error)
    process.exit(1)
  })
