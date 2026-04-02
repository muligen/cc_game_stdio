# Rest Site System

> **Status**: Designed
> **Author**: user + agents
> **Last Updated**: 2026-04-02
> **Implements Pillar**: Meaningful Opportunity Cost (heal vs upgrade vs remove — can only pick one), Informed Strategy (clear options with visible outcomes)

## Overview

The Rest Site System manages the choices available to the player when they reach a Rest
Site node on the map. The player can choose one of: **Rest** (heal 30% maxHP), **Smith**
(upgrade one card), **Dig** (obtain a random card), or **Toke** (remove one card from
the deck). Only one action can be taken per rest site. Rest sites are the most important
resource recovery points in a run.

## Player Fantasy

Rest sites are breathing room. You just survived several tough fights, your HP is low,
and now you face a critical decision: heal up for upcoming fights, upgrade that key
card, or thin your deck? **Meaningful Opportunity Cost**: every rest site offers only
one action — you can never both rest AND upgrade.

Reference: Slay the Spire's rest sites create some of the hardest decisions in the game.
Do you heal to survive the boss, or upgrade Bash to Strike+?

## Detailed Design

### Core Rules

**1. Rest Site Options (MVP)**

| Option | Effect | Prerequisites |
|--------|--------|---------------|
| **Rest** | Heal 30% of maxHP (rounded down) | None |
| **Smith** | Choose 1 card in deck → upgrade it | Deck has upgradable cards |
| **Dig** | Obtain 1 random card (pick from 3) | Character has card pool |
| **Toke** | Remove 1 card from deck | Deck size > minDeckSize (1) |

MVP Priority: Rest and Smith are **required**. Dig and Toke are **nice-to-have**.

**2. Rest Site Flow**

```
enterRestSite():
  options = getAvailableOptions()
  displayRestSiteUI(options)

  choice = await playerSelection(options)

  switch(choice):
    case "rest": executeRest()
    case "smith": executeSmith()
    case "dig":   executeDig()
    case "toke":  executeToke()

  returnToMap()
```

**3. Rest (Heal)**

```
executeRest():
  healAmount = Math.floor(maxHP * 0.30)
  currentHP = Math.min(currentHP + healAmount, maxHP)
  showHealAnimation(healAmount)
```

Disabled when: `currentHP == maxHP` (already full health).

**4. Smith (Upgrade Card)**

```
executeSmith():
  upgradeableCards = deck.filter(c => !c.isUpgraded)
  if upgradeableCards.length == 0:
    show("No cards to upgrade")
    return  // allow different option

  selectedCard = await playerSelectCard(upgradeableCards)
  selectedCard.upgrade()
  showUpgradeAnimation(selectedCard)
```

Disabled when: all cards in deck are already upgraded.

**5. Dig (Obtain Card)**

```
executeDig(rng):
  cards = generateCardReward(characterId, rng, count: 3)
  selectedCard = await playerSelectCard(cards)  // or skip
  if selectedCard:
    deckManager.addToMasterDeck(selectedCard.id)
    showObtainAnimation(selectedCard)
```

Player can skip all 3 cards (no card added).

**6. Toke (Remove Card)**

```
executeToke():
  removableCards = deck.cards  // all cards are candidates
  if deck.size <= minDeckSize:
    show("Cannot remove — deck at minimum size")
    return

  selectedCard = await playerSelectCard(removableCards)
  deckManager.removeFromMasterDeck(selectedCard.instanceId)
  showRemoveAnimation(selectedCard)
```

Disabled when: `deck.size <= minDeckSize`.

### Option Availability

| Option | Visible | Disabled When |
|--------|---------|---------------|
| Rest | Always | `currentHP == maxHP` |
| Smith | Always | All cards upgraded |
| Dig | Always | Extremely rare edge case |
| Toke | Always | `deck.size <= minDeckSize` |

Disabled options are grayed out but still visible (player knows they exist).

### Relic Interactions

| Relic | Effect on Rest Site |
|-------|---------------------|
| Coffee Dripper | Rest option is disabled (cannot rest — ever) |
| Girya | Smith: upgrade 2 cards instead of 1 |
| Shovel | Dig: offers 5 cards instead of 3 |
| Peace Pipe | Toke: remove 2 cards instead of 1 |
| Regal Pillow | Rest: heal 25% maxHP instead of 30% but also gain 15 gold |

### Interactions with Other Systems

| System | Direction | Data Exchanged | When |
|--------|-----------|---------------|------|
| Map System | Map → Rest | Trigger rest site on node entry | Map navigation |
| Card System | Rest → Card | Upgrade card (Smith), generate cards (Dig) | Card operations |
| Deck Manager | Rest → Deck | addToMasterDeck (Dig), removeFromMasterDeck (Toke) | Deck modifications |
| Run State Manager | Rest → Run | HP update (Rest), deck state changes | Post-action |
| Character System | Rest → Character | Card pool for Dig generation | Dig |
| Relic System | Relic → Rest | Modify available options or parameters | Option display |
| RNG System | RNG → Rest | Dig card generation | Dig action |

## Formulas

### Rest Heal Amount

```
restHeal(maxHP):
  return Math.floor(maxHP * 0.30)

// Examples:
// maxHP=50 → heal 15
// maxHP=75 → heal 22
// maxHP=80 → heal 24
```

### Smith Upgrade

```
smithUpgrade(card):
  // Uses Card System's upgrade mechanism
  card.applyUpgrade()
  // Card's upgrade field defines what changes (cost, damage, block, etc.)
```

### Dig Card Generation

```
digCards(characterId, rng):
  pool = getAvailableCards(characterId).filter(c => c.rarity != STARTER)
  return pickUniqueCards(pool, rng, count: 3)
```

### Girya Double Smith

```
executeSmithWithGirya():
  upgradeableCards = deck.filter(c => !c.isUpgraded)
  for i = 0 to 2:  // 2 upgrades
    if upgradeableCards.length == 0: break
    card = await playerSelectCard(upgradeableCards)
    card.upgrade()
    upgradeableCards = upgradeableCards.filter(c => c != card)
```

## Edge Cases

1. **HP full + Rest selected**: Heals 0 HP. Animation shows "+0". Player wasted their
   rest site. This is intentional — player should have chosen Smith or Toke.

2. **No upgradeable cards**: Smith option disabled. If ALL options disabled (extremely
   rare), show "Nothing to do" and return to map. Rest site is consumed.

3. **Dig skipped**: Player can choose not to take any card. No card added.

4. **Toke on deck size 1**: Cannot remove. minDeckSize prevents this. Toke option
   is disabled.

5. **Coffee Dripper disables Rest**: If player has Coffee Dripper, Rest is always
   grayed out. Smith/Dig/Toke remain available.

6. **Girya: only 1 upgradeable card**: Player upgrades that one card, second selection
   shows "No cards to upgrade" and stops. Only 1 card upgraded.

7. **Two consecutive rest sites**: Valid. Each is independent.

8. **Rest site interrupted mid-selection**: If interrupted during Smith/Toke card
   selection, rest site is not consumed. Player resumes at selection screen.

9. **MaxHP changed before resting**: Uses current maxHP at time of resting.

10. **Peace Pipe removes 2, deck at 2**: First removal succeeds. Second removal would
    bring deck below minDeckSize — second removal is skipped. Only 1 card removed.

## Dependencies

### Upstream (this system depends on)

| System | Type | Interface |
|--------|------|-----------|
| Data/Config | Hard | Rest site configuration (heal percent, options available) |
| Card System | Hard | Card upgrade logic, card data for Smith/Dig/Toke |
| Deck Manager | Hard | `addToMasterDeck`, `removeFromMasterDeck` for Dig/Toke |
| Run State Manager | Hard | `currentHP`, `maxHP` for healing |
| RNG System | Soft | For Dig card generation |
| Character System | Soft | Card pool filter for Dig |
| Relic System | Soft | Relics that modify rest site options |

### Downstream (systems that depend on this)

| System | Type | Interface |
|--------|------|-----------|
| Map System | Hard | Rest site node triggers this system |
| Run State Manager | Hard | HP update, deck state after action |
| Combat UI | Soft | Rest site screen display |

## Tuning Knobs

| Knob | Location | Default | Safe Range | What Breaks |
|------|----------|---------|------------|-------------|
| `restHealPercent` | `game-config.json` | 0.30 | 0.20-0.40 | 0.20: weak heal; 0.40: too forgiving |
| `digCardsOffered` | `game-config.json` | 3 | 2-5 | 2: less choice; 5: choice overload |
| `minDeckSize` | `game-config.json` | 1 | 1-3 | >1: limits aggressive thinning |
| `smithUpgradeLimit` | `game-config.json` | 1 | 1-2 | 2: too generous without Girya relic |

## Acceptance Criteria

1. Entering Rest Site node displays rest site screen with available options.
2. Rest heals 30% maxHP, clamped to maxHP.
3. Rest is disabled when HP is already at maxHP.
4. Smith allows selecting 1 card to upgrade; shows upgrade preview.
5. Smith is disabled when all cards are upgraded.
6. Dig generates 3 cards from character pool; player picks 1 or skips.
7. Toke allows removing 1 card from deck (not below minDeckSize).
8. Only one option can be chosen per rest site.
9. After action, player returns to map.
10. Coffee Dripper relic disables Rest option.
11. Girya relic allows upgrading 2 cards at Smith.

## Open Questions

1. **Rest site screen design**: Full-screen overlay or sidebar? Recommend: full-screen
   with character portrait and option cards. Owner: UX Designer. Combat UI GDD.

2. **Upgrade animation**: How to show the card upgrade visually? Recommend: card flips
   and shows new stats with a glow effect. Owner: Art Director.

3. **Dig rarity distribution**: Should Dig use the same rarity distribution as rewards
   or a different one? Recommend: same as rewards (includes pity system).
   Owner: Game Designer.
