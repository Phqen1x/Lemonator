import { useEffect, useRef } from 'react'
import { textToSpeech } from '../services/lemonade'
import type { GameState } from '../types/game'
import type { AnswerValue } from '../types/game'

// ── Voice lines ───────────────────────────────────────────────────────────────

const REACTIONS: Record<AnswerValue, string[]> = {
  yes: [
    "Aha! Yes! A vital clue!",
    "Of course! Just as I suspected.",
    "Excellent. The picture is becoming clearer.",
    "Perfect. That narrows things down considerably.",
    "I knew it! My citrus instincts were right.",
    "Splendid! Very helpful indeed.",
    "Yes! This is very revealing.",
  ],
  no: [
    "No? Interesting. Back to the drawing board.",
    "Hmm. That rules out quite a few suspects.",
    "Ah, not that. Noted. Adjusting my theory.",
    "Very well. That eliminates some possibilities.",
    "No! Fascinating. This changes things.",
    "I see. Crossing that off my list.",
  ],
  probably: [
    "Probably? How delightfully ambiguous. I will count that as a leaning yes.",
    "Ah, probably... uncertainty noted. I will factor it in.",
    "Almost certainly. My confidence is rising.",
    "Probably! Intriguing. Very intriguing.",
  ],
  probably_not: [
    "Probably not? Leaning no, then. Interesting.",
    "Almost a no. Adjusting my calculations.",
    "Hmm. Not definitively no, but close enough.",
    "Probably not... my theory shifts accordingly.",
  ],
  dont_know: [
    "You do not know? A mystery within a mystery!",
    "Curious! Even you do not know. No matter, I will work with what I have.",
    "Unknown? Fascinating. I will account for the ambiguity.",
    "Hmm. Uncertain answer. The plot thickens.",
  ],
}

const PROCESSING_COMMENTARY = [
  "Hmm... let me think about that.",
  "Interesting. Very interesting.",
  "Cross-referencing my knowledge base...",
  "I am analyzing the possibilities.",
  "The clues are forming a picture.",
  "I can almost taste the answer.",
  "Running through my suspects...",
  "Getting warmer. Definitely getting warmer.",
  "This narrows it down considerably.",
  "Consulting my inner lemon...",
  "Do not rush me. I am detecting.",
  "The answer is in here somewhere. I can feel it.",
  "Hmm... the evidence points in a fascinating direction.",
  "Give me just a moment more.",
  "My deductive powers are at work.",
  "Every clue brings me closer...",
]

const GAME_START_LINES = [
  "Hmm! Think of a character. Detective Lemonade is on the case!",
  "Ready! Think of your character and let the investigation begin.",
  "Excellent! Picture someone in your mind and I shall deduce who it is.",
]

const GUESS_PREFIXES = [
  "I have got it! I believe you are thinking of",
  "Elementary! It must be",
  "Eureka! It can only be",
  "After careful analysis, my answer is",
  "My citrus intuition has spoken. You are thinking of",
]

const REJECTION_REACTIONS = [
  "Hmm! Not quite. Let me reconsider my theory...",
  "Not that one? Fascinating. Back to the drawing board.",
  "Incorrect? Interesting. I shall recalibrate.",
]

function pickRandom<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)]
}

// ── Playback state (module-level so it survives re-renders) ───────────────────

let currentAudio: HTMLAudioElement | null = null
let currentBlobUrl: string | null = null
let currentAbortController: AbortController | null = null

function interruptSpeech(): void {
  // Cancel any in-flight TTS request
  if (currentAbortController) {
    currentAbortController.abort()
    currentAbortController = null
  }
  // Stop any currently playing audio
  if (currentAudio) {
    currentAudio.pause()
    currentAudio.src = ''
    currentAudio = null
  }
  if (currentBlobUrl) {
    URL.revokeObjectURL(currentBlobUrl)
    currentBlobUrl = null
  }
}

/**
 * Sends text to the Kokoro TTS endpoint, then plays the returned MP3.
 * Calls `onEnd` when playback finishes (or on error, so callers never get stuck).
 * If interrupted via `interruptSpeech()` before the fetch returns, the abort
 * signal cancels the request and `onEnd` is NOT called (caller checks the ref).
 */
function speakText(text: string, onEnd?: () => void): void {
  interruptSpeech()

  const controller = new AbortController()
  currentAbortController = controller

  console.info(`[Voice] → "${text.slice(0, 70)}${text.length > 70 ? '...' : ''}"`)

  textToSpeech(text, controller.signal)
    .then(buffer => {
      // If we were interrupted while waiting for the server, do nothing
      if (controller.signal.aborted) return

      currentAbortController = null

      const blob = new Blob([buffer], { type: 'audio/mpeg' })
      const url = URL.createObjectURL(blob)
      currentBlobUrl = url

      const audio = new Audio(url)
      currentAudio = audio

      const cleanup = () => {
        if (currentBlobUrl === url) {
          URL.revokeObjectURL(url)
          currentBlobUrl = null
        }
        if (currentAudio === audio) currentAudio = null
      }

      audio.onended = () => {
        cleanup()
        onEnd?.()
      }
      audio.onerror = (e) => {
        console.error('[Voice] Audio playback error:', e)
        cleanup()
        onEnd?.()  // still call onEnd so commentary loop continues
      }

      audio.play().catch(e => {
        console.error('[Voice] audio.play() failed:', e)
        cleanup()
        onEnd?.()
      })
    })
    .catch(e => {
      if (e instanceof Error && e.name === 'AbortError') return  // normal interrupt
      console.error('[Voice] TTS request failed:', e)
      onEnd?.()  // keep the game moving even if TTS is down
    })
}

// ── Hook ──────────────────────────────────────────────────────────────────────

export function useLemonadeVoice(state: GameState): void {
  const prevPhaseRef = useRef(state.phase)
  const prevQuestionRef = useRef<string | null>(null)

  const isProcessingRef = useRef(false)
  const commentaryIndexRef = useRef(0)
  const commentaryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Stable ref to recursive schedule function
  const scheduleCommentaryRef = useRef<() => void>(() => {})
  scheduleCommentaryRef.current = () => {
    if (commentaryTimerRef.current !== null) clearTimeout(commentaryTimerRef.current)
    const delay = 3800 + Math.random() * 2500  // 3.8–6.3 s between lines
    commentaryTimerRef.current = setTimeout(() => {
      commentaryTimerRef.current = null
      if (!isProcessingRef.current) return
      const line = PROCESSING_COMMENTARY[commentaryIndexRef.current % PROCESSING_COMMENTARY.length]
      commentaryIndexRef.current++
      speakText(line, () => {
        if (isProcessingRef.current) scheduleCommentaryRef.current()
      })
    }, delay)
  }

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (commentaryTimerRef.current !== null) clearTimeout(commentaryTimerRef.current)
      interruptSpeech()
    }
  }, [])

  // React to phase / question / answer / guess changes
  useEffect(() => {
    const { phase, currentQuestion, lastAnswer, finalGuess } = state
    const prevPhase = prevPhaseRef.current
    prevPhaseRef.current = phase

    const clearCommentary = () => {
      if (commentaryTimerRef.current !== null) {
        clearTimeout(commentaryTimerRef.current)
        commentaryTimerRef.current = null
      }
    }

    // ── Game just started (idle → processing) ────────────────────────────────
    if (phase === 'processing' && prevPhase === 'idle') {
      isProcessingRef.current = true
      speakText(pickRandom(GAME_START_LINES), () => {
        if (isProcessingRef.current) scheduleCommentaryRef.current()
      })
      return
    }

    // ── User answered a question (waiting_for_answer → processing) ───────────
    if (phase === 'processing' && prevPhase === 'waiting_for_answer') {
      isProcessingRef.current = true
      clearCommentary()
      interruptSpeech()  // Cut off question being read
      const reactions = lastAnswer ? REACTIONS[lastAnswer] : null
      const reactionLine = reactions ? pickRandom(reactions) : "Hmm, interesting..."
      speakText(reactionLine, () => {
        if (isProcessingRef.current) scheduleCommentaryRef.current()
      })
      return
    }

    // ── Guess rejected, back to processing (guessing → processing) ───────────
    if (phase === 'processing' && prevPhase === 'guessing') {
      isProcessingRef.current = true
      clearCommentary()
      interruptSpeech()
      speakText(pickRandom(REJECTION_REACTIONS), () => {
        if (isProcessingRef.current) scheduleCommentaryRef.current()
      })
      return
    }

    // ── New question arrived (→ waiting_for_answer) ───────────────────────────
    if (
      phase === 'waiting_for_answer' &&
      currentQuestion &&
      currentQuestion !== prevQuestionRef.current
    ) {
      prevQuestionRef.current = currentQuestion
      isProcessingRef.current = false
      clearCommentary()
      speakText(currentQuestion)  // interruptSpeech() called inside speakText
      return
    }

    // ── Guess announced (→ guessing) ─────────────────────────────────────────
    if (phase === 'guessing' && finalGuess && prevPhase !== 'guessing') {
      isProcessingRef.current = false
      clearCommentary()
      interruptSpeech()
      speakText(`${pickRandom(GUESS_PREFIXES)}... ${finalGuess}!`)
      return
    }

    // ── Reset ─────────────────────────────────────────────────────────────────
    if (phase === 'idle') {
      isProcessingRef.current = false
      clearCommentary()
      interruptSpeech()
    }
  }, [state.phase, state.currentQuestion, state.lastAnswer, state.finalGuess]) // eslint-disable-line react-hooks/exhaustive-deps
}
