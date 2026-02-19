interface NewGameButtonProps {
  onNewGame: () => void
}

export default function NewGameButton({ onNewGame }: NewGameButtonProps) {
  return (
    <div className="new-game-button-container">
      <button className="new-game-button" onClick={onNewGame}>
        🔄 Give Up / New Game
      </button>
    </div>
  )
}
