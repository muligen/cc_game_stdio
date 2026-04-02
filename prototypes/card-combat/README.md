# PROTOTYPE - NOT FOR PRODUCTION

## Card Combat Prototype

### Question
Does the core Slay the Spire-style card combat loop (draw, play, energy, enemy turn) feel right?

### Hypothesis
A minimal card combat system with Strike/Defend/Bash vs a single Cultist will validate that the turn rhythm, energy decisions, and block/damage dynamics create engaging moment-to-moment gameplay.

### How to Run
```bash
cd prototypes/card-combat
npm install
npm run dev
```
Then open the URL shown by Vite (typically http://localhost:5173).

### What to Evaluate
- Does drawing 5 cards per turn create interesting choices?
- Is 3 energy per turn the right budget for these card costs?
- Does Block feel meaningful against the Cultist's 6-damage attack?
- Does the Bash card (cost 2, 8 dmg + 2 Vulnerable) feel impactful?
- Is the turn flow (player turn -> enemy turn) clear and readable?
- Are damage popups and HP changes readable?

### Controls
- **Click a card** to select it
- **Click the enemy** to play an attack card on them
- **Skill cards** (Defend) resolve immediately on click
- **End Turn button** triggers the enemy's action
- **After game over** click to restart

### Cards
| Card   | Cost | Effect                      |
|--------|------|-----------------------------|
| Strike | 1    | Deal 6 damage               |
| Defend | 1    | Gain 5 Block                |
| Bash   | 2    | Deal 8 damage, apply 2 Vulnerable |

### Enemy
- **Cultist**: 50 HP, attacks for 6 damage every turn

### Scope Limitations (intentional)
- No deckbuilding — fixed 5-card starter each turn
- No draw pile / discard pile simulation — shuffled fresh each turn
- No relics, potions, or status effects beyond Vulnerable
- No map or encounter system
- No animations beyond damage popups
- Single enemy only
