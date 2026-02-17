import { useGameState } from '../context/GameContext'
import type { AnswerValue } from '../types/game'

// Lemonade character expressions as inline SVGs
const lemonadeExpressions: Record<AnswerValue | 'neutral', string> = {
  neutral: `data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 200 300'%3E%3C!-- Glass body --%3E%3Crect x='50' y='80' width='100' height='140' rx='10' fill='%23fff9e6' stroke='%23f4d03f' stroke-width='3'/%3E%3C!-- Lemonade liquid --%3E%3Crect x='52' y='120' width='96' height='100' rx='8' fill='%23f9e79f' opacity='0.8'/%3E%3C!-- Lemon slice --%3E%3Ccircle cx='100' cy='150' r='15' fill='%23f4d03f'/%3E%3Cpath d='M100,135 L100,165 M85,150 L115,150' stroke='%23fff' stroke-width='2'/%3E%3C!-- Straw --%3E%3Crect x='130' y='40' width='8' height='80' fill='%23e74c3c'/%3E%3Crect x='130' y='35' width='8' height='15' rx='4' fill='%23e74c3c'/%3E%3C!-- Face --%3E%3Ccircle cx='85' cy='95' r='5' fill='%23333'/%3E%3Ccircle cx='115' cy='95' r='5' fill='%23333'/%3E%3Cpath d='M85,110 Q100,120 115,110' stroke='%23333' stroke-width='2' fill='none'/%3E%3C!-- Arms --%3E%3Cpath d='M50,120 L30,140' stroke='%23f4d03f' stroke-width='4' stroke-linecap='round'/%3E%3Cpath d='M150,120 L170,140' stroke='%23f4d03f' stroke-width='4' stroke-linecap='round'/%3E%3C!-- Legs --%3E%3Cpath d='M70,220 L60,270' stroke='%23f4d03f' stroke-width='4' stroke-linecap='round'/%3E%3Cpath d='M130,220 L140,270' stroke='%23f4d03f' stroke-width='4' stroke-linecap='round'/%3E%3C/svg%3E`,
  
  yes: `data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 200 300'%3E%3C!-- Glass body --%3E%3Crect x='50' y='80' width='100' height='140' rx='10' fill='%23fff9e6' stroke='%23f4d03f' stroke-width='3'/%3E%3C!-- Lemonade liquid --%3E%3Crect x='52' y='120' width='96' height='100' rx='8' fill='%23f9e79f' opacity='0.8'/%3E%3C!-- Lemon slice --%3E%3Ccircle cx='100' cy='150' r='15' fill='%23f4d03f'/%3E%3C!-- Straw --%3E%3Crect x='130' y='40' width='8' height='80' fill='%23e74c3c'/%3E%3C!-- Happy face --%3E%3Ccircle cx='85' cy='95' r='6' fill='%23333'/%3E%3Ccircle cx='115' cy='95' r='6' fill='%23333'/%3E%3Cpath d='M80,110 Q100,130 120,110' stroke='%23333' stroke-width='3' fill='none'/%3E%3C!-- Excited arms up --%3E%3Cpath d='M50,120 L40,100' stroke='%23f4d03f' stroke-width='4' stroke-linecap='round'/%3E%3Cpath d='M150,120 L160,100' stroke='%23f4d03f' stroke-width='4' stroke-linecap='round'/%3E%3C!-- Legs --%3E%3Cpath d='M70,220 L60,270' stroke='%23f4d03f' stroke-width='4' stroke-linecap='round'/%3E%3Cpath d='M130,220 L140,270' stroke='%23f4d03f' stroke-width='4' stroke-linecap='round'/%3E%3C/svg%3E`,
  
  no: `data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 200 300'%3E%3C!-- Glass body --%3E%3Crect x='50' y='80' width='100' height='140' rx='10' fill='%23fff9e6' stroke='%23f4d03f' stroke-width='3'/%3E%3C!-- Lemonade liquid --%3E%3Crect x='52' y='120' width='96' height='100' rx='8' fill='%23f9e79f' opacity='0.8'/%3E%3C!-- Lemon slice --%3E%3Ccircle cx='100' cy='150' r='15' fill='%23f4d03f'/%3E%3C!-- Straw --%3E%3Crect x='130' y='40' width='8' height='80' fill='%23e74c3c'/%3E%3C!-- Sad face --%3E%3Ccircle cx='85' cy='95' r='5' fill='%23333'/%3E%3Ccircle cx='115' cy='95' r='5' fill='%23333'/%3E%3Cpath d='M85,120 Q100,110 115,120' stroke='%23333' stroke-width='2' fill='none'/%3E%3C!-- Arms down --%3E%3Cpath d='M50,120 L35,150' stroke='%23f4d03f' stroke-width='4' stroke-linecap='round'/%3E%3Cpath d='M150,120 L165,150' stroke='%23f4d03f' stroke-width='4' stroke-linecap='round'/%3E%3C!-- Legs --%3E%3Cpath d='M70,220 L60,270' stroke='%23f4d03f' stroke-width='4' stroke-linecap='round'/%3E%3Cpath d='M130,220 L140,270' stroke='%23f4d03f' stroke-width='4' stroke-linecap='round'/%3E%3C/svg%3E`,
  
  probably: `data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 200 300'%3E%3C!-- Glass body --%3E%3Crect x='50' y='80' width='100' height='140' rx='10' fill='%23fff9e6' stroke='%23f4d03f' stroke-width='3'/%3E%3C!-- Lemonade liquid --%3E%3Crect x='52' y='120' width='96' height='100' rx='8' fill='%23f9e79f' opacity='0.8'/%3E%3C!-- Lemon slice --%3E%3Ccircle cx='100' cy='150' r='15' fill='%23f4d03f'/%3E%3C!-- Straw --%3E%3Crect x='130' y='40' width='8' height='80' fill='%23e74c3c'/%3E%3C!-- Optimistic face --%3E%3Ccircle cx='85' cy='95' r='5' fill='%23333'/%3E%3Ccircle cx='115' cy='95' r='5' fill='%23333'/%3E%3Cpath d='M85,110 Q100,118 115,110' stroke='%23333' stroke-width='2' fill='none'/%3E%3C!-- Arms slightly up --%3E%3Cpath d='M50,120 L35,130' stroke='%23f4d03f' stroke-width='4' stroke-linecap='round'/%3E%3Cpath d='M150,120 L165,130' stroke='%23f4d03f' stroke-width='4' stroke-linecap='round'/%3E%3C!-- Legs --%3E%3Cpath d='M70,220 L60,270' stroke='%23f4d03f' stroke-width='4' stroke-linecap='round'/%3E%3Cpath d='M130,220 L140,270' stroke='%23f4d03f' stroke-width='4' stroke-linecap='round'/%3E%3C/svg%3E`,
  
  probably_not: `data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 200 300'%3E%3C!-- Glass body --%3E%3Crect x='50' y='80' width='100' height='140' rx='10' fill='%23fff9e6' stroke='%23f4d03f' stroke-width='3'/%3E%3C!-- Lemonade liquid --%3E%3Crect x='52' y='120' width='96' height='100' rx='8' fill='%23f9e79f' opacity='0.8'/%3E%3C!-- Lemon slice --%3E%3Ccircle cx='100' cy='150' r='15' fill='%23f4d03f'/%3E%3C!-- Straw --%3E%3Crect x='130' y='40' width='8' height='80' fill='%23e74c3c'/%3E%3C!-- Skeptical face --%3E%3Ccircle cx='85' cy='95' r='5' fill='%23333'/%3E%3Ccircle cx='115' cy='95' r='5' fill='%23333'/%3E%3Cpath d='M85,115 Q100,112 115,115' stroke='%23333' stroke-width='2' fill='none'/%3E%3C!-- Arms slightly down --%3E%3Cpath d='M50,120 L40,145' stroke='%23f4d03f' stroke-width='4' stroke-linecap='round'/%3E%3Cpath d='M150,120 L160,145' stroke='%23f4d03f' stroke-width='4' stroke-linecap='round'/%3E%3C!-- Legs --%3E%3Cpath d='M70,220 L60,270' stroke='%23f4d03f' stroke-width='4' stroke-linecap='round'/%3E%3Cpath d='M130,220 L140,270' stroke='%23f4d03f' stroke-width='4' stroke-linecap='round'/%3E%3C/svg%3E`,
  
  dont_know: `data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 200 300'%3E%3C!-- Glass body --%3E%3Crect x='50' y='80' width='100' height='140' rx='10' fill='%23fff9e6' stroke='%23f4d03f' stroke-width='3'/%3E%3C!-- Lemonade liquid --%3E%3Crect x='52' y='120' width='96' height='100' rx='8' fill='%23f9e79f' opacity='0.8'/%3E%3C!-- Lemon slice --%3E%3Ccircle cx='100' cy='150' r='15' fill='%23f4d03f'/%3E%3C!-- Straw --%3E%3Crect x='130' y='40' width='8' height='80' fill='%23e74c3c'/%3E%3C!-- Confused face --%3E%3Ccircle cx='82' cy='92' r='5' fill='%23333'/%3E%3Ccircle cx='118' cy='98' r='5' fill='%23333'/%3E%3Cpath d='M85,112 Q100,115 115,112' stroke='%23333' stroke-width='2' fill='none'/%3E%3C!-- Question mark --%3E%3Ctext x='95' y='175' font-size='30' fill='%23333' font-weight='bold'%3E%3F%3C/text%3E%3C!-- Arms confused --%3E%3Cpath d='M50,120 L45,135' stroke='%23f4d03f' stroke-width='4' stroke-linecap='round'/%3E%3Cpath d='M150,120 L155,135' stroke='%23f4d03f' stroke-width='4' stroke-linecap='round'/%3E%3C!-- Legs --%3E%3Cpath d='M70,220 L60,270' stroke='%23f4d03f' stroke-width='4' stroke-linecap='round'/%3E%3Cpath d='M130,220 L140,270' stroke='%23f4d03f' stroke-width='4' stroke-linecap='round'/%3E%3C/svg%3E`,
}

export default function Canvas() {
  const { currentImageUrl, lastAnswer, phase } = useGameState()
  
  // Determine which lemonade expression to show
  const getLemonadeExpression = (): string => {
    // If we have a final generated image (after correct guess), show that
    if (currentImageUrl && (phase === 'revealed' || phase === 'hero_render')) {
      return currentImageUrl
    }
    
    // Otherwise show lemonade character with appropriate expression
    const expression = lastAnswer || 'neutral'
    return lemonadeExpressions[expression]
  }

  return (
    <div className="canvas-container">
      <div className="canvas-frame">
        <img 
          src={getLemonadeExpression()} 
          alt="Detective Lemonade" 
          className="canvas-image" 
          style={{ objectFit: 'contain' }}
        />
      </div>
    </div>
  )
}
