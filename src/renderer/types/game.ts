export type GamePhase =
  | 'idle'
  | 'asking'
  | 'waiting_for_answer'
  | 'processing'
  | 'guessing'
  | 'revealed'
  | 'hero_render'

export type AnswerValue = 'yes' | 'no' | 'probably' | 'probably_not' | 'dont_know'

export interface Trait {
  key: string
  value: string
  confidence: number
  turnAdded: number
}

export interface Guess {
  name: string
  confidence: number
}

export interface TurnRecord {
  turnNumber: number
  question: string
  answer: AnswerValue
  newTraits: Trait[]
  topGuesses: Guess[]
  imageUrl: string | null
}

export interface GameState {
  phase: GamePhase
  turn: number
  traits: Trait[]
  turns: TurnRecord[]
  currentQuestion: string | null
  topGuesses: Guess[]
  rejectedGuesses: string[]
  currentImageUrl: string | null
  seed: number
  finalGuess: string | null
  error: string | null
  isProcessing: boolean
}

export type GameAction =
  | { type: 'START_GAME' }
  | { type: 'SET_QUESTION'; question: string; guesses: Guess[]; traits: Trait[] }
  | { type: 'SUBMIT_ANSWER'; answer: AnswerValue }
  | { type: 'UPDATE_IMAGE'; imageUrl: string }
  | { type: 'MAKE_GUESS'; guess: string }
  | { type: 'CONFIRM_GUESS'; correct: boolean }
  | { type: 'HERO_RENDER_COMPLETE'; imageUrl: string }
  | { type: 'SET_ERROR'; error: string }
  | { type: 'CLEAR_ERROR' }
  | { type: 'RESET' }
