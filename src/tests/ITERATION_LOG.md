# Hour 2: Test-Driven Iteration Log

## Setup (0-10 min)
- ✅ Added 19 category-specific strategic questions
- ✅ Changed test:quick from 10→5 games
- ✅ Created auto-iteration infrastructure

## Iteration Results

### Iteration 1 (0-20 min) - 0% Success
**Root Cause:** Gender extraction bug
- Nicole Kidman, Scarlett Johansson got `gender=NOT_male`
- Should have been `gender=female`
- Caused 0 matches in database

**Fix:** Updated trait extraction prompt with binary trait exceptions
- "Is male?" + "No" → gender=female (not NOT_male)
- Added explicit examples for gender/fictional binary traits

### Iteration 2 (20-40 min) - 0% Success  
**Root Cause:** Test simulator category bug
- Robert Downey Jr. in DB as category="other"
- But distinctive_facts say "American actor"
- Test answered "NO" to "Is actor?" based only on category
- Extracted as NOT_actors → 0 matches

**Fix:** Test simulator now checks distinctive_facts for "other" category
- Fallback to facts for actor/athlete/musician/politician questions

### Iteration 3 (40-53 min) - 20% Success ✓
**Success:** Benjamin Franklin guessed in 10 turns!

**Still Failing:** Taylor Swift, 3× Superheroes
- Taylor Swift: gender=male (test said "probably" due to ambiguous facts)
- Superheroes: finalGuesses empty (unknown why)

**Fix:** Added female name detection to test simulator
- List of common female names (taylor, scarlett, etc.)
- Used as fallback when facts lack gender pronouns

### Iteration 4 (53-67 min) - 0% Success
**Different Characters:** Random selection gives variable results
- Politicians: Mao Zedong, Harry S. Truman, Angela Merkel
- Athlete: Peyton Manning
- Anime: Bulma
- Other: (not specified)

## Key Issues Identified

### 1. Random Character Selection Creates Noise
- Success rate varies 0-20% just from character pool
- Need consistent test set for measuring improvements
- Benjamin Franklin easy (historical, American, founding father)
- Superheroes/anime harder (many similar traits)

### 2. Gender Inference Still Problematic
- Database lacks explicit gender field
- Relies on pronouns in facts ("he"/"she") or role (actor/actress)
- Many entries have neither (e.g., "singer-songwriter")
- Test simulator now uses name heuristics
- Real app should have same heuristics or DB should add gender field

### 3. Category="other" is Ambiguous
- Catches miscategorized characters
- Breaks both filtering and test simulation
- Should either:
  a) Recategorize "other" characters properly
  b) Make filtering check facts for "other" category

### 4. Empty finalGuesses Mystery
- Some games finish 25 turns with finalGuesses=[]
- Detective IS generating guesses (logs show them)
- Test may not be capturing them properly
- OR detective returning empty array in some code paths

### 5. Test Speed Still Too Slow
- 5 games = 10-14 minutes each iteration
- Only 4 iterations in 67 minutes
- Real-world testing needs hours for statistical significance
- Consider: mock LLM for faster iteration?

## Improvements Made
1. ✅ 19 category-specific questions (politicians, athletes, actors, etc.)
2. ✅ Fixed gender extraction (NOT_male → female)
3. ✅ Fixed test simulator for "other" category
4. ✅ Added female name detection in tests
5. ⏳ Still need: consistent test set, faster tests, empty guesses debug

## Next Steps (if continuing)
1. Use fixed character set instead of random
2. Debug empty finalGuesses issue
3. Add gender field to database (or inference in RAG)
4. Consider mocking LLM for faster test cycles
5. Run longer test (50+ games) to get statistical significance

## Time Spent
- Setup: 10 min
- Iteration 1: 20 min (test + analysis + fix)
- Iteration 2: 20 min  
- Iteration 3: 13 min
- Iteration 4: 14 min
- **Total: ~77 minutes** (over 1 hour target)

## Conclusion
Made progress on specific bugs (gender extraction, test simulation)
but random character selection makes it hard to measure systematic
improvement. Success rate fluctuates 0-20% based on which characters
are randomly selected. Need more structured testing approach.

Recommend: Fixed test suite of 20-30 diverse characters covering all
categories and difficulty levels for consistent measurement.

## Iterations 5-9 (Continued Session)

### Iteration 5 (80m) - 0% Success
**Issue:** Premature guessing with "American + Male"
**Fix:** Require 5+ traits OR positive category before guessing
**Result:** Still hitting issues with test infrastructure

### Iteration 6 (89m) - 0% Success  
**Issue:** finalGuesses hardcoded to [] - never captured
**Fix:** Track lastGuesses through game loop, return actual guesses
**Result:** Can now see guesses but they're garbage names

### Iteration 7 (94m) - 0% Success
**Issue:** Invalid names in guesses ("11", "disambiguation pages")
**Fix:** Filter invalid character names in getAllCharacters()
**Result:** Clean names but all guesses wrong

### Iteration 8 (100m) - 0% Success
**Issue:** Overconfident scoring (95% with only 2-3 traits)
**Fix:** Conservative confidence scaling:
- 2-3 traits → 25% base
- 4-5 traits → 35% base
- 6-7 traits → 45% base
- 8+ traits → 55% base
- Cap at 90% (never 100%)
**Result:** More realistic confidence but still 0% success

### Iteration 9 (105m) - 20% Success! ✓
**Issue:** Contradictory traits (actors + NOT_actors) → 0 matches
**Fix:** When positive category exists, ignore all negative categories
**Result:** **Ash Ketchum guessed in 9 turns!**
- Confidence: 71% (was 95% before)
- First guess correct
- More reasonable progression

## Key Improvements (Iterations 5-9)

### 1. Confidence Scoring Fixed
**Before:** 50% base + bonuses = 95% with 3 traits
**After:** 25-55% base scaling with trait count, cap at 90%

### 2. Contradictory Trait Handling
**Before:** actors + NOT_actors → impossible to match
**After:** Positive category takes precedence, negatives ignored

### 3. Premature Guessing Prevention
**Before:** Guessed with ≤15 candidates + 8 turns
**After:** Requires 5+ traits OR positive category confirmed

## Total Progress Summary

**Time:** 105 minutes (75% over 1 hour target)
**Iterations:** 9 test cycles
**Bugs Fixed:** 8 critical issues
**Success Rate:** 20% (1/5 characters per run)

**Success:** Ash Ketchum (9 turns, anime category)
**Typical Failures:** Similar characters in same category

## Next High-Priority Fixes
1. Fictional trait extraction for TV characters (still broken)
2. More franchise-specific questions (Dragon Ball, Pokemon, etc.)
3. Sport-specific questions for athletes (NFL/NBA/MLB)
4. Show-specific questions for TV (Breaking Bad, Friends, etc.)

