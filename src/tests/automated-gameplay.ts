/**
 * Automated Integration Tests for Detective AI
 * 
 * This module provides automated testing by simulating gameplay:
 * 1. Picks a random character from the knowledge base
 * 2. Detective asks questions
 * 3. Simulated player answers based on character's actual traits
 * 4. Tracks performance metrics (turns, accuracy, etc.)
 */

import type { CharacterData, Trait } from '../renderer/services/character-rag'

export interface GameResult {
  characterName: string
  category: string
  success: boolean
  turnsToGuess: number
  totalTurns: number
  finalGuesses: string[]
  correctGuessRank: number | null // 1 = first guess, 2 = second, etc.
  traits: Trait[]
  questionHistory: Array<{ question: string; answer: string }>
}

export interface TestMetrics {
  totalGames: number
  successRate: number
  averageTurns: number
  guessDistribution: {
    firstGuess: number
    secondGuess: number
    thirdGuess: number
    notInTop3: number
  }
  categoryPerformance: Record<string, {
    games: number
    success: number
    avgTurns: number
  }>
  hardestCharacters: Array<{ name: string; turns: number }>
}

/**
 * Simulate answering a question based on character data
 */
export function simulateAnswer(
  question: string,
  character: CharacterData
): 'yes' | 'no' | 'probably' {
  const q = question.toLowerCase()
  const facts = character.distinctive_facts.join(' ').toLowerCase()
  const name = character.name.toLowerCase()
  
  // Fictional
  if (q.includes('fictional')) {
    return character.traits.fictional ? 'yes' : 'no'
  }
  
  // Gender (check name and facts)
  const femaleNames = ['taylor', 'scarlett', 'nicole', 'jennifer', 'emma', 'natalie', 'angelina', 'madonna', 'rihanna', 'beyonce', 'adele', 'gaga', 'ariana']
  const isFemaleByName = femaleNames.some(name => character.name.toLowerCase().includes(name))
  
  if (q.includes('male') && !q.includes('female')) {
    if (facts.includes('he ') || facts.includes('his ') || 
        (facts.includes('actor') && !facts.includes('actress'))) {
      return 'yes'
    }
    if (facts.includes('she ') || facts.includes('her ') || facts.includes('actress') || isFemaleByName) {
      return 'no'
    }
    return 'probably' // Ambiguous
  }
  
  if (q.includes('female')) {
    if (facts.includes('she ') || facts.includes('her ') || facts.includes('actress') || isFemaleByName) {
      return 'yes'
    }
    if (facts.includes('he ') || facts.includes('his ') || 
        (facts.includes('actor') && !facts.includes('actress'))) {
      return 'no'
    }
    return 'probably' // Ambiguous
  }
  
  // Categories
  if (q.includes('actor')) {
    // Check category first, but also check facts for "other" category
    if (character.category === 'actors') return 'yes'
    if (character.category === 'other' && (facts.includes('actor') || facts.includes('actress'))) return 'yes'
    return 'no'
  }
  if (q.includes('athlete')) {
    if (character.category === 'athletes') return 'yes'
    if (character.category === 'other' && facts.includes('athlete')) return 'yes'
    return 'no'
  }
  if (q.includes('musician') || q.includes('singer')) {
    if (character.category === 'musicians') return 'yes'
    if (character.category === 'other' && (facts.includes('musician') || facts.includes('singer'))) return 'yes'
    return 'no'
  }
  if (q.includes('politician')) {
    if (character.category === 'politicians') return 'yes'
    if (character.category === 'other' && facts.includes('politician')) return 'yes'
    return 'no'
  }
  if (q.includes('superhero')) {
    return character.category === 'superheroes' ? 'yes' : 'no'
  }
  if (q.includes('anime') || q.includes('manga')) {
    return character.category === 'anime' ? 'yes' : 'no'
  }
  if (q.includes('video game') || q.includes('game')) {
    return character.category === 'video-games' ? 'yes' : 'no'
  }
  if (q.includes('tv') || q.includes('television')) {
    return character.category === 'tv-characters' ? 'yes' : 'no'
  }
  if (q.includes('historical figure')) {
    const hasDates = /\d{4}–\d{4}/.test(facts)
    const before1950 = hasDates && !facts.includes('195') && !facts.includes('196') && !facts.includes('197')
    return before1950 ? 'yes' : 'no'
  }
  
  // Origin/Medium
  if (q.includes('comic book')) {
    return (character.category === 'superheroes' || facts.includes('comic')) ? 'yes' : 'no'
  }
  if (q.includes('movie') || q.includes('film')) {
    return (character.category === 'actors' || facts.includes('movie') || facts.includes('film')) ? 'yes' : 'no'
  }
  
  // Geographic
  if (q.includes('american')) {
    return (facts.includes('american') || facts.includes('united states') || facts.includes('u.s.')) ? 'yes' : 'no'
  }
  
  // Life status
  if (q.includes('still alive') || q.includes('alive today')) {
    const isDead = facts.includes('–') || facts.includes('died')
    return isDead ? 'no' : 'yes'
  }
  
  // Genre/Style
  if (q.includes('comedy') || q.includes('comedian')) {
    return (facts.includes('comedy') || facts.includes('comedian') || facts.includes('comic')) ? 'yes' : 'no'
  }
  if (q.includes('action')) {
    return (facts.includes('action') || facts.includes('martial arts') || facts.includes('fighter')) ? 'yes' : 'no'
  }
  
  // Powers
  if (q.includes('superpower') || q.includes('powers') || q.includes('abilities')) {
    const hasPowers = character.category === 'superheroes' || 
                     character.category === 'anime' ||
                     facts.includes('superhero') ||
                     facts.includes('superpower') ||
                     facts.includes('magic')
    return hasPowers ? 'yes' : 'no'
  }
  
  // Broad questions - use heuristics
  if (q.includes('known internationally')) {
    // Major categories tend to be international
    return ['actors', 'athletes', 'musicians', 'superheroes'].includes(character.category) ? 'yes' : 'probably'
  }
  
  if (q.includes('physical appearance')) {
    return character.distinctive_facts.length > 3 ? 'probably' : 'no'
  }
  
  if (q.includes('distinctive personality')) {
    return character.category === 'tv-characters' || character.category === 'anime' ? 'yes' : 'probably'
  }
  
  if (q.includes('famous duo') || q.includes('group')) {
    return facts.includes('team') || facts.includes('group') || facts.includes('band') ? 'yes' : 'no'
  }
  
  if (q.includes('catchphrase') || q.includes('signature move')) {
    return character.category === 'anime' || character.category === 'superheroes' ? 'probably' : 'no'
  }
  
  if (q.includes('based on a real person')) {
    return character.traits.fictional ? 'no' : 'yes'
  }
  
  // Default: Try to find keywords in facts
  const keywords = q.split(' ').filter(w => w.length > 4)
  const matches = keywords.filter(kw => facts.includes(kw) || name.includes(kw))
  
  if (matches.length >= 2) return 'yes'
  if (matches.length === 1) return 'probably'
  return 'no'
}

/**
 * Calculate metrics from multiple game results
 */
export function calculateMetrics(results: GameResult[]): TestMetrics {
  if (results.length === 0) {
    return {
      totalGames: 0,
      successRate: 0,
      averageTurns: 0,
      guessDistribution: { firstGuess: 0, secondGuess: 0, thirdGuess: 0, notInTop3: 0 },
      categoryPerformance: {},
      hardestCharacters: []
    }
  }
  
  const successes = results.filter(r => r.success).length
  const totalTurns = results.reduce((sum, r) => sum + r.turnsToGuess, 0)
  
  const guessDistribution = {
    firstGuess: results.filter(r => r.correctGuessRank === 1).length,
    secondGuess: results.filter(r => r.correctGuessRank === 2).length,
    thirdGuess: results.filter(r => r.correctGuessRank === 3).length,
    notInTop3: results.filter(r => r.correctGuessRank === null || r.correctGuessRank > 3).length
  }
  
  // Category performance
  const categoryPerformance: Record<string, { games: number; success: number; avgTurns: number }> = {}
  for (const result of results) {
    if (!categoryPerformance[result.category]) {
      categoryPerformance[result.category] = { games: 0, success: 0, avgTurns: 0 }
    }
    categoryPerformance[result.category].games++
    if (result.success) {
      categoryPerformance[result.category].success++
    }
    categoryPerformance[result.category].avgTurns += result.turnsToGuess
  }
  
  // Calculate averages
  for (const cat in categoryPerformance) {
    const perf = categoryPerformance[cat]
    perf.avgTurns = perf.avgTurns / perf.games
  }
  
  // Hardest characters (most turns)
  const hardestCharacters = [...results]
    .sort((a, b) => b.turnsToGuess - a.turnsToGuess)
    .slice(0, 10)
    .map(r => ({ name: r.characterName, turns: r.turnsToGuess }))
  
  return {
    totalGames: results.length,
    successRate: successes / results.length,
    averageTurns: totalTurns / results.length,
    guessDistribution,
    categoryPerformance,
    hardestCharacters
  }
}

/**
 * Format metrics as readable text
 */
export function formatMetrics(metrics: TestMetrics): string {
  const lines: string[] = []
  
  lines.push('='.repeat(60))
  lines.push('DETECTIVE AI PERFORMANCE METRICS')
  lines.push('='.repeat(60))
  lines.push('')
  
  lines.push(`Total Games: ${metrics.totalGames}`)
  lines.push(`Success Rate: ${(metrics.successRate * 100).toFixed(1)}%`)
  lines.push(`Average Turns to Guess: ${metrics.averageTurns.toFixed(1)}`)
  lines.push('')
  
  lines.push('Guess Distribution:')
  lines.push(`  First Guess (Rank 1):  ${metrics.guessDistribution.firstGuess} (${(metrics.guessDistribution.firstGuess / metrics.totalGames * 100).toFixed(1)}%)`)
  lines.push(`  Second Guess (Rank 2): ${metrics.guessDistribution.secondGuess} (${(metrics.guessDistribution.secondGuess / metrics.totalGames * 100).toFixed(1)}%)`)
  lines.push(`  Third Guess (Rank 3):  ${metrics.guessDistribution.thirdGuess} (${(metrics.guessDistribution.thirdGuess / metrics.totalGames * 100).toFixed(1)}%)`)
  lines.push(`  Not in Top 3:          ${metrics.guessDistribution.notInTop3} (${(metrics.guessDistribution.notInTop3 / metrics.totalGames * 100).toFixed(1)}%)`)
  lines.push('')
  
  lines.push('Performance by Category:')
  const sortedCategories = Object.entries(metrics.categoryPerformance)
    .sort((a, b) => b[1].games - a[1].games)
  
  for (const [category, perf] of sortedCategories) {
    const successRate = (perf.success / perf.games * 100).toFixed(0)
    lines.push(`  ${category.padEnd(15)} ${perf.games} games, ${successRate}% success, ${perf.avgTurns.toFixed(1)} avg turns`)
  }
  lines.push('')
  
  lines.push('Hardest Characters (most turns):')
  for (let i = 0; i < Math.min(10, metrics.hardestCharacters.length); i++) {
    const char = metrics.hardestCharacters[i]
    lines.push(`  ${(i + 1).toString().padStart(2)}. ${char.name.padEnd(25)} ${char.turns} turns`)
  }
  
  lines.push('')
  lines.push('='.repeat(60))
  
  return lines.join('\n')
}
