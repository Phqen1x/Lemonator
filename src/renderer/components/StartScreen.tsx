interface Props {
  onStart: () => void
  isConnected: boolean
}

export default function StartScreen({ onStart, isConnected }: Props) {
  return (
    <div className="start-screen">
      <div className="start-content">
        <h1 className="start-title">Akinator's Canvas</h1>
        <p className="start-subtitle">Think of any character — real or fictional.</p>
        <p className="start-description">
          I'll ask you questions and sketch what I think your character looks like,
          refining my drawing with each answer until I guess who it is.
        </p>
        <button
          className="start-button"
          onClick={onStart}
          disabled={!isConnected}
        >
          {isConnected ? 'Start Game' : 'Connecting to Lemonade...'}
        </button>
        {!isConnected && (
          <p className="start-warning">
            Waiting for Lemonade SDK at localhost:8000
          </p>
        )}
      </div>
    </div>
  )
}
