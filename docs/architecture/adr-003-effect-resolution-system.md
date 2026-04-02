# ADR-003: Effect Resolution System (Effect DSL)

**Status**: Accepted

**Date**: 2026-04-02

**Scope**: Effect DSL specification, handler contracts, modifier order, trigger system

**Supersedes**: None

**Depends on**: ADR-001 (Data-Driven Design, EffectResolver lookup table), ADR-002 (Damage Pipeline)

---

## Context

ADR-001 Decision 3 established the principle: all gameplay values live in JSON,
effect behavior uses lookup tables. The EffectResolver maps effect type strings to
handler functions. This ADR specifies the complete contract for that system:

- What effect types exist and what data each requires
- How the resolver passes data to handlers (source, target, state, effect data)
- The modifier application order for damage calculations
- How triggers ("on card played", "on damage dealt", "on turn end") connect
  effects to combat events
- How conditional effects work without turning the DSL into a programming language

Without this specification, each system implementer would invent their own effect
handling conventions, leading to inconsistencies in how a card's JSON definition
maps to runtime behavior.

---

## Decision

### Effect Data Model

Every effect in JSON follows this shape:

```typescript
// Base shape all effects share
interface EffectData {
  type: EffectType;           // Which handler to invoke
  value: number;              // Primary magnitude
  upgradedValue?: number;     // Magnitude if card is upgraded
  hits?: number;              // For multi-hit effects (default 1)
  status?: string;            // For status effect effects (e.g., "vulnerable")
  duration?: number;          // For timed effects (e.g., status duration)
  upgradedDuration?: number;  // Duration if card is upgraded
  target?: TargetOverride;    // Override card's default target
  condition?: ConditionData;  // Optional precondition (see Conditional Effects)
}

type TargetOverride = 'self' | 'all_enemies' | 'random_enemy' | 'none';
// When absent, the card's top-level `target` field is used
```

### EffectType Enum

The complete catalog of effect types for the initial implementation:

```typescript
enum EffectType {
  // --- Damage ---
  DEAL_DAMAGE = 'deal_damage',             // Deal damage (uses Damage Pipeline)
  DEAL_DAMAGE_TO_ALL = 'deal_damage_all',  // AOE damage to all enemies

  // --- Block ---
  GAIN_BLOCK = 'gain_block',               // Gain block

  // --- Status Effects ---
  APPLY_STATUS = 'apply_status',           // Apply a buff/debuff to target
  REMOVE_STATUS = 'remove_status',         // Remove stacks of a buff/debuff
  TRANSFER_STATUS = 'transfer_status',     // Move debuffs from self to target

  // --- Card Manipulation ---
  DRAW_CARDS = 'draw_cards',               // Draw N cards
  EXHAUST_CARDS = 'exhaust_cards',         // Exhaust cards from hand
  DISCARD_CARDS = 'discard_cards',         // Discard cards from hand
  FETCH_CARD_TYPE = 'fetch_card_type',     // Choose a card of type from draw pile
  ADD_CARD_TO_HAND = 'add_card_to_hand',   // Create a card and add to hand

  // --- Energy ---
  GAIN_ENERGY = 'gain_energy',             // Gain temporary energy
  LOSE_ENERGY = 'lose_energy',             // Lose energy (enemy effect)

  // --- Healing ---
  HEAL = 'heal',                           // Restore HP

  // --- Meta ---
  APPLY_POWER = 'apply_power',             // Apply a persistent power (Strength, Dexterity)
  GAIN_GOLD = 'gain_gold',                 // Gain gold (rare, event-only)
  NOTHING = 'nothing',                     // Explicitly do nothing (placeholder)

  // --- Conditional / Composite ---
  CONDITIONAL = 'conditional',             // Execute sub-effects if condition is met
  REPEAT = 'repeat',                       // Repeat contained effects N times
}
```

New effect types are added by:
1. Adding a member to the `EffectType` enum
2. Implementing an `EffectHandler` function
3. Registering the handler in the `EffectResolver`
4. Adding JSON validation for the new type's required fields

### Handler Contract

Every effect handler follows the same signature:

```typescript
interface EffectContext {
  source: Entity;           // The entity causing the effect (player or enemy)
  target: Entity;           // The entity receiving the effect
  combatState: CombatState; // Current combat state (for deck/energy queries)
  runState: RunState;       // Current run state (for gold/HP/relic queries)
  eventBus: IEventBus;      // For firing events during resolution
  rng: SeededRNG;           // Deterministic random for any randomness
}

type EffectHandler = (
  context: EffectContext,
  effect: EffectData
) => EffectResult;

interface EffectResult {
  success: boolean;         // Did the effect execute? (false if target dead, etc.)
  damage?: number;          // Damage dealt (for triggers)
  blocked?: number;         // Damage absorbed by block
  healed?: number;          // HP restored
  statusApplied?: string;   // Status effect ID applied
  cardsDrawn?: number;      // Cards drawn
  energyGained?: number;    // Energy gained
  message?: string;         // Log message for combat log
}
```

**Key rules for handlers:**

1. Handlers are **pure functions of their inputs**: given the same context and
   effect data, a handler always produces the same result (no hidden state).
   The `rng` parameter ensures determinism for any randomness.

2. Handlers **fire events** via `context.eventBus` for any significant game state
   change. They do NOT modify `combatState` or `runState` directly -- they call
   mutation methods on those objects, which emit events internally.

3. Handlers **check target validity** before applying effects: `target.isAlive`
   must be true. If the target is dead, return `{ success: false }`.

4. Handlers **return results**, not void. The returned `EffectResult` is used by
   the combat log, animation system, and trigger system to react to what happened.

### EffectResolver Implementation

```typescript
class EffectResolver {
  private handlers: Map<EffectType, EffectHandler> = new Map();

  register(type: EffectType, handler: EffectHandler): void {
    if (this.handlers.has(type)) {
      throw new Error(`Duplicate handler registration for effect type: ${type}`);
    }
    this.handlers.set(type, handler);
  }

  resolve(context: EffectContext, effect: EffectData): EffectResult {
    const handler = this.handlers.get(effect.type);
    if (!handler) {
      console.error(`No handler registered for effect type: ${effect.type}`);
      return { success: false, message: `Unknown effect: ${effect.type}` };
    }

    // Determine effective value (use upgraded if card is upgraded)
    const effectiveValue = effect.upgradedValue !== undefined &&
      context.source.isCardUpgraded ? effect.upgradedValue : effect.value;

    const effectiveDuration = effect.upgradedDuration !== undefined &&
      context.source.isCardUpgraded ? effect.upgradedDuration : effect.duration;

    // Build effective effect with resolved values
    const effectiveEffect: EffectData = {
      ...effect,
      value: effectiveValue,
      duration: effectiveDuration,
    };

    return handler(context, effectiveEffect);
  }

  /** Resolve an array of effects sequentially, stopping if target dies */
  resolveAll(context: EffectContext, effects: EffectData[]): EffectResult[] {
    const results: EffectResult[] = [];
    for (const effect of effects) {
      if (!context.target.isAlive && effect.type !== EffectType.NOTHING) {
        break; // Stop resolving if target is dead
      }
      results.push(this.resolve(context, effect));
    }
    return results;
  }
}
```

### Modifier Application Order

When calculating damage (invoked by the `deal_damage` handler), modifiers apply
in this exact sequence:

```
Step 1: Base value
  damage = effect.value

Step 2: Source offensive modifiers
  damage += source.strength                    // Flat additive
  damage = floor(damage * source.damageMultiplier)  // Multiplicative (relics)

Step 3: Target defensive modifiers (debuffs on target)
  if target has Vulnerable:
    damage = floor(damage * 1.5)               // Takes 50% more damage

Step 4: Source offensive debuffs (debuffs on source)
  if source has Weak:
    damage = floor(damage * 0.75)              // Deals 25% less damage

Step 5: Target block
  absorbed = min(target.block, damage)
  target.block -= absorbed
  damage -= absorbed

Step 6: Floor at 0
  damage = max(0, damage)                      // Cannot deal negative damage
```

**Rationale for this order:**

- **Strength before Vulnerable**: Strength adds a flat amount, then Vulnerable
  multiplies the total. This means Vulnerable amplifies Strength, which matches
  the reference game and makes Strength+Vulnerable a strong combo.
- **Vulnerable before Weak**: If both apply (attacker has Weak, target has
  Vulnerable), Vulnerable is applied first, then Weak reduces the result. This
  means the net effect of Vulnerable + Weak is `floor(floor(base * 1.5) * 0.75)`,
  which is less than the base -- Weak "wins" in the interaction.
- **Block last**: Block is a resource, not a modifier. It absorbs whatever damage
  survives the modifier chain.

**Block modifier (Frail):** Frail is handled in the `gain_block` handler, not the
damage pipeline:

```
if source has Frail:
  block = floor(block * 0.75)                  // Gain 25% less block
```

Frail applies when block is gained, not when damage is dealt. This is a separate
calculation from the damage modifier chain.

### Trigger System

Effects are not only on cards. Relics, potions, and status effects also produce
effects in response to combat events. The trigger system connects events to effects.

#### Trigger Categories

```typescript
enum TriggerType {
  // Combat lifecycle
  ON_COMBAT_START = 'on_combat_start',
  ON_COMBAT_END = 'on_combat_end',
  ON_PLAYER_TURN_START = 'on_player_turn_start',
  ON_PLAYER_TURN_END = 'on_player_turn_end',
  ON_ENEMY_TURN_END = 'on_enemy_turn_end',

  // Card play
  ON_CARD_PLAYED = 'on_card_played',
  ON_ATTACK_PLAYED = 'on_attack_played',
  ON_SKILL_PLAYED = 'on_skill_played',
  ON_POWER_PLAYED = 'on_power_played',

  // Damage
  ON_DAMAGE_DEALT = 'on_damage_dealt',
  ON_DAMAGE_TAKEN = 'on_damage_taken',
  ON_ATTACK_RECEIVED = 'on_attack_received',    // Enemy was attacked

  // Death
  ON_ENTITY_DEATH = 'on_entity_death',
  ON_ENEMY_DEATH = 'on_enemy_death',

  // Deck manipulation
  ON_CARD_DRAWN = 'on_card_drawn',
  ON_CARD_EXHAUSTED = 'on_card_exhausted',
  ON_CARD_DISCARDED = 'on_card_discarded',

  // Status
  ON_STATUS_APPLIED = 'on_status_applied',
  ON_BLOCK_GAINED = 'on_block_gained',
  ON_HP_CHANGED = 'on_hp_changed',
}
```

#### Trigger Data Model

```json
{
  "id": "relic_pen_nib",
  "name": "Pen Nib",
  "triggers": [
    {
      "event": "on_card_played",
      "condition": { "cardType": "attack" },
      "effects": [
        {
          "type": "apply_power",
          "status": "pen_nib_counter",
          "value": 1
        }
      ]
    },
    {
      "event": "on_attack_played",
      "condition": { "statusStacks": { "pen_nib_counter": 10 } },
      "effects": [
        { "type": "deal_damage", "value": 0, "hits": 0 },
        { "type": "remove_status", "status": "pen_nib_counter", "value": 10 }
      ]
    }
  ]
}
```

Simpler relics have a single trigger with no condition:

```json
{
  "id": "relic_burning_blood",
  "name": "Burning Blood",
  "triggers": [
    {
      "event": "on_combat_end",
      "effects": [
        { "type": "heal", "value": 6 }
      ]
    }
  ]
}
```

#### Trigger Resolution

When a combat event fires, the TriggerManager processes all registered triggers
for that event:

```typescript
class TriggerManager {
  // Map of event name -> array of { entityId, trigger, handler }
  private subscriptions: Map<TriggerType, TriggerSubscription[]> = new Map();

  subscribe(entityId: string, trigger: TriggerData, handler: () => void): void { ... }
  unsubscribeAll(entityId: string): void { ... }

  /** Called by EventBus when a combat event fires */
  onEvent(event: TriggerType, payload: EventPayload): void {
    const subs = this.subscriptions.get(event) || [];
    // Process in priority order, then acquisition order for same priority
    const sorted = subs.sort((a, b) => a.priority - b.priority);

    for (const sub of sorted) {
      // Check condition (if any)
      if (sub.condition && !this.evaluateCondition(sub.condition, payload)) {
        continue;
      }
      // Resolve trigger effects
      const context = this.buildContext(sub.entityId, payload);
      for (const effect of sub.effects) {
        this.effectResolver.resolve(context, effect);
        // Death check after each effect
        if (!payload.target?.isAlive) break;
      }
    }
  }
}
```

### Conditional Effects

Some effects require a precondition. Rather than creating hundreds of specific
effect types, a `conditional` wrapper effect checks a condition and then executes
sub-effects:

```json
{
  "type": "conditional",
  "condition": {
    "type": "hand_size",
    "operator": "greater_than_or_equal",
    "value": 5
  },
  "effects": [
    { "type": "gain_block", "value": 3 }
  ]
}
```

**Condition types (initial set, extensible):**

```typescript
type ConditionData =
  | { type: 'hand_size'; operator: ComparisonOp; value: number }
  | { type: 'hp_percent'; operator: ComparisonOp; value: number }
  | { type: 'status_stacks'; status: string; operator: ComparisonOp; value: number }
  | { type: 'card_type_in_hand'; cardType: CardType; operator: ComparisonOp; value: number }
  | { type: 'cards_played_this_turn'; operator: ComparisonOp; value: number }
  | { type: 'enemy_count'; operator: ComparisonOp; value: number }
  | { type: 'has_relic'; relicId: string }
  | { type: 'random_chance'; chance: number };  // chance is 0.0-1.0

type ComparisonOp = 'equal' | 'not_equal' | 'greater_than' |
                    'less_than' | 'greater_than_or_equal' | 'less_than_or_equal';
```

**Design constraint**: Conditions are read-only queries against game state. They
must not modify state. They must not nest conditionals (no conditional inside a
conditional). This keeps the DSL simple and prevents it from becoming a Turing-
complete scripting language.

### Effect Resolution in Card Context

Putting it all together, when a card is played:

```
1. CardPlayPipeline validates and pays cost (ADR-002)
2. For each effect in card.effects[]:
   a. If effect.type is "conditional":
      - Evaluate condition against current game state
      - If true: resolve sub-effects
      - If false: skip
   b. If effect.type is "repeat":
      - Resolve contained effects N times
   c. If effect.type is "deal_damage" with hits > 1:
      - For each hit: run Damage Pipeline (ADR-002) + death check
   d. Otherwise:
      - Look up handler in EffectResolver
      - Build EffectContext from current state
      - Call handler(context, effect)
      - Collect EffectResult
3. TriggerManager processes any triggers fired during step 2
   (e.g., relics responding to on_damage_dealt)
```

---

## Consequences

### Positive

- **Complete separation of data and behavior**: JSON defines what effects do and
  how much; TypeScript defines the mechanics. Card designers can create new cards
  by combining existing effect types in JSON without touching code.
- **Type-safe end to end**: The `EffectType` enum, `EffectData` interface, and
  `EffectHandler` signature ensure compile-time correctness. A misspelled effect
  type in JSON is caught during data validation at startup.
- **Testable in isolation**: Each handler is a pure function. Unit tests provide
  an `EffectContext` with mock entities and verify the `EffectResult`. No Phaser
  runtime, no UI, no scene lifecycle needed for handler tests.
- **Extensible by design**: Adding a new effect type is a three-step process
  (enum member, handler function, registration). Existing cards and systems are
  unaffected. The EffectResolver does not need to know about specific types.
- **Deterministic modifier order**: Every damage calculation in the game follows
  the same six-step sequence. No ambiguity about whether Strength applies before
  or after Vulnerable.
- **Trigger system unifies cards, relics, potions**: All three entity types use
  the same effect DSL and the same resolver. A relic trigger and a card effect
  that both deal damage use the identical `deal_damage` handler and modifier
  chain.

### Negative

- **DSL expressiveness ceiling**: Complex effects like "for each card exhausted
  this turn, deal 3 damage" require either a specialized effect type or creative
  use of conditional + trigger combinations. As content complexity grows, the
  tension between "keep the DSL simple" and "express this card's behavior" will
  increase. Mitigation: the `CONDITIONAL` and `REPEAT` types provide escape
  hatches for moderately complex effects without requiring a scripting language.
- **Condition type proliferation**: Every new conditional card may seem to need
  a new condition type. Without discipline, the condition types could grow
  indefinitely. Mitigation: design reviews should prefer "can this be modeled
  with existing conditions?" before adding new ones.
- **No effect chaining from JSON**: A handler cannot trigger another effect
  directly (that requires going through the event bus). This is intentional
  (prevents infinite loops from data) but means some card behaviors require
  custom handlers rather than pure JSON composition.
- **Performance of trigger evaluation**: When a combat event fires, all
  registered triggers for that event are evaluated, including condition checks.
  With 10+ relics, each firing conditions on every card play, the overhead adds
  up. Mitigation: conditions are simple comparisons (<0.01ms each). At 20
  conditions per event, total overhead is <0.2ms -- well within budget.

### Performance Implications

| Operation | Cost | Notes |
|-----------|------|-------|
| EffectResolver.lookup | O(1) | Map.get() by enum value |
| Handler execution (simple) | <0.05ms | Arithmetic + state mutation |
| Handler execution (conditional) | <0.1ms | Condition evaluation + sub-effects |
| Trigger evaluation (per trigger) | <0.02ms | Condition check only (most skip) |
| Full card play (3 effects + 10 relic triggers) | <1ms | Dominated by events, not logic |
| Modifier chain (damage calc) | <0.01ms | 6 arithmetic steps |

No operation in the effect system has per-frame cost. All work is triggered by
player actions or combat events.

### Alternatives Considered

1. **Scriptable effects (embedded DSL)**: A mini-language in JSON with variables,
   loops, and conditionals. Rejected because it violates the project constraint
   against `eval()` and turns data files into code. The flat lookup table pattern
   keeps JSON as data and TypeScript as code.

2. **One class per card**: Each card is a TypeScript class with an `execute()`
   method containing its full logic. Rejected per ADR-001: violates data-driven
   design, makes content iteration require recompilation.

3. **Node-based visual scripting**: Effects defined as a graph of connected nodes
   (condition -> modifier -> action). Rejected for MVP: adds a graph parser and
   executor with no clear benefit over the flat effect list for the current
   content complexity. The conditional/repeat types provide sufficient composability.

4. **No conditional effects**: Only allow flat, unconditional effects. Any card
   that needs a condition gets a custom handler. Rejected because it forces
   frequently-needed patterns (scaling with hand size, bonus at low HP) into
   code that should be data. The condition system with its limited, non-nestable
   types is a controlled compromise.
