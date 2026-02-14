import { useGameState } from '../context/GameContext'
import type { AnswerValue } from '../types/game'

const ANSWERS: Array<{ value: AnswerValue; label: string; className: string }> = [
  { value: 'yes', label: 'Yes', className: 'btn-yes' },
  { value: 'no', label: 'No', className: 'btn-no' },
  { value: 'probably', label: 'Probably', className: 'btn-maybe' },
  { value: 'probably_not', label: 'Probably Not', className: 'btn-maybe' },
  { value: 'dont_know', label: "Don't Know", className: 'btn-neutral' },
]

interface Props {
  onAnswer: (answer: AnswerValue) => void
}

export default function AnswerButtons({ onAnswer }: Props) {
  const { phase, isProcessing } = useGameState()
  const disabled = phase !== 'waiting_for_answer' || isProcessing

  return (
    <div className="answer-buttons">
      {ANSWERS.map(a => (
        <button
          key={a.value}
          className={`answer-btn ${a.className}`}
          disabled={disabled}
          onClick={() => onAnswer(a.value)}
        >
          {a.label}
        </button>
      ))}
    </div>
  )
}
