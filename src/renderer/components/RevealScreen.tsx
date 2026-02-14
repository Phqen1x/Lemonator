import { useGameState } from '../context/GameContext'

interface Props {
  onConfirm: (correct: boolean) => void
  onReset: () => void
}

export default function RevealScreen({ onConfirm, onReset }: Props) {
  const { phase, finalGuess, currentImageUrl, isProcessing } = useGameState()

  if (phase === 'guessing') {
    return (
      <div className="reveal-screen">
        <div className="reveal-content">
          <h2>My guess is...</h2>
          <h1 className="reveal-guess">{finalGuess}</h1>
          {currentImageUrl && (
            <img src={currentImageUrl} alt="Character" className="reveal-image" />
          )}
          <p>Am I right?</p>
          <div className="reveal-buttons">
            <button className="answer-btn btn-yes" onClick={() => onConfirm(true)}>
              Yes!
            </button>
            <button className="answer-btn btn-no" onClick={() => onConfirm(false)}>
              No, keep trying
            </button>
          </div>
        </div>
      </div>
    )
  }

  if (phase === 'revealed' || phase === 'hero_render') {
    return (
      <div className="reveal-screen">
        <div className="reveal-content">
          {isProcessing ? (
            <p className="reveal-rendering">Creating hero render...</p>
          ) : (
            <>
              <h2>I knew it!</h2>
              <h1 className="reveal-guess">{finalGuess}</h1>
              {currentImageUrl && (
                <img src={currentImageUrl} alt="Hero render" className="reveal-image hero-image" />
              )}
              <button className="start-button" onClick={onReset}>
                Play Again
              </button>
            </>
          )}
        </div>
      </div>
    )
  }

  return null
}
