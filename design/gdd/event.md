# Event System

> **Status**: Designed
> **Author**: user + agents
> **Last Updated**: 2026-04-02
> **Implements Pillar**: Informed Strategy (choices have visible outcomes), Calculated Tension (risk/reeward event choices), Adaptive Builds (events can dramatically change your run direction)

 

## Overview

The Event System manages story events encountered on map Event nodes. Each event presents a scenario with 2-3 choices, each with different outcomes: gain gold, obtain cards/reelic/potions, lose HP, transform cards, apply status effects, or or face penalties. Events are a run variety and surprise and change build direction, create meaningful risk/reeward decisions.

 The system uses the Event RNG stream for deterministic event selection and is tracks event history to prevent immediate repetition within the same run.

 

## Player Fantasy

 Events are unexpected encounters that break up the monotony of pure combat. You mysterious stranger offers you a choice: take this relic and risk your curse, or take gold and *The you think is worth the risk? Each event is a mini-narrative beat that adds flavor and the run, **Adaptive Builds** pillar: events can fundamentally change your strategy. Obt a curse that may force you to change your deck composition. Obtain a free relic that may shift your build entirely.

 **Calculated Tension**: every event choice carries risk. **Informed Strategy**: outcomes are clearly stated before choosing.

 

## Detailed Design

 

### Core Rules
 **1. Event Data Schema**
 ```
 interface EventData {
   id: string;              // "world_of_gods", "big_fish", etc.
   name: string;            // Display name
   description: string;     // Scenario description (2-3 sentences)
   flavorText?: string;    // Optional narrative text
   act?: number;             // Which act this event can appear (1, 2, or 3)
   rarity: EventRarity;    // COMMON | UNCOMMON | RARE
   choices: EventChoice[]; // 2-3 choices
   prerequisites?: EventPrerequisite; // conditions to appear
 }
 
 interface EventChoice {
   id: string;
   text: string;           // Button text
   outcome: EventOutcome; // what happens
   tooltip?: string;    // Extended description on hover
 }
 
 interface EventOutcome {
   effects: OutcomeEffect[]; // ordered effects
   resultText?: string;   // Flavor text after choosing
 }
 
 type OutcomeEffect =
   | { type: "gainGold"; amount: number }
   | { type: "loseGold"; amount: number }
   | { type: "gainHP"; amount: number }
   | { type: "loseHP"; amount: number }
   | { type: "gainMaxHP"; amount: number }
   | { type: "loseMaxHP"; amount: number }
   | { type: "gainCard"; cardId: string }
   | { type: "removeCard"; cardInstanceId?: string }  // specific or random
   | { type: "transformCard"; from: string; to: string }
   | { type: "gainRelic"; relicId: string }
   | { type: "gainPotion"; potionId: string }
   | { type: "gainStatusEffect"; effectId: string; stacks: number; duration: string }
   | { type: "upgradeCard"; cardInstanceId: string }
   | { type: "nothing" }  // no effect (flavor only)
 ```
 **2. Event Rarity**
 | Rarity | Pool Weight | Description |
 |--------|-------------|-------------|
 | COMMON | 50% | Simple events with mild outcomes |
 | UNCOMMON | 35% | Events with more impactful outcomes |
 | RARE | 15% | Events that can dramatically change a run |
 **3. Event Selection**
 When a player enters an Event node on the map:
 ```
 selectEvent(act, rng, eventHistory, runState):
   pool = events.filter(e =>
     e.act == act &&
     !eventHistory.includes(e.id) &&
     checkPrerequisites(e, runState)
   )
   if pool.length == 0:
     pool = events.filter(e => e.act == act)  // fallback: ignore history
   
   weights = pool.map(e => e.rarityWeight)
   event = rng.weightedPick(pool, weights)
   return event
 ```
 **Rules:**
 - Events are filtered by current act (1, 2, or 3)
 - Already-seen events are avoided in the same run (no repeats)
 - Some events have prerequisites (e.g., "must have at least 1 curse")
 - If no events match filters, use fallback pool (ignore history)
 **4. Event Flow**
 ```
 enterEvent(eventData):
   // Display event screen
   showEventScreen(eventData)
   
   // Player reads description and choices
   choice = await playerSelection(eventData.choices)
   
   // Execute outcome
   for effect in choice.outcome.effects:
     executeOutcomeEffect(effect)
   
   // Show result text
   if choice.outcome.resultText:
     showResultText(choice.outcome.resultText)
   
   // Mark event as seen
   eventHistory.push(eventData.id)
   
   // Return to map
   returnToMap()
 ```
 **5. Outcome Effect Execution**
 ```
 executeOutcomeEffect(effect):
   switch(effect.type):
     case "gainGold":
       runState.addGold(effect.amount)
     case "loseGold":
       runState.removeGold(effect.amount)  // can't go below 0
     case "gainHP":
       runState.heal(effect.amount)
     case "loseHP":
       runState.takeDamage(effect.amount)  // can kill player!
     case "gainMaxHP":
       runState.increaseMaxHP(effect.amount)
     case "loseMaxHP":
       runState.decreaseMaxHP(effect.amount)  // clamps currentHP
     case "gainCard":
       deckManager.addToMasterDeck(effect.cardId)
     case "removeCard":
       if effect.cardInstanceId:
         deckManager.removeFromMasterDeck(effect.cardInstanceId)
       else:
         // Player selects which card to remove
         card = await playerSelectCard(deck)
         deckManager.removeFromMasterDeck(card.instanceId)
     case "transformCard":
       deckManager.transformCard(effect.from, effect.to)
     case "gainRelic":
       relicManager.addRelic(effect.relicId)
     case "gainPotion":
       potionManager.addPotion(effect.potionId)
     case "gainStatusEffect":
       statusEffect.applyEffect(runState.player, effect.effectId, effect.stacks)
     case "upgradeCard":
       if effect.cardInstanceId:
         deckManager.upgradeCard(effect.cardInstanceId)
       else:
         card = await playerSelectUpgradeableCard(deck)
         card.upgrade()
     case "nothing":
       // No mechanical effect
 ```
 ### MVP Event List (Sample)
 | ID | Name | Act | Rarity | Choices |
 |----|------|-----|--------|---------|
 | `world_of_gods` | World of Goblins? | 1 | COMMON | [Take damage, Gain gold] |
 | `big_fish` | Big Fish | 1 | COMMON | [Fight fish → Gain relic, Leave] |
 | `golden_idol` | Golden Idol | 1 | UNCOMMON | [Pray → Gain gold, Desecrate → Lose maxHP] |
 | `golden_chest` | Golden Chest | 1 | UNCOMMON | [Open carefully → Gold+relic, Open hastily → Gold+curse] |
 | `living_wall` | Living Wall | 2 | COMMON | [Embrace the wall → Gain relic+curse, Walk away → Nothing] |
 | `secret_portal` | Secret Portal | 2 | UNCOMMON | [Enter → Transform card, Leave → Nothing] |
 | `winding_halls` | Winding Halls | 2 | RARE | [Fight shades → Gain relic, Flee → Gain card] |
 | `mind_bloom` | Mind Bloom | 3 | RARE | [Medititate → Upgrade 2 cards, Channel anger → Gain Strength] |
 | `library` | The Library | 3 | RARE | [Remove 2 cards, Read → Gain 2 random cards] |
 **6. Event Prerequisites**
 ```typescript
 interface EventPrerequisite {
   type: "hasRelic" | "hasCard" | "hasCurse" | "hpBelow" | "goldAbove" | "deckSizeBelow";
   params: any;  // type-specific params
 }
 ```
 Events with prerequisites only appear if conditions are met. Examples:
 - `"Obtain curse" event requires player to have at least 1 curse
 - `"Upgrade 3 cards" event requires deck size >= 5
 

## Formulas
 ### Event Selection Weight
 ```
 eventWeight(event):
   switch(event.rarity):
     COMMON:   return 50
     UNCOMMON: return 35
     RARE:     return 15
 ```
 ### Gold Loss Clamp
 ```
 loseGold(amount):
   actualLoss = Math.min(amount, runState.gold)
   runState.gold -= actualLoss
  // gold cannot go below 0
 ```
 ### HP Loss from Event
 ```
 eventHPDamage(targetHP, damage):
   targetHP -= damage
   if targetHP <= 0:
     targetHP = 0  // can kill the player!
     return targetHP
 ```
 Unlike combat damage, event HP loss is NOT affected by Block and does NOT trigger onDamageTaken.

 ### Max HP Change Clamp
 ```
 adjustMaxHP(currentHP, currentMaxHP, delta):
   newMaxHP = Math.max(1, currentMaxHP + delta)  // min 1
   newCurrentHP = Math.min(currentHP, newMaxHP)
   return { hp: newCurrentHP, maxHP: newMaxHP }
 ```

## Edge Cases

 1. **Event HP loss kills player**: If loseHP effect brings HP to 0, run is over. Player dies at the event — extremely harsh but intentional (like Slay the Spire's "I'm forgetting" event). Game over screen appears.
  2. **No valid events for act**: If filtering produces empty pool, show "Nothing happens..." and return to map. No event consumed.
  3. **All events already seen**: Very unlikely with 20+ events per act. If pool exhausted, allow repeating with a warning.
  4. **Transform card that doesn't exist in deck**: If the from card isn't in deck, effect does nothing. Show "Card not found" and skip transformation.
  5. **Gain relic when inventory full**: Relic added normally to obtained list. No swap prompt (unlike potions).
  6. **Remove card when deck at min size**: Cannot remove below minDeckSize. Choice is disabled or effect skipped.
  7. **Lose gold when gold is 0**: Gold goes to 0. No negative gold.
  8. **Lose maxHP when currentHP > new maxHP**: currentHP clamped to new maxHP.
  9. **Event during combat**: Not in MVP. Events only happen only on map nodes.
  10. **Event with all negative outcomes**: Valid. Some events are "trap" events — all choices are bad. Player must identify and avoid these.

 

## Dependencies
 ### Upstream
 | System | Type | Interface |
 |--------|------|-----------|
 | Data/Config | Hard | `getEvent(id)` → EventData, event pool definitions |
 | RNG System | Hard | Event RNG stream for deterministic selection |
 | Character System | Soft | Card pool for event card rewards |
 ### Downstream
 | System | Type | Interface |
 |--------|------|-----------|
 | Run State Manager | Hard | Gold, HP, maxHP, deck, relic, potion, effect tracking |
 | Deck Manager | Hard | Card add/remove/transform/upgrade operations |
 | Relic System | Hard | `addRelic()` for gain-re relic effects |
 | Potion System | Hard | `addPotion()` for gain-potion effects |
 | Status Effect | Soft | `applyEffect()` for status-effect outcomes |
 | Event UI | Hard | Event data for display, choice selection |

 

## Tuning Knobs
 | Knob | Location | Default | Safe Range | What Breaks |
 |------|----------|---------|------------|-------------|
 | `commonEventWeight` | `event-config.json` | 50 | 30-60 | 30: events too rare; 60: events too common |
 | `uncommonEventWeight` | `event-config.json` | 35 | 20-45 | Same |
 | `rareEventWeight` | `event-config.json` | 15 | 5-25 | Same |
 | `minEventPoolPerAct` | `event-config.json` | 5 | 3-10 | 3: repetitive; 10: too diverse |
 | `noRepeatInRun` | `event-config.json` | true | false | false: repetitive; true: more variety |
 | `eventHPLossCanKill` | `event-config.json` | true | false | true: allows events to kill — adds stakes |

 

## Acceptance Criteria
  1. Event node on map triggers event screen.
  2. Event selected from pool based on act, rarity, and prerequisites.
  3. Already-seen events not NOT repeat within the same run.
  4. Player choice shows correct result text and executes outcome effects.
  5. `gainGold` effect adds gold to run state.
  6. `loseHP` effect reduces HP ( can kill player if `eventHPLossCanKill` is true).
  7. `loseGold` effect cannot reduce gold below 0.
 
  8. `gainCard` effect adds card to deck.
  9. `removeCard` effect removes card from deck (respects minDeckSize).
  10. `transformCard` effect converts one card to another.
  11. `gainRelic` effect adds relic to inventory.
  12. Event RNG stream ensures same seed produces same event sequence.

 

## Open Questions
  1. **Event narrative writing**: How much flavor text per event? Should events tell a story or Slay the Spire has minimal narrative — mostly flavor text with some outcomes. Owner: Writer. Content pass.
  2. **Event art**: Should each event have unique art? Recommend: yes, a simple illustration per event. Owner: Art Director.
  3. **Conditional event chains**: Should some events unlock or subsequent events based on previous choices? Recommend: yes, for post-MVP. Adds depth and consequence tracking. Owner: Game Designer.
