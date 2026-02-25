import { GameProvider, useGameState } from './context/GameContext'
import { useGameLoop } from './hooks/useGameLoop'
import { useLemonadeHealth } from './hooks/useLemonadeHealth'
import { useLemonadeVoice } from './hooks/useLemonadeVoice'
import Canvas from './components/Canvas'
import ChatLog from './components/ChatLog'
import DetectiveBrain from './components/DetectiveBrain'
import AnswerButtons from './components/AnswerButtons'
import StartScreen from './components/StartScreen'
import RevealScreen from './components/RevealScreen'
import StatusBar from './components/StatusBar'
import TitleBar from './components/TitleBar'
import QuestionBubble from './components/QuestionBubble'
import NewGameButton from './components/NewGameButton'

function GameApp() {
  const state = useGameState()
  const { startGame, submitAnswer, confirmGuess, resetGame } = useGameLoop()
  const { isConnected } = useLemonadeHealth()
  useLemonadeVoice(state)

  const showReveal = state.phase === 'guessing' || state.phase === 'revealed' || state.phase === 'hero_render'
  const showGame = state.phase !== 'idle'

  return (
    <>
      <TitleBar />
      {!showGame ? (
        <StartScreen onStart={startGame} isConnected={isConnected} />
      ) : (
        <div className="app-layout">
          <div className="sidebar">
            <DetectiveBrain />
          </div>
          <div className="center-column">
            <QuestionBubble />
            <AnswerButtons onAnswer={submitAnswer} />
            <Canvas />
            <NewGameButton onNewGame={resetGame} />
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
