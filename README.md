# 🍋 Lemonator

**AI-Powered Character Guessing Game with a Lemonade Mascot**

Lemonator is a reverse Akinator game where an AI detective asks you questions about a character you're thinking of, then uses advanced reasoning to guess who it is. Meet Lemon, your expressive mascot who reacts to your answers and reveals the character portrait when the AI makes its final guess!

<div align="center">

**Think of a character. Answer questions. Watch Lemon solve the mystery!**

</div>

---

## 🎮 What is Lemonator?

Lemonator combines multiple AI agents working together:

- **🔍 The Detective** (Qwen3-4B) - Asks strategic questions and narrows down possibilities using RAG
- **🎨 The Visualist** (Phi-4-mini) - Translates traits into detailed art descriptions  
- **🖼️ The Artist** (SDXL-Turbo) - Generates character portraits when making final guesses
- **🍋 Lemon the Mascot** - Your animated companion who reacts to every answer!

The game features:
- **407+ characters** across 9 categories (actors, musicians, politicians, athletes, superheroes, anime, TV, video games, historical figures)
- **Smart question selection** using information theory and entropy calculations
- **Expressive lemonade mascot** that changes expressions based on your answers (yes, no, probably, don't know)
- **Portrait generation** when the AI makes a guess
- **Fuzzy RAG matching** to handle ambiguous or missing traits gracefully
- **Multi-trait extraction** for faster convergence
- **Contradiction detection** to ensure logical consistency

---

## 📋 Prerequisites

### Required Software

1. **Node.js 18+** - [Download here](https://nodejs.org/)
2. **Lemonade Server v9.3.2+** - AMD's local AI inference server
   - Must be running on `http://localhost:8000`
   - See [Lemonade Setup](#lemonade-setup) below

### System Requirements

- **RAM**: 16GB minimum (32GB recommended for smooth image generation)
- **Storage**: 20GB free space (for models)
- **GPU**: Recommended for SDXL-Turbo image generation
  - AMD GPU with ROCm support, or
  - NVIDIA GPU with CUDA, or
  - CPU fallback (slower)

---

## 🚀 Quick Start

### 1. Install Dependencies

```bash
npm install
```

### 2. Start Lemonade Server

The app requires a running Lemonade server with these models loaded:

**Text Models (LLM):**
- `qwen3-4b` - The Detective (question generation, trait extraction)
- `phi-4-mini` - The Visualist (appearance descriptions)

**Image Model:**
- `sdxl-turbo` - The Artist (portrait generation)

Start your Lemonade server with these models enabled. See [LemonadeSpec.md](./LemonadeSpec.md) for detailed configuration.

```bash
# Example Lemonade server start command (adjust paths to your setup)
lemonade-server --models qwen3-4b,phi-4-mini,sdxl-turbo --port 8000
```

### 3. Run the Application

**Development Mode** (with hot reload):
```bash
npm run dev
```

**Production Build**:
```bash
npm run build
# The built app will be in dist/ and dist-electron/
```

The app will launch as an Electron desktop application.

---

## 🎯 How to Play

### Starting a Game

1. **Launch the app** - An Electron window will open
2. **Think of a character** - Anyone from the knowledge base (530+ characters)
3. **Click "Start Game"** - The AI detective begins investigating

### Answering Questions

The AI will ask you yes/no questions about your character. Answer honestly with:

- **Yes** - Confirms the trait
- **Probably Yes** - Mostly true but not certain
- **Probably Not** - Mostly false but not certain  
- **No** - Definitely false
- **I Don't Know** - Skip the question (trait won't be used)

**Watch Lemon react!** The lemonade mascot changes expressions based on your answers, showing excitement for definitive answers and confusion for uncertain ones.

### The AI's Investigation

As you answer questions, the AI:
1. **Extracts traits** from your answers (gender, category, nationality, appearance, etc.)
2. **Narrows down candidates** using its knowledge base with RAG filtering
3. **Avoids contradictions** - Won't extract traits that conflict with what you've already confirmed
4. **Shows top guesses** with confidence scores throughout the game

### The Guess

When the AI reaches **95% confidence** (or detects a character name match), it will:

1. **Generate a portrait** of the character (2-5 seconds)
2. **Show a guess dialog** with the character's name and image
3. **Ask "Am I right?"** with two buttons:
   - **Yes!** ✓ - You win! The game ends with celebration
   - **No, keep trying** ✗ - The AI continues asking questions and learning

### Top Guesses

Throughout the game, you'll see the AI's top 3-5 guesses with confidence scores in the sidebar. Watch as the list narrows down to your character!

---

## 🏗️ Project Structure

```
lemonator/
├── src/
│   ├── renderer/              # React UI components
│   │   ├── components/        # QuestionBubble, AnswerButtons, CharacterDisplay
│   │   ├── context/           # GameContext (state management)
│   │   ├── hooks/             # useGameLoop (game orchestration)
│   │   ├── services/          # AI service layers
│   │   │   ├── detective-rag.ts    # The Detective (Qwen3-4B)
│   │   │   ├── character-rag.ts    # Knowledge base & RAG filtering
│   │   │   ├── visualist.ts        # The Visualist (Phi-4-mini)
│   │   │   ├── artist.ts           # The Artist (SDXL-Turbo)
│   │   │   └── lemonade.ts         # Lemonade API client
│   │   └── types/             # TypeScript interfaces
│   ├── main/                  # Electron main process
│   └── preload/               # Electron preload scripts
├── character-knowledge.json   # 530 character database
├── package.json              # Dependencies & scripts
└── README.md                 # This file
```

---

## 🧪 Testing

The project includes integration tests for game logic and AI performance:

```bash
# Quick test - 5 games
npm run test:quick

# Medium test - 10 games
npm run test:medium

# Full test suite - 50 games
npm run test:full

# Test specific category
npm run test:category

# Test visualist prompt generation
npm run test:visualist
```

Test results are saved to `test-results-{timestamp}.json` with detailed analytics.

---

## 🔧 Configuration

### Lemonade Server Endpoints

Edit `src/shared/constants.ts` to change API endpoints:

```typescript
export const BASE_URL = 'http://localhost:8000'
export const CHAT_ENDPOINT = `${BASE_URL}/v1/chat/completions`
export const IMAGE_ENDPOINT = `${BASE_URL}/v1/images/generations`
```

### AI Models

The app uses these models by default:

```typescript
export const DETECTIVE_MODEL = 'qwen3-4b'      // Question generation
export const VISUALIST_MODEL = 'phi-4-mini'    // Appearance descriptions
export const ARTIST_MODEL = 'sdxl-turbo'       // Image generation
```

Change models in `src/shared/constants.ts` if using different ones.

### Confidence Threshold

Adjust when the AI makes a guess:

```typescript
export const CONFIDENCE_THRESHOLD = 0.95  // 95% confidence
```

Lower values = faster guesses (less accurate)  
Higher values = slower guesses (more accurate)

---

## 🧠 How It Works

### The Detective's Strategy

1. **Broad Questions First** - "Is your character fictional?" "Are they American?"
2. **Category Identification** - Quickly determines if actor/athlete/musician/etc.
3. **Category-Specific Questions** - "Did they act in Marvel movies?" "Are they a rapper?"
4. **Trait Narrowing** - Asks about appearance, era, popularity
5. **Contradiction Prevention** - Validates new traits don't conflict with existing ones
6. **High Confidence Guess** - When candidates narrow to 1-3 matches with 95%+ confidence

### RAG Knowledge Base

The detective uses **Retrieval-Augmented Generation** (RAG) with:

- **Strict filtering** - Fast AND logic (must match ALL traits)
- **Fuzzy matching** - Fallback scoring (match MOST traits)
- **Information gain** - Shannon entropy to pick most discriminating questions
- **Mutual exclusivity** - Avoids illogical questions (e.g., "Are they a politician?" after confirming actor)
- **Trait validation** - Two-layer protection against contradictory traits (prompt + code validation)

### Portrait Generation

**When making a guess**, the AI:

1. **Builds appearance prompt** using character knowledge + confirmed traits
2. **Generates portrait** with SDXL-Turbo in background (2-5 seconds, non-blocking)
3. **Shows guess dialog** immediately (portrait appears when ready)
4. **Game continues** - No waiting for image generation

**During gameplay**: Lemon the mascot is displayed with different expressions based on your answers (happy for "yes", sad for "no", thoughtful for "probably", confused for "don't know").

---

## 🐛 Troubleshooting

### "Lemonade server may be overloaded"

**Problem**: Portrait generation times out after 30 seconds

**Solutions**:
- Check if Lemonade server is running: `curl http://localhost:8000/health`
- Ensure SDXL-Turbo model is loaded
- Check GPU memory usage (SDXL needs ~6GB VRAM)
- Portrait generation is optional - the game continues even if it fails
- Consider disabling image generation by setting `ENABLE_IMAGE_GENERATION = false` in constants.ts

### "No matches even with fuzzy matching"

**Problem**: Character not in knowledge base

**Solutions**:
- The character might not be in the 407-character database
- Check `character-knowledge.json` to see available characters
- Add your character to the database with proper traits and distinctive_facts
- The game will continue and the AI will make its best guess based on traits

### Game is slow between questions

**Problem**: Performance issues

**Solutions**:
- Ensure you're running the **latest build** (restart app after `npm run build`)
- Check console logs are not flooding (verbose logging was removed in recent commits)
- Verify Lemonade server is responding quickly: `time curl -X POST http://localhost:8000/v1/chat/completions ...`

### Top guesses not showing

**Problem**: Empty guesses array or wrong confidence scores

**Solution**: 
- This was fixed in recent commits with improved RAG filtering
- Contradiction validation prevents illogical trait combinations
- Restart the app to reload the JavaScript bundle

### Guess dialog shows as regular question

**Problem**: "Is your character [Name]?" appears with answer buttons instead of guess dialog

**Solution**:
- Fixed in commit `ad85ccd` - guess dialog now shows immediately
- Portrait generates in background (non-blocking)
- Make sure you're running the latest build

---

## 📚 Technical Deep Dive

### Multi-Agent Architecture

**The Detective** (detective-rag.ts):
- Manages game state and turn history
- Extracts 1-N traits per question using Zod validation
- Validates traits against existing ones to prevent contradictions
- Uses RAG to filter 407 characters → top candidates
- Selects next question using entropy/information gain
- Makes guesses when confidence ≥ 95% or character name detected

**The Visualist** (visualist.ts):
- Receives confirmed traits as input
- Generates detailed appearance descriptions for portraits
- Maintains consistency with character knowledge
- Only used when generating final guess portraits

**The Artist** (artist.ts):
- Takes Visualist prompts as input
- Generates 512x512 portraits with SDXL-Turbo
- Non-blocking async generation (guess dialog shows immediately)
- Portrait appears in dialog when ready

**Lemon the Mascot** (Canvas.tsx):
- SVG lemonade character with 6 different expressions
- Reacts to answer types: yes, no, probably_yes, probably_not, dont_know, neutral
- Displayed throughout gameplay (replaced by portrait only during guess phase)

### Optimization Techniques

- **Strict filtering first** - O(n) with early exit (fast)
- **Fuzzy fallback** - O(n×m) scoring only when strict fails (rare)
- **Minimal console logging** - Performance-critical paths optimized
- **Async portrait generation** - Never blocks game flow, guess dialog shows immediately
- **Category mutual exclusivity** - Once actor confirmed, skip politician/athlete/musician questions
- **Contradiction validation** - Two-layer protection (prompt instruction + code validation) prevents illogical trait extraction
- **Non-blocking guess flow** - Portrait renders in background while user can interact with guess dialog

### Performance Benchmarks

- **Question generation**: 200-500ms (Qwen3-4B)
- **Trait extraction**: 100-300ms (Qwen3-4B)  
- **RAG filtering**: 50-200ms (in-memory)
- **Portrait generation**: 2-5 seconds (SDXL-Turbo on GPU, non-blocking)
- **Total turn time**: ~500ms-1s (excluding optional portrait gen)

---

## 🤝 Contributing

Contributions welcome! Areas for improvement:

- Add more characters to `character-knowledge.json` (following the existing structure)
- Improve question selection algorithm with more sophisticated entropy calculations
- Add support for more languages
- Enhance portrait generation with ControlNet/IP-Adapter for better consistency
- Create more Lemon mascot expressions
- Add sound effects and voice lines
- Implement hint system for difficult characters

---

## 📝 License

MIT License - See LICENSE file for details

---

## 🙏 Credits

- **AMD Lemonade SDK** - Local AI inference framework
- **Qwen3-4B** - Detective reasoning model
- **Phi-4-mini** - Visualist description model  
- **SDXL-Turbo** - Fast image generation
- Built with React, TypeScript, Electron, and Vite

---

## 📞 Support

Having issues? Check:
1. [Troubleshooting](#-troubleshooting) section above
2. [LemonadeSpec.md](./LemonadeSpec.md) for detailed Lemonade setup
3. Console logs in DevTools (Ctrl+Shift+I in the app)
4. Recent commits in git history (many bug fixes recently!)

**Latest Performance Fixes**:
- `ad85ccd` - Fixed guess flow (dialog shows immediately, portrait renders async)
- `17866cb` - Added contradiction validation (prevents NOT_actors after actors confirmed)
- `e13c417` - Pass existing traits to LLM to prevent contradictions
- `4a79287` - Added nationality trait support, pre-render portraits before guess
- `892dbb1` - Removed verbose logging (93% reduction in console output)
- `aa4e565` - Optimized filtering (strict first, fuzzy fallback)

---

<div align="center">

**🍋 When life gives you clues, make Lemonator! 🍋**

*Think of a character. Lemon will help solve the mystery!*

</div>
