import { useGameState } from '../context/GameContext'

export default function Canvas() {
  const { currentImageUrl, isProcessing } = useGameState()

  return (
    <div className="canvas-container">
      <div className={`canvas-frame ${isProcessing ? 'canvas-loading' : ''}`}>
        {currentImageUrl ? (
          <img src={currentImageUrl} alt="Character sketch" className="canvas-image" />
        ) : (
          <div className="canvas-placeholder">
            <div className="canvas-silhouette" />
            <span>Awaiting vision...</span>
          </div>
        )}
      </div>
    </div>
  )
}
