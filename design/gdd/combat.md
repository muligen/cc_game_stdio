# Combat System

> **Status**: Designed
> **Author**: user + agents
> **Last Updated**: 2026-04-01
> **Implements Pillar**: Informed Strategy (complete battle info visibility), Calculated Tension (turn-by-turn pressure), Meaningful Opportunity Cost (limited actions per turn)

## Overview

The Combat System is the game's central battle engine, orchestrating all combat subsystems.
It manages combat initialization (spawning enemies, loading deck, resetting energy), turn
flow (player turn → enemy turn loop), card play resolution, damage/block calculation and
application, death handling, and combat end (victory rewards / defeat). It is the
coordinator of all Layer 2 systems — Card, Deck Manager, Energy, Enemy AI, and Status
Effect — unifying them into a coherent battle experience.

## Player Fantasy

Every combat is a carefully constructed puzzle. You see the enemy's intent, calculate
incoming damage, plan your card order, and weigh defense versus offense. **Informed
Strategy**: all information is visible — enemy HP, intent, your hand, pile sizes.
**Calculated Tension**: "Can I survive this round? Should I use this AOE or kill the
right enemy first?" **Meaningful Opportunity Cost**: only 3 energy and 5 cards per turn
— every card play is an irreversible choice.

Reference: Slay the Spire's combat is the gold standard for roguelike deckbuilders.
The turn-by-turn rhythm of planning, executing, and reacting creates a deeply engaging
core loop.

## Detailed Design

### Core Rules

**1. Combat States**

| State | Description | Transition |
|-------|-------------|------------|
| **Initializing** | Load enemies, deck, energy, draw initial hand | → PlayerTurn |
| **PlayerTurn** | Player plays cards, uses potions, ends turn | → EnemyTurn |
| **EnemyTurn** | Enemies execute intents in order | → PlayerTurn or CombatOver |
| **CombatOver** | Battle resolved | → Reward (victory) or → GameOver (defeat) |

**2. Combat Initialization**

```
initCombat(encounterData):
  1. Read encounter config from Data/Config (enemy IDs, positions)
  2. Instantiate enemies (HP, moves, phases)
  3. DeckManager.initCombat() — copy Master Deck → Draw Pile → shuffle
  4. EnergySystem.turnStart() — reset currentEnergy
  5. StatusEffect.clearAll() — remove any residual effects
  6. DeckManager.drawCards(handSize) — draw initial hand (Innate guaranteed)
  7. Each enemy selects first intent
  8. → PlayerTurn
```

**3. Damage Application**

```
applyDamage(source, target, baseDamage):
  damage = calculateDamage(baseDamage, source, target)

  // Intangible cap (before Block)
  if target.hasEffect("Intangible"):
    damage = Math.min(damage, 1)

  // Block absorption
  if target.block > 0:
    if damage <= target.block:
      target.block -= damage
      damage = 0
    else:
      damage -= target.block
      target.block = 0

  // HP reduction
  if damage > 0:
    target.HP -= damage
    fireTriggers("onDamageTaken", target)

  // Death check
  if target.HP <= 0:
    handleDeath(target)
```

**4. Block Application**

```
applyBlock(target, baseAmount):
  block = calculateBlock(baseAmount, target)
  target.block += block
  // No upper limit on Block
```

**5. Death Handling**

```
handleDeath(entity):
  if entity == player:
    → CombatOver (defeat)
  else:
    entity.isAlive = false
    entity.block = 0
    removeAllEffects(entity)
    if allEnemiesDead():
      → CombatOver (victory)
```

**6. Combat End**

```
endCombat(result):
  // Clear combat state
  StatusEffect.clearAllCombatEffects()
  EnergySystem.resetToZero()
  DeckManager.destroyCombatPiles()

  if result == "victory":
    → Reward System (generate rewards)
  else:
    → Run State Manager (run over)
```

**7. Multi-hit Attacks**

If a move has `hits > 1`:
- Damage formula calculated once per hit
- Each hit applies Block damage separately (Block chips between hits)
- Strength is added per hit (not multiplied by hits)
- Death checks between hits — if target dies, remaining hits fizzle

**8. Block Reset Timing**

- **Player**: Block resets to 0 at the START of player's turn (before drawing)
- **Enemy**: Block resets to 0 at the START of that enemy's individual turn

### Turn Flow

**Player Turn:**

```
PlayerTurn:
  // === Turn Start Phase ===
  1. Reset player Block to 0
  2. EnergySystem.turnStart() → reset energy
  3. DeckManager.drawCards(handSize)
  4. StatusEffect.fireTriggers("onTurnStart", player)

  // === Player Action Loop ===
  while playerTurnActive:
    - Player selects card → validate (canPlay, valid target)
    - EnergySystem.spendEnergy(cost)
    - Execute card effects (damage, block, applyEffect, etc.)
    - Update display if enemy killed
    - Check all enemies dead → CombatOver (victory)

  // === Turn End Phase ===
  5. StatusEffect.processTurnEnd(player):
     a. Poison tick (if player has Poison — rare but possible)
     b. Duration decrement for turn-based effects
     c. Remove expired effects
     d. Fire onTurnEnd triggers (e.g., Metallicize → gain Block)
  6. Check player alive (Poison can kill at turn end)
  7. DeckManager.discardHand() — non-Retain → Discard, Ethereal → Exhaust
  8. → EnemyTurn
```

**Enemy Turn:**

```
EnemyTurn:
  for each enemy in enemyOrder (left to right):
    if not enemy.isAlive: continue

    // === Enemy Turn Start ===
    enemy.block = 0  // reset Block
    StatusEffect.fireTriggers("onTurnStart", enemy)

    // === Execute Intent ===
    if enemy.isStunned:
      // Skip execution, stun wears off
      enemy.isStunned = false
    else:
      for each effect in enemy.currentMove.effects:
        executeEffect(enemy, effect)
        if not enemy.isAlive: break  // Thorns etc.

    // === Enemy Turn End ===
    if enemy.isAlive:
      StatusEffect.processTurnEnd(enemy):
        a. Poison tick
        b. Duration decrement
        c. Remove expired effects
        d. Fire onTurnEnd triggers
      if enemy.isAlive:
        enemy.selectNextIntent()

  // === Post-Enemy Phase ===
  if player.HP <= 0:
    → CombatOver (defeat)
  else:
    → PlayerTurn
```

### Combat States

Full state machine:

```
Initializing → PlayerTurn ⇄ EnemyTurn → CombatOver
                   ↓              ↓
              (victory)      (defeat)
```

Sub-states within PlayerTurn:
- **Drawing** → **WaitingForInput** → **PlayingCard** → **WaitingForInput**
- Player may end turn at any point during WaitingForInput

Sub-states within EnemyTurn:
- **EnemyStart** → **EnemyActing** → **EnemyEnd** → (next enemy or back to PlayerTurn)

### Interactions with Other Systems

| System | Direction | Data Exchanged | When |
|--------|-----------|---------------|------|
| Card System | Combat → Card | Card play validation, effect execution | Card play |
| Deck Manager | Combat → Deck | drawCards, discardHand, exhaustCard | Turn flow |
| Energy System | Combat → Energy | turnStart, spendEnergy, canPlay checks | Turn start, card play |
| Enemy AI System | Combat → AI | Intent execution, next intent selection | Enemy turn |
| Status Effect | Combat → Effect | applyEffect, processTurnEnd, clearAll | Various |
| Status Effect | Effect → Combat | Damage/block modifiers, trigger callbacks | Calculation |
| Data/Config | Config → Combat | Encounter definitions, enemy IDs | Combat init |
| RNG System | RNG → Combat | Combat seed for shuffle | Deck init |
| Combat UI | Combat → UI | State, HP, Block, intents, turn phase | Continuous |
| Reward System | Combat → Reward | Victory trigger, enemy data for loot table | Combat end |
| Run State Manager | Combat → Run | HP after combat, defeat notification | Combat end |
| Relic System | Relic → Combat | Trigger effects (onCardPlayed, onDamageTaken, etc.) | Various |

## Formulas

### Unified Damage Calculation

```
calculateDamage(baseDamage, source, target):
  damage = baseDamage + getEffectStacks(source, "Strength")
  damage = Math.floor(damage * vulnerableMultiplier(target))
  damage = Math.floor(damage * weakMultiplier(source))
  damage = Math.max(0, damage)
  return damage
```

Applied identically for cards and enemy attacks. References Status Effect System
formulas for multipliers.

### Block Calculation

```
calculateBlock(baseBlock, target):
  block = baseBlock + getEffectStacks(target, "Dexterity")
  block = Math.floor(block * frailMultiplier(target))
  block = Math.max(0, block)
  return block
```

### Thorns Damage

```
thornsDamage(target):
  stacks = getEffectStacks(target, "Thorns")
  // Flat damage per hit, NOT modified by Strength or attack multipliers
  return Math.max(0, stacks)
```

Applied when this entity is attacked. Thorns fires per hit of multi-hit attacks.

### Intangible Cap

```
intangibleCap(damage, target):
  if target.hasEffect("Intangible"):
    return Math.min(damage, 1)
  return damage
```

Applied AFTER all other damage calculations but BEFORE Block absorption.
Exception: Poison bypasses Intangible (deals full stacks).

## Edge Cases

1. **All enemies killed mid-player-turn**: Player can continue playing remaining cards.
   When they end turn (or auto-end), enemy turn is skipped → CombatOver victory.
   No forced end — player may want to play block cards for relic triggers.

2. **Player dies to Poison at own turn end**: Poison ticks during player's turn-end
   processing. If this reduces HP to 0, CombatOver defeat triggers even though it's
   still "the player's turn" in a sense. The turn-end processing completes before
   transitioning.

3. **Enemy kills itself via Thorns**: If the player has Thorns and an enemy attacks,
   the Thorns return damage can kill the enemy mid-intent. Remaining effects in that
   enemy's intent are skipped.

4. **Multiple enemies, one kills the player**: If enemy #1's attack kills the player,
   enemies #2 and beyond do NOT execute. CombatOver triggers immediately.

5. **Block exceeds incoming damage**: All damage absorbed by Block. No HP lost.
   Remaining Block persists until the entity's next turn start.

6. **X-cost card kills all enemies mid-effect**: Card effects resolve fully even if
   enemies die mid-resolution. Dead enemies don't receive further effects. After all
   effects resolve, CombatOver victory triggers.

7. **Empty draw pile at combat start**: Should never happen (minimum deck size is 1).
   If it does, player starts with an empty hand. No crash.

8. **Relic effects during combat**: Relics fire triggers at appropriate times
   (onCardPlayed, onDamageTaken, onTurnEnd, etc.). These are handled by the Status
   Effect System's trigger mechanism. Combat System does not directly call relic
   methods.

9. **Simultaneous player + enemy death**: If an effect causes both player and enemy
   to die at the same time (e.g., self-damage card + Thorns), player death takes
   priority → CombatOver defeat.

10. **No combat duration limit**: There is no hard cap on combat turns. Very long
    combats are valid with heavy sustain builds. The natural limit is the player's
    patience and card pool.

## Dependencies

### Upstream (this system depends on)

| System | Type | Interface |
|--------|------|-----------|
| Card System | Hard | Card play validation (`canPlay`), effect execution |
| Deck Manager | Hard | `drawCards(n)`, `discardHand()`, `exhaustCard()`, shuffle trigger |
| Energy System | Hard | `turnStart()`, `canPlay(card)`, `spendEnergy(cost)`, `currentEnergy` |
| Enemy AI System | Hard | Intent selection, move execution, stun handling |
| Status Effect System | Hard | `applyEffect()`, `processTurnEnd()`, `getEffectStacks()`, `clearAllCombatEffects()` |
| Data/Config | Hard | Combat encounter definitions, enemy data |

### Downstream (systems that depend on this)

| System | Type | Interface |
|--------|------|-----------|
| Combat UI | Hard | Combat state, entity HP/Block/intent, turn phase for display |
| Reward System | Hard | Combat victory triggers reward generation |
| Run State Manager | Hard | HP tracking across combats, defeat → run over |
| Relic System | Soft | Trigger hooks for relic effects during combat events |

## Tuning Knobs

| Knob | Location | Default | Safe Range | What Breaks |
|------|----------|---------|------------|-------------|
| `handSize` | `game-config.json` | 5 | 3-7 | Shared with Card/Deck systems |
| `baseEnergy` | `character.json` | 3 | 1-5 | Shared with Energy System |
| `enemyTurnDelay` | `game-config.json` | 500ms | 200-1000ms | 200ms: too fast to read; 1000ms: too slow |
| `combatEndDelay` | `game-config.json` | 1000ms | 500-2000ms | Delay before reward screen |
| `maxCombatTurns` | `game-config.json` | ∞ | 50-∞ | 50: some builds hit ceiling |
| `minPlayerHP` | `game-config.json` | 0 | 0 | Should always be 0 |

## Acceptance Criteria

1. Combat initializes: enemies spawned, deck shuffled, initial hand drawn, energy reset.
2. Player turn: cards drawn, cards playable (energy check), end turn button available.
3. Enemy turn: each enemy executes intent in order, selects next intent.
4. Damage formula matches unified formula (Strength, Vulnerable, Weak applied).
5. Block absorbs damage before HP; excess Block carries until next turn start.
6. Block resets to 0 at start of entity's turn.
7. Player death (HP ≤ 0) triggers CombatOver defeat.
8. All enemies dead triggers CombatOver victory → Reward System.
9. Poison damage at turn end can kill player (checked during turn-end processing).
10. Stunned enemy skips turn execution.
11. Multi-hit attack applies damage per hit with Block chipped between hits.
12. Combat end clears all combat effects, resets energy, destroys combat piles.

## Open Questions

1. **Combat speed settings**: Should players be able to adjust combat animation speed?
   Recommend: yes, 1x/2x/3x speed toggle for accessibility and experienced players.
   Owner: UX Designer. Define during Combat UI GDD.

2. **Auto-end turn**: Should the turn auto-end when player has 0 energy and no
   0-cost playable cards? Recommend: no — player may want to use potions or
   relics with manual activation. Owner: Game Designer.

3. **Combat retry**: Should players be able to retry a lost combat?
   Recommend: no for standard mode; optional "Easy Mode" feature post-MVP.
   Owner: Game Designer. Evaluate post-MVP.
