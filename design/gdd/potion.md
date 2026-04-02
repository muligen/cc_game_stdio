# Potion System

> **Status**: Designed
> **Author**: user + agents
> **Last Updated**: 2026-04-02
> **Implements Pillar**: Adaptive Builds (potions enable flexible responses), Informed Strategy (potion effects are clear and predictable)

## Overview

The Potion System manages the player's potion inventory and usage mechanics. Each
character has up to 3 potion slots (expandable to 5 via relics). Potions are
single-use consumables — once used, the slot is emptied. Potions are obtained
through combat reward drops, events, and shop purchases. They provide one-time
effects: healing HP, gaining energy, applying status effects, temporary buffs,
and more. Potions can be used during combat (player turn only) or outside combat
(if the potion allows it).

## Player Fantasy

Potions are your emergency buttons. When your calculations are off, your energy
runs short, or you encounter a dangerous situation, potions are your backup plan.
**Adaptive Builds**: different potion combinations support different strategies —
attack potions for damage, defensive potions for survival. **Informed Strategy**:
every potion's effect is clearly described — you know exactly what each bottle does.

Reference: Slay the Spire's potions feel impactful without being mandatory. They're
safety nets that enable riskier plays.

## Detailed Design

### Core Rules

**1. Potion Data Schema**

```
interface PotionData {
  id: string;              // "fire_potion", "block_potion", etc.
  name: string;            // Display name
  description: string;     // Effect description
  rarity: PotionRarity;    // COMMON | UNCOMMON | RARE
  target: TargetType;      // SELF | ENEMY | NONE
  effects: PotionEffect[]; // Effects on use
  canUseInCombat: boolean; // default true
  canUseOutOfCombat: boolean; // varies
}
```

**2. Potion Rarity**

| Rarity | Drop Weight | Examples |
|--------|-------------|----------|
| COMMON | 65% | Fire Potion (20 dmg), Block Potion (12 Block), Energy Potion (2 energy) |
| UNCOMMON | 25% | Fear Potion (apply Weak 3), Speed Potion (draw 3 cards) |
| RARE | 10% | Fairy Potion (revive on death), Ghost Potion (gain Intangible) |

**3. Potion Inventory**

```
interface PotionSlots {
  slots: (PotionData | null)[];  // maxSlots entries, null = empty
  maxSlots: number;              // base 3, relic can increase
}
```

- Base slots: 3 (relics can add +1 or +2)
- Fixed-size array, not an infinite list
- Each slot holds one potion or is empty
- New potion: placed in first empty slot
- Full slots: player can swap (discard existing) or skip new potion

**4. Potion Use Rules**

- **In combat**: Click potion → select target (if needed) → execute effect → slot emptied
- **Out of combat**: Only `canUseOutOfCombat: true` potions (e.g., Blood Potion)
- **Timing**: Any time during player's turn (costs no energy, does not count as a card play)
- **Per-turn limit**: Unlimited (can use multiple potions per turn)
- **Enemy turn**: Cannot use potions during enemy turn

**5. Potion Effect Types**

| Effect Type | Description | Examples |
|-------------|-------------|----------|
| `dealDamage` | Deal X damage to target | Fire Potion (20), Explosive Potion (10 to all) |
| `gainBlock` | Gain X Block | Block Potion (12) |
| `gainEnergy` | Gain X energy this turn | Energy Potion (2) |
| `applyEffect` | Apply status effect | Fear Potion (Weak 3), Poison Potion (Poison 6) |
| `heal` | Restore X HP | Blood Potion (20% maxHP) |
| `drawCards` | Draw X cards | Speed Potion (draw 3) |
| `special` | Unique effect | Fairy Potion (auto-revive), Ghost Potion (Intangible) |

### Potion Inventory

**MVP Potion List (Ironclad-relevant):**

| ID | Name | Rarity | Effect | Target |
|----|------|--------|--------|--------|
| `fire_potion` | Fire Potion | COMMON | Deal 20 damage | ENEMY |
| `block_potion` | Block Potion | COMMON | Gain 12 Block | SELF |
| `energy_potion` | Energy Potion | COMMON | Gain 2 energy | SELF |
| `blood_potion` | Blood Potion | COMMON | Heal 20% maxHP | SELF |
| `fear_potion` | Fear Potion | UNCOMMON | Apply Weak 3 turns | ENEMY |
| `speed_potion` | Speed Potion | UNCOMMON | Draw 3 cards | SELF |
| `strength_potion` | Strength Potion | UNCOMMON | Gain 2 Strength (combat) | SELF |
| `weak_potion` | Weak Potion | UNCOMMON | Apply Weak 2 to all enemies | ALL_ENEMY |
| `fairy_potion` | Fairy Potion | RARE | Auto-revive on death (30% HP) | SELF |
| `ghost_potion` | Ghost Potion | RARE | Gain Intangible 1 turn | SELF |
| `liquid_memo` | Liquid Memories | RARE | Return all exhausted cards to draw pile | SELF |

**Fairy Potion (Special Mechanic):**

- When used, applies a persistent buff for the entire combat (not an immediate effect)
- When player HP reaches 0: HP restored to 30% of maxHP, Fairy Potion buff consumed
- One use per combat — if player dies again after revival, no second chance
- If combat ends without dying, the potion is still consumed (used but not triggered)

### Interactions with Other Systems

| System | Direction | Data Exchanged | When |
|--------|-----------|---------------|------|
| Data/Config | Config → Potion | `getPotion(id)` → PotionData | Load time |
| Status Effect | Potion → Effect | `applyEffect()` for status-inducing potions | Potion use |
| Combat System | Combat → Potion | Use permission check (player turn active?) | Potion use |
| Combat System | Potion → Combat | Damage, block, energy, draw, heal effects | Potion use |
| Reward System | Reward → Potion | `addPotion(potionId)` on drop | Post-combat |
| Run State Manager | Potion → Run | Potion slot serialization | Save/load |
| Shop System | Shop → Potion | `addPotion(potionId)` on purchase | Shopping |
| Combat UI | Potion → UI | Slot display, use interaction | Continuous |

## Formulas

### Potion Rarity Roll

```
rollPotionRarity(rng):
  roll = rng.nextFloat()
  if roll < 0.10: return RARE
  if roll < 0.35: return UNCOMMON  // 0.10 + 0.25
  return COMMON                     // remaining 65%
```

### Potion Damage

```
potionDamage(baseDamage, target):
  // NOT affected by Strength (unlike cards)
  // IS affected by Vulnerable on target
  damage = baseDamage
  damage = Math.floor(damage * vulnerableMultiplier(target))
  return Math.max(0, damage)
```

### Potion Block

```
potionBlock(baseBlock, player):
  // IS affected by Dexterity and Frail (same as cards)
  block = baseBlock + getEffectStacks(player, "Dexterity")
  block = Math.floor(block * frailMultiplier(player))
  return Math.max(0, block)
```

### Blood Potion Heal

```
bloodPotionHeal(maxHP):
  return Math.floor(maxHP * 0.20)
```

## Edge Cases

1. **Potion slots full + reward drop**: Reward screen shows dropped potion with swap/skip
   options. Player can discard any existing potion to pick up the new one.

2. **Targeting dead enemy**: Cannot target dead enemies. UI disables targeting for
   potions that require an enemy target when all enemies are dead.

3. **Fairy Potion + second death**: If player revives via Fairy and dies again in the
   same combat, no second revival. Fairy effect is consumed on first death.

4. **Heal potion out of combat**: Blood Potion can be used on the map screen. Heals
   currentHP, clamped to maxHP.

5. **Energy potion at high energy**: No issue. Adds 2 energy regardless of current
   or effectiveMaxEnergy. No upper bound on currentEnergy.

6. **Potion with no valid target**: If all enemies are dead and potion targets ENEMY,
   the potion cannot be used. Player keeps it.

7. **Draw potion with empty deck**: Speed Potion draws 3 cards following normal draw
   rules (shuffle Discard → Draw if needed, stop if both piles empty).

8. **Potion use during enemy turn**: Not allowed. Blocked at the Combat System level.

9. **Relic adds potion slots mid-combat**: New slot immediately available. Extremely
   rare in practice (relics obtained post-combat).

10. **Multiple identical potions**: Player can hold multiple copies of the same potion
    in different slots. Each is an independent instance.

## Dependencies

### Upstream (this system depends on)

| System | Type | Interface |
|--------|------|-----------|
| Data/Config | Hard | `getPotion(id)` → PotionData schema |
| Status Effect | Hard | `applyEffect()` for status-inducing potions |

### Downstream (systems that depend on this)

| System | Type | Interface |
|--------|------|-----------|
| Reward System | Hard | `addPotion(potionId)` on potion reward drop |
| Combat System | Hard | Potion use during player turn, damage/block/energy application |
| Run State Manager | Hard | Potion slot serialization for save/load |
| Shop System | Soft | `addPotion(potionId)` on purchase |
| Combat UI | Soft | Potion slot display and use interaction |

## Tuning Knobs

| Knob | Location | Default | Safe Range | What Breaks |
|------|----------|---------|------------|-------------|
| `maxPotionSlots` | `character.json` | 3 | 2-5 | 2: too limiting; 5: hoarding |
| `commonPotionWeight` | `reward-config.json` | 0.65 | 0.50-0.80 | 0.50: too many uncommon/rare |
| `uncommonPotionWeight` | `reward-config.json` | 0.25 | 0.15-0.35 | 0.35: uncommons too common |
| `rarePotionWeight` | `reward-config.json` | 0.10 | 0.05-0.15 | 0.15: rares too frequent |
| `firePotionDamage` | `potions.json` | 20 | 15-30 | 15: weak; 30: too strong for common |
| `blockPotionAmount` | `potions.json` | 12 | 8-15 | 8: weak; 15: very strong |
| `energyPotionAmount` | `potions.json` | 2 | 1-3 | 1: barely helps; 3: very strong |

## Acceptance Criteria

1. Potion slots display correctly (up to 3 base slots).
2. Obtained potion placed in first empty slot.
3. Full slots: new potion shows swap/skip prompt.
4. Combat use: click → select target → effect executes → slot emptied.
5. Potion use costs no energy and does not count as a card play.
6. Potion damage affected by Vulnerable, NOT affected by Strength.
7. Potion Block affected by Dexterity and Frail.
8. Fairy Potion triggers on death (30% HP restore, one-time per combat).
9. Blood Potion usable out of combat (heal 20% maxHP, clamped to maxHP).
10. Dead enemies cannot be targeted by enemy-targeted potions.
11. Potions cannot be used during enemy turn.

## Open Questions

1. **Potion discard button**: Should players be able to discard potions without using
   them? Recommend: yes, right-click or long-press to discard. Frees up slots.
   Owner: UX Designer. Combat UI GDD.

2. **Potion animation timing**: Should potion use have a distinct animation?
   Recommend: quick flash effect (0.3s) — don't slow down combat.
   Owner: UX Designer. Combat UI GDD.

3. **Character-specific potions**: Should different characters have different potion
   pools? Recommend: no for MVP — shared potion pool. Post-MVP character-specific
   potions can be added. Owner: Game Designer.
