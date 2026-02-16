import { useGameState } from '../context/GameContext'

export default function QuestionBubble() {
  const { currentQuestion, phase } = useGameState()

  // Show question during asking and waiting phases
  if ((phase !== 'asking' && phase !== 'waiting_for_answer') || !currentQuestion) {
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
