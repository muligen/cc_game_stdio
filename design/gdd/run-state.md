# Run State Manager

> **Status**: Designed
> **Author**: user + agents
> **Last Updated**: 2026-04-02
> **Implements Pillar**: Informed Strategy (complete run state visibility), Adaptive Builds (run state defines build identity)

## Overview

The Run State Manager is the central state container that tracks and persists all mutable state for a single run. It manages current HP, gold, master deck, relic list, potion slots, map progress, and act stage. It serves as the hub for all other systems, providing state query and and state modification interfaces. Run state is initialized when a new run starts and destroyed when the run ends, Updated after every significant action (combat, reward, shop, event).

## Player Fantasy

The player always knows their state. Opening the run state query reveals current HP, gold, deck size, relic count, potion inventory. This is the foundation of **Informed Strategy** — without complete information there are no strategic decisions. The run state also embodies **Adaptive Builds**: your deck + relics + potions combination forms your build identity, and every addition or removal changes who your character is.

Reference: Slay the Spire's run state is visible at the deck view, relic bar, potion slots, gold counter, HP bar — always accessible, always informing decisions.

## Detailed Design

### Core Rules

**1. Run State Data**

```
interface RunState {
  // Run identification
  runId: string;                 // unique run ID (seed-based)
  seed: number;                 // master seed
  characterId: string;           // character being played

  // Player stats
  currentHP: number;
  maxHP: number;
  gold: number;

  // Deck
  masterDeck: CardInstance[];       // full card collection

  // Relics
  relics: string[];               // relic IDs obtained

  // Potions
  potions: (string | null)[];       // potion slots (null = empty)

  // Map progress
  currentAct: number;           // 1, 2, or 3
  currentFloor: number;         // 0-14 within act
  currentNodeId: string | null;  // current map node
  visitedNodes: string[];       // all visited node IDs
  mapData: MapData[];            // generated maps per act

  // Combat tracking
  combatsWon: number;
  elitesKilled: string[];       // elite IDs killed (for relic tracking)
  bossesKilled: string[];

  // Run metadata
  turnCount: number;            // total turns played across all combats
  cardsPlayedCount: number;     // total cards played

  // Run status
  status: RunStatus;            // ACTIVE, VICTORY, DEFEATED, ABANDONED
  score: number;                // final score (post-MVP: leaderboard)
}

enum RunStatus {
  ACTIVE,       // run in progress
  VICTORY,     // beat final boss
  DEFEATED,    // player HP reached 0
  ABANDONED    // player quit mid-run (post-MVP)
}
```

**2. Card Instance**

```
interface CardInstance {
  instanceId: string;     // unique per-run instance ID
  cardId: string;         // references CardData
  upgraded: boolean;      // has this card been upgraded?
}
```

**3. State Transitions**

| Transition | Trigger | State Changes |
|------------|---------|----------------|
| Run Start | New game selected | Initialize character, deck, relics, potions, map |
| Node Enter | Map node selected | Update currentFloor, currentNodeId, add to visitedNodes |
| Combat End | Victory | Update HP, gold, combatsWon, deck, relics/potions |
| Elite Kill | Elite defeated | Add to elitesKilled, update relics |
| Boss Kill | Boss defeated | Add to bossesKilled, increment act, new map |
| Rest Site | Rest action taken | Update HP and/or deck |
| Shop | Purchase/removal | Update gold, deck, relics, potions |
| Event | Event resolved | Update any combination |
| Run End (Victory) | Final boss killed | status → VICTORY, calculate score |
| Run End (Defeat) | HP reaches 0 | status → DEFEATED |

### State Query Interface

```
// Read-only queries (used by all systems)
getHP(): { current: number, max: number }
getGold(): number
getDeck(): CardInstance[]
getRelics(): string[]
getPotions(): (string | null)[]
getAct(): number
getFloor(): number
getNodeId(): string | null
getMapData(act: number): MapData
getStatus(): RunStatus
```

### State Write Interface

```
// Write operations (used by specific systems only)
modifyHP(delta: number): void          // combat, events, rest sites
modifyGold(delta: number): void         // rewards, shops, events
addCard(instance: CardInstance): void   // rewards, shops, events
removeCard(instanceId: string): void  // shops, rest sites, events
upgradeCard(instanceId: string): void  // rest sites
addRelic(relicId: string): void      // rewards, shops, events
addPotion(potionId: string): void   // rewards, shops
removePotion(slot: number): void     // potion use
setCurrentNode(nodeId: string): void // map system
advanceAct(): void                  // after boss kill
setStatus(status: RunStatus): void // combat system (victory/defeat)
```

### Run Initialization Flow

```
startRun(characterId, seed):
  // Create run state
  runState = new RunState()
  runState.runId = generateRunId(seed)
  runState.seed = seed
  runState.characterId = characterId

  // Load character data
  charData = getCharacter(characterId)
  runState.currentHP = charData.hp
  runState.maxHP = charData.maxHp
  runState.gold = startingGold  // default 0

  // Initialize deck from starter deck
  for cardId in charData.starterDeck:
    instance = createCardInstance(cardId)
    runState.masterDeck.push(instance)

  // Initialize starter relics
  for relicId in charData.starterRelics:
    runState.relics.push(relicId)

  // Initialize empty potion slots
  runState.potions = new Array(charData.maxPotionSlots).fill(null)

  // Initialize Act 1 map
  runState.currentAct = 1
  runState.currentFloor = 0
  runState.mapData[1] = generateMap(1, seed)

  // Set active status
  runState.status = RunStatus.ACTIVE
  runState.combatsWon = 0
  runState.turnCount = 0
  runState.cardsPlayedCount = 0

  return runState
```

### Interactions with Other Systems

| System | Direction | Data Exchanged | When |
|--------|-----------|---------------|------|
| Data/Config | Config → Run | Character data, starter deck, starter relics | Run start |
| RNG System | RNG → Run | Master seed, sub-seed derivation | Run start |
| Character System | Char → Run | HP, maxHP, starterDeck, starterRelics | Run start |
| Combat System | Run ↔ Combat | HP queries/modification, gold, deck, status | Combat |
| Map System | Run ↔ Map | Current position, map data, act progression | Map navigation |
| Reward System | Reward → Run | Gold, cards, relics, potions added | Post-combat |
| Shop System | Shop → Run | Gold spent, cards/relics/potions bought, cards removed | Shopping |
| Rest Site System | Rest → Run | HP restored, cards upgraded/removed | Rest site |
| Event System | Event → Run | Various modifications | Event resolution |
| Potion System | Run → Potion | Potion slot queries; Potion → Run: slot modifications | Potion use |
| Relic System | Run → Relic | Relic list; Relic → Run: relic additions | Relic triggers |
| Deck Manager | Run → Deck | Master deck; Deck → Run: deck modifications | Various |
| Save/Load System | Run → Save | Full run state serialization (Post-MVP) | Save trigger |
| Meta-Progression | Run → Meta | Score, run history (Post-MVP) | Run end |

## Formulas

### HP Modification

```
modifyHP(delta):
  currentHP = Math.max(0, Math.min(currentHP + delta, maxHP))
  if currentHP <= 0:
    status = DEFEATED
```

### Gold Modification

```
modifyGold(delta):
  gold = Math.max(0, gold + delta)
```

### Run Progress Percentage

```
getRunProgress():
  totalFloors = 3 * 15  // 3 acts * 15 floors each
  completedFloors = (currentAct - 1) * 15 + currentFloor
  return completedFloors / totalFloors
```

### Score Calculation (Post-MVP)

```
calculateScore():
  score = 0
  score += combatsWon * 10
  score += elitesKilled.length * 50
  score += relics.length * 15
  score += Math.floor(gold / 10)
  if status == VICTORY: score += 500
  return score
```

## Edge Cases

1. **HP exceeds maxHP**: Clamped to maxHP. Can happen through events that increase maxHP while currentHP was already at old maxHP.

2. **Gold goes negative**: Clamped to 0. Cannot happen through normal gameplay.

3. **Deck at minimum size**: Cannot remove below minDeckSize (1). Prevented at Shop/Rest Site level, not enforced here (systems calling removeCard must check).

4. **Potion slot out of bounds**: Access to `potions[slot]` where slot >= maxPotionSlots returns null. Graceful handling.

5. **Relic already obtained**: `addRelic` checks existing list. If duplicate, no-op (silent).

6. **Run abandoned mid-game**: Post-MVP feature. Sets status to ABANDONED. Run state preserved for history.

7. **Act 3 boss transition**: After Act 3 boss, run is complete. status → VICTORY. No Act 4 map generated.

8. **Map data missing for act**: Should never happen if initialization is correct. Access returns null with warning.

9. **Seed reproducibility**: Same seed + same character + same decisions produces identical run. All RNG streams derive from master seed.

10. **Multiple state updates in same frame**: All state modifications are batch-atomic. Systems read latest state. No race conditions.

## Dependencies

### Upstream (this system depends on)

| System | Type | Interface |
|--------|------|-----------|
| Data/Config | Hard | Character data, starter deck/relics, act definitions |
| RNG System | Hard | Master seed, sub-seed derivation |
| Character System | Hard | Character selection, starter data |

### Downstream (systems that depend on this)

| System | Type | Interface |
|--------|------|-----------|
| Combat System | Hard | HP queries/modification, status changes |
| Map System | Hard | Current position, map data, act progression |
| Reward System | Hard | Gold modification, card/relic/potion additions |
| Shop System | Hard | Gold, deck, relic, potion operations |
| Rest Site System | Hard | HP, deck modification |
| Event System | Hard | Various state modifications |
| Potion System | Hard | Potion slot queries and modifications |
| Relic System | Hard | Relic list queries and additions |
| Deck Manager | Hard | Master deck reference |
| Save/Load System | Hard | Full run state serialization (Post-MVP) |
| Meta-Progression | Hard | Score, run history (Post-MVP) |

## Tuning Knobs

| Knob | Location | Default | Safe Range | What Breaks |
|------|----------|---------|------------|-------------|
| `startingGold` | `game-config.json` | 0 | 0-50 | 50: too rich to start |
| `minDeckSize` | `game-config.json` | 1 | 1-3 | >1: limits aggressive thinning |
| `maxPotionSlots` | `character.json` | 3 | 2-5 | 2: very limiting; 5: hoarding |
| `floorsPerAct` | `game-config.json` | 15 | 10-20 | 10: short run; 20: grindy |

## Acceptance Criteria

1. Run start initializes all fields from character data correctly.
2. HP modification clamps to [0, maxHP].
3. Gold modification clamps to 0 (no negative gold).
4. Card addition adds to master deck.
5. Card removal respects minDeckSize (enforced by callers).
6. Relic addition prevents duplicates.
7. Potion slot access handles out-of-bounds gracefully.
8. Map progression tracks act and floor correctly.
9. Act advance generates new map for next act.
10. Status transitions (ACTIVE → VICTORY/DEFEATED) work correctly.
11. Same seed produces same run state (deterministic).
12. Score calculation produces correct value.

## Open Questions

1. **Run history tracking**: Should the system track a detailed log of every action?
   Recommend: yes, for Post-MVP analytics and debugging. Keep an action log with
   entries like `{turn, action, result}`. Owner: Systems Designer.

2. **Hot-seat mode**: Should multiple runs be tracked simultaneously?
   Recommend: no for MVP. Single active run. Post-MVP can add run slots.
   Owner: Game Designer.

3. **Death recap**: Should defeated runs show a "what went wrong" summary?
   Recommend: yes, Post-MVP. Show deck composition, key relics, and combat history.
   Owner: UX Designer. Screen Flow GDD.
