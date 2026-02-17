import { useCallback, useRef } from 'react'
import { useGameState, useGameDispatch } from '../context/GameContext'
import { askDetective, recordRejectedGuess, recordAmbiguousQuestion, resetSessionLearning } from '../services/detective-rag'
import { buildHeroImagePrompt } from '../services/visualist'
import { getCharacterReferenceImage } from '../services/image-search'
import { renderCaricature, renderSimplePortrait } from '../services/artist'
import { CONFIDENCE_THRESHOLD, ENABLE_IMAGE_GENERATION } from '../../shared/constants'
import type { AnswerValue, Trait } from '../types/game'

export function useGameLoop() {
  const state = useGameState()
  const dispatch = useGameDispatch()
  const stateRef = useRef(state)
  stateRef.current = state

  // Mid-game image generation: Simple text-to-image portrait (fast)
  // Returns a Promise so caller can await if desired
  const generateImageInBackground = useCallback(async (topGuesses: Array<{name: string, confidence: number}>, traits: Trait[], turn: number, seed: number): Promise<void> => {
    if (!ENABLE_IMAGE_GENERATION) {
      console.info('[GameLoop] Image generation disabled')
      return
    }
    
    // Need at least one guess with reasonable confidence
    if (!topGuesses || topGuesses.length === 0 || topGuesses[0].confidence < 0.3) {
      console.info('[GameLoop] No strong guess yet, skipping image update')
      return
    }
    
    const topGuess = topGuesses[0]
    console.info(`[GameLoop] Generating portrait for top guess: ${topGuess.name} (${Math.round(topGuess.confidence * 100)}%)`)
    
    try {
      // Build appearance details
      const appearanceDetails = buildHeroImagePrompt(topGuess.name, traits)
      
      // Generate simple portrait (fast, no img2img)
      const imageUrl = await renderSimplePortrait(topGuess.name, seed + turn * 1000, appearanceDetails)
      dispatch({ type: 'UPDATE_IMAGE', imageUrl })
    } catch (e) {
      console.warn('Mid-game portrait generation failed:', e)
      // Don't show error to user - mid-game images are optional
    }
  }, [dispatch])

  const startGame = useCallback(async () => {
    resetSessionLearning() // Reset learning for new game
    dispatch({ type: 'START_GAME' })
    try {
      const { question, newTraits, topGuesses } = await askDetective([], [], 1, [])
      
      // Check if first question is somehow a guess (very unlikely but handle it)
      const guessMatch = question.match(/^Is your character (.+)\?$/i)
      const guessName = guessMatch?.[1]?.trim()
      const traitKeywords = [
        'american', 'british', 'male', 'female', 'fictional', 'real', 'an actor', 'an athlete',
        'a musician', 'a politician', 'a superhero', 'a villain', 'from a', 'from an', 'from the',
        'known for', 'alive', 'dead', 'still alive', 'well-known', 'famous',
      ]
      const isCharacterGuessQuestion = guessName && !traitKeywords.some(kw => guessName.toLowerCase().includes(kw))

      if (isCharacterGuessQuestion && guessName) {
        console.log(`[UI] 🎯 Turn 1: GUESS ON FIRST TURN - "${question}" → Guessing: ${guessName}`)
        dispatch({ type: 'MAKE_GUESS', guess: guessName })
        const s = stateRef.current
        const appearanceDetails = buildHeroImagePrompt(guessName, newTraits)
        renderSimplePortrait(guessName, s.seed, appearanceDetails)
          .then(heroUrl => {
            dispatch({ type: 'UPDATE_IMAGE', imageUrl: heroUrl })
          })
          .catch(error => {
            console.warn('[GameLoop] Character render failed:', error)
          })
      } else {
        dispatch({ type: 'SET_QUESTION', question, guesses: topGuesses, traits: newTraits })
        const s = stateRef.current
        // Try to generate image for initial top guess
        generateImageInBackground(topGuesses, newTraits, 1, s.seed)
      }
    } catch (e) {
      dispatch({ type: 'SET_ERROR', error: e instanceof Error ? e.message : 'Failed to start game' })
    }
  }, [dispatch, generateImageInBackground])

  const submitAnswer = useCallback(async (answer: AnswerValue) => {
    const s = stateRef.current
    
    // Validate current state
    if (!s.currentQuestion) {
      console.error('[GameLoop] No current question to answer')
      return
    }
    
    // Track ambiguous questions (user doesn't know the answer)
    if (answer === 'dont_know') {
      recordAmbiguousQuestion(s.currentQuestion, s.turn)
    }

    // Dispatch to update state - this adds the current turn to state.turns
    dispatch({ type: 'SUBMIT_ANSWER', answer })

    try {
      // Build turn history: Include the current turn that was just answered
      // s.turns has all PREVIOUS turns, we need to add the current one
      const turnHistory = [
        ...s.turns.map(t => ({ question: t.question, answer: t.answer })),
        { question: s.currentQuestion, answer }
      ]
      
      console.log(`[GameLoop] Calling askDetective with turn history (${turnHistory.length} items):`, 
                  turnHistory.map(t => t.question).slice(-3))  // Show last 3
      console.log(`[GameLoop] Latest turn: "${s.currentQuestion}" -> ${answer}`)

      const { question, newTraits, topGuesses } = await askDetective(
        s.traits,
        turnHistory,  // All turns INCLUDING the one just answered
        s.turn + 1,
        s.rejectedGuesses
        // Don't pass previousQuestion/answer separately - it's in turnHistory now
      )

      // Log UI state updates
      if (newTraits.length > 0) {
        console.log(`[UI] ✅ Turn ${s.turn + 1}: Added ${newTraits.length} new trait(s):`)
        newTraits.forEach(t => {
          console.log(`[UI]   - ${t.key} = ${t.value} (confidence: ${Math.round(t.confidence * 100)}%)`)
        })
      }

      const topGuess = topGuesses[0]

      // Detect if the returned "question" is actually a character guess
      // Pattern: "Is your character [Name]?" where Name is not a trait keyword
      const guessMatch = question.match(/^Is your character (.+)\?$/i)
      const guessName = guessMatch?.[1]?.trim()
      const traitKeywords = [
        'american', 'male', 'female', 'fictional', 'real',
        'an actor', 'an athlete', 'a musician', 'a politician', 'a superhero',
        'from a', 'from an', 'from the', 'known for', 'alive', 'dead', 'still alive',
        'a villain', 'a hero', 'a leader', 'in a band', 'a rapper',
        'well-known', 'internationally', 'primarily', 'associated with', 'part of',
        'historical', 'a historical', 'figure', 'person', 'individual',
        'someone', 'anybody', 'character who', 'character that',
        'active', 'famous', 'known', 'celebrated', 'renowned',
      ]
      const isCharacterGuessQuestion = guessName && !traitKeywords.some(kw => guessName.toLowerCase().includes(kw))

      if (isCharacterGuessQuestion && guessName) {
        // Make the guess FIRST, then generate portrait in background
        console.log(`[UI] 🎯 Turn ${s.turn + 1}: GUESS DETECTED - "${question}" → Guessing: ${guessName}`)
        
        // Show guess dialog immediately
        dispatch({ type: 'MAKE_GUESS', guess: guessName })
        
        // Generate portrait in background (non-blocking)
        console.info('[GameLoop] Creating character render in background...')
        const appearanceDetails = buildHeroImagePrompt(guessName, [...s.traits, ...newTraits])
        renderSimplePortrait(guessName, s.seed, appearanceDetails)
          .then(heroUrl => {
            dispatch({ type: 'UPDATE_IMAGE', imageUrl: heroUrl })
            console.info('[GameLoop] ✓ Character render complete')
          })
          .catch(error => {
            console.warn('[GameLoop] Character render failed:', error)
          })
        
        return
      }

      if (topGuess && topGuess.confidence >= CONFIDENCE_THRESHOLD) {
        // Make the guess FIRST, then generate portrait in background
        console.log(`[UI] 🎯 Turn ${s.turn + 1}: HIGH CONFIDENCE GUESS - Guessing: ${topGuess.name} (${Math.round(topGuess.confidence * 100)}%)`)
        
        // Show guess dialog immediately
        dispatch({ type: 'MAKE_GUESS', guess: topGuess.name })
        
        // Generate portrait in background (non-blocking)
        console.info('[GameLoop] Creating character render in background...')
        const appearanceDetails = buildHeroImagePrompt(topGuess.name, [...s.traits, ...newTraits])
        renderSimplePortrait(topGuess.name, s.seed, appearanceDetails)
          .then(heroUrl => {
            dispatch({ type: 'UPDATE_IMAGE', imageUrl: heroUrl })
            console.info('[GameLoop] ✓ Character render complete')
          })
          .catch(error => {
            console.warn('[GameLoop] Character render failed:', error)
          })
        
        return
      }

      dispatch({ type: 'SET_QUESTION', question, guesses: topGuesses, traits: newTraits })

      // ============================================================
      // MID-GAME IMAGE GENERATION DISABLED
      // Uncomment below to re-enable portrait generation during game
      // ============================================================
      // Get fresh merged traits for image generation
      // const mergedTraits = [...s.traits, ...newTraits]
      // // Generate image in background (non-blocking - don't await)
      // generateImageInBackground(topGuesses, mergedTraits, s.turn + 1, s.seed)
      //   .catch(err => console.warn('[GameLoop] Background image generation failed (ignored):', err))
      // ============================================================
    } catch (e) {
      dispatch({ type: 'SET_ERROR', error: e instanceof Error ? e.message : 'Detective failed' })
    }
  }, [dispatch, generateImageInBackground])

  const confirmGuess = useCallback(async (correct: boolean) => {
    const s = stateRef.current
    dispatch({ type: 'CONFIRM_GUESS', correct })

    if (correct) {
      if (!ENABLE_IMAGE_GENERATION) {
        console.info('[GameLoop] Hero image generation disabled')
        dispatch({ type: 'HERO_RENDER_COMPLETE', imageUrl: '' })
      } else if (!s.finalGuess) {
        console.warn('[GameLoop] No final guess - skipping hero image')
        dispatch({ type: 'HERO_RENDER_COMPLETE', imageUrl: s.currentImageUrl || '' })
      } else {
        try {
          console.info('[GameLoop] ==========================================')
          console.info('[GameLoop] Creating character render for:', s.finalGuess)
          console.info('[GameLoop] ==========================================')
          
          // Build appearance description
          console.info('[GameLoop] Step 1: Building appearance description...')
          const appearanceDetails = buildHeroImagePrompt(s.finalGuess, s.traits)
          console.info('[GameLoop] Appearance:', appearanceDetails)
          
          // Try simple portrait first (fast)
          console.info('[GameLoop] Step 2: Generating portrait...')
          let heroUrl: string
          try {
            heroUrl = await renderSimplePortrait(s.finalGuess, s.seed, appearanceDetails)
            console.info('[GameLoop] ✓ Simple portrait generated')
          } catch (portraitError) {
            console.warn('[GameLoop] Simple portrait failed, trying caricature with reference...')
            
            // Fallback: Try img2img with reference image
            const referenceImage = await getCharacterReferenceImage(s.finalGuess)
            
            if (!referenceImage) {
              console.error('[GameLoop] ✗ No reference image found, using current image')
              dispatch({ type: 'HERO_RENDER_COMPLETE', imageUrl: s.currentImageUrl || '' })
              return
            }
            
            console.info('[GameLoop] ✓ Found reference image, generating caricature...')
            heroUrl = await renderCaricature(s.finalGuess, referenceImage, s.seed, appearanceDetails)
            console.info('[GameLoop] ✓ Caricature generated')
          }
          
          console.info('[GameLoop] ✓✓✓ SUCCESS: Character render complete!')
          console.info('[GameLoop] ==========================================')
          dispatch({ type: 'HERO_RENDER_COMPLETE', imageUrl: heroUrl })
        } catch (error) {
          console.error('[GameLoop] ✗✗✗ ERROR: Character render failed:', error)
          dispatch({ type: 'HERO_RENDER_COMPLETE', imageUrl: s.currentImageUrl || '' })
        }
      }
    } else {
      // Record rejection for learning
      if (s.finalGuess) {
        recordRejectedGuess(s.finalGuess, s.traits, s.turn)
      }

      // After rejection, rejectedGuesses is updated in reducer
      const rejected = s.finalGuess
        ? [...s.rejectedGuesses, s.finalGuess]
        : s.rejectedGuesses
      try {
        const turnHistory = s.turns.map(t => ({ question: t.question, answer: t.answer }))
        const { question, newTraits, topGuesses } = await askDetective(
          s.traits, turnHistory, s.turn + 1, rejected,
        )
        
        // CRITICAL: Check if the new question is also a guess!
        // This can happen when the AI narrows down to another character after rejection
        const guessMatch = question.match(/^Is your character (.+)\?$/i)
        const guessName = guessMatch?.[1]?.trim()
        const traitKeywords = [
          'american', 'british', 'male', 'female', 'fictional', 'real', 'an actor', 'an athlete',
          'a musician', 'a politician', 'a superhero', 'a villain', 'from a', 'from an', 'from the',
          'known for', 'alive', 'dead', 'still alive', 'well-known', 'famous',
        ]
        const isCharacterGuessQuestion = guessName && !traitKeywords.some(kw => guessName.toLowerCase().includes(kw))

        if (isCharacterGuessQuestion && guessName) {
          console.log(`[UI] 🎯 Turn ${s.turn + 1}: GUESS AFTER REJECTION - "${question}" → Guessing: ${guessName}`)
          dispatch({ type: 'MAKE_GUESS', guess: guessName })
          
          // Generate portrait in background
          const appearanceDetails = buildHeroImagePrompt(guessName, [...s.traits, ...newTraits])
          renderSimplePortrait(guessName, s.seed, appearanceDetails)
            .then(heroUrl => {
              dispatch({ type: 'UPDATE_IMAGE', imageUrl: heroUrl })
            })
            .catch(error => {
              console.warn('[GameLoop] Character render failed:', error)
            })
        } else {
          dispatch({ type: 'SET_QUESTION', question, guesses: topGuesses, traits: newTraits })
        }
      } catch (e) {
        dispatch({ type: 'SET_ERROR', error: e instanceof Error ? e.message : 'Detective failed' })
      }
    }
  }, [dispatch, generateImageInBackground])

  const resetGame = useCallback(() => {
    resetSessionLearning() // Reset learning for new game
    dispatch({ type: 'RESET' })
  }, [dispatch])

  return { startGame, submitAnswer, confirmGuess, resetGame }
}
