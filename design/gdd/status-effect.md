# Status Effect System

> **Status**: Designed
> **Author**: user + agents
> **Last Updated**: 2026-04-01
> **Implements Pillar**: Informed Strategy (visible effects enable informed decisions), Readability First (clear effect icons and tooltips)

## Overview

The Status Effect System is the unified engine for managing all buffs, debuffs,
and temporary modifiers in the game. Cards, relics, enemies, potions, and events
all use a single interface to apply effects. The system handles stacking rules,
duration tracking, turn-end processing, and trigger callbacks. Every effect is
visible to the player with clear iconography and tooltip descriptions.

## Player Fantasy

Players should feel informed and in control. When an enemy shows an intent to
apply Vulnerable, the player can calculate the exact consequence. When they see
Poison ticking down, they know exactly how many turns of damage remain. This
serves the **Informed Strategy** pillar — all effects are visible with exact
numbers, enabling optimal play. It also serves **Readability First** — effect
icons are immediately distinguishable, and tooltips explain mechanics precisely.

Reference: Slay the Spire nails this with clean effect icons, exact stack/duration
numbers, and hover-to-read tooltips. No hidden information.

## Detailed Design

### Core Rules

**1. Effect Categories**

| Category | Description | Examples |
|----------|-------------|----------|
| **Buff** | Positive effect on the target | Strength, Dexterity, Artifact, Energized, Intangible |
| **Debuff** | Negative effect on the target | Vulnerable, Weak, Frail, Poison |
| **Neutral** | Neither positive nor negative | Draw effects, card manipulation markers |

**2. Duration Types**

| Duration Type | Behavior | Examples |
|--------------|----------|----------|
| `combat` | Persists until combat ends | Strength, Dexterity |
| `turns` | Decrements by 1 at end of target's turn; removed at 0 | Vulnerable, Weak, Frail |
| `stacks` | Decrements by 1 when triggered; removed at 0 | Poison (1 per turn end), Artifact (1 per debuff negated) |
| `permanent` | Never expires naturally; removed by specific effects | Certain relic-granted buffs |

**3. Stacking Modes**

| Mode | Behavior | Examples |
|------|----------|----------|
| `addDuration` | New duration added to existing | Vulnerable (2 + 1 = 3 turns) |
| `addStacks` | New stacks added to existing | Poison (3 + 2 = 5 stacks) |
| `overwriteMax` | Take maximum of old and new | Intangible (max(2, 1) = 2) |
| `doesNotStack` | If already active, ignore new application | Certain unique buffs |

**4. Turn-End Processing Order**

At the end of each entity's turn, effects are processed in this exact order:

1. **Poison deals damage**: `stacks` damage, then `stacks -= 1`
2. **Turn-based effects decrement**: Duration -1 for all `turns`-type effects
3. **Remove expired effects**: All effects with duration/stacks = 0 are removed
4. **onTurnEnd triggers fire**: e.g., Metallicize → gain Block, Plated Armor → gain Block

This order matters: Poison damage happens before duration decrement, and
removal happens before end-of-turn triggers.

**5. Trigger Timings**

| Trigger | When Fired | Example Use |
|---------|-----------|-------------|
| `onApply` | Effect is first applied to target | Buffer Block gain |
| `onTurnStart` | At the start of the entity's turn | Draw bonus, energy gain |
| `onTurnEnd` | At the end of the entity's turn | Metallicize, Plated Armor |
| `onCardPlayed` | After a card is played | Combo counters |
| `onAttack` | When this entity deals attack damage | Strength modification |
| `onDamageTaken` | When this entity takes damage | Thorns damage |
| `onDebuffApplied` | When a debuff would be applied | Artifact negation |

**6. Artifact Negation**

When a debuff would be applied to a target:
1. Check if target has `Artifact` with stacks > 0
2. If yes: `Artifact.stacks -= 1`, debuff is **negated** (not applied at all)
3. If Artifact stacks reach 0, remove the Artifact effect
4. Buffs are NOT negated by Artifact — only debuffs
5. Boss immunity is checked separately — immune effects are ignored entirely,
   they do NOT consume Artifact

### States and Transitions

| State | Description | Transition To |
|-------|-------------|---------------|
| **Defined** | Effect schema exists in Data/Config | → Instantiated (on `applyEffect` call) |
| **Instantiated** | Effect created, attached to entity | → Active (after apply logic) or → Negated (Artifact block) |
| **Active** | Effect is influencing gameplay | → Expiring (duration/stacks reach 0) |
| **Expiring** | About to be removed | → Removed (cleanup) |
| **Negated** | Blocked by Artifact — never applied | → (terminal, cleaned up) |
| **Removed** | Effect cleaned up from entity | → (terminal) |

### Interactions with Other Systems

| System | Direction | Data Exchanged | When |
|--------|-----------|---------------|------|
| Data/Config | Config → Effect | Effect schema: name, type, durationType, stackingMode, trigger callbacks | Load time |
| Combat System | Combat → Effect | `applyEffect(targetId, effectId, stacks)` | Card play, enemy action |
| Combat System | Effect → Combat | Damage/block modifiers: `getModifier(targetId, "Vulnerable")` → multiplier | Damage/block calculation |
| Card System | Card → Effect | Card effects trigger `applyEffect` | Card resolution |
| Enemy AI | AI → Effect | Enemy intents trigger `applyEffect` | Enemy turn |
| Relic System | Relic → Effect | Relics apply passive or triggered effects | Various triggers |
| Potion System | Potion → Effect | Potions apply temporary effects | Potion use |
| Energy System | Effect → Energy | Certain debuffs add `penaltyEnergy` | Turn start calculation |
| Combat UI | Effect → UI | Active effects list for display (icon, stacks/duration, tooltip) | Continuous |

## Formulas

### Damage Modifiers

```
vulnerableMultiplier(target):
  if target.hasEffect("Vulnerable"): return 1.5
  else: return 1.0

weakMultiplier(attacker):
  if attacker.hasEffect("Weak"): return 0.75
  else: return 1.0

strengthBonus(attacker):
  return attacker.getEffectStacks("Strength")  // can be negative

// Final attack damage:
damage = baseDamage + strengthBonus(attacker)
damage = Math.floor(damage * vulnerableMultiplier(target))
damage = Math.floor(damage * weakMultiplier(attacker))
damage = Math.max(0, damage)  // floor at 0
```

### Block Modifiers

```
frailMultiplier(target):
  if target.hasEffect("Frail"): return 0.75
  else: return 1.0

dexterityBonus(target):
  return target.getEffectStacks("Dexterity")  // can be negative

// Final block from a card:
block = baseBlock + dexterityBonus(target)
block = Math.floor(block * frailMultiplier(target))
block = Math.max(0, block)  // floor at 0
```

### Poison Damage

```
poisonTick(target):
  stacks = target.getEffectStacks("Poison")
  if stacks <= 0: return 0
  damage = stacks  // 1 damage per stack, bypasses Block
  target.modifyEffect("Poison", -1)  // reduce by 1
  if target.getEffectStacks("Poison") <= 0:
    target.removeEffect("Poison")
  return damage
```

### Artifact Negation

```
tryApplyDebuff(target, effectId, stacks):
  // Boss immunity check (from Data/Config)
  if target.isImmuneTo(effectId): return false  // not applied, no Artifact consumed
  
  // Artifact check
  artifactStacks = target.getEffectStacks("Artifact")
  if artifactStacks > 0:
    target.modifyEffect("Artifact", -1)
    if target.getEffectStacks("Artifact") <= 0:
      target.removeEffect("Artifact")
    return false  // negated
  
  // Apply normally
  applyEffect(target, effectId, stacks)
  return true  // applied
```

## Edge Cases

1. **Same effect applied twice in one action**: Both applications process
   sequentially. Vulnerable(2) then Vulnerable(1) → Vulnerable(3) via addDuration.

2. **Negative stacks**: Strength and Dexterity can go negative. Negative Strength
   reduces attack damage. Negative Dexterity reduces block. No floor on the stack
   value itself, but final damage/block calculations floor at 0.

3. **Poison reaches 0**: Poison(1) ticks for 1 damage, reduces to 0, effect
   removed. Next poison application starts fresh from the applied amount.

4. **Intangible + Poison**: Intangible limits incoming attack damage to 1, but
   Poison damage bypasses Block AND Intangible — Poison always deals full stacks.

5. **Frail and non-card Block**: Frail only affects Block gained from cards.
   Block from relics (e.g., Orichalcum: "If you end your turn with 0 Block, gain 6
   Block") or effects (Metallicize) is NOT reduced by Frail.

6. **Multiple debuffs vs. Artifact(1)**: Three debuffs applied simultaneously
   are processed sequentially. Artifact negates the first, the remaining two apply.

7. **Effect on dead entity**: If an entity dies mid-turn, remaining effects on
   that entity are cleared. No post-death triggers fire (no "on death" poison tick).

8. **Combat end cleanup**: When combat ends, ALL effects on ALL entities are
   removed. No effects persist between combats (Strength/Dexterity are combat-only).

9. **Effect applied during its own trigger**: If `onTurnEnd` of Effect A causes
   Effect A to be reapplied, the reapplication happens after the current trigger
   batch completes. Prevents infinite loops.

10. **Boss immunity**: Some bosses are immune to specific debuffs (defined in
    enemy data). Immune debuffs are silently ignored — they do NOT consume Artifact.

## Dependencies

### Upstream (this system depends on)

| System | Type | Interface |
|--------|------|-----------|
| Data/Config | Hard | `getStatusEffect(id)` → schema with name, type, durationType, stackingMode, triggerDef |

### Downstream (systems that depend on this)

| System | Type | Interface |
|--------|------|-----------|
| Combat System | Hard | Damage/block formula queries (`getModifier`, `getEffectStacks`) |
| Card System | Hard | Card effects call `applyEffect` |
| Enemy AI System | Hard | Enemy intents call `applyEffect` for debuffs |
| Relic System | Soft | Relics register passive effects and trigger listeners |
| Potion System | Soft | Potions call `applyEffect` |
| Energy System | Soft | Status effects can modify `penaltyEnergy` |
| Combat UI | Soft | Reads active effects for icon/tooltip display |

## Tuning Knobs

| Knob | Location | Default | Safe Range | What Breaks |
|------|----------|---------|------------|-------------|
| `vulnerableMultiplier` | `status-effects.json` | 1.5 | 1.0-2.0 | 1.0: no downside; 2.0: double damage too punishing |
| `weakMultiplier` | `status-effects.json` | 0.75 | 0.5-1.0 | 0.5: halved damage too harsh; 1.0: no downside |
| `frailMultiplier` | `status-effects.json` | 0.75 | 0.5-1.0 | Same as Weak |
| `poisonDamagePerStack` | `status-effects.json` | 1 | 1-3 | 3: Poison dominates all builds |
| `defaultVulnerableDuration` | `enemies.json` | 2 | 1-3 | 1: barely matters; 3: very punishing early |
| `defaultWeakDuration` | `enemies.json` | 2 | 1-3 | Same |
| `defaultFrailDuration` | `enemies.json` | 2 | 1-3 | Same |
| `intangibleMaxDuration` | `status-effects.json` | 1 | 1-2 | 2: nearly invincible |

## Acceptance Criteria

1. Applying Vulnerable(2) then Vulnerable(1) → target has Vulnerable(3 turns).
2. Poison(3) at turn end: deals 3 damage, becomes Poison(2).
3. Artifact(1) negates next debuff, Artifact removed afterward.
4. Strength can go negative; -2 Strength means attacks deal 2 less damage.
5. Frail reduces card-gained Block but NOT relic/effect Block.
6. `combat`-duration effects persist across turns until combat ends.
7. `turns`-duration effects decrease by 1 at end of target's turn; removed at 0.
8. Boss immune to a debuff → debuff ignored, Artifact NOT consumed.
9. Turn-end processing order: Poison damage → duration decrement → removal →
   onTurnEnd triggers (verifiable by test with simultaneous Poison + Metallicize).
10. Effect applied during its own trigger does not cause infinite loop.

## Open Questions

1. **Effect limit per entity**: Should there be a maximum number of concurrent
   effects per entity? If unlimited, UI could overflow. Recommend: soft cap of
   10 visible effects (oldest scroll off or collapse). Owner: UX Designer.
   Decision needed before Combat UI GDD.

2. **Buff/Debuff cleanse card design**: Cards that "remove all debuffs" — should
   this be a status effect operation or a separate system? Recommend: `removeEffects`
   method on this system with filter (byCategory: "debuff"). Owner: Card System GDD.

3. **Stacking mode for new custom effects**: Should modders/designers be able to
   define new stacking modes beyond the 4 listed? Recommend: start with 4, add
   custom modes via plugin pattern if needed post-MVP. Owner: Tech Director.
