# Enemy AI System

> **Status**: Designed
> **Author**: user + agents
> **Last Updated**: 2026-04-01
> **Implements Pillar**: Informed Strategy (visible intents enable planning), Calculated Tension (uncertain move pools create tension)

## Overview

The Enemy AI System manages behavioral decisions for all enemies in the game. Each enemy
displays an **Intent** at the start of each turn, showing the player what action it will
take. Enemies select moves from predefined **Move Lists** using three selection modes:
Rotating (fixed cycle), Weighted Pool (random with constraints), and Conditional
(trigger-based). Bosses have multi-phase AI that switches behavior patterns at HP
thresholds. The system uses the AI RNG stream for reproducibility.

## Player Fantasy

This system serves the **Informed Strategy** pillar: every enemy's intent is fully visible.
You know exactly how much damage is coming, what debuff will be applied, or whether the
enemy is buffing itself. This turns each turn into a puzzle: "How much Block do I need to
survive this round?" It also serves **Calculated Tension**: while the current intent is
known, the NEXT turn's intent is uncertain (drawn from a weighted pool), creating
continuous tension about what's coming.

Reference: Slay the Spire's intent system is iconic — seeing a 30-damage attack intent
creates immediate pressure to find Block.

## Detailed Design

### Core Rules

**1. Enemy Data Schema**

```
interface EnemyData {
  id: string;
  name: string;
  type: "normal" | "elite" | "boss";
  hp: number;                // base HP
  moves: MoveEntry[];        // move selection definitions
  phases?: BossPhase[];      // boss only: phase transitions
}

interface EnemyMove {
  id: string;                // move identifier
  name: string;              // display name
  intent: IntentType;        // intent icon to show
  effects: MoveEffect[];     // ordered effects to execute
  damage?: number;           // base damage (null if not attack)
  block?: number;            // block to gain (null if none)
  target?: TargetType;       // SELF / PLAYER / ALL_PLAYERS
  hits?: number;             // number of hits (default 1)
}

interface MoveEntry {
  moveId: string;
  weight: number;            // for weighted pool mode
  maxConsecutive?: number;   // max times this move can repeat
  conditions?: MoveCondition[];
}
```

**2. Intent Types**

| Intent Type | Icon Meaning | Display Info |
|-------------|-------------|--------------|
| `ATTACK` | Sword | Damage number |
| `ATTACK_DEFEND` | Sword + Shield | Damage + Block numbers |
| `DEFEND` | Shield | Block number |
| `BUFF` | Up arrow | Buff name (or "?" if hidden) |
| `DEBUFF` | Down arrow | Debuff name |
| `STRONG_DEBUFF` | Large down arrow | High-threat debuff marker |
| `MAGIC` | Magic icon | Special effect name |
| `SLEEP` | Zzz | No action this turn |
| `STUN` | Stun stars | No action this turn (stunned) |
| `UNKNOWN` | "?" | Hidden intent (boss special) |

**3. Enemy Turn Execution**

1. Read current intent's move
2. Execute effects in `move.effects[]` order
3. Attack effects: calculate damage → `dealDamage(target, calculatedDamage)`
4. Block effects: `gainBlock(self, blockAmount)`
5. Status effects: `applyEffect(target, effectId, stacks)`
6. After execution complete, select next turn's intent

**4. Stun Mechanic**

- Certain cards/effects can Stun an enemy
- Stunned enemy skips its turn action (intent not executed)
- Stun lasts 1 turn (does not stack)
- Stunned enemy selects a new move normally next turn

### Intent System

The intent is selected at the **end of the enemy's turn** (for display during the
player's next turn). Exception: combat start — the first intent is selected immediately
after combat initialization.

**Intent Display Rules:**

- ATTACK intents show the calculated damage value (including Strength, Vulnerable, Weak)
- BUFF/DEBUFF intents show the effect name or a description
- DEFEND intents show the block amount
- UNKNOWN intents show only "?" — no numerical preview
- SLEEP/STUN intents show the status icon only

**Intent Damage Preview:**

The damage shown in the intent includes all currently known modifiers. If the player
applies Vulnerable to themselves after seeing the intent, the displayed damage does NOT
update (intent shows the state at time of selection). This matches Slay the Spire behavior.

### Move Selection

**Mode 1: Rotating**

```
rotatingSelect(moveList, currentIndex):
  nextIndex = (currentIndex + 1) % moveList.length
  return moveList[nextIndex]
```

Used for simple enemies with predictable patterns.

**Mode 2: Weighted Pool**

```
selectMove(enemy, lastMoveId, consecutiveCount):
  pool = enemy.moves.filter(m =>
    m.moveId != lastMoveId ||
    m.maxConsecutive == null ||
    consecutiveCount < m.maxConsecutive
  )
  totalWeight = sum(pool.map(m => m.weight))
  roll = aiRng.nextInt(0, totalWeight - 1)
  cumulative = 0
  for move in pool:
    cumulative += move.weight
    if roll < cumulative: return move
  return pool[pool.length - 1]  // fallback
```

Uses AI RNG stream for deterministic replay.

**Mode 3: Conditional**

Conditions are checked in order; first match wins. If no condition matches, fall through
to weighted pool.

```
conditions:
  - trigger: "hp_below"
    threshold: 0.5           // HP < 50%
    moveId: "enrage"
  - trigger: "player_has_effect"
    effectId: "Vulnerable"
    moveId: "exploit_weakness"
  - trigger: "turn_count"
    operator: "=="
    value: 1                 // first turn only
    moveId: "opening_attack"
```

**Boss Phase System:**

```
interface BossPhase {
  phaseId: string;
  hpThreshold: number;       // trigger when HP <= this %
  moves: MoveEntry[];        // new move pool for this phase
  onPhaseTransition?: {
    effects: MoveEffect[];   // effects on transition
    message?: string;        // boss dialogue
  }
}
```

- Bosses start in Phase 1
- When HP drops below threshold, switch to next phase immediately
- Phase transition: current turn's intent stays the same; next turn uses new move pool
- Consecutive limit resets on phase transition

### Interactions with Other Systems

| System | Direction | Data Exchanged | When |
|--------|-----------|---------------|------|
| Data/Config | Config → AI | EnemyData, MoveData, BossPhase definitions | Load time |
| RNG System | RNG → AI | AI RNG stream for weighted pool selection | Move selection |
| Status Effect | AI → Effect | `applyEffect()` calls from enemy moves | Enemy turn |
| Status Effect | Effect → AI | Strength/Weak modifiers for damage calculation | Damage calc |
| Combat System | Combat → AI | Turn start/end triggers, HP threshold checks | Combat flow |
| Combat System | AI → Combat | Intent data for display, damage/block application | Enemy turn |
| Combat UI | AI → UI | Intent icon, damage/block values, phase messages | Continuous |

## Formulas

### Enemy Attack Damage

```
enemyDamage(baseDamage, attacker, target):
  damage = baseDamage + getEffectStacks(attacker, "Strength")
  damage = Math.floor(damage * weakMultiplier(attacker))
  damage = Math.floor(damage * vulnerableMultiplier(target))
  damage = Math.max(0, damage)
  return damage
```

Same structure as Card System damage formula. Enemy Strength comes from buffs
applied by their own moves or other enemies.

### Enemy Block

```
enemyBlock(baseBlock, enemy):
  block = baseBlock + getEffectStacks(enemy, "Dexterity")
  block = Math.floor(block * frailMultiplier(enemy))
  block = Math.max(0, block)
  return block
```

### Intent Display Damage

```
displayDamage(move, attacker, target):
  base = move.damage || 0
  bonus = getEffectStacks(attacker, "Strength")
  vuln = vulnerableMultiplier(target)  // player can see own Vulnerable
  weak = weakMultiplier(attacker)       // player can see enemy's Weak
  return Math.floor((base + bonus) * vuln * weak)
```

Snapshot at intent selection time. Does NOT update if modifiers change later.

## Edge Cases

1. **Single-move enemy**: An enemy with only 1 move uses it every turn. The
   `maxConsecutive` limit is ignored when the pool has only 1 entry. Design rule:
   every enemy should have at least 2 moves, but the system handles 1 gracefully.

2. **Boss dies mid-phase transition**: If a boss dies from a hit that would trigger
   a phase transition, the boss simply dies. Phase transition only occurs while alive.

3. **No conditional match**: If all conditions fail to match, the system falls back
   to weighted pool selection. If the weighted pool is also empty, a fallback move
   is used (Attack for 1 damage). This should never happen with properly configured
   enemy data.

4. **Enemy dies mid-effect chain**: If effect #3 in a move's effect list would kill
   the enemy, remaining effects (#4, #5, etc.) are skipped. The enemy is dead.

5. **Stun on boss opening turn**: If a boss is Stunned on its first turn, the opening
   move is not executed. Next turn, the boss selects normally (the "turn_count == 1"
   condition no longer matches).

6. **Unknown intent**: Some boss moves use `UNKNOWN` intent type. Players see only
   "?" — no damage preview or effect name. The actual effects still execute normally.

7. **Enemy block at turn start**: Enemy Block resets to 0 at the start of the enemy's
   turn, before intent selection. Block from the previous turn is lost.

8. **Consecutive limit with no alternatives**: If the only valid move has been used
   `maxConsecutive` times, and no other moves exist, the limit is ignored. The enemy
   uses the only available move regardless.

9. **Multiple enemies applying same buff**: Two enemies can independently apply the
   same buff to themselves or each other. Stacking follows Status Effect System rules.

10. **Dead enemy no intent**: Dead enemies do not display intents and do not execute
    moves. This is handled at the Combat System level.

## Dependencies

### Upstream (this system depends on)

| System | Type | Interface |
|--------|------|-----------|
| Data/Config | Hard | `getEnemy(id)` → EnemyData, MoveData, BossPhase definitions |
| RNG System | Hard | AI RNG stream for deterministic weighted selection |
| Status Effect | Hard | `applyEffect()`, `getEffectStacks()` for damage/block calculation |

### Downstream (systems that depend on this)

| System | Type | Interface |
|--------|------|-----------|
| Combat System | Hard | Enemy turn execution, intent selection triggers, HP threshold checks |
| Combat UI | Soft | Intent icon + damage value display, boss phase transition messages |

## Tuning Knobs

| Knob | Location | Default | Safe Range | What Breaks |
|------|----------|---------|------------|-------------|
| `bossPhaseThreshold` | `enemies.json` (per boss) | 0.5 | 0.25-0.75 | 0.25: phase too late; 0.75: phase too early |
| `defaultConsecutiveLimit` | `game-config.json` | 2 | 1-3 | 1: moves never repeat; 3: spam risk |
| `eliteHpMultiplier` | `enemies.json` | 1.0 | 1.0-2.0 | 2.0: elites too tanky |
| `bossHpMultiplier` | `enemies.json` | 1.0 | 1.0-1.5 | 1.5: boss fights too long |
| `minMoveCount` | `game-config.json` | 2 | 2-4 | <2: consecutive limit cannot function |

## Acceptance Criteria

1. Enemy displays intent (icon + numerical value) at start of player's turn.
2. Weighted pool selection uses AI RNG stream — same seed produces same move sequence.
3. Consecutive limit enforced: same move does not appear more than `maxConsecutive`
   times in a row.
4. Boss switches phase when HP drops below threshold, uses new move pool.
5. Boss phase transition fires `onPhaseTransition` effects.
6. Conditional moves take priority over weighted pool when conditions match.
7. Intent display damage includes Strength, Vulnerable, and Weak modifiers.
8. Stunned enemy skips its turn action entirely.
9. Enemy with only 1 move uses it every turn (no consecutive limit crash).
10. Dead enemy does not display intent or execute moves.

## Open Questions

1. **Intent animation**: Should intents animate in (fade-in) or appear instantly?
   Recommend: quick fade-in (0.2s) for juice without slowing decisions.
   Owner: UX Designer. Define during Combat UI GDD.

2. **Boss dialogue on phase transition**: Should bosses speak when changing phases?
   Recommend: yes, 1-2 short lines. Enhances boss identity.
   Owner: Writer. Content creation during Production.

3. **Elite unique AI mechanics**: Should elites have special AI beyond stronger stats
   and larger move pools? Recommend: MVP elites are just stronger normal enemies.
   Post-MVP can add unique abilities.
   Owner: Game Designer. Evaluate during Feature Layer design.
