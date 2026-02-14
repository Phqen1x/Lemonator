import { useRef, useEffect } from 'react'
import { useGameState } from '../context/GameContext'

export default function ChatLog() {
  const { turns, currentQuestion, phase } = useGameState()
  const bottomRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [turns.length, currentQuestion])

  return (
    <div className="chatlog">
      <h3 className="chatlog-title">Investigation Log</h3>
      <div className="chatlog-messages">
        {turns.map((t, i) => (
          <div key={i} className="chatlog-turn">
            <div className="chatlog-question">
              <span className="chatlog-label">Q{t.turnNumber}:</span> {t.question}
            </div>
            <div className="chatlog-answer">
              <span className="chatlog-label">A:</span>{' '}
              <span className={`answer-tag answer-${t.answer}`}>
                {t.answer.replace('_', ' ')}
              </span>
            </div>
          </div>
        ))}
        {currentQuestion && phase === 'waiting_for_answer' && (
          <div className="chatlog-turn chatlog-current">
            <div className="chatlog-question">
              <span className="chatlog-label">Q{turns.length + 1}:</span> {currentQuestion}
            </div>
          </div>
        )}
        <div ref={bottomRef} />
      </div>
    </div>
  )
}
