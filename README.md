# 🍋 Lemonator

**AI-Powered Character Guessing Game with Real-Time Portrait Generation**

Lemonator is a reverse Akinator game where an AI detective asks you questions about a character you're thinking of, then uses advanced reasoning and image generation to guess who it is—while dynamically drawing their portrait as clues are revealed!

<div align="center">

**Think of a character. Answer questions. Watch the AI solve the mystery!**

</div>

---

## 🎮 What is Lemonator?

Lemonator combines three AI agents working together:

- **🔍 The Detective** (Qwen3-4B) - Asks strategic questions and narrows down possibilities using RAG
- **🎨 The Visualist** (Phi-4-mini) - Translates traits into detailed art descriptions  
- **🖼️ The Artist** (SDXL-Turbo) - Generates real-time portraits based on discovered clues

The game features:
- **530+ characters** across 9 categories (actors, musicians, politicians, athletes, superheroes, anime, TV, video games, historical figures)
- **Smart question selection** using information theory and entropy calculations
- **Real-time portrait generation** that evolves as the AI learns more about your character
- **Fuzzy RAG matching** to handle ambiguous or missing traits gracefully
- **Multi-trait extraction** for faster convergence

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

### Watch the Portrait Evolve

As you answer questions, the AI:
1. **Extracts traits** from your answers (gender, category, appearance, etc.)
2. **Narrows down candidates** using its knowledge base
3. **Generates portraits** of top guesses in real-time
4. **Updates the image** as more clues are revealed

### The Guess

When the AI reaches **95% confidence**, it will make a formal guess:

- **Correct** ✓ - You win! A detailed hero portrait is generated
- **Wrong** ✗ - The AI keeps asking questions and learning

### Top Guesses

Throughout the game, you'll see the AI's top 3-5 guesses with confidence scores. Watch as the list narrows down to your character!

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
5. **High Confidence Guess** - When candidates narrow to 1-3 matches

### RAG Knowledge Base

The detective uses **Retrieval-Augmented Generation** (RAG) with:

- **Strict filtering** - Fast AND logic (must match ALL traits)
- **Fuzzy matching** - Fallback scoring (match MOST traits)
- **Information gain** - Shannon entropy to pick most discriminating questions
- **Mutual exclusivity** - Avoids illogical questions (e.g., "Are they a politician?" after confirming actor)

### Image Generation Pipeline

1. **Extract visual traits** from Q&A (hair color, age, ethnicity, style)
2. **Build appearance prompt** using character knowledge + confirmed traits
3. **Generate portrait** with SDXL-Turbo (2-5 seconds)
4. **Update in background** - Game continues without blocking

---

## 🐛 Troubleshooting

### "Lemonade server may be overloaded"

**Problem**: Image generation times out after 30 seconds

**Solutions**:
- Check if Lemonade server is running: `curl http://localhost:8000/health`
- Ensure SDXL-Turbo model is loaded
- Check GPU memory usage (SDXL needs ~6GB VRAM)
- Reduce image size or use CPU fallback

### "No matches even with fuzzy matching"

**Problem**: Character not in knowledge base

**Solutions**:
- The character might not be in the 530-character database
- Check `character-knowledge.json` to see available characters
- The AI will continue asking questions and use LLM-based guessing as fallback

### Game is slow between questions

**Problem**: Performance issues

**Solutions**:
- Ensure you're running the **latest build** (restart app after `npm run build`)
- Check console logs are not flooding (verbose logging was removed in recent commits)
- Verify Lemonade server is responding quickly: `time curl -X POST http://localhost:8000/v1/chat/completions ...`

### Top guesses not showing

**Problem**: Empty guesses array

**Solution**: 
- This was fixed in commit `4323216` - make sure you're running the latest version
- Restart the app to reload the JavaScript bundle

---

## 📚 Technical Deep Dive

### Multi-Agent Architecture

**The Detective** (detective-rag.ts):
- Manages game state and turn history
- Extracts 1-N traits per question using Zod validation
- Uses RAG to filter 530 characters → top candidates
- Selects next question using entropy/information gain
- Makes guesses when confidence ≥ 95%

**The Visualist** (visualist.ts):
- Receives confirmed traits as input
- Generates detailed appearance descriptions
- Maintains consistency across turns
- Enhances with character-specific knowledge when available

**The Artist** (artist.ts):
- Takes Visualist prompts as input
- Generates 512x512 portraits with SDXL-Turbo
- Non-blocking async generation (game continues while rendering)
- Caches images by character name to avoid regeneration

### Optimization Techniques

- **Strict filtering first** - O(n) with early exit (fast)
- **Fuzzy fallback** - O(n×m) scoring only when strict fails (rare)
- **No verbose logging** - Console logs removed from hot paths
- **Async image gen** - Never blocks game flow
- **Category mutual exclusivity** - Once actor confirmed, skip politician/athlete/musician questions

### Performance Benchmarks

- **Question generation**: 200-500ms (Qwen3-4B)
- **Trait extraction**: 100-300ms (Qwen3-4B)  
- **Appearance description**: 300-600ms (Phi-4-mini)
- **Portrait generation**: 2-5 seconds (SDXL-Turbo on GPU)
- **Total turn time**: ~1-2 seconds (excluding image gen)

---

## 🤝 Contributing

Contributions welcome! Areas for improvement:

- Add more characters to `character-knowledge.json`
- Improve question selection algorithm
- Add support for more languages
- Enhance portrait generation with ControlNet/IP-Adapter
- Add multiplayer mode

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
- `892dbb1` - Removed verbose logging (93% reduction in console output)
- `aa4e565` - Optimized filtering (strict first, fuzzy fallback)
- `3a76b8b` - Fixed category mutual exclusivity
- `e40c67d` - Fixed game hang (non-blocking image generation)

---

<div align="center">

**🍋 When life gives you clues, make Lemonator! 🍋**

*Think of a character. The AI will draw them while solving the mystery.*

</div>
