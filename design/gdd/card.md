# Card System

> **Status**: Designed
> **Author**: user + agents
> **Last Updated**: 2026-04-01
> **Implements Pillar**: Adaptive Builds (diverse card pool enables varied builds), Meaningful Opportunity Cost (every card pick has deck-weight cost), Readability First (clear card text and visual hierarchy)

## Overview

The Card System defines the data schema, lifecycle, and play mechanics for every card
in the game. Cards are the player's primary agency — they represent attacks, skills,
powers, and passive effects. Each card has a type, cost, rarity, target type, optional
keywords, and an upgrade path. Cards flow through four piles (Draw, Hand, Discard,
Exhaust) during combat. The system handles card drawing, playing, exhausting, and
upgrading, serving as the foundation for the Deck Manager, Combat System, Reward
System, and Shop System.

## Player Fantasy

Every card pick matters. Adding a card to your deck isn't always good — too many
cards dilute your draws. This is the **Adaptive Builds** pillar: the card pool is
diverse enough to support vastly different strategies (burst damage, poison stall,
block-heavy, combo). It also serves **Meaningful Opportunity Cost**: skipping a card
reward is a valid and often correct choice. **Readability First**: card text is
unambiguous — what you read is what happens.

Reference: Slay the Spire nails this with concise card text, clear rarity coloring,
and the tension of "do I even want this card?"

## Detailed Design

### Core Rules

**1. Card Types**

| Type | Description | Examples |
|------|-------------|----------|
| **ATTACK** | Deals damage to one or more enemies. Modified by Strength/Vulnerable/Weak. | Strike, Bash, Cleave |
| **SKILL** | Applies Block, status effects, or utility. No direct damage. | Defend, Shrug It Off, Flame Barrier |
| **POWER** | Grants a persistent combat effect. Played once, lasts the combat. | Demon Form, Combust, Metalize |
| **STATUS** | Negative cards added to deck by enemies. Unplayable or detrimental. | Dazed, Wound, Burn, Slimed |
| **CURSE** | Negative cards from events. Unplayable (no effect, occupies hand). | Regret, Decay, Doubt |

**2. Card Data Schema**

```
interface CardData {
  id: string;            // unique identifier, e.g. "strike_red"
  name: string;          // display name, e.g. "Strike"
  type: CardType;        // ATTACK | SKILL | POWER | STATUS | CURSE
  rarity: Rarity;        // STARTER | COMMON | UNCOMMON | RARE | SPECIAL
  cost: number;          // energy cost (0+), or base cost for X-cost
  costType: CostType;    // NORMAL | X | UNPLAYABLE
  character: string;     // character id or "any" for shared cards
  targets: TargetType;   // SELF | ENEMY | ALL_ENEMY | NONE
  effects: CardEffect[]; // ordered list of effects on play
  keywords: Keyword[];   // special modifiers (Exhaust, Ethereal, etc.)
  upgrade: CardUpgrade;  // upgrade delta (what changes when upgraded)
  description: string;   // template string for card text
  flavorText?: string;   // optional lore text
}
```

**3. Card Keywords**

| Keyword | Effect | Timing |
|---------|--------|--------|
| **Exhaust** | Card is removed from combat (goes to Exhaust pile) after resolution | On play |
| **Ethereal** | Card is exhausted at end of turn if still in hand | Turn end |
| **Innate** | Card is always in the opening hand of each combat | Combat start |
| **Retain** | Card stays in hand at end of turn instead of discarding | Turn end |
| **Unplayable** | Card cannot be voluntarily played (no energy cost check applies) | Always |
| **Scry** | Look at top N cards of draw pile; discard any number, return rest in order | On play |

**4. Card Play Flow (6 steps)**

1. **Eligibility check**: Player selects a card from hand. System checks:
   - `card.costType != UNPLAYABLE`
   - `currentEnergy >= card.cost` (or `currentEnergy > 0` for X-cost)
   - Valid target exists for `card.targets` (e.g., enemy alive)
2. **Cost payment**: Energy deducted per Energy System rules.
3. **Target resolution**: If `ENEMY`, player picks a target. If `ALL_ENEMY` or `SELF` or `NONE`, auto-resolved.
4. **Effect execution**: Each `CardEffect` in `effects[]` resolves in order.
5. **Keyword triggers**: Exhaust cards move to Exhaust pile. Other keywords fire.
6. **Post-play cleanup**: Card moves to Discard pile (default) or Exhaust pile (if Exhaust keyword).

**5. Drawing Cards**

- At combat start: Draw `handSize` (default 5) cards from Draw Pile.
- Each turn start: Draw `handSize` cards.
- If Draw Pile is empty when drawing: shuffle Discard Pile into Draw Pile (using combat RNG stream), then draw.
- If both Draw Pile and Discard Pile are empty: no cards drawn.

### Card Pile States and Transitions

| State | Description | Transition To |
|-------|-------------|---------------|
| **Draw Pile** | Face-down, unordered from player perspective | → Hand (draw), → Discard (Scry discard) |
| **Hand** | Player's playable cards, max `maxHandSize` (default 10) | → Discard (turn end, non-Retain), → Exhaust (Exhaust/Ethereal), → Draw Pile (Return) |
| **Discard Pile** | Played or discarded cards | → Draw Pile (shuffle on empty draw), → Exhaust (relic/effect) |
| **Exhaust Pile** | Permanently removed from this combat | — (terminal for combat) |
| **Master Deck** | Full deck state (persists across combats) | — (modified only by rewards/events/shops) |

```
Draw Pile → Hand → Discard Pile → Draw Pile (shuffle)
                  ↘ Exhaust Pile (Exhaust keyword)
```

### Card Keywords and Properties

**Keyword Interaction Rules:**

1. **Exhaust + Retain**: Exhaust takes priority. If an Exhaust card is played, it exhausts — Retain is irrelevant (card is no longer in hand at turn end).
2. **Ethereal + Retain**: Ethereal takes priority. The card exhausts at turn end even with Retain.
3. **Innate + multiple copies**: If deck has two copies of an Innate card, one is guaranteed in opening hand (random selection if both qualify).
4. **Unplayable cards in hand**: Occupy hand slots. Can be exhausted by other card effects (e.g., "Exhaust all Status cards in hand").

### Card Upgrade System

- **Where**: Rest Sites only (not during combat).
- **What**: One card is upgraded. Upgraded card name shows "+" suffix (e.g., "Strike+").
- **How**: `upgrade` field defines delta — changed properties overwrite base values.
- **One-time**: Each card can be upgraded exactly once. No double upgrades.
- **Reversibility**: Upgrades persist for the entire run. Cannot be undone.

Typical upgrade effects:
- Attack: +3 damage or +50% damage (whichever is defined per card)
- Skill: +3 Block or extended duration
- Power: Reduced cost or increased magnitude
- Cost reduction: Some cards reduce cost by 1 on upgrade

### Interactions with Other Systems

| System | Direction | Data Exchanged | When |
|--------|-----------|---------------|------|
| Data/Config | Config → Card | `CardData` schema from `cards.json` | Load time |
| Energy System | Card → Energy | `spendEnergy(card.cost)` before play | Card play |
| Energy System | Energy → Card | `currentEnergy` for X-cost cards | Card play |
| Status Effect | Card → Effect | `applyEffect()` calls from card effects | Card resolution |
| Status Effect | Effect → Card | Strength/Dexterity modify damage/block formulas | Damage/Block calculation |
| Deck Manager | Deck → Card | Card ownership, pile management | Combat flow |
| Combat System | Combat → Card | Turn start/end triggers, draw calls | Turn flow |
| Reward System | Reward → Card | Card reward generation (rarity pool) | Post-combat |
| Shop System | Shop → Card | Card purchase adds to master deck | Shopping |
| Event System | Event → Card | Events may add/remove/transform cards | Event resolution |
| Character System | Character → Card | Starting deck, card pool restriction | Run start |

## Formulas

### Attack Damage

```
totalDamage(baseDamage, attacker, target):
  damage = baseDamage + getEffectStacks(attacker, "Strength")
  damage = Math.floor(damage * vulnerableMultiplier(target))
  damage = Math.floor(damage * weakMultiplier(attacker))
  damage = Math.max(0, damage)
  return damage
```

Variables:
- `baseDamage` (int): From `CardData.effects[].value`
- `strengthBonus`: From Status Effect System's `getEffectStacks`
- `vulnerableMultiplier`: 1.5 if target has Vulnerable, else 1.0
- `weakMultiplier`: 0.75 if attacker has Weak, else 1.0

### Block Gain

```
totalBlock(baseBlock, player):
  block = baseBlock + getEffectStacks(player, "Dexterity")
  block = Math.floor(block * frailMultiplier(player))
  block = Math.max(0, block)
  return block
```

Variables:
- `baseBlock` (int): From `CardData.effects[].value`
- `dexterityBonus`: From Status Effect System's `getEffectStacks`
- `frailMultiplier`: 0.75 if player has Frail, else 1.0

### Scry Resolution

```
scry(amount):
  cards = drawPile.peek(amount)
  playerChoosesDiscard(cards) → discarded[]  // UI interaction
  for each card in discarded:
    drawPile.remove(card)
    discardPile.add(card)
  // remaining cards stay on top of draw pile in original order
```

### X-Cost Card Resolution

```
xResolution(card, currentEnergy):
  xValue = currentEnergy  // all energy consumed
  for each effect in card.effects:
    if effect.scalesWithX:
      effect.value = effect.baseValue * xValue
  // card.cost == 0 for display, actual cost = xValue energy
```

## Edge Cases

1. **Empty Draw + Discard**: If both piles are empty when drawing, the draw fails silently. Player plays with whatever cards remain in hand.

2. **Hand limit (10)**: If hand has 10 cards and a draw effect triggers, excess drawn cards go directly to Discard Pile. Player is notified ("Hand full — X cards discarded").

3. **X-cost card with 0 energy**: Cannot be played. `canPlay` returns false for X-cost when `currentEnergy == 0`.

4. **Unplayable cards (STATUS/CURSE)**: Cannot be played via normal means. Occupy hand slots. Can be removed from hand by other card effects (e.g., Medkit exhausts a Status card).

5. **Ethereal + played this turn**: If an Ethereal card is played (not still in hand at turn end), it follows normal play flow (Discard or Exhaust). Ethereal only triggers if the card is *still in hand* at turn end.

6. **Innate + combat restart**: Innate cards appear in the opening hand of every combat, including retrying the same combat.

7. **Upgrading a card already in Draw Pile**: Upgrade applies to the card in the Master Deck. During combat, the in-pile instance is upgraded when possible. If the pile is shuffled, the upgraded version is used.

8. **Multiple copies of same card**: Each copy is an independent instance. Upgrading one copy does not upgrade others.

9. **Card effect targeting dead enemy**: If a multi-target card's target dies mid-resolution, remaining effects target valid enemies only. If all targets die, remaining effects fizzle.

10. **Drawing during enemy turn**: Some relics/effects trigger draws outside player turn. These draws follow normal draw rules (check Draw Pile, shuffle if needed).

## Dependencies

### Upstream (this system depends on)

| System | Type | Interface |
|--------|------|-----------|
| Data/Config | Hard | `getCard(id)` → CardData schema |
| Energy System | Hard | `canPlay(card)`, `spendEnergy(cost)`, `currentEnergy` for X-cost |
| Status Effect | Hard | `applyEffect()`, `getEffectStacks()` for Strength/Dexterity |
| RNG System | Soft | Combat stream for shuffle randomization |

### Downstream (systems that depend on this)

| System | Type | Interface |
|--------|------|-----------|
| Deck Manager | Hard | Card pile management, draw/discard/exhaust operations |
| Combat System | Hard | Card play flow, turn start/end triggers |
| Reward System | Hard | Card reward pool (rarity filters, character restriction) |
| Shop System | Hard | Card purchase/removal, pricing by rarity |
| Event System | Soft | Card addition/removal/transformation |
| Character System | Soft | Starting deck composition, card pool filtering |

## Tuning Knobs

| Knob | Location | Default | Safe Range | What Breaks |
|------|----------|---------|------------|-------------|
| `handSize` | `game-config.json` | 5 | 3-7 | 3: too few options; 7: too easy to full-block |
| `maxHandSize` | `game-config.json` | 10 | 8-12 | 8: easy to clog with Status; 12: hand overflow rare |
| `baseEnergy` | `character.json` | 3 | 1-5 | See Energy System GDD |
| `starterDeckSize` | `character.json` | 10 | 8-12 | 8: too thin; 12: slower to see key cards |
| `rewardCardsOffered` | `reward-config.json` | 3 | 2-4 | 2: less choice; 4: choice overload |
| `rareCardChance` | `reward-config.json` | 0.12 | 0.05-0.20 | 0.05: rares too scarce; 0.20: rares too common |
| `upgradeDamageBonus` | `cards.json` (per card) | +3 | +2 to +6 | +6: upgrades too impactful |
| `upgradeBlockBonus` | `cards.json` (per card) | +3 | +2 to +5 | +5: block too easy post-upgrade |

## Acceptance Criteria

1. Playing a 2-cost Attack card with 3 energy leaves 1 energy remaining.
2. Drawing when Draw Pile is empty shuffles Discard Pile into Draw Pile first.
3. Drawing when both Draw and Discard are empty produces no cards (no crash).
4. Hand at 10 cards: next draw sends overflow cards to Discard Pile.
5. Ethereal card not played by turn end is exhausted (goes to Exhaust Pile).
6. Innate card appears in opening hand of every combat.
7. Retain card stays in hand at turn end (does not go to Discard Pile).
8. X-cost card with 3 energy deals 3x base effect value.
9. Upgrading Strike adds +3 damage (11 → 14). Name shows "Strike+".
10. STATUS card (Dazed) cannot be played — `canPlay` returns false.
11. Attack damage formula: `floor((base + strength) * vulnerable * weak)`, floor 0.

## Open Questions

1. **Card animation timing**: Should card plays have fixed animation duration or
   scale with effect complexity? Recommend: fixed 0.3s for card movement, effects
   resolve visually in parallel. Owner: UX Designer. Decide during Combat UI GDD.

2. **Card text templating language**: Should card descriptions use a token system
   (e.g., "Deal {damage} damage" where `{damage}` is computed at display time)?
   Recommend: yes, with Data/Config providing the template engine. Owner: Systems
   Designer. Define during implementation.

3. **Modded/custom card support**: Should the CardData schema support arbitrary
   effects for future modding? Recommend: effects are defined as typed structs
   with parameters, not scripts. Extensible via new effect types post-MVP.
   Owner: Tech Director. Decide during Technical Setup.
