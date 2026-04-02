# Deck Manager

> **Status**: Designed
> **Author**: user + agents
> **Last Updated**: 2026-04-01
> **Implements Pillar**: Adaptive Builds (deck composition defines build identity), Meaningful Opportunity Cost (every card add/remove changes draw odds)

## Overview

The Deck Manager is responsible for managing the player's card collection throughout a run.
It operates on two levels: the **Master Deck** (persistent full card collection, survives
across combats) and **Combat Piles** (four transient piles during combat: Draw, Hand,
Discard, Exhaust). The system handles drawing, discarding, shuffling, and exhausting
cards during combat, as well as adding, removing, and transforming cards in the Master
Deck via rewards, events, and shops. It is the direct downstream of the Card System and
provides deck state queries to the Combat System and Run State Manager.

## Player Fantasy

Your deck IS your build. Every card you add slightly shifts the odds of drawing your key
cards. This serves the **Adaptive Builds** pillar — deck composition defines your strategy.
It also serves **Meaningful Opportunity Cost** — skipping a card reward isn't "getting
nothing," it's "keeping your deck lean." Slay the Spire teaches players that less is more:
a thin deck is more consistent than a bloated one.

Reference: Slay the Spire nails this by making deck management feel strategic, not
administrative. The joy of trimming your deck to a lean 15-card engine is core to the
roguelike deckbuilder fantasy.

## Detailed Design

### Core Rules

**1. Master Deck Management**

- At run start: load starter deck from `character.json` data
- Add card: rewards, shops, events call `addToMasterDeck(cardId)`
- Remove card: shops (remove service), events call `removeFromMasterDeck(cardId)` — player chooses which
- Transform card: certain events convert card A → card B (remove old, add new)
- Master Deck is read-only during combat; modifications queue until combat ends
- Minimum deck size: 1 card (cannot remove last card)

**2. Combat Piles**

| Pile | Contents | Ordering |
|------|----------|----------|
| **Draw** | Unrevealed cards, face-down | Shuffled (random order) |
| **Hand** | Currently playable cards | Player-arranged |
| **Discard** | Played or end-of-turn discarded cards | Unordered |
| **Exhaust** | Permanently removed from this combat | Unordered |

**3. Combat Flow**

1. **Combat start**: Copy Master Deck → Draw Pile → Shuffle (combat RNG stream)
2. Place guaranteed Innate cards into opening hand
3. Draw `handSize` cards
4. **Each turn start**: Draw `handSize` cards
5. **Each turn end**: Non-Retain cards in Hand → Discard Pile; Ethereal cards → Exhaust Pile
6. **Combat end**: All Combat Piles destroyed; Master Deck unchanged

**4. Draw Rules** (aligned with Card System GDD)

- `draw(n)`: Take n cards from top of Draw Pile → Hand
- If Draw Pile has fewer than n: shuffle Discard → Draw, then draw remaining
- If Draw + Discard combined have fewer than n: draw until both are empty
- If Hand reaches `maxHandSize` (10): overflow cards → Discard Pile directly

**5. Shuffle Rules**

- Uses Combat RNG stream (separated from AI/reward, ensures reproducibility)
- Algorithm: Fisher-Yates shuffle
- Trigger: automatically when Draw Pile is empty and drawing is needed

**6. Deck Statistics Queries**

- `getDeckSize()` → total cards in Draw + Hand + Discard + Exhaust (during combat)
- `getMasterDeckSize()` → total cards in Master Deck
- `getCardCount(cardId)` → count of a specific card in Master Deck
- `getCardsByType(type)` / `getCardsByRarity(rarity)` → filtered queries

### Deck States and Transitions

**Master Deck State Machine:**

| State | Description | Transition To |
|-------|-------------|---------------|
| **Uninitialized** | Before run start | → Active (run starts) |
| **Active** | Normal state, modifiable between combats | → Locked (combat starts) |
| **Locked** | Read-only during combat | → Active (combat ends) |
| **Frozen** | Run ended (win/death) | — (terminal) |

**Combat Pile States:**

| State | Description | Transition To |
|-------|-------------|---------------|
| **Created** | Combat starts, cards copied from Master Deck | → Shuffled |
| **Shuffled** | Draw Pile shuffled | → In Play (first draw) |
| **In Play** | Active combat, cards distributed across piles | → Ending |
| **Ending** | Combat resolved, cleanup pending | → Destroyed |
| **Destroyed** | All pile data released | — (terminal) |

### Interactions with Other Systems

| System | Direction | Data Exchanged | When |
|--------|-----------|---------------|------|
| Card System | Deck ← Card | Card instances, pile operations (draw/discard/exhaust) | Card play, draw effects |
| Data/Config | Config → Deck | Starter deck from `character.json` | Run start |
| RNG System | RNG → Deck | Combat stream for shuffle randomization | Shuffle trigger |
| Combat System | Combat → Deck | `drawCards(n)`, `discardHand()`, `exhaustCard()` | Turn flow |
| Combat System | Deck → Combat | Pile sizes, card lists for display | Continuous |
| Run State Manager | Deck → Run | Master deck snapshot for serialization | Save, run end |
| Reward System | Reward → Deck | `addToMasterDeck(cardId)` | Post-combat reward |
| Shop System | Shop → Deck | `addToMasterDeck()`, `removeFromMasterDeck()` | Shopping |
| Event System | Event → Deck | `addToMasterDeck()`, `removeFromMasterDeck()`, `transformCard()` | Event resolution |

## Formulas

### Fisher-Yates Shuffle

```
shuffle(array, rng):
  for i = array.length - 1 downto 1:
    j = rng.nextInt(0, i)
    swap(array[i], array[j])
```

Uses combat RNG stream for deterministic replay.

### Draw Probability (for debugging/tuning only, not player-visible)

```
P(draw specific card in next N draws) ≈ (countInDrawPile / drawPileSize) * N
```

### Deck Thinness Score (internal metric)

```
deckThinness = (targetSize / actualDeckSize) * 100
// targetSize from game-config.json, default 15
// Used for balance tuning reference, NOT exposed to player
```

## Edge Cases

1. **Missing starter deck**: If `character.json` has no starter deck defined or it's empty,
   use fallback: 5 Strikes + 5 Defends. Log a warning.

2. **Removing last card**: Cannot remove the last card from Master Deck. UI disables
   remove option when `masterDeckSize == 1`.

3. **Transform the only card**: Transform replaces card A with card B even if A is the
   only card in Master Deck. Count stays at 1, card content changes.

4. **Master Deck modification during combat**: Not allowed. Master Deck is read-only
   during combat. Any queued operations (from events that trigger mid-combat) are
   deferred until combat ends.

5. **Multiple shuffles in one turn**: A turn with many draw effects may exhaust Draw +
   Discard multiple times. Each time Discard is exhausted into Draw, a new shuffle
   occurs. This is correct behavior.

6. **Innate with multiple copies**: If deck contains 2 copies of an Innate card, the
   opening hand guarantees at least 1 appears. Both appearing is possible but not
   guaranteed.

7. **Hand full + draw effect**: Overflow cards go directly to Discard Pile without
   triggering any on-draw effects. The draw "happened" but the card never entered Hand.

8. **All cards exhausted**: If during a combat all cards are exhausted, subsequent turns
   have no cards to draw (Draw + Discard both empty). This is a valid game state —
   the player can still use potions or relics.

9. **Adding cards mid-combat**: Not allowed. Card additions to Master Deck only happen
   between combats (reward screen, shop, map events).

10. **Card instance tracking**: Each card in the deck is an independent instance with a
    unique run-scoped instance ID. This allows tracking individual cards across piles
    (e.g., "which copy of Strike was exhausted").

## Dependencies

### Upstream (this system depends on)

| System | Type | Interface |
|--------|------|-----------|
| Card System | Hard | `CardData` schema, card instance creation, pile operation definitions |
| Data/Config | Hard | `getCharacter(id).starterDeck`, card ID → CardData lookup |
| RNG System | Hard | Combat RNG stream for deterministic shuffle |

### Downstream (systems that depend on this)

| System | Type | Interface |
|--------|------|-----------|
| Combat System | Hard | `drawCards(n)`, `discardHand()`, `exhaustCard(instance)`, turn start/end pile transitions |
| Run State Manager | Hard | Master deck snapshot for serialization, deck statistics queries |
| Reward System | Soft | `addToMasterDeck(cardId)` after card reward selection |
| Shop System | Soft | `addToMasterDeck()`, `removeFromMasterDeck()` for buy/remove services |
| Event System | Soft | `addToMasterDeck()`, `removeFromMasterDeck()`, `transformCard(oldId, newId)` |

## Tuning Knobs

| Knob | Location | Default | Safe Range | What Breaks |
|------|----------|---------|------------|-------------|
| `handSize` | `game-config.json` | 5 | 3-7 | 3: too few options per turn; 7: too easy to answer all threats |
| `maxHandSize` | `game-config.json` | 10 | 8-12 | 8: easy to clog with Status cards; 12: overflow almost never happens |
| `starterDeckSize` | `character.json` | 10 | 8-12 | 8: very thin starter; 12: slower to see key cards in early combats |
| `minDeckSize` | `game-config.json` | 1 | 1-3 | >1: restricts aggressive deck-thinning strategies |
| `maxRemovePerShop` | `shop-config.json` | 1 | 1-3 | 3: deck thinning too easy, removes tension |

## Acceptance Criteria

1. At combat start, Draw Pile contains all Master Deck cards (shuffled).
2. `draw(5)` moves exactly 5 cards from Draw Pile top to Hand.
3. When Draw Pile is empty, `draw(n)` shuffles Discard → Draw first, then draws.
4. When both Draw and Discard are empty, `draw(n)` draws until empty — no crash.
5. Hand at maxHandSize: overflow cards go to Discard Pile directly.
6. Turn end: non-Retain cards → Discard, Ethereal cards → Exhaust.
7. Innate card appears in opening hand of every combat.
8. `addToMasterDeck("strike_red")` increases Master Deck size by 1.
9. `removeFromMasterDeck()` cannot reduce Master Deck below 1 card.
10. Combat end destroys all Combat Piles; Master Deck unchanged.
11. Shuffle uses combat RNG stream — same seed produces same draw order.

## Open Questions

1. **Deck viewer UI**: How players view Draw/Discard/Exhaust pile contents during combat.
   Recommend: clickable pile icons with card list overlay, filterable by type.
   Owner: UX Designer. Define during Combat UI GDD.

2. **Card back art**: Should different characters have different card back art?
   Recommend: yes, reinforces character identity. Owner: Art Director.

3. **Deck size limit**: Should Master Deck have a maximum size cap?
   Slay the Spire has no cap. Recommend: no cap for MVP; natural limit from card
   add frequency. Owner: Game Designer. Verify during balance pass.
