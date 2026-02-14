I've put together the full technical specification for your project. This is formatted as a complete Markdown file that you can copy-paste directly into your repository's README.md or submission documents.

Markdown  
\# 🍋 Akinator’s Canvas: The Local AI Detective  
\*\*Project Specification for the AMD AI Developer "Lemonade" Challenge\*\*

\---

\#\# 1\. Project Vision  
\*\*Akinator’s Canvas\*\* is a multimodal, local-first "Reverse Akinator" game designed to showcase the power of the \*\*AMD Ryzen™ AI PC\*\*. 

Instead of a simple text-based guessing game, the AI acts as a \*\*Forensic Sketch Artist\*\*. As the user answers questions about a secret character, the AI uses a combination of LLMs (running on the NPU) and Image Generation (running on the iGPU) to visually reconstruct the character in real-time. The game starts with a vague "lemon" of an idea and evolves into a high-fidelity "lemonade" masterpiece once the identity is confirmed.

\---

\#\# 2\. Hardware Strategy (The "Lemonade" Advantage)  
To maximize performance and battery life, this project utilizes the \*\*entire Ryzen AI silicon\*\* to avoid processing bottlenecks:

| Component | AI Model | Hardware Target | Role |  
| :--- | :--- | :--- | :--- |  
| \*\*The Detective\*\* | Llama 3 / Mistral (Quantized) | \*\*NPU\*\* | Manages game state, logic, and Q\&A. |  
| \*\*The Visualist\*\* | Phi-3 Mini | \*\*NPU\*\* | Translates clues into descriptive art prompts. |  
| \*\*The Artist\*\* | SDXL Turbo / SD 1.5 | \*\*iGPU\*\* | Performs real-time image synthesis via Vulkan/ROCm. |  
| \*\*The Logic\*\* | Python / Lemonade SDK | \*\*CPU\*\* | Orchestrates the agentic workflow. |

\> \*\*Why this wins:\*\* By offloading the "thinking" (LLMs) to the NPU and the "creating" (Stable Diffusion) to the iGPU, the CPU remains cool and responsive for the UI.

\---

\#\# 3\. The Triple-Agent Architecture

\#\#\# A. The Detective (Logic Agent)  
\* \*\*Goal:\*\* Identify the user's character in as few questions as possible.  
\* \*\*Mechanism:\*\* Maintains a list of "Confirmed Traits" (e.g., \`fictional: true\`, \`gender: female\`, \`hair: red\`).  
\* \*\*Trigger:\*\* Every time a user answers, the Detective updates the state and passes the data to the Visualist.

\#\#\# B. The Visualist (Prompt Engineering Agent)  
\* \*\*Goal:\*\* Maintain visual consistency while adding new details.  
\* \*\*Mechanism:\*\* It receives the current "Confirmed Traits" and generates a prompt for the Artist.   
\* \*\*Constraint:\*\* It is instructed to keep the background and composition consistent to simulate a "growing" sketch.

\#\#\# C. The Artist (Image Generation Agent)  
\* \*\*Goal:\*\* Real-time visual feedback.  
\* \*\*Mechanism:\*\* Uses \*\*Img2Img (Image-to-Image)\*\* refinement. It takes the \*previous\* turn's image as an input and applies the \*new\* prompt with a moderate "denoising strength" to evolve the image without losing its overall shape.

\---

\#\# 4\. The Game Loop (Operational Workflow)

1\.  \*\*Initial State:\*\* User thinks of a character. The AI generates a "Level 0" image: A blurry, abstract yellow-and-white silhouette.  
2\.  \*\*Turn Cycle:\*\*  
    \* \*\*Question:\*\* The Detective asks: \*"Does your character have superpowers?"\*  
    \* \*\*Answer:\*\* User says: \*"Yes."\*  
    \* \*\*Synthesis:\*\* The Visualist adds "superhero aesthetic, glowing aura" to the prompt.  
    \* \*\*Render:\*\* The Artist refines the previous blur into a more defined humanoid shape with glowing elements.  
3\.  \*\*The Reveal:\*\* When the Detective reaches a confidence threshold (e.g., \>90%), it makes a formal guess. If correct, a final high-step-count "Hero Render" is generated.

\---

\#\# 5\. Technical Implementation Details

\#\#\# Lemonade SDK Integration  
The project connects to the local \*\*Lemonade (LLM-Aide)\*\* server to manage model switching:

\`\`\`python  
import lemonade

client \= lemonade.Client(base\_url="http://localhost:8000")

\# Example: The Detective asking the next question  
def get\_next\_question(history):  
    response \= client.chat.completions.create(  
        model="llama3-8b-npu",  
        messages=\[{"role": "system", "content": "You are the Detective..."}, ...\]  
    )  
    return response.choices\[0\].message.content

### **Prompt Evolution Logic**

To ensure the image doesn't jump wildly, the Visualist uses a "Layered Prompting" strategy:

* **Base:** "Digital painting, professional character concept art, high detail."  
* **Confirmed Layers:** \[Male\] \+ \[Fantasy\] \+ \[Wields a sword\] \+ \[Silver hair\].  
* **Current Focus:** \[Blue glowing eyes\].

---

## **6\. UI/UX Design**

* **The Canvas:** A 512x512 live-updating image box.  
* **The Log:** A chat-style interface for the history of questions and answers.  
* **The "Detective's Brain":** A small sidebar showing the AI's current "Top 3 Guesses" based on the traits gathered so far.

---

## **7\. Privacy & Portability**

* **100% Offline:** No data leaves the machine, making it a perfect showcase for local AI privacy.  
* **Low Power:** Leveraging the NPU for constant LLM reasoning ensures the game doesn't drain the laptop battery like cloud-reliant alternatives.

Would you like me to generate a specific list of \*\*System Prompts\*\* for the Detective and Visualist agents to ensure they don't hallucinate during the game?

