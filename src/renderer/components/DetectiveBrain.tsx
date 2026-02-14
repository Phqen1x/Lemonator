import { useGameState } from '../context/GameContext'

export default function DetectiveBrain() {
  const { topGuesses, traits, turn } = useGameState()

  return (
    <div className="detective-brain">
      <h3 className="brain-title">Detective's Brain</h3>

      <div className="brain-section">
        <h4>Top Guesses</h4>
        {topGuesses.length > 0 ? (
          <ol className="guess-list">
            {topGuesses.slice(0, 3).map((g, i) => (
              <li key={i} className="guess-item">
                <span className="guess-name">{g.name}</span>
                <span className="guess-confidence">
                  <span className="guess-confidence-text">{Math.round(g.confidence * 100)}%</span>
                  <div className="confidence-bar-track">
                    <div
                      className="confidence-bar"
                      style={{ width: `${Math.round(g.confidence * 100)}%` }}
                    />
                  </div>
                </span>
              </li>
            ))}
          </ol>
        ) : (
          <p className="brain-empty">Gathering clues...</p>
        )}
      </div>

      <div className="brain-section">
        <h4>Confirmed Traits ({traits.length})</h4>
        <div className="trait-list">
          {traits.map((t, i) => (
            <span key={i} className="trait-tag" title={`Added turn ${t.turnAdded}`}>
              {t.key}: {t.value}
            </span>
          ))}
          {traits.length === 0 && <p className="brain-empty">No traits yet</p>}
        </div>
      </div>

      <div className="brain-section">
        <div className="turn-counter">Turn {turn}</div>
      </div>
    </div>
  )
}
