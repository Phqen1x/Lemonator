import { useGameState } from '../context/GameContext'

interface Props {
  isConnected: boolean
}

export default function StatusBar({ isConnected }: Props) {
  const { turn, isProcessing, error } = useGameState()

  return (
    <div className="status-bar">
      <div className="status-left">
        <span className={`status-dot ${isConnected ? 'connected' : 'disconnected'}`} />
        <span>{isConnected ? 'Lemonade Online' : 'Disconnected'}</span>
      </div>
      <div className="status-center">
        {isProcessing && <span className="status-processing">Thinking...</span>}
        {error && <span className="status-error">{error}</span>}
      </div>
      <div className="status-right">
        Turn {turn}
      </div>
    </div>
  )
}
