import { createContext, useContext, useReducer, type Dispatch, type ReactNode } from 'react'
import type { GameState, GameAction, Trait } from '../types/game'

const initialState: GameState = {
  phase: 'idle',
  turn: 0,
  traits: [],
  turns: [],
  currentQuestion: null,
  topGuesses: [],
  rejectedGuesses: [],
  currentImageUrl: null,
  seed: Math.floor(Math.random() * 2147483647),
  finalGuess: null,
  error: null,
  isProcessing: false,
}

function mergeTraits(existing: Trait[], incoming: Trait[]): Trait[] {
  const merged = [...existing]
  for (const trait of incoming) {
    const idx = merged.findIndex(t => t.key === trait.key)
    if (idx >= 0) {
      merged[idx] = trait
    } else {
      merged.push(trait)
    }
  }
  return merged
}

function gameReducer(state: GameState, action: GameAction): GameState {
  switch (action.type) {
    case 'START_GAME':
      return {
        ...initialState,
        phase: 'processing',
        seed: Math.floor(Math.random() * 2147483647),
        isProcessing: true,
      }

    case 'SET_QUESTION':
      // Detective returned a new question — show it, advance turn, merge traits
      return {
        ...state,
        phase: 'waiting_for_answer',
        turn: state.turn + 1,
        currentQuestion: action.question,
        topGuesses: action.guesses,
        traits: mergeTraits(state.traits, action.traits),
        isProcessing: false,
      }

    case 'SUBMIT_ANSWER':
      // Record the completed Q&A turn, then go to processing
      return {
        ...state,
        phase: 'processing',
        isProcessing: true,
        turns: [
          ...state.turns,
          {
            turnNumber: state.turn,
            question: state.currentQuestion || '',
            answer: action.answer,
            newTraits: [],
            topGuesses: state.topGuesses,
            imageUrl: state.currentImageUrl,
          },
        ],
      }

    case 'UPDATE_IMAGE':
      // Background image gen completed
      return {
        ...state,
        currentImageUrl: action.imageUrl,
      }

    case 'MAKE_GUESS':
      return {
        ...state,
        phase: 'guessing',
        finalGuess: action.guess,
        isProcessing: false,
      }

    case 'CONFIRM_GUESS':
      if (action.correct) {
        return { ...state, phase: 'revealed', isProcessing: true }
      }
      return {
        ...state,
        phase: 'processing',
        isProcessing: true,
        rejectedGuesses: state.finalGuess
          ? [...state.rejectedGuesses, state.finalGuess]
          : state.rejectedGuesses,
      }

    case 'HERO_RENDER_COMPLETE':
      return {
        ...state,
        phase: 'hero_render',
        currentImageUrl: action.imageUrl,
        isProcessing: false,
      }

    case 'SET_ERROR':
      return { ...state, error: action.error, isProcessing: false }

    case 'CLEAR_ERROR':
      return { ...state, error: null }

    case 'RESET':
      return initialState

    default:
      return state
  }
}

const GameContext = createContext<GameState>(initialState)
const GameDispatchContext = createContext<Dispatch<GameAction>>(() => {})

export function GameProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(gameReducer, initialState)
  return (
    <GameContext.Provider value={state}>
      <GameDispatchContext.Provider value={dispatch}>
        {children}
      </GameDispatchContext.Provider>
    </GameContext.Provider>
  )
}

export function useGameState() {
  return useContext(GameContext)
}

export function useGameDispatch() {
  return useContext(GameDispatchContext)
}
