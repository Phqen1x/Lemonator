import { useGameState } from '../context/GameContext'
import { useEffect } from 'react'

export default function QuestionBubble() {
  const { currentQuestion, phase, turn } = useGameState()

  // Log questions as they're displayed
  useEffect(() => {
    if (currentQuestion && phase === 'waiting_for_answer') {
      // Check if it's a character guess question
      const isCharacterGuess = /^Is your character .+\?$/i.test(currentQuestion) && 
                               !currentQuestion.toLowerCase().includes('from') &&
                               !currentQuestion.toLowerCase().includes('known for') &&
                               !currentQuestion.toLowerCase().includes('an actor') &&
                               !currentQuestion.toLowerCase().includes('an athlete')
      
      if (isCharacterGuess) {
        console.log(`[UI] 🎲 Turn ${turn}: GUESSING - ${currentQuestion}`)
      } else {
        console.log(`[UI] ❓ Turn ${turn}: ASKING - ${currentQuestion}`)
      }
    }
  }, [currentQuestion, phase, turn])

  // Show question during waiting phase
  if (phase !== 'waiting_for_answer' || !currentQuestion) {
    return null
  }

  return (
    <div className="question-bubble-container">
      <div className="question-bubble">
        <div className="question-bubble-avatar">🍋</div>
        <div className="question-bubble-text">{currentQuestion}</div>
      </div>
    </div>
  )
}
