import { useCallback, useRef } from 'react'
import { useGameState, useGameDispatch } from '../context/GameContext'
import { askDetective } from '../services/detective'
import { buildImagePrompt } from '../services/visualist'
import { renderImage, renderHeroImage } from '../services/artist'
import { CONFIDENCE_THRESHOLD } from '../../shared/constants'
import type { AnswerValue, Trait } from '../types/game'

export function useGameLoop() {
  const state = useGameState()
  const dispatch = useGameDispatch()
  const stateRef = useRef(state)
  stateRef.current = state

  const generateImageInBackground = useCallback((traits: Trait[], turn: number, seed: number) => {
    ;(async () => {
      try {
        const prompt = buildImagePrompt(traits, turn)
        const imageUrl = await renderImage(prompt, seed, turn)
        dispatch({ type: 'UPDATE_IMAGE', imageUrl })
      } catch (e) {
        console.warn('Image generation failed:', e)
      }
    })()
  }, [dispatch])

  const startGame = useCallback(async () => {
    dispatch({ type: 'START_GAME' })
    try {
      const { question, newTraits, topGuesses } = await askDetective([], [], 1, [])
      dispatch({ type: 'SET_QUESTION', question, guesses: topGuesses, traits: newTraits })

      const s = stateRef.current
      generateImageInBackground(newTraits, 0, s.seed)
    } catch (e) {
      dispatch({ type: 'SET_ERROR', error: e instanceof Error ? e.message : 'Failed to start game' })
    }
  }, [dispatch, generateImageInBackground])

  const submitAnswer = useCallback(async (answer: AnswerValue) => {
    const s = stateRef.current
    dispatch({ type: 'SUBMIT_ANSWER', answer })

    try {
      const turnHistory = [
        ...s.turns.map(t => ({ question: t.question, answer: t.answer })),
      ]
      if (s.currentQuestion) {
        turnHistory.push({ question: s.currentQuestion, answer })
      }

      const { question, newTraits, topGuesses } = await askDetective(
        s.traits,
        turnHistory,
        s.turn + 1,
        s.rejectedGuesses,
      )

      const topGuess = topGuesses[0]
      if (topGuess && topGuess.confidence >= CONFIDENCE_THRESHOLD) {
        dispatch({ type: 'SET_QUESTION', question, guesses: topGuesses, traits: newTraits })
        dispatch({ type: 'MAKE_GUESS', guess: topGuess.name })
        return
      }

      dispatch({ type: 'SET_QUESTION', question, guesses: topGuesses, traits: newTraits })

      const allTraits = [...s.traits, ...newTraits]
      generateImageInBackground(allTraits, s.turn + 1, s.seed)
    } catch (e) {
      dispatch({ type: 'SET_ERROR', error: e instanceof Error ? e.message : 'Detective failed' })
    }
  }, [dispatch, generateImageInBackground])

  const confirmGuess = useCallback(async (correct: boolean) => {
    const s = stateRef.current
    dispatch({ type: 'CONFIRM_GUESS', correct })

    if (correct) {
      try {
        const prompt = buildImagePrompt(s.traits, 20)
        const heroUrl = await renderHeroImage(prompt, s.seed)
        dispatch({ type: 'HERO_RENDER_COMPLETE', imageUrl: heroUrl })
      } catch {
        dispatch({ type: 'HERO_RENDER_COMPLETE', imageUrl: s.currentImageUrl || '' })
      }
    } else {
      // After rejection, rejectedGuesses is updated in reducer
      const rejected = s.finalGuess
        ? [...s.rejectedGuesses, s.finalGuess]
        : s.rejectedGuesses
      try {
        const turnHistory = s.turns.map(t => ({ question: t.question, answer: t.answer }))
        const { question, newTraits, topGuesses } = await askDetective(
          s.traits, turnHistory, s.turn + 1, rejected,
        )
        dispatch({ type: 'SET_QUESTION', question, guesses: topGuesses, traits: newTraits })
      } catch (e) {
        dispatch({ type: 'SET_ERROR', error: e instanceof Error ? e.message : 'Detective failed' })
      }
    }
  }, [dispatch, generateImageInBackground])

  const resetGame = useCallback(() => {
    dispatch({ type: 'RESET' })
  }, [dispatch])

  return { startGame, submitAnswer, confirmGuess, resetGame }
}
