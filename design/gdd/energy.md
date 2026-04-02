# Energy System

> **Status**: Designed
> **Author**: user + agents
> **Last Updated**: 2026-04-01
> **Implements Pillar**: Meaningful Opportunity Cost (limited energy forces tradeoffs on every card play)

## Overview

The Energy System manages turn-based energy as the primary resource for playing
cards. At the start of each player turn, energy is reset to a maximum value
(default 3). Playing a card costs energy equal to the card's cost. Unspent
energy at end of turn is lost. Relics, potions, card effects, and debuffs can
modify the maximum or grant/penalize energy, creating strategic tension around
how to spend a limited resource each turn.

## Player Fantasy

Every turn is a budgeting puzzle: "Do I play one big 3-cost card, or three
1-cost cards? Do I save this block card for next turn or go aggressive now?"
The energy cap creates genuine tradeoffs — you can never do everything you want,
so every choice has an opportunity cost. This directly serves the **Meaningful
Opportunity Cost** pillar: energy is a zero-sum resource within a turn, and
spending it on one thing means not spending it on another.

Reference: Slay the Spire nails this feeling with 3 base energy — enough to
feel capable, but not enough to feel comfortable.

## Detailed Design

### Core Rules

1. **Turn start energy reset**: At the beginning of each player turn:
   - `currentEnergy = effectiveMaxEnergy + bonusEnergy - penaltyEnergy`
   - `effectiveMaxEnergy = baseEnergy + relicBonus`
   - Result is clamped: `currentEnergy = max(0, startEnergy)`
   - All temporary bonuses and penalties from the *previous* turn are cleared
     before recalculation.

2. **Playing a card**: When the player plays a card:
   - If `card.costType == 'X'`: `actualCost = currentEnergy`
   - Else: `actualCost = card.cost`
   - Check: `currentEnergy >= actualCost` (card is unplayable if not)
   - Execute: `currentEnergy -= actualCost`
   - `currentEnergy` floor is 0 (cannot go negative)

3. **Turn end**: At the end of each player turn:
   - `currentEnergy = 0` (unspent energy is lost)
   - Any temporary energy modifiers that last "this turn only" expire.

4. **Zero-cost cards**: Cards with `cost: 0` are always playable regardless of
   current energy. They do not consume energy.

5. **Energy gain during turn**: Some card effects or relics can add energy
   mid-turn (e.g., "Gain 2 energy. Lose 1 HP."). This increases
   `currentEnergy` directly and does NOT increase `effectiveMaxEnergy`.

6. **Energy loss during turn**: Some effects can drain energy mid-turn. This
   reduces `currentEnergy` but floor is 0.

### States and Transitions

| State | When | Energy Value | Transition To |
|-------|------|-------------|---------------|
| **Reset** | Turn start, before calculation | 0 | → Full (after calculation) |
| **Full** | Turn start, after calculation | effectiveMax + bonuses | → Spending (first card played) |
| **Spending** | After each card play | Decreasing | → Depleted (energy = 0) or → Bonus (energy gained mid-turn) |
| **Bonus** | Mid-turn energy gain | Above initial value | → Spending (card played) |
| **Depleted** | currentEnergy = 0 | 0 | → Bonus (energy gain) or → End |
| **End** | Turn ends | 0 (forced) | → Reset (next turn start) |

State flow per turn:
```
Reset → Full → Spending ↔ Bonus → ... → Depleted/End → Reset
```

### Interactions with Other Systems

| System | Direction | Data Exchanged | When |
|--------|-----------|---------------|------|
| Card System | Energy ← Card | Card requests `currentEnergy >= card.cost` check | Before card play |
| Card System | Energy → Card | X-cost cards receive `currentEnergy` as their X value | On card play |
| Data/Config | Config → Energy | `baseEnergy` from `character.json`, `cost` from `cards.json` | Game start |
| Relic System | Relic → Energy | `relic.energyBonus` modifies `effectiveMaxEnergy` permanently | Passive (always on) |
| Status Effect | Effect → Energy | `penaltyEnergy` debuff reduces turn-start energy | Turn start calc |
| Potion System | Potion → Energy | Energy potion adds `bonusEnergy` this turn | On use |
| Combat UI | Energy → UI | `currentEnergy` and `effectiveMaxEnergy` for display | Continuous |

## Formulas

### Turn Start Calculation

```
effectiveMaxEnergy = baseEnergy + relicBonus
startEnergy = effectiveMaxEnergy + bonusEnergy - penaltyEnergy
currentEnergy = max(0, startEnergy)
```

Variables:
- `baseEnergy` (int): Character's base energy, from Data/Config. Default: 3
- `relicBonus` (int): Sum of all permanent energy bonuses from relics. Default: 0
- `bonusEnergy` (int): Sum of temporary energy bonuses this turn. Default: 0
- `penaltyEnergy` (int): Sum of temporary energy penalties this turn. Default: 0

### Card Cost Check

```
canPlay(card):
  if card.costType == 'X': return currentEnergy > 0
  if card.costType == 'Unplayable': return false
  return currentEnergy >= card.cost
```

### Energy Delta

```
gainEnergy(amount):
  currentEnergy += amount
  // No upper bound on currentEnergy

spendEnergy(amount):
  currentEnergy = max(0, currentEnergy - amount)
```

## Edge Cases

1. **All energy drained by debuff**: If `penaltyEnergy >= effectiveMaxEnergy + bonusEnergy`,
   turn starts with 0 energy. Player can still play 0-cost cards. This is
   intentional — it's a severe but survivable situation.

2. **X-cost card with 0 energy**: `canPlay` returns false for X-cost cards when
   energy is 0. X-cost cards require at least 1 energy.

3. **Multiple energy relics stacking**: Two relics each granting +1 energy result
   in +2 total. Stacking is additive and uncapped.

4. **Energy gain exceeds display**: UI shows current energy as a number. There
   is no hard cap — if effects grant 10 energy in a turn, UI shows 10.

5. **Relic that changes baseEnergy mid-combat**: Some boss relics (e.g., "Start
   each turn with 1 less energy, gain 1 energy per card played") modify the
   formula. The `effectiveMaxEnergy` recalculation happens at turn start, not
   during the turn.

6. **Simultaneous energy gain and loss**: If an effect says "Gain 2 energy, then
   lose 1 energy", apply sequentially: `currentEnergy += 2; currentEnergy -= 1`.
   Net result: +1. Order matters for triggered effects.

7. **Energy after combat ends**: Energy resets to 0 when combat ends. No energy
   carries between combats.

## Dependencies

### Upstream (this system depends on)

| System | Type | Interface |
|--------|------|-----------|
| Data/Config | Hard | `baseEnergy` from `character.json`, `cost`/`costType` from `cards.json` |

### Downstream (systems that depend on this)

| System | Type | Interface |
|--------|------|-----------|
| Card System | Hard | `canPlay(card)`, `spendEnergy(cost)`, `currentEnergy` for X-cost |
| Combat System | Hard | Turn start/end energy reset triggers |
| Combat UI | Soft | `currentEnergy`, `effectiveMaxEnergy` for display |
| Relic System | Soft | Relics can modify `relicBonus` or trigger `gainEnergy` |
| Potion System | Soft | Energy potions call `gainEnergy(amount)` |

## Tuning Knobs

| Knob | Location | Default | Safe Range | What Breaks |
|------|----------|---------|------------|-------------|
| `baseEnergy` | `character.json` | 3 | 1-5 | 1: Can barely play cards. 5: No decision pressure |
| `relicBonus` | `relics.json` | varies | 0-3 per relic | Too much makes late game trivial |
| `potionBonus` | `potions.json` | 2 | 1-3 | 3: Very strong, use sparingly |
| `penaltyEnergy` | `enemies.json` (debuff) | varies | 1-2 | 3+: Can soft-lock if player can't play any cards |

## Acceptance Criteria

1. Turn start sets `currentEnergy` to `max(0, baseEnergy + relicBonus + bonusEnergy - penaltyEnergy)`.
2. Playing a 2-cost card reduces `currentEnergy` by 2.
3. Card with `cost > currentEnergy` cannot be played (UI shows it grayed out).
4. X-cost card consumes all `currentEnergy` and reports the amount to the card effect.
5. Turn end forces `currentEnergy = 0`.
6. `penaltyEnergy >= effectiveMaxEnergy` results in 0 energy, not negative.
7. 0-cost card is playable at any energy level, including 0.
8. Energy gain mid-turn increases `currentEnergy` without affecting `effectiveMaxEnergy`.
9. Two relics each granting +1 energy result in `effectiveMaxEnergy = baseEnergy + 2`.

## Open Questions

1. **Energy UI animation**: Should energy orbs animate when gained/spent, or update
   instantly? Instant is clearer for strategic play; animation adds juice. Owner:
   UX Designer. Can defer to Combat UI GDD.

2. **Energy carry-over relic**: Should any relic allow unspent energy to carry over
   to the next turn? Slay the Spire avoids this intentionally. Recommendation: No
   carry-over in MVP. Owner: Game Designer. Decide during Relic System GDD.

3. **Energy cap**: Should `effectiveMaxEnergy` have a hard cap (e.g., 10)? Without
   a cap, stacked relics could theoretically give 10+ energy, making turns very
   long. Recommendation: No hard cap, but tune relic bonus values to keep typical
   range 3-6. Owner: Systems Designer. Verify during balance pass.
