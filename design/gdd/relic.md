# Relic System

> **Status**: Designed
> **Author**: user + agents
> **Last Updated**: 2026-04-02
> **Implements Pillar**: Adaptive Builds (relics fundamentally alter run strategy), Informed Strategy (relic effects are transparent)

## Overview

The Relic System manages the player's passive relic collection. Relics are permanent
passive-effect items — once obtained, they persist throughout the entire run without
requiring equipping or activation. Relics are obtained through elite combats, boss
combats, events, and shops. Each relic has one or more triggers that fire at specific
game events. Relics are the key driver of build diversity — they fundamentally change
your strategy from run to run.

## Player Fantasy

This is the core of the **Adaptive Builds** pillar: relics define what makes each run
unique. Every run you obtain different relics, forcing you to adapt your strategy.
Getting Ornamental Fan (gain Block after being attacked) encourages a tanky playstyle;
Sundial (gain 2 gold every 3 shuffles) rewards frequent shuffling. Relics make every
run feel different.

Reference: Slay the Spire's relics are iconic. They're the primary source of run-to-run
variety and the reason no two runs play the same.

## Detailed Design

### Core Rules

**1. Relic Data Schema**

```
interface RelicData {
  id: string;                // "burning_blood", "ornamental_fan", etc.
  name: string;              // Display name
  description: string;       // Effect description
  flavorText?: string;       // Lore flavor text
  tier: RelicTier;           // STARTER | COMMON | UNCOMMON | RARE | BOSS | SHOP | EVENT
  triggers: RelicTrigger[];  // When this relic fires
  counter?: RelicCounter;    // Optional counter mechanism
  stackable: boolean;        // Can player get multiple copies? (usually false)
}
```

**2. Relic Tiers**

| Tier | Source | Examples |
|------|--------|----------|
| STARTER | Character starting relic | Burning Blood, Ring of the Snake |
| COMMON | Elite combat reward | Anchor, Orichalcum, Vajra |
| UNCOMMON | Elite combat reward | Ornamental Fan, Shuriken, Pen Nib |
| RARE | Elite combat reward | Dead Branch, Kunai, Wrist Blade |
| BOSS | Boss combat reward (pick 1 of 3) | Runic Cube, Coffee Dripper, Fusion Hammer |
| SHOP | Shop purchase | Cauldron, Chem X, Orange Pellets |
| EVENT | Event reward | FaceTrader, Mutagenic Strength |

**3. Relic Triggers**

| Trigger | When | Example Relic |
|---------|------|---------------|
| `onCombatStart` | Combat begins | Bag of Marbles (apply 1 Vulnerable to all enemies) |
| `onCombatEnd` | Combat ends | Burning Blood (heal 6 HP) |
| `onTurnStart` | Each turn start | Sundial (every 3rd shuffle: gain 2 gold) |
| `onTurnEnd` | Each turn end | Orichalcum (if Block=0, gain 6 Block) |
| `onCardPlayed` | Card is played | Shuriken (every 3 attacks: gain 1 Strength) |
| `onAttack` | Attack damage dealt | Pen Nib (every 10th attack: double damage) |
| `onDamageTaken` | Damage is taken | Anchor (combat start: gain 10 Block) |
| `onShuffle` | Discard shuffled into Draw | Sundial counter increment |
| `onHeal` | Healing occurs | Meat on the Bone (if HP ≤ 50% at turn end, heal 5) |
| `onPotionUsed` | Potion is used | Potion Belt (+2 potion slots) |
| `onRelicObtained` | Relic is obtained | Courier (shop restocks cheaper) |
| `onGoldGained` | Gold is gained | Sling of Courage (+1 Strength per 100 gold) |
| `onCardExhausted` | Card is exhausted | Dead Branch (exhaust → add random card to hand) |
| `onBlockLost` | Block resets to 0 at turn start | Heap of Earth (gain 3 Block when Block resets) |
| `passive` | Always active | Vajra (always +1 Strength), Boss energy relics |

**4. Relic Counter System**

```
interface RelicInstance {
  data: RelicData;
  counter: number;         // current counter value
  counterTarget: number;   // target value to trigger
  enabled: boolean;        // some effects can disable relics
}

// Example: Shuriken
// counter starts at 0, counterTarget = 3
// onCardPlayed(ATTACK): counter++
// when counter == counterTarget: gain 1 Strength, counter = 0
```

**5. Relic Pool Management**

```
interface RelicPool {
  all: string[];                    // all relic IDs
  obtained: string[];               // relics obtained this run
  available: string[];              // all - obtained

  getRelic(tier: RelicTier): string;  // random available relic of tier
  markObtained(id: string): void;     // add to obtained list
}
```

- No duplicate relics in a run (unless `stackable: true`)
- Obtained relics removed from available pool
- Boss relics may have negative costs

**6. Boss Relic Cost Mechanic**

| Relic | Effect | Cost |
|-------|--------|------|
| Coffee Dripper | Heal 5 HP after each combat | Cannot rest at Rest Sites |
| Fusion Hammer | +1 energy per turn | Cannot buy cards at shops |
| Runic Cube | Draw 1 extra card per turn | Lose 1 HP per turn |
| Busted Crown | +1 energy per turn | Card rewards show 2 cards (not 3) |

**7. Trigger Execution Order**

When multiple relics fire at the same trigger point, they execute in order of
acquisition (first obtained = first triggered).

### Relic Triggers

Triggers are checked at specific points in the game loop. The Relic System
maintains a registry of active relics mapped to their triggers:

```
triggerRelics(triggerName: string, context: TriggerContext):
  for relic in relicsByTrigger[triggerName]:
    if relic.enabled:
      relic.execute(context)
```

The `context` object provides relevant data:
- `source`: entity that caused the trigger
- `target`: entity affected
- `card`: card involved (for card-related triggers)
- `damage`: damage amount (for damage triggers)
- `combat`: reference to current combat state

### Interactions with Other Systems

| System | Direction | Data Exchanged | When |
|--------|-----------|---------------|------|
| Data/Config | Config → Relic | `getRelic(id)` → RelicData, tier pools | Load time |
| Status Effect | Relic → Effect | `applyEffect()` for relic-triggered effects | Trigger fires |
| Energy System | Relic → Energy | `relicBonus` for energy-granting relics | Passive |
| Reward System | Reward → Relic | `addRelic(relicId)` on elite/boss reward | Post-combat |
| Shop System | Shop → Relic | `addRelic(relicId)` on purchase | Shopping |
| Event System | Event → Relic | `addRelic(relicId)` on event reward | Event resolution |
| Run State Manager | Relic → Run | Relic list serialization | Save/load |
| Combat System | Combat → Relic | Trigger hooks during combat events | Combat flow |
| Potion System | Relic → Potion | Potion Belt increases maxSlots | On obtain |
| Combat UI | Relic → UI | Relic list display, counter values | Continuous |

## Formulas

### Pen Nib Damage

```
penNibDamage(baseDamage, counter):
  counter++
  if counter >= 10:
    damage = baseDamage * 2
    counter = 0
  else:
    damage = baseDamage
  return { damage, counter }
```

### Orichalcum Block

```
orichalcumBlock(currentBlock):
  if currentBlock == 0: return 6
  return 0
```

### Meat on the Bone Heal

```
meatOnTheBone(currentHP, maxHP):
  if currentHP <= Math.floor(maxHP * 0.5): return 5
  return 0
```

### Dead Branch Card Generation

```
deadBranch(characterId, rng):
  pool = getAvailableCards(characterId).filter(c => c.rarity != STARTER)
  card = rng.weightedPick(pool, c => 1)
  return card  // added to hand
```

### Sundial Gold

```
sundialGold(shuffleCounter):
  shuffleCounter++
  if shuffleCounter >= 3:
    shuffleCounter = 0
    return 2
  return 0
```

## Edge Cases

1. **Duplicate relic prevention**: `relicPool.markObtained()` called on acquisition.
   If generation tries to give an already-obtained relic, re-roll.

2. **Boss relic cost already paid**: If player rested before getting Coffee Dripper,
   the past rest is not reversed. Cost only applies going forward.

3. **Relic triggers during relic acquisition**: Obtaining relic A may trigger relic B's
   `onRelicObtained`. Process in acquisition order.

4. **Disabled relic**: Some effects can temporarily disable a relic. Disabled relics
   do not fire any triggers. Counter state is preserved.

5. **Counter overflow**: Counter triggers immediately upon reaching target and resets.
   Cannot exceed target value.

6. **Dead Branch with empty card pool**: Should not happen (character always has
   non-Starter cards). If it does, no card is generated.

7. **Multiple relics modify same value**: E.g., Vajra (+1 Strength) + Akabeko (first
   attack +8 damage). Effects stack in acquisition order.

8. **Relic obtained mid-combat**: Some events give relics during combat. The relic
   activates immediately but only passive effects apply. `onCombatStart` is NOT
   retroactively triggered.

9. **Potion Belt slot increase**: Gained immediately on relic obtain. New slots are
   empty. Already-held potions are unaffected.

10. **No extra relics obtained**: Valid. Player can complete a run with only the
    starter relic. Very difficult but possible.

## Dependencies

### Upstream (this system depends on)

| System | Type | Interface |
|--------|------|-----------|
| Data/Config | Hard | `getRelic(id)` → RelicData, tier pool definitions |
| Status Effect | Hard | `applyEffect()` for relic effects that apply status effects |
| RNG System | Soft | Reward stream for random card generation (Dead Branch, etc.) |

### Downstream (systems that depend on this)

| System | Type | Interface |
|--------|------|-----------|
| Reward System | Hard | `addRelic(relicId)` on elite/boss reward |
| Run State Manager | Hard | Relic list serialization, `relicBonus` for energy |
| Shop System | Soft | Shop-tier relic sales |
| Event System | Soft | Event-tier relic rewards |
| Energy System | Soft | `relicBonus` from energy-granting relics |
| Combat System | Soft | Trigger hooks during combat events |
| Potion System | Soft | Potion Belt increases maxSlots |

## Tuning Knobs

| Knob | Location | Default | Safe Range | What Breaks |
|------|----------|---------|------------|-------------|
| `eliteRelicPool` | `relics.json` | 30+ | 15-50 | 15: too few options; 50: too diluted |
| `bossRelicPool` | `relics.json` | 30+ | 15-50 | Same |
| `shopRelicCost` | `shop-config.json` | 150 | 100-200 | 100: too cheap; 200: too expensive |
| `starterRelicReplaceable` | `game-config.json` | false | — | True: starter can be removed |
| `penNibTarget` | `relics.json` | 10 | 5-15 | 5: triggers too often; 15: too rare |
| `shurikenTarget` | `relics.json` | 3 | 2-5 | 2: too easy; 5: hard to enable |

## Acceptance Criteria

1. Obtained relic activates immediately (passive effects apply).
2. No duplicate relics in a single run (unless stackable).
3. Boss relic: pick 1 of 3, or skip all.
4. Relic triggers fire at correct timing (onCombatStart, onTurnEnd, onCardPlayed, etc.).
5. Counter relics (Shuriken, Pen Nib) count correctly and trigger at target.
6. Boss relic costs execute correctly (Coffee Dripper disables resting).
7. Multiple relics firing at same trigger execute in acquisition order.
8. Relic Pool filters out already-obtained relics.
9. Orichalcum grants 6 Block when Block is 0 at turn end.
10. Dead Branch generates a random card to hand when a card is exhausted.

## Open Questions

1. **Relic animation on trigger**: Should relic icons pulse/glow when their trigger
   fires? Recommend: yes, quick flash for feedback. Owner: UX Designer.

2. **Relic tooltip detail**: How much info should relic tooltips show? Full mechanics
   or flavor only? Recommend: full mechanics with exact numbers. Owner: UX Designer.
   Combat UI GDD.

3. **Relic removal mechanic**: Should any mechanic allow removing a relic?
   Slay the Spire has We meet again event. Recommend: yes, but limited to events.
   Owner: Game Designer. Event System GDD.
