# Character System

> **Status**: Designed
> **Author**: user + agents
> **Last Updated**: 2026-04-01
> **Implements Pillar**: Adaptive Builds (each character enables different build strategies)

## Overview

The Character System manages playable character definitions and selection. Each character
has unique HP, starting energy, starter deck, exclusive card pool, and starting relics.
The system loads character data at run start and provides a character instance to the Run
State Manager. MVP includes one fully playable character (Ironclad equivalent) with the
remaining three characters structurally defined but with placeholder content.

## Player Fantasy

This serves the **Adaptive Builds** pillar: different characters fundamentally change
your strategy. One may lean toward burst damage, another toward poison stall, another
toward block engines. Choosing a character is choosing which strategy space to explore.

Reference: Slay the Spire's four characters (Ironclad, Silent, Defect, Watcher) each
represent completely different gameplay experiences while sharing the same core rules.

## Detailed Design

### Core Rules

**1. Character Data Schema**

```
interface CharacterData {
  id: string;              // "ironclad", "silent", etc.
  name: string;            // Display name
  description: string;     // 1-2 sentence blurb
  hp: number;              // Starting HP
  maxHp: number;           // Starting max HP
  energy: number;          // Base energy per turn (default 3)
  starterDeck: string[];   // Card IDs for starting deck
  starterRelics: string[]; // Relic IDs for starting relics
  cardPool: string[];      // Character-exclusive card IDs
  color: string;           // Character theme color (for UI)
  unlockCondition?: UnlockCondition; // Post-MVP
}
```

**2. MVP Characters**

| ID | Name | HP | Energy | Starter Deck | Starter Relic | Theme |
|----|------|-----|--------|--------------|---------------|-------|
| `ironclad` | Ironclad | 80 | 3 | 5 Strike + 4 Defend + 1 Bash | Burning Blood (heal 6 HP post-combat) | High damage, Strength stacking |
| `silent` | Silent | 70 | 3 | 5 Strike + 5 Defend + 1 Survivor + 1 Neutralize | Ring of the Snake (draw 2 extra) | Poison, Shiv, Block |
| `defect` | Defect | 75 | 3 | 4 Strike + 4 Defend + 1 Zap + 1 Dualcast | Cracked Core (channel 1 Orb/turn) | Orb system, Energy manipulation |
| `watcher` | Watcher | 70 | 3 | 4 Strike + 4 Defend + 1 Eruption + 1 Vigil | PureWater (+1 Block/turn) | Stance switching, Divinity |

Post-MVP: Only `ironclad` is fully implemented. Other 3 have structure but empty card/relic data.

**3. Character Selection Flow**

1. Main menu → "New Run" → Character select screen
2. Display all unlocked characters (MVP: only Ironclad)
3. Player selects character → load `CharacterData`
4. Initialize Run State: HP, maxHP, starterDeck, starterRelics
5. Enter Map System (start run)

**4. Character in Combat**

- Combat System reads character HP and Block from Run State
- Character's `energy` value is passed to Energy System as `baseEnergy`
- Character's `starterDeck` initializes Deck Manager
- The character itself is not a combat entity — it's a data source

**5. Card Pool Rules**

- Character-specific cards: `card.character == characterId`
- Neutral cards (Status, Curse): `card.character == "any"`
- Colorless cards: Shared pool available to all characters
- Reward System and Shop System filter by character's card pool

**6. HP Management**

- `currentHP`: Mutable during run, reduced by combat damage
- `maxHP`: Can be increased by events/relics; rarely decreased
- Healing: `currentHP = min(currentHP + healAmount, maxHP)`
- Run over when `currentHP <= 0`

### Character Data

Characters are defined in `data/characters.json`:

```json
{
  "ironclad": {
    "id": "ironclad",
    "name": "Ironclad",
    "description": "A fallen soldier who made a pact with dark forces...",
    "hp": 80,
    "maxHp": 80,
    "energy": 3,
    "starterDeck": ["strike_red", "strike_red", "strike_red", "strike_red", "strike_red",
                     "defend_red", "defend_red", "defend_red", "defend_red",
                     "bash"],
    "starterRelics": ["burning_blood"],
    "cardPool": ["strike_red", "defend_red", "bash", /* ... 70+ cards */],
    "color": "#C41E3A"
  }
}
```

### Interactions with Other Systems

| System | Direction | Data Exchanged | When |
|--------|-----------|---------------|------|
| Data/Config | Config → Character | CharacterData from `characters.json` | Run start |
| Card System | Character → Card | Starter deck card IDs, card pool filter | Run init, rewards |
| Energy System | Character → Energy | `baseEnergy` from character data | Combat init |
| Run State Manager | Character → Run | HP, maxHP, starterDeck, starterRelics | Run start |
| Reward System | Character → Reward | Card pool for filtering rewards | Post-combat |
| Shop System | Character → Shop | Card pool for shop stock | Shopping |
| Meta-Progression | Run → Character | Unlock state (Post-MVP) | Between runs |

## Formulas

### Ascension HP Adjustment (Post-MVP)

```
adjustedHP(baseHP, ascensionLevel):
  if ascensionLevel >= 6: return baseHP - 5
  return baseHP
```

### HP Healing

```
healAfterCombat(currentHP, maxHP, healAmount):
  return Math.min(currentHP + healAmount, maxHP)
```

### Card Pool Filtering

```
getAvailableCards(characterId):
  characterCards = cards.filter(c => c.character == characterId)
  sharedCards = cards.filter(c => c.character == "any")
  return [...characterCards, ...sharedCards]
```

## Edge Cases

1. **Only one character unlocked**: Character select shows only Ironclad. Can auto-skip
   selection in MVP for faster iteration.

2. **Character-specific card in shared reward**: Never happens. Reward System filters by
   character's card pool. No Ironclad cards appear for Silent.

3. **Max HP reduced below current HP**: If an event reduces maxHP and currentHP exceeds
   new maxHP, currentHP is clamped to new maxHP.

4. **Character with 0 HP at run start**: Invalid. Data validation enforces hp > 0.

5. **Empty starter deck**: Invalid. Each character must have at least 10 starter cards.
   Data validation enforced.

6. **Starter relic removed**: Certain events can remove relics, including starter relics.
   This is valid gameplay — a meaningful sacrifice.

7. **Missing character data fields**: Data/Config validation catches missing required
   fields. Sensible defaults: energy=3, hp=75, starterDeck=[].

8. **Multiple runs same character**: Each run is independent. Character data is read-only;
   run state is the mutable copy.

## Dependencies

### Upstream (this system depends on)

| System | Type | Interface |
|--------|------|-----------|
| Data/Config | Hard | `getCharacter(id)` → CharacterData |
| Card System | Hard | Card data for starter deck and card pool definition |

### Downstream (systems that depend on this)

| System | Type | Interface |
|--------|------|-----------|
| Run State Manager | Hard | Character HP, maxHP, starterDeck, starterRelics at run init |
| Energy System | Soft | `baseEnergy` from character data |
| Reward System | Soft | Card pool filtering by character ID |
| Shop System | Soft | Card pool for shop stock |
| Meta-Progression | Soft | Character unlock state (Post-MVP) |

## Tuning Knobs

| Knob | Location | Default | Safe Range | What Breaks |
|------|----------|---------|------------|-------------|
| `baseHP` (per character) | `characters.json` | 70-80 | 50-100 | 50: too fragile; 100: too tanky |
| `baseEnergy` | `characters.json` | 3 | 2-4 | 2: very constrained; 4: too free |
| `starterDeckSize` | `characters.json` | 10 | 8-12 | 8: thin start; 12: slow to see key cards |
| `starterRelicHeal` | `relics.json` | 6 | 3-10 | 3: barely noticeable; 10: too much sustain |

## Acceptance Criteria

1. Character selection loads correct CharacterData (HP, energy, deck, relics).
2. Run initializes with character's starter deck (correct card count and IDs).
3. Run initializes with character's starter relic(s).
4. Energy System uses character's `baseEnergy` value.
5. Reward System only offers cards from character's card pool + shared cards.
6. HP clamped to maxHP on heal operations.
7. Post-combat healing relic works (Ironclad: heal 6 HP, clamped to maxHP).
8. Character data validation rejects missing required fields.

## Open Questions

1. **Character unlock order**: Should characters be unlockable in a specific order?
   Recommend: Ironclad available from start, others unlocked via meta-progression.
   Owner: Game Designer. Define during Meta-Progression GDD.

2. **Character-specific tutorial**: Should each character have a brief tutorial?
   Recommend: Yes, a 1-screen overview of the character's unique mechanic.
   Owner: UX Designer. Define during Screen Flow GDD.

3. **Custom character mod support**: Should the schema support modded characters?
   Recommend: Post-MVP. Schema is designed for extensibility but no mod API in MVP.
   Owner: Tech Director.
