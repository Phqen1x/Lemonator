import { useGameState } from '../store/gameStore'

export default function QuestionBubble() {
  const { currentQuestion, phase } = useGameState()

  if (phase !== 'playing' || !currentQuestion) {
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
