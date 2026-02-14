import { GameProvider, useGameState } from './context/GameContext'
import { useGameLoop } from './hooks/useGameLoop'
import { useLemonadeHealth } from './hooks/useLemonadeHealth'
import Canvas from './components/Canvas'
import ChatLog from './components/ChatLog'
import DetectiveBrain from './components/DetectiveBrain'
import AnswerButtons from './components/AnswerButtons'
import StartScreen from './components/StartScreen'
import RevealScreen from './components/RevealScreen'
import StatusBar from './components/StatusBar'

function GameApp() {
  const state = useGameState()
  const { startGame, submitAnswer, confirmGuess, resetGame } = useGameLoop()
  const { isConnected } = useLemonadeHealth()

  const showReveal = state.phase === 'guessing' || state.phase === 'revealed' || state.phase === 'hero_render'
  const showGame = state.phase !== 'idle'

  return (
    <>
      {!showGame ? (
        <StartScreen onStart={startGame} isConnected={isConnected} />
      ) : (
        <div className="app-layout">
          <div className="sidebar">
            <DetectiveBrain />
          </div>
          <div className="center-column">
            <Canvas />
            <AnswerButtons onAnswer={submitAnswer} />
          </div>
          <div className="chat-column">
            <ChatLog />
          </div>
        </div>
      )}

      {showReveal && (
        <RevealScreen onConfirm={confirmGuess} onReset={resetGame} />
      )}

      <StatusBar isConnected={isConnected} />
    </>
  )
}

export default function App() {
  return (
    <GameProvider>
      <GameApp />
    </GameProvider>
  )
}
