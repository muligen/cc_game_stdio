# Ascension System

> **Status**: Designed
> **Author**: user + agents
> **Last Updated**: 2026-04-02
> **Implements Pillar**: Calculated Tension (each level raises stakes), Adaptive Builds (forces new strategies at higher difficulty)

## Overview

The Ascension System provides 20 escalating difficulty levels unlocked progressively after each victory. Each level introduces a new restriction or enemy enhancement, forcing players to adapt their strategies. Beating Ascension 20 is the game's ultimate challenge. Modeled after Slay the Spire's Ascension mode.

## Player Fantasy

**Calculated Tension**: each Ascension level makes the game harder, but you chose to challenge it. Winning at higher Ascension brings immense satisfaction. **Adaptive Builds**: high Ascension forces you to abandon comfortable strategies and discover new build directions. The deck that cleared A5 may fail at A10.

Reference: Slay the Spire's Ascension 0-20 is the game's core challenge loop and keeps players engaged for hundreds of hours.

## Detailed Design

### Ascension Level Data

| Level | Effect | Category |
|-------|--------|----------|
| 1 | Normal enemies have +1 HP per act | Enemy |
| 2 | Elites spawn 10% more frequently | Map |
| 3 | Elite enemies have +1 HP per act | Enemy |
| 4 | Boss enemies have +1 HP per act | Enemy |
| 5 | -5% starting gold (min 0) | Economy |
| 6 | -1 max potion slots (min 2) | Player |
| 7 | +1 Elite per act (max 4 → 5) | Map |
| 8 | Elite enemies have +1 Strength | Enemy |
| 9 | Boss enemies have +1 Strength | Enemy |
| 10 | Normal enemies have +1 Strength | Enemy |
| 11 | Potion drop rate -10% | Reward |
| 12 | Upgraded enemies appear in first 3 floors | Enemy |
| 13 | Card reward shifted toward uncommon/rare | Reward |
| 14 | -5 maxHP at start | Player |
| 15 | Events 50% more likely to be negative | Event |
| 16 | Shop prices +15% | Economy |
| 17 | Normal enemies have +2 HP per act | Enemy |
| 18 | Elite enemies have +2 HP per act | Enemy |
| 19 | Boss enemies have +2 HP per act | Enemy |
| 20 | Boss enemies have +2 Strength | Enemy |

### Ascension Progress Tracking

```
interface AscensionProgress {
  characterId: string
  highestCompleted: number  // 0-20, 0 = no ascension cleared
  unlockedLevel: number     // next available level
}
```

- Per-character tracking
- Completing Ascension N unlocks Ascension N+1
- Starting a run: player selects Ascension level (0 to unlockedLevel)
- Ascension 0 = base game (no modifiers)

### Ascension Level Application

```
applyAscension(ascensionLevel, runState, config):
  if ascensionLevel >= 1: config.enemyHPBonus += 1 * runState.currentAct
  if ascensionLevel >= 5: runState.gold = Math.max(0, runState.gold - Math.floor(startingGold * 0.05))
  if ascensionLevel >= 6: runState.maxPotionSlots = Math.max(2, runState.maxPotionSlots - 1)
  if ascensionLevel >= 14:
    runState.maxHP -= 5
    runState.currentHP = Math.min(runState.currentHP, runState.maxHP)
  // etc. — all modifiers applied at run start or dynamically
```

## Formulas

### Enemy HP Scaling

```
effectiveEnemyHP(baseHP, ascensionLevel, currentAct):
  bonus = 0
  if ascensionLevel >= 1: bonus += 1 * currentAct
  if ascensionLevel >= 17: bonus += 2 * currentAct
  return baseHP + bonus

effectiveEliteHP(baseHP, ascensionLevel, currentAct):
  bonus = 0
  if ascensionLevel >= 3: bonus += 1 * currentAct
  if ascensionLevel >= 18: bonus += 2 * currentAct
  return baseHP + bonus

effectiveBossHP(baseHP, ascensionLevel, currentAct):
  bonus = 0
  if ascensionLevel >= 4: bonus += 1 * currentAct
  if ascensionLevel >= 19: bonus += 2 * currentAct
  return baseHP + bonus
```

### Enemy Strength Scaling

```
effectiveEnemyStrength(baseStrength, ascensionLevel):
  bonus = 0
  if ascensionLevel >= 10: bonus += 1
  return baseStrength + bonus

effectiveEliteStrength(baseStrength, ascensionLevel):
  bonus = 0
  if ascensionLevel >= 8: bonus += 1
  return baseStrength + bonus

effectiveBossStrength(baseStrength, ascensionLevel):
  bonus = 0
  if ascensionLevel >= 9: bonus += 1
  if ascensionLevel >= 20: bonus += 2
  return baseStrength + bonus
```

### Other Scaling

```
effectiveEliteCount(baseCount, ascensionLevel):
  if ascensionLevel >= 7: return baseCount + 1
  return baseCount

effectivePotionDropRate(baseRate, ascensionLevel):
  if ascensionLevel >= 11: return Math.max(0.1, baseRate - 0.10)
  return baseRate

effectiveShopPrice(basePrice, ascensionLevel):
  if ascensionLevel >= 16: return Math.ceil(basePrice * 1.15)
  return basePrice

effectiveMaxHP(baseMaxHP, ascensionLevel):
  hp = baseMaxHP
  if ascensionLevel >= 14: hp -= 5
  return Math.max(1, hp)
```

## Edge Cases

1. **Ascension 20 on all characters**: Each character tracks independently. Completing A20 on Ironclad doesn't unlock it for Silent.

2. **Negative gold from A5**: Starting gold floor is 0. Cannot go negative.

3. **MaxHP reduction from A14**: Cannot reduce below 1 maxHP. If character base HP is 80, A14 gives 75.

4. **Potion slots from A6**: Minimum 2 slots. If relic expands to 5, A6 reduces to 4.

5. **Multiple HP bonuses stacking**: A1 and A17 both add HP per act. At A17 Act 3: +3 HP (1*3 + 2*3) total bonus.

6. **Ascension 0 (base game)**: No modifiers applied. Default experience.

7. **Completing ascension with character that hasn't unlocked it**: Not possible — must select unlocked level.

8. **Ascension effects on events**: A15 increases negative event weight by 50%, not guaranteed negative.

## Dependencies

### Upstream (this system depends on)

| System | Type | Interface |
|--------|------|-----------|
| Data/Config | Hard | Ascension level definitions, modifier values |
| Run State Manager | Hard | Starting conditions modification (HP, gold, potion slots) |
| Combat System | Hard | Enemy HP/Strength modification |
| Map System | Hard | Elite count modification |
| Reward System | Hard | Potion drop rate, card rarity shift |
| Event System | Hard | Event weight modification |
| Shop System | Hard | Price modification |

### Downstream (systems that depend on this)

| System | Type | Interface |
|--------|------|-----------|
| Meta-Progression | Soft | Ascension completion feeds into meta-progression tracking |

## Tuning Knobs

| Knob | Location | Default | Safe Range | What Breaks |
|------|----------|---------|------------|-------------|
| `maxAscensionLevel` | `ascension-config.json` | 20 | 10-30 | 10: too few; 30: grindy |
| `hpBonusPerAct` | `ascension-config.json` | 1 | 1-3 | 3: enemies too tanky |
| `goldReductionPercent` | `ascension-config.json` | 0.05 | 0-0.15 | 0.15: too punishing |
| `maxHPReduction` | `ascension-config.json` | 5 | 3-10 | 10: very fragile start |
| `shopPriceMultiplier` | `ascension-config.json` | 1.15 | 1.0-1.30 | 1.30: shops nearly useless |

## Acceptance Criteria

1. Ascension level selectable at run start (0 to unlocked).
2. Each level applies correct modifier to run state.
3. Enemy HP/Strength modified per ascension rules.
4. Elite count modified per ascension rules.
5. Starting gold/maxHP modified correctly.
6. Potion slots modified correctly.
7. Shop prices modified correctly.
8. Ascension completion unlocks next level for that character.
9. Per-character ascension tracking.
10. Ascension 0 = base game (no modifiers).

## Open Questions

1. **Ascension rewards**: Should higher Ascension give cosmetic rewards (card backs, titles)?
   Recommend: yes, Post-MVP cosmetic unlocks. Owner: Game Designer.

2. **Ascension leaderboards**: Should there be per-Ascension leaderboards?
   Recommend: yes, if online features exist. Post-MVP. Owner: Analytics Engineer.

3. **Custom Ascension**: Should players be able to toggle individual modifiers?
   Recommend: no — defeats the purpose of progressive difficulty. Owner: Game Designer.
