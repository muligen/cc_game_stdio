# Shop System

> **Status**: Designed
> **Author**: user + agents
> **Last Updated**: 2026-04-02
> **Implements Pillar**: Meaningful Opportunity Cost (gold is scarce — every purchase has tradeoffs), Adaptive Builds (shop cards/relics shape your strategy)

## Overview

The Shop System manages the merchant encountered on map Shop nodes. The shop offers a rotating stock of cards, relics, and potions for purchase, plus a card removal service. Each shop visit presents 5 colorless cards, 3 character cards, 2 relics, and 2 potions at fixed markup prices. A single card removal is available per visit. Gold is the universal currency, and every purchase is a meaningful tradeoff — the gold you spend now is gold you cannot spend later.

## Player Fantasy

The shop is a pivotal build-shaping moment. You walk in with 200 gold and see a rare relic for 150 — but you also need to remove a Strike from your deck. Do you buy the relic that could define your run, or thin your deck for consistency? Every gold piece matters. **Meaningful Opportunity Cost**: you can't afford everything. **Adaptive Builds**: the shop's random stock may push your build in an unexpected direction — a Poison relic when you were going for Shivs might inspire a pivot.

Reference: Slay the Spire's shop is tense and exciting. You count your gold, weigh options, and sometimes walk away with nothing because the price isn't right.

## Detailed Design

### Core Rules

**1. Shop Stock Generation**

```
generateShopStock(runState, shopRng):
  stock = new ShopStock()

  // Colorless cards — 5 cards from colorless pool
  colorlessPool = getCardPool("COLORLESS", runState.act)
  stock.colorlessCards = shopRng.pickUnique(colorlessPool, 5)

  // Character cards — 3 cards from character's pool
  charPool = getCardPool(runState.characterId, runState.act)
  charPool = charPool.filter(c => c.rarity != STATER)  // no starter cards
  stock.characterCards = shopRng.pickUnique(charPool, 3)

  // Relics — 2 relics from shop pool
  relicPool = getRelicPool("SHOP").filter(r => !runState.relics.includes(r.id))
  stock.relics = shopRng.pickUnique(relicPool, 2)

  // Potions — 2 potions
  potionPool = getPotionPool(runState.characterId)
  stock.potions = shopRng.pickUnique(potionPool, 2)

  // Card removal — 1 available
  stock.removalAvailable = true

  return stock
```

**2. Pricing**

| Item Type | Price Formula | Example |
|-----------|--------------|---------|
| Common Card | 50g | Strike equivalent |
| Uncommon Card | 75g | Most character uncommons |
| Rare Card | 150g | Premium cards |
| Colorless Common | 50g | Basic colorless |
| Colorless Uncommon | 100g | Duality, deep breath |
| Colorless Rare | 200g | Meta-defining cards |
| Common Relic | 150g | Entry relics |
| Uncommon Relic | 200g | Mid-tier relics |
| Rare Relic | 300g | Premium relics |
| Shop Relic | 150g | Shop-exclusive relics |
| Potion | 40-60g (random) | Varies per potion tier |
| Card Removal | 75g (base, +25g per previous removal this run) | Escalating cost |

**3. Shop Relics (Shop-Exclusive)**

Some relics only appear in shops and have unique effects:

| Relic | Cost | Effect |
|-------|------|--------|
| Membership Card | 50g | Shop items cost 20% less (applied retroactively) |
| Courier | 200g | Shop gets +1 card of each type |
| Ssserpent Ring | 150g | Gain 1 Strength when entering shop |
| Frozen Egg | 150g | Cards from shop start upgraded |
| Stone Calendar | 150g | At turn 7 end, deal 52 damage to all enemies |

**4. Discount System**

```
calculatePrice(basePrice, runState):
  discount = 0
  if runState.hasRelic("membership_card"):
    discount += Math.floor(basePrice * 0.2)  // 20% off
  if runState.hasRelic("courier"):
    // Courier doesn't discount — adds stock
  return Math.max(1, basePrice - discount)
```

**5. Card Removal Cost**

```
getRemovalCost(runState):
  baseCost = 75
  previousRemovals = runState.cardsRemovedThisRun  // tracked counter
  return baseCost + (previousRemovals * 25)
```

Each card removal increases the next removal cost by 25g, even across different shops.

**6. Shop Flow**

```
enterShop(runState, shopRng):
  stock = generateShopStock(runState, shopRng)
  showShopScreen(stock)

  loop:
    action = await playerAction()

    switch(action.type):
      case "buyCard":
        card = stock.cards[action.index]
        price = calculatePrice(card.shopPrice, runState)
        if runState.gold >= price:
          runState.modifyGold(-price)
          runState.addCard(createCardInstance(card.id))
          stock.cards.removeAt(action.index)
          playSound("purchase")

      case "buyRelic":
        relic = stock.relics[action.index]
        price = calculatePrice(relic.shopPrice, runState)
        if runState.gold >= price:
          runState.modifyGold(-price)
          runState.addRelic(relic.id)
          stock.relics.removeAt(action.index)
          playSound("purchase_relic")

      case "buyPotion":
        potion = stock.potions[action.index]
        price = calculatePrice(potion.shopPrice, runState)
        if runState.gold >= price && runState.hasEmptyPotionSlot():
          runState.modifyGold(-price)
          runState.addPotion(potion.id)
          stock.potions.removeAt(action.index)
          playSound("purchase")

      case "removeCard":
        cost = getRemovalCost(runState)
        if runState.gold >= cost && stock.removalAvailable:
          card = await playerSelectCard(runState.masterDeck)
          if card && deckManager.canRemove(card.instanceId):
            runState.modifyGold(-cost)
            runState.removeCard(card.instanceId)
            runState.cardsRemovedThisRun++
            stock.removalAvailable = false

      case "leave":
        returnToMap()
        break
```

**7. Membership Card Retroactive Discount**

The Membership Card relic applies its 20% discount to all shop prices when the player enters the shop. If bought during a shop visit, it immediately recalculates remaining prices.

### Interactions with Other Systems

| System | Direction | Data Exchanged | When |
|--------|-----------|---------------|------|
| Data/Config | Config → Shop | Card/relic/potion pools, pricing tables | Stock generation |
| RNG System | RNG → Shop | Shop RNG stream for deterministic stock | Shop entry |
| Run State Manager | Shop ↔ Run | Gold queries/modification, card/relic/potion additions | Purchases/removals |
| Card System | Shop → Card | Card instances added to master deck | Card purchase |
| Deck Manager | Shop → Deck | Card removal from master deck | Card removal service |
| Relic System | Shop → Relic | Relic additions | Relic purchase |
| Potion System | Shop → Potion | Potion additions | Potion purchase |

## Formulas

### Shop Card Price

```
shopCardPrice(card):
  if card.rarity == COMMON: return 50
  if card.rarity == UNCOMMON: return 75
  if card.rarity == RARE: return 150
  if card.color == COLORLESS:
    if card.rarity == COMMON: return 50
    if card.rarity == UNCOMMON: return 100
    if card.rarity == RARE: return 200
```

### Shop Relic Price

```
shopRelicPrice(relic):
  if relic.tier == COMMON: return 150
  if relic.tier == UNCOMMON: return 200
  if relic.tier == RARE: return 300
  if relic.tier == SHOP: return 150
```

### Potion Price

```
shopPotionPrice(potion, shopRng):
  base = 40 + shopRng.nextInt(0, 21)  // 40-60
  if potion.tier == RARE: base += 20  // 60-80 for rare potions
  return base
```

### Effective Price After Discount

```
effectivePrice(basePrice, runState):
  discount = 0
  if runState.hasRelic("membership_card"):
    discount = Math.floor(basePrice * 0.2)
  return Math.max(1, basePrice - discount)
```

### Card Removal Escalation

```
removalCost(cardsRemovedPreviously):
  return 75 + (cardsRemovedPreviously * 25)
```

Examples:
- First removal: 75g
- Second removal: 100g
- Third removal: 125g
- Fourth removal: 150g

## Edge Cases

1. **Player has no gold**: All items show as unaffordable (grayed out). Card removal still displayed with cost. Player can only leave.

2. **Potion slots full**: Buy potion button disabled. Shows "Potion slots full" tooltip. Player must use/discard a potion first.

3. **All cards bought from a category**: That section shows "Sold out". No replacement stock generated.

4. **Card removal when deck at minimum**: Removal service disabled if deck size equals minDeckSize (1). Shows "Cannot remove — deck too small".

5. **Membership Card bought mid-shop**: Remaining items immediately recalculate prices. If an item was affordable before but the discount makes it even cheaper, the saved gold is not retroactively refunded on already-purchased items.

6. **Relic already owned (pool management)**: Shop stock generation filters out owned relics. If all shop relics are owned, relic section shows "No relics available".

7. **Colorless pool too small**: If fewer than 5 colorless cards exist for current act, display what's available. No duplicates.

8. **Shop visit during Act 3**: Act-appropriate card pools. Higher-tier relics more likely in later acts.

9. **Gold exactly equals price**: Purchase allowed. Player leaves with 0 gold.

10. **Leave without buying anything**: Valid. No penalty. Stock is not preserved for next visit.

## Dependencies

### Upstream (this system depends on)

| System | Type | Interface |
|--------|------|-----------|
| Data/Config | Hard | Card/relic/potion pool definitions, pricing tables |
| RNG System | Hard | Shop RNG stream for deterministic stock generation |
| Card System | Hard | CardData for display and price calculation |
| Relic System | Hard | Relic data for display, pool filtering |
| Potion System | Hard | Potion data for display, slot availability check |
| Run State Manager | Hard | Gold, deck, relic list, potion slots, removal counter |
| Deck Manager | Hard | Card removal operation |

### Downstream (systems that depend on this)

| System | Type | Interface |
|--------|------|-----------|
| Run State Manager | Hard | Gold modification, card/relic/potion additions |
| Deck Manager | Hard | Card removal from master deck |
| Map System | Soft | Shop node triggers shop entry |
| Shop UI | Hard | Shop data for display, purchase/removal interactions |

## Tuning Knobs

| Knob | Location | Default | Safe Range | What Breaks |
|------|----------|---------|------------|-------------|
| `baseRemovalCost` | `shop-config.json` | 75g | 50-150 | 50: too easy to thin; 150: too expensive |
| `removalCostIncrement` | `shop-config.json` | 25g | 0-50 | 0: flat cost; 50: rapidly unaffordable |
| `shopColorlessCount` | `shop-config.json` | 5 | 3-8 | 3: low variety; 8: overwhelming |
| `shopCharacterCardCount` | `shop-config.json` | 3 | 2-5 | 2: limited choice; 5: analysis paralysis |
| `shopRelicCount` | `shop-config.json` | 2 | 1-4 | 1: no choice; 4: too generous |
| `shopPotionCount` | `shop-config.json` | 2 | 1-3 | 1: limited; 3: too many |
| `membershipCardDiscount` | `shop-config.json` | 0.2 | 0.1-0.5 | 0.1: barely noticeable; 0.5: everything half price |

## Acceptance Criteria

1. Shop generates stock with correct item counts (5 colorless, 3 character, 2 relics, 2 potions).
2. Card prices match rarity-based pricing table.
3. Relic prices match tier-based pricing table.
4. Potion prices fall within configured range.
5. Card removal costs escalate correctly (+25g per previous removal).
6. Cannot purchase items when gold is insufficient (button disabled).
7. Cannot add potion when all slots are full.
8. Cannot remove card when deck is at minimum size.
9. Membership Card discount applies to all shop prices.
10. Purchased items are correctly added to run state.
11. Removed cards are correctly removed from master deck.
12. Shop RNG stream ensures same seed produces same shop stock.
13. "Sold out" displayed when all items in a category are purchased.
14. Leaving shop returns to map without penalty.

## Open Questions

1. **Shop reroll**: Should players be able to reroll shop stock for a fee?
   Recommend: no for MVP. Post-MVP: add as a relic effect. Owner: Game Designer.

2. **On-sale items**: Should some shop items be randomly discounted?
   Recommend: yes, 1-2 items at 50% off adds excitement. Owner: Systems Designer.

3. **Shopkeeper character**: Should the shop have a named NPC with dialogue?
   Recommend: yes, adds personality. Minimal lines for MVP. Owner: Writer.
