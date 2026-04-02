# Reward System

> **Status**: Designed
> **Author**: user + agents
> **Last Updated**: 2026-04-01
> **Implements Pillar**: Meaningful Opportunity Cost (skip = stay lean), Adaptive Builds (card picks shape your build)

## Overview

The Reward System generates rewards after each combat victory. Every victory provides
three categories: **Gold** (fixed + random), **Card Selection** (pick 1 of 3 from
character card pool or skip), and **Potion** (probability-based drop). Elite and Boss
combats additionally drop **Relics**. The system uses the Reward RNG stream for
randomization, ensuring reproducibility. The core design principle: skipping a card
is not a failure — it's a strategic choice to keep your deck lean.

## Player Fantasy

The post-combat reward screen is where **Adaptive Builds** and **Meaningful Opportunity
Cost** intersect. You just survived a tough fight, and now you decide: is this card
worth adding? Or should you skip it to keep your deck lean? Gold to save or spend?
Every choice has weight because every addition changes your draw odds.

Reference: Slay the Spire's reward screen makes every choice feel meaningful. Skipping
a card is often the correct play — and that's a brilliant design.

## Detailed Design

### Core Rules

**1. Reward Types**

| Type | Source | Frequency | Selection |
|------|--------|-----------|-----------|
| **Gold** | Every combat | Always | Auto-granted |
| **Card** | Every combat | Always | Pick 1 of 3 or skip all |
| **Potion** | Every combat | 40% chance | Receive (skip if slots full) |
| **Relic** | Elite/Boss | First kill only | Auto-granted |
| **Boss Relic** | Boss | Boss fights only | Pick 1 of 3 |

**2. Gold Generation**

```
goldReward(enemyType):
  base = enemyType.goldBase
  bonus = rewardRng.nextInt(0, goldVariance)
  return base + bonus
```

| Enemy Type | Base Gold | Variance |
|------------|-----------|----------|
| Normal | 15 | 5 |
| Elite | 30 | 10 |
| Boss | 60 | 20 |

**3. Card Reward Generation**

```
generateCardRewards(characterId, rng):
  pool = getAvailableCards(characterId)
  pool = pool.filter(c => c.rarity != STARTER && c.rarity != SPECIAL)

  // Roll rarities for 3 cards
  rarities = [rollRarity(rng), rollRarity(rng), rollRarity(rng)]

  // Pick unique cards for each rarity
  cards = []
  for rarity in rarities:
    candidates = pool.filter(c => c.rarity == rarity && !cards.includes(c))
    if candidates.length == 0:
      candidates = pool.filter(c => c.rarity == COMMON && !cards.includes(c))
    card = rng.weightedPick(candidates, c => 1)
    cards.push(card)

  return cards  // 3 unique cards
```

**4. Rarity Roll with Pity System**

```
rollRarity(rng, pityCounter):
  rareChance = min(baseRareChance + pityCounter * pityIncrement, 0.40)
  roll = rng.nextFloat()

  if roll < rareChance:
    pityCounter = 0  // reset
    return RARE
  else:
    pityCounter++    // increment
    if roll - rareChance < uncommonChance:
      return UNCOMMON
    else:
      return COMMON
```

Pity counter persists across combats within a run. Resets on RARE pull.
Hard cap at 40% rare chance (~10 non-rare rolls to reach cap).

**5. Potion Drop**

```
potionDrop(rng, potionSlotsUsed, maxSlots):
  if rng.nextFloat() < potionDropRate:
    if potionSlotsUsed < maxSlots:
      return generateRandomPotion(rng)
    else:
      return null  // slots full, can swap
  return null  // no drop
```

If potion slots are full and a potion drops, player can choose to discard
an existing potion to pick up the new one, or skip entirely.

**6. Relic Drop**

- Elite: One common relic, auto-granted on first kill of that elite type
- Boss: 3 boss relics to choose from (or skip all)
- Relics are filtered by `previouslyObtained` list — no duplicates

**7. Skip Mechanism**

- **Card**: Player can skip all 3 cards (recommended option — deck thinness is valuable)
- **Potion**: Player can skip if inventory is full or choose to discard existing
- **Gold**: Cannot skip — always auto-granted
- **Relic**: Common relics auto-granted; Boss relics can be skipped
- **Boss Relic**: Skipping is valid — some boss relics have downsides

### Reward Generation

**Reward Screen Flow:**

1. Combat victory → Combat System calls `generateRewards(encounterType)`
2. System generates all reward items using Reward RNG stream
3. Display reward screen: Gold (auto), 3 cards (pick 1 or skip), potion (if dropped), relic (if eligible)
4. Player makes selections one at a time
5. Selected items are added to run state:
   - Card → `deckManager.addToMasterDeck(cardId)`
   - Gold → `runState.addGold(amount)`
   - Potion → `potionSystem.addPotion(potionId)`
   - Relic → `relicSystem.addRelic(relicId)`
6. All selections complete → proceed to Map System

### Interactions with Other Systems

| System | Direction | Data Exchanged | When |
|--------|-----------|---------------|------|
| Card System | Reward → Card | Card pool query for character | Reward generation |
| Data/Config | Config → Reward | Gold values, rarity weights, relic/potion data | Load time |
| RNG System | RNG → Reward | Reward RNG stream | All randomization |
| Character System | Character → Reward | Card pool filter | Reward generation |
| Deck Manager | Reward → Deck | `addToMasterDeck(cardId)` | Card selection |
| Relic System | Reward → Relic | `addRelic(relicId)` | Relic obtain |
| Potion System | Reward → Potion | `addPotion(potionId)` | Potion obtain |
| Run State Manager | Reward → Run | Gold, obtained items tracking | All selections |
| Reward UI | Reward → UI | Reward data for display | Reward screen |

## Formulas

### Rarity Probability (with Pity)

```
P(RARE) = min(0.12 + pityCounter * 0.03, 0.40)
P(UNCOMMON | not RARE) = 0.37
P(COMMON | not RARE) = 0.63

Expected rare frequency without pity: ~12% (1 in ~8 cards)
With 5 pity: 27% (1 in ~4 cards)
At pity cap (10): 40% (1 in 2.5 cards)
```

### Gold Range

```
Normal: 15-20 gold
Elite:  30-40 gold
Boss:   60-80 gold
```

### Potion Drop Rate

```
P(drop) = 0.40 per combat
Expected: 1 potion every 2.5 combats
Over 15 combats: ~6 potion drops
```

## Edge Cases

1. **Rarity pool empty**: If no RARE cards remain in character pool, fall back to
   UNCOMMON. If UNCOMMON also empty, fall back to COMMON. If all empty, no card reward.

2. **Entire card pool exhausted**: In extreme late-game where player has obtained most
   cards. Display "No cards available" — skip is the only option.

3. **Duplicate relic prevention**: Relic pool filters by `previouslyObtained`. If a tier
   is fully obtained, no relic is offered.

4. **Boss relic all obtained**: Should not happen — boss relic pool is 30+ items, and a
   run has at most 3 bosses. If it does, offer nothing (skip only).

5. **Potion full + drop**: Show the dropped potion with option to swap or skip. Player
   can discard any existing potion to pick up the new one.

6. **Pity counter overflow**: Hard cap at 40% prevents infinite accumulation. After
   ~10 non-rare rolls, pity stays at max.

7. **Gold overflow**: No gold cap. Player can accumulate unlimited gold (useful for
   late-game shops).

8. **Same elite type, different individuals**: Each elite encounter is independent. Even
   if you fight two Jaw Worms, each gives a relic on first kill.

9. **3 cards with same ID**: Prevented by deduplication logic. Each of the 3 cards must
   have a unique `cardId`.

10. **Reward screen interrupted**: Rewards are serialized before display. On recovery,
    the same reward screen is shown with choices still available.

## Dependencies

### Upstream (this system depends on)

| System | Type | Interface |
|--------|------|-----------|
| Card System | Hard | CardData schema, card pool query |
| Data/Config | Hard | Rarity weights, gold values, relic/potion data |
| RNG System | Hard | Reward RNG stream for deterministic generation |
| Character System | Hard | Card pool filtering by character ID |

### Downstream (systems that depend on this)

| System | Type | Interface |
|--------|------|-----------|
| Deck Manager | Hard | `addToMasterDeck(cardId)` on card selection |
| Relic System | Hard | `addRelic(relicId)` on relic obtain |
| Potion System | Hard | `addPotion(potionId)` on potion drop |
| Run State Manager | Hard | Gold tracking, obtained items list |
| Reward UI | Hard | Reward data for display |

## Tuning Knobs

| Knob | Location | Default | Safe Range | What Breaks |
|------|----------|---------|------------|-------------|
| `baseRareChance` | `reward-config.json` | 0.12 | 0.05-0.20 | 0.05: rares too rare; 0.20: too common |
| `pityIncrement` | `reward-config.json` | 0.03 | 0.01-0.05 | 0.01: pity barely helps; 0.05: rares too frequent |
| `normalGoldBase` | `reward-config.json` | 15 | 10-25 | 10: too poor; 25: too rich |
| `eliteGoldBase` | `reward-config.json` | 30 | 20-50 | Same |
| `bossGoldBase` | `reward-config.json` | 60 | 40-100 | Same |
| `potionDropRate` | `reward-config.json` | 0.40 | 0.20-0.60 | 0.20: too rare; 0.60: always drops |
| `rewardCardsOffered` | `reward-config.json` | 3 | 2-4 | 2: less choice; 4: overwhelming |
| `maxPotionSlots` | `character.json` | 3 | 2-5 | 2: very limiting; 5: hoarding |

## Acceptance Criteria

1. Combat victory displays reward screen (gold + 3 cards + potion if dropped).
2. Cards generated from character-specific pool with correct rarity distribution.
3. Player can pick 1 card or skip all cards.
4. Skipping cards adds nothing to deck — deck size unchanged.
5. Gold auto-added to run state after combat.
6. Elite first-kill grants common relic.
7. Boss grants 3 boss relics to choose 1.
8. Pity system works: consecutive non-rare rolls increase next rare chance.
9. Potion slots full shows swap/skip prompt.
10. 3 offered cards have unique IDs (no duplicates).
11. Reward RNG stream ensures same seed produces same rewards.

## Open Questions

1. **Boss relic swap**: Should players be able to swap an existing relic for a boss
   relic (like Slay the Spire)? Recommend: yes, but MVP can be simpler (just add).
   Owner: Game Designer. Define during Relic System GDD.

2. **Neow bonus (pre-run reward)**: Should there be a pre-run reward screen (choose
   starting bonus)? Recommend: yes, post-MVP. Enhances replayability.
   Owner: Game Designer. Post-MVP feature.

3. **Card reward rarity display**: Should rarity be shown before or after picking?
   Slay the Spire shows rarity colors on the cards. Recommend: yes, show rarity.
   Owner: UX Designer. Reward UI GDD.
