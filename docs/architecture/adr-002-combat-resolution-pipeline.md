# ADR-002: Combat Resolution Pipeline

**Status**: Accepted

**Date**: 2026-04-02

**Scope**: Turn structure, damage resolution, death checking, block management

**Supersedes**: None

**Depends on**: ADR-001 (CombatState, EffectResolver, Event Bus pattern)

---

## Context

Combat is the core gameplay loop of a roguelike deckbuilder. Every turn, the player
plays cards, effects resolve in a specific order, enemies execute their intents, and
the game state advances. The order in which these steps occur is load-bearing:

- Status effects like Vulnerable and Weak must modify damage at the right moment.
- Block must absorb damage before HP is reduced.
- Death must be checked after every individual damage instance, not at end-of-turn.
- Multi-hit attacks must treat each hit as a separate damage instance (so
  Vulnerable applies to each, Strength adds to each, and death can occur mid-attack).
- Relics that trigger "on damage dealt" or "on damage taken" must fire at the
  correct point in the pipeline.

If the resolution order is wrong, cascading bugs appear: a relic might fire before
the damage it should react to, or an enemy might deal damage after it should be
dead. This ADR defines the exact sequence so that all 24 systems can rely on a
consistent, documented pipeline.

---

## Decision

### Turn Structure

A combat consists of repeating **turn cycles**. Each turn cycle has two phases:
**Player Turn** and **Enemy Turn**.

```
Combat Start
  |
  v
+---------------------------------------------------+
| Turn Cycle (repeats until combat ends)            |
|                                                    |
|  [Player Turn]                                     |
|    1. Turn start phase                             |
|    2. Player action phase (play cards / end turn)  |
|    3. Player turn end phase                        |
|                                                    |
|  [Enemy Turn]                                      |
|    4. Enemy intent execution phase                 |
|    5. Turn end phase                               |
+---------------------------------------------------+
  |
  v
Combat End (when any side is fully defeated)
```

### Phase Details

#### Combat Start

```
1. Create CombatState (per ADR-001 Decision 2)
2. Shuffle draw pile (seeded RNG)
3. Initialize enemy instances from encounter data
4. Roll first enemy intents
5. Fire event: onCombatStart
6. Fire event: onPlayerTurnStart
7. Draw initial hand (5 cards, configurable)
```

#### Phase 1: Player Turn Start

```
1. Reset player block to 0
2. Reset player card play count
3. Apply "at turn start" status effects to player
   (e.g., Draw 1 extra card from Vigilance)
4. Fire event: onPlayerTurnStart
5. Refill energy to character base (modified by relics/effects)
6. Draw cards up to hand size limit (default 5)
```

#### Phase 2: Player Action Phase

The player selects and plays cards, or ends their turn. Each card play follows
the **Card Play Pipeline** (see below). The player may play multiple cards in
sequence during this phase. The phase ends when the player explicitly ends their
turn, or when no legal actions remain.

#### Phase 3: Player Turn End

```
1. Discard entire hand to discard pile
2. Apply "at end of player turn" status effects to player
   (e.g., lose 1 Dexterity from Withering)
3. Decrement player status effect durations
4. Fire event: onPlayerTurnEnd
5. Check if combat should end (all enemies dead)
```

#### Phase 4: Enemy Turn

```
For each living enemy (in order):
  1. Execute enemy intent (attack, defend, buff, debuff, or multi-action)
     - Each action resolved via the same Damage Pipeline used for player attacks
     - Multi-hit attacks: each hit is a separate damage instance
  2. After each damage instance: check death (player)
3. Reset enemy block to 0
4. Apply "at end of enemy turn" status effects to each enemy
5. Decrement enemy status effect durations
6. Roll next intent for each enemy
7. Fire event: onEnemyTurnEnd
8. Check if combat should end (player dead)
```

#### Combat End

```
1. Fire event: onCombatEnd (carries result: victory / defeat)
2. Award gold, cards, potions based on combat result
3. Destroy CombatState
4. Commit results to global RunState via StateManagerPlugin
5. Transition to RewardScene or DeathScene via SceneFlowController
```

### Card Play Pipeline

When the player plays a card, the following steps execute in strict order:

```
1. VALIDATE
   - Check energy cost can be paid
   - Check target is valid (alive, correct type)
   - Check card is playable (not silenced, etc.)
   If invalid: abort, return card to hand

2. PAY COST
   - Deduct energy cost from CombatState
   - Fire event: onCardPlayed(card, target)

3. RESOLVE EFFECTS (for each effect in card's effects array, in order)
   a. Resolve target(s) from card's target type
   b. Calculate modified value (see Modifier Application Order below)
   c. Apply effect via EffectResolver (ADR-003)
   d. After each damage instance: check death (see Death Checking below)

4. POST-PLAY
   - Fire event: onCardResolved(card, target)
   - If card has exhaust property: move to exhaust pile
   - Else: move to discard pile
   - Update cards played this turn counter
```

**Important**: Step 3 processes effects sequentially. If a card has two effects
(deal damage, then apply Vulnerable), the damage resolves fully (including death
checks) before the Vulnerable is applied. This is intentional and matches the
Slay the Spire reference behavior.

### Damage Pipeline

Every source of damage -- player attacks, enemy attacks, status effect ticks,
relic procs -- goes through the same pipeline:

```
resolveDamage(source: Entity, target: Entity, baseDamage: number)
  -> number (actual HP lost)

1. FIRE EVENT: onDamageAboutToBeDealt(source, target, baseDamage)
   - Listeners may modify the pending damage amount

2. CALCULATE MODIFIED DAMAGE:
   a. Start with baseDamage
   b. Apply source's Strength: damage += source.strength
   c. If target has Vulnerable: damage = floor(damage * 1.5)
   d. If source has Weak: damage = floor(damage * 0.75)
   e. Minimum damage is 0 (cannot heal via negative damage)
   (See ADR-003 for full modifier application order)

3. APPLY BLOCK:
   if target.block > 0:
     absorbed = min(target.block, damage)
     target.block -= absorbed
     damage -= absorbed
     Fire event: onBlockBroken(target, absorbed)

4. APPLY HP LOSS:
   if damage > 0:
     target.currentHP -= damage
     Fire event: onDamageDealt(source, target, damage)
     Fire event: onDamageTaken(target, source, damage)

5. DEATH CHECK:
   if target.currentHP <= 0:
     target.isAlive = false
     Fire event: onEntityDeath(target)
     If target is player: end combat (defeat)
     If target is enemy: check if all enemies dead

6. RETURN actual HP lost (original damage minus block absorption)
```

### Multi-Hit Attacks

Multi-hit attacks (e.g., "Deal 3 damage 4 times") are modeled as a single effect
with a `hits` parameter. The Damage Pipeline runs once per hit:

```json
{
  "type": "deal_damage",
  "value": 3,
  "hits": 4
}
```

Resolution:
```
for (let i = 0; i < effect.hits; i++) {
  if (!target.isAlive) break;  // stop if target dies mid-attack
  resolveDamage(source, target, effect.value);
}
```

Each hit is a fully independent damage instance:
- Strength adds to each hit individually
- Vulnerable multiplies each hit individually
- Block absorption applies per hit (target's remaining block carries between hits)
- Death is checked after each hit
- Relics that trigger "on damage dealt" fire for each hit

This matches the reference game behavior where multi-hit attacks are extremely
strong with Strength scaling because each hit benefits from the full Strength bonus.

### Death Checking

Death is checked **immediately after every individual damage instance**. This is
the most critical timing rule in the pipeline:

```
After resolveDamage() modifies target.currentHP:
  if target.currentHP <= 0:
    target.isAlive = false
    Fire event: onEntityDeath(target)
    // No further effects target this entity
    // If an enemy dies mid-multi-hit, remaining hits are forfeit
    // If the player dies, combat ends immediately (no more card effects resolve)
```

**Death is final within a combat**: there are no "prevent death" mechanics in the
base design. If a "prevent death" relic is added later, it would be implemented
as a listener on `onEntityDeath` that restores 1 HP and cancels the death sequence.

### Block Application and Reset Timing

Block timing follows strict rules:

1. **Player block resets to 0 at the start of the player's turn** (Phase 1, step 1).
   This happens before drawing cards. Block from the previous enemy turn does not
   carry over into the player's next defense cycle.

2. **Enemy block resets to 0 at the end of the enemy turn** (Phase 4, step 3).
   Block that enemies gain during their turn is used to absorb the player's attacks
   on the next player turn. Block from intents is applied during intent execution.

3. **Block application is additive within a turn**: if the player plays two Defend
   cards in one turn, block values sum. If an enemy gains block from both its intent
   and a buff, those values also sum.

4. **Block does not decay**: block stays at its value until the reset point. There
   is no "block loses 1 per turn" mechanic in the base design (such a mechanic would
   be modeled as a status effect tick, not a block rule change).

```
Block Lifecycle:

Player Turn Start:  player.block = 0
  ...player plays Defend cards...  player.block += 5, += 5 = 10
Enemy Turn:         enemy attacks for 7 damage
                    -> block absorbs 7, player.block = 3, damage = 0
                    enemy attacks for 5 damage
                    -> block absorbs 3, player.block = 0, damage = 2 (HP loss)
Next Player Turn:   player.block = 0 (reset)
```

### Priority-Based Effect Resolution

Effects that trigger in response to combat events are resolved by priority:

```
Priority Order (lower number = resolves first):
  0 = Override effects (rare: replace the action entirely)
  1 = Prevention effects (block damage, negate attack)
  2 = Modification effects (change damage amount, add Weak)
  3 = Reaction effects (deal damage in response, gain energy)
  4 = Notification effects (UI updates, animation triggers)
  5 = Cleanup effects (remove temp buffs, trigger end-of-chain logic)
```

When multiple effects have the same priority (e.g., two relics both trigger "on
damage dealt" at priority 3), they resolve in **relic acquisition order** (the
relic the player obtained first resolves first). This provides deterministic
ordering and matches the reference game's behavior.

### Turn Flow Diagram (Complete)

```
Combat Start
  |
  v
Player Turn Start
  |-- Reset block to 0
  |-- Refill energy
  |-- Draw hand (5 cards)
  |-- Apply start-of-turn status effects
  |-- Fire onPlayerTurnStart
  |
  v
Player Action Loop
  |-- Player selects card + target
  |     |
  |     v
  |   Validate -> Pay cost -> Resolve effects (per-effect Damage Pipeline)
  |     |              |
  |     |              +-> Death check after each damage instance
  |     |              +-> If player dead: Combat End (defeat)
  |     |              +-> If all enemies dead: Combat End (victory)
  |     |
  |     +-> Discard/exhaust card
  |     +-> Fire onCardResolved
  |
  |-- Player clicks "End Turn" (or no actions remain)
  |
  v
Player Turn End
  |-- Discard hand
  |-- Apply end-of-turn status effects
  |-- Decrement player status durations
  |-- Fire onPlayerTurnEnd
  |
  v
Enemy Turn
  |-- For each living enemy:
  |     Execute intent action(s)
  |       |
  |       v
  |     Damage Pipeline per action (same as player attacks)
  |       +-> Death check after each damage instance
  |       +-> If player dead: Combat End (defeat)
  |
  |-- Reset enemy block to 0
  |-- Apply end-of-turn status effects to each enemy
  |-- Decrement enemy status durations
  |-- Roll next intents
  |-- Fire onEnemyTurnEnd
  |
  v
Loop back to Player Turn Start
```

---

## Consequences

### Positive

- **Deterministic resolution**: Every interaction has a defined order. Two
  developers implementing different systems can work independently knowing exactly
  when their effects fire relative to each other. This reduces integration bugs.
- **Death checking after every damage instance** prevents the "zombie enemy"
  bug where an enemy at 0 HP continues to deal damage. The game state is always
  consistent.
- **Multi-hit as repeated single hits** means Strength, Vulnerable, and Weak all
  "just work" for multi-hit attacks without special-casing. This is why
  Strength-scaling multi-hit cards are strong in the reference game -- it emerges
  naturally from the pipeline, not from special rules.
- **Unified Damage Pipeline** for both player and enemy attacks means status
  effects, relics, and block mechanics are consistent regardless of damage source.
  No "does this relic work on enemy attacks too?" ambiguity.
- **Block reset timing** matches player expectations from the reference game and
  creates clear strategic decisions: block now or attack now?
- **Priority ordering** gives a deterministic resolution for competing effects
  without requiring complex scheduling logic.

### Negative

- **Synchronous resolution complexity**: During a multi-hit attack with relic
  triggers, the call stack can get deep (resolveDamage -> onDamageDealt -> relic
  effect -> resolveDamage -> ...). Developers must be careful not to create
  infinite trigger loops. Mitigation: a recursion depth counter with a hard limit
  (e.g., 50 nested resolutions maximum per card play).
- **Death mid-effect-chain**: When an enemy dies mid-card-effect-chain, remaining
  effects that target the dead enemy must be skipped. The EffectResolver must
  check `target.isAlive` before applying each effect, not just at the start.
- **Block reset timing asymmetry**: Player block resets at turn start, enemy block
  resets at turn end. This asymmetry is correct for gameplay but must be
  documented clearly to avoid confusion during implementation.
- **No animation timing in this ADR**: The pipeline defines logical resolution
  order, not visual/animation order. Animations may need to be queued and played
  asynchronously while the logical pipeline continues. A separate ADR (or the
  CombatScene implementation) must address how visual timing maps to logical timing.

### Performance Implications

- **Per-card-play cost**: A single card play involves ~5-10 function calls
  (validate, pay cost, resolve effects, death check, events). At 16.67ms per
  frame budget and typical card play taking <0.1ms in logic, this is well within
  budget. The bottleneck is rendering/animation, not logic.
- **Multi-hit attacks**: A 4-hit attack with relic triggers might generate 20-30
  event emissions. Each event handler must complete in <0.1ms to keep the total
  under 3ms. Simple arithmetic handlers easily meet this.
- **Death checking overhead**: Checking `target.currentHP <= 0` after every
  damage instance is a single integer comparison. Negligible cost.
- **No per-frame work**: The pipeline is event-driven and executes in response to
  player actions. No continuous update loop is needed.

### Alternatives Considered

1. **Batch damage resolution**: Resolve all damage from a multi-hit attack as a
   single batch, then check death once. Rejected because it breaks the interaction
   with Strength, Vulnerable, and relics that trigger "on damage dealt" per hit.
   It also prevents the dramatic "enemy dies on hit 3 of 4" visual moment.

2. **End-of-turn death checking**: Check for deaths only at the end of each turn,
   not after each damage instance. Rejected because it allows dead enemies to
   continue dealing damage during the enemy turn, creating nonsensical game states.

3. **Separate player and enemy damage pipelines**: Different resolution logic for
   player attacks vs enemy attacks. Rejected because it doubles the code surface
   for damage resolution and creates inconsistency in how relics and status effects
   interact with different damage sources.

4. **Action queue / stack-based resolution (MTG-style)**: A stack where effects
   are pushed and resolved LIFO, allowing responses and interrupts. Rejected as
   over-engineered for this game design. The player does not respond during the
   enemy turn, so a stack-based system adds complexity without gameplay benefit.
   The priority-based system provides sufficient ordering without the overhead.
