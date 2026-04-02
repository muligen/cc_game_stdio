# ADR-004: Event Bus / Pub-Sub Pattern

**Status**: Accepted

**Date**: 2026-04-02

**Scope**: Inter-system communication, event types, type safety, relic triggers

**Supersedes**: None

**Depends on**: ADR-001 (StateManagerPlugin event emitter), ADR-002 (Combat Pipeline events), ADR-003 (Trigger system)

---

## Context

This game has 24 designed systems that must communicate. The combat system needs to
tell the relic system when damage is dealt. The deck manager needs to tell the UI
when a card is drawn. The status effect system needs to know when a turn ends.

ADR-001 Decision 2 established that the StateManagerPlugin uses Phaser's built-in
EventEmitter for state change notifications (`hp-changed`, `deck-changed`). ADR-002
references combat events (`onCardPlayed`, `onDamageDealt`, `onEntityDeath`). ADR-003
defines a TriggerType enum that maps directly to combat events.

This ADR unifies all of these into a single, coherent event architecture:

- Whether to use Phaser's EventEmitter or a custom implementation
- How events are named, typed, and validated
- The complete catalog of events for combat and meta systems
- How relics subscribe to combat events (the bridge between EventBus and TriggerManager)
- Error handling and event ordering guarantees

---

## Decision

### Decision 1: Custom Map-Based Event Bus with Typed Interface

Phaser 3 provides `Phaser.Events.EventEmitter` -- a synchronous, priority-aware
event system. It is already used internally by Phaser for scene lifecycle, input,
and tween events. ADR-001's StateManagerPlugin already uses it.

**We use a custom Map-based event bus implementation, wrapped in the typed
`IEventBus` interface.**

The implementation uses an internal `Map<string, ListenerEntry[]>` for listener
management instead of wrapping `Phaser.Events.EventEmitter` directly. This was
an intentional deviation from the original design sketch, driven by testability
requirements.

**Why a custom implementation instead of wrapping Phaser's EventEmitter:**

1. **Testability without Phaser runtime**: The custom event bus can be instantiated
   and fully tested in Vitest without loading the Phaser engine. Wrapping
   `Phaser.Events.EventEmitter` would require Phaser as a test dependency or
   complex mocking of the emitter constructor.
2. **Priority support**: Phaser's TypeScript types do not expose the priority
   parameter on `on()`. The custom implementation provides priority-based listener
   ordering (lower number = earlier execution) with stable insertion sort, matching
   the ADR-002 priority-based effect resolution requirements.
3. **Full control over dispatch semantics**: The custom implementation provides
   explicit snapshot-based dispatch, once-listener deferred removal, and error
   isolation between handlers -- all with clear, auditable code rather than relying
   on Phaser's internal behavior.
4. **Consistent `IEventBus` public API**: The typed wrapper interface (`IEventBus`)
   remains the public contract. Consumers depend on the interface, not the concrete
   `GameEventBus` class. This allows swapping the implementation if needed.

**Phaser bridge adapter**: When Phaser scene/tween/timer events need to flow into
the typed event bus, an adapter layer will bridge `Phaser.Events.EventEmitter`
events to the `IEventBus.emit()` calls. This keeps the game's event architecture
decoupled from Phaser's internal event system while still integrating seamlessly.

The typed wrapper adds compile-time safety (misspelled event names are caught by
TypeScript) without changing runtime behavior.

#### Implementation Note

The `GameEventBus` class in `src/systems/game-event-bus.ts` is the approved
implementation. Key properties:

- Listener registry: `Map<string, ListenerEntry[]>` with sorted insertion by priority
- Nesting depth tracking: counter with hard cap of 50 (prevents infinite event loops)
- Error isolation: try/catch per handler; dev mode re-throws, production swallows
- Destroy lifecycle: `destroy()` clears all listeners and prevents further use

This implementation was chosen during Sprint 1 when it became clear that 517+
unit tests needed to run without Phaser loaded. The original ADR-004 sketch showed
a thin Phaser wrapper, but the testability benefit of the custom implementation
outweighed the consistency benefit of reusing Phaser's emitter directly.

### Decision 2: Event Naming Convention

```
on[Subject][Action]     -- for combat and gameplay events
state:[field]-changed   -- for state mutation notifications (ADR-001 pattern)
ui:[screen]-[action]    -- for UI lifecycle events
```

**Examples:**

```
Combat events:     onCardPlayed, onDamageDealt, onTurnEnd, onCombatStart
State events:      state:hp-changed, state:gold-changed, state:deck-changed
UI events:         ui:combat-ready, ui:reward-closed, ui:transition-complete
```

**Rules:**

1. **camelCase** for all event names (consistent with project naming conventions).
2. **`on` prefix** for combat/gameplay events -- these represent things that
   happened in the game world.
3. **`state:` prefix** for state mutation notifications -- these represent data
   changes. Kept consistent with ADR-001.
4. **`ui:` prefix** for UI lifecycle events -- these represent visual state changes.
5. **Past tense** for actions that have completed: `onCardPlayed` (not `onCardPlay`).
6. **Present/gerund** for actions about to happen: `onDamageAboutToBeDealt` (used
   for pre-modification hooks).

### Decision 3: Event Payload Type Map

All event payloads are defined in a single typed map. This is the compile-time
contract that prevents type errors:

```typescript
interface EventPayloadMap {
  // --- Combat Lifecycle ---
  onCombatStart:          { combatState: CombatState; enemies: EnemyInstance[] };
  onCombatEnd:            { result: 'victory' | 'defeat'; combatState: CombatState };
  onPlayerTurnStart:      { turnNumber: number };
  onPlayerTurnEnd:        { turnNumber: number };
  onEnemyTurnEnd:         { turnNumber: number; remainingEnemies: number };

  // --- Card Play ---
  onCardPlayed:           { card: CardInstance; target: Entity | null; source: 'player' | 'enemy' };
  onCardResolved:         { card: CardInstance; target: Entity | null; results: EffectResult[] };
  onAttackPlayed:         { card: CardInstance; target: Entity };
  onSkillPlayed:          { card: CardInstance; target: Entity | null };
  onPowerPlayed:          { card: CardInstance; target: Entity | null };

  // --- Damage ---
  onDamageAboutToBeDealt: { source: Entity; target: Entity; damage: number };
  onDamageDealt:          { source: Entity; target: Entity; damage: number; blocked: number };
  onDamageTaken:          { target: Entity; source: Entity; damage: number; blocked: number };
  onBlockBroken:          { target: Entity; amount: number };

  // --- Death ---
  onEntityDeath:          { entity: Entity; cause: 'damage' | 'status_effect' };
  onEnemyDeath:           { enemy: EnemyInstance; killer: Entity };

  // --- Status Effects ---
  onStatusApplied:        { target: Entity; status: string; stacks: number };
  onStatusRemoved:        { target: Entity; status: string };
  onStatusTriggered:      { target: Entity; status: string; damage?: number };

  // --- Block ---
  onBlockGained:          { target: Entity; amount: number; total: number };

  // --- Deck Manipulation ---
  onCardDrawn:            { card: CardInstance; from: 'draw_pile' | 'other' };
  onCardExhausted:        { card: CardInstance };
  onCardDiscarded:        { card: CardInstance };
  onCardAddedToHand:      { card: CardInstance };
  onDeckShuffled:         { pile: 'draw_pile' | 'discard_pile' };

  // --- Energy ---
  onEnergySpent:          { amount: number; remaining: number };
  onEnergyGained:         { amount: number; source: string };

  // --- Healing ---
  onHeal:                 { target: Entity; amount: number };

  // --- Power Application ---
  onPowerApplied:         { target: Entity; power: string; stacks: number };

  // --- State Mutations (from StateManagerPlugin, per ADR-001) ---
  'state:hp-changed':     { oldValue: number; newValue: number; delta: number; source: string };
  'state:gold-changed':   { oldValue: number; newValue: number; delta: number; source: string };
  'state:deck-changed':   { action: 'add' | 'remove'; cardId: string };
  'state:relic-added':    { relicId: string };
  'state:run-status-changed': { oldStatus: RunStatus; newStatus: RunStatus };

  // --- UI Lifecycle ---
  'ui:combat-ready':      { turnNumber: number };
  'ui:reward-closed':     { choice: RewardChoice };
  'ui:transition-complete': { from: string; to: string };
}
```

### Decision 4: Event Ordering Guarantees

1. **Synchronous, in-order execution**: When `emit('onDamageDealt', payload)` is
   called, all listeners execute in registration order (within the same priority
   level) before the `emit()` call returns. There is no async dispatch.

2. **Priority levels** (aligned with ADR-002):
   ```
   Priority 0: Override/Prevention  (block application, damage negation)
   Priority 1: Modification         (relics that change damage amount)
   Priority 2: Reaction             (relics that respond to damage)
   Priority 3: Notification         (UI updates, combat log)
   Priority 4: Cleanup              (remove temp buffs, trigger chains)
   ```
   Listeners at priority 0 execute before priority 1, etc.

3. **Nested emissions**: A handler may emit new events during its execution.
   These nested events resolve fully (depth-first) before the parent event's
   next handler executes. This matches the Damage Pipeline in ADR-002 where
   `resolveDamage` fires `onDamageDealt`, whose handlers may trigger further
   damage via relics.

4. **Recursion limit**: A hard cap of 50 nested emissions per original event.
   If exceeded, log an error and stop processing the current chain. This prevents
   infinite loops from mutual trigger dependencies (Relic A triggers Relic B
   triggers Relic A).

### Decision 5: Relic Subscription via TriggerManager

Relics do not subscribe to the EventBus directly. Instead, the **TriggerManager**
acts as a bridge:

```
EventBus                      TriggerManager                    Relics
  |                               |                               |
  | onDamageDealt                 |                               |
  +------------------------------>|                               |
  |                               | Check relic triggers for      |
  |                               | "on_damage_dealt" event       |
  |                               |                               |
  |                               | relic_burning_blood?          |
  |                               |   condition: none             |
  |                               |   -> EffectResolver.resolve() |
  |                               |                               |
  |                               | relic_pen_nib?                |
  |                               |   condition: attack played    |
  |                               |   -> evaluate condition       |
  |                               |   -> skip (not attack)        |
  |                               |                               |
  |                               +------------------------------>|
  |                               |  (effects resolved, state     |
  |                               |   updated)                    |
```

**Subscription lifecycle:**

```
1. Combat starts:
   - TriggerManager reads player's relic list from RunState
   - For each relic with triggers:
     - Load relic data from GameRegistryPlugin
     - Subscribe relic's trigger to EventBus via TriggerManager
   - TriggerManager subscribes to all TriggerType events on EventBus

2. During combat:
   - EventBus fires combat events
   - TriggerManager receives events, evaluates conditions, resolves effects
   - TriggerManager fires any new events triggered by effect resolution

3. Combat ends:
   - TriggerManager.unsubscribeAll()
   - All relic subscriptions cleaned up
   - Combat EventBus destroyed (combat-scoped) or cleared (global-scoped)
```

This layered approach means:
- **Relics never touch EventBus directly** -- all access goes through TriggerManager
- **TriggerManager owns the condition evaluation** -- keeps relic logic centralized
- **EventBus remains a general-purpose system** -- not coupled to relic specifics

### Decision 6: Event Bus Scope

Two event bus instances serve different lifetimes:

```
GameEventBus (global, persists across entire run)
  -- Installed in StateManagerPlugin
  -- Carries state mutation events (state:hp-changed, etc.)
  -- Carries meta events (state:run-status-changed)
  -- Survives scene transitions
  -- Destroyed only when the game instance is destroyed

CombatEventBus (combat-scoped, created/destroyed per combat)
  -- Created in CombatScene.init()
  -- Carries all combat events (onDamageDealt, onCardPlayed, etc.)
  -- Destroyed in CombatScene.shutdown()
  -- TriggerManager subscribes to this bus, not the global bus
```

**Why two buses:**

1. **Memory safety**: Combat events are voluminous (hundreds per combat). Destroying
   the combat bus after each fight releases all listener references, preventing
   memory leaks from relic subscriptions that outlive combat.

2. **Scope clarity**: A UI component in ShopScene has no business listening to
   `onCardPlayed`. The combat bus only exists during combat. Compile-time types
   can enforce which bus a system subscribes to.

3. **Test isolation**: Combat system unit tests create a fresh CombatEventBus per
   test. No cross-test state contamination from leftover listeners.

### Error Handling in Handlers

```typescript
// Wrapped handler execution in GameEventBus
private safeEmit(event: string, payload: unknown): void {
  const listeners = this.emitter.listenerCount(event);
  try {
    this.emitter.emit(event, payload);
  } catch (error) {
    console.error(
      `[EventBus] Error in handler for event "${event}":`,
      error
    );
    // Do NOT re-throw. One broken handler must not crash the game.
    // The error is logged for debugging. The game continues.
  }
}
```

**Rules:**

1. **Handlers must not throw exceptions** for normal game logic. A handler should
   return gracefully even if the game state is unexpected (e.g., target is dead).
2. **If a handler throws unexpectedly**, the EventBus catches it, logs it, and
   continues to the next handler. One broken relic must not prevent other relics
   from functioning.
3. **In development mode**, handler errors are thrown (not caught) so they surface
   immediately during testing. In production, they are caught and logged.

---

## Consequences

### Positive

- **Loose coupling**: The combat system does not know about relics. It fires
  `onDamageDealt` and moves on. The TriggerManager bridges to relics. Systems
  communicate through events without importing each other.
- **Type safety**: The `EventPayloadMap` ensures that `emit('onDamageDealt', payload)`
  requires a payload matching the `DamageDealtPayload` shape. TypeScript catches
  mismatched payloads at compile time, not runtime.
- **Consistent with ADR-001**: The StateManagerPlugin's event emitter pattern is
  the same system, just with a different scope (global vs combat-scoped). No new
  paradigm for developers to learn.
- **Deterministic**: Synchronous, in-order execution means the same game actions
  always produce the same event sequence. Essential for seeded RNG runs and
  reproducible bug reports.
- **Testable**: Unit tests create a fresh `GameEventBus`, subscribe a spy, emit
  an event, and assert the spy received the correct payload. No mocks needed for
  the bus itself -- it is the real implementation.
- **Scalable**: Adding a new event is: add it to `EventPayloadMap`, add the emit
   call in the relevant system, add the payload type. Existing events and handlers
   are unaffected.

### Negative

- **Debugging complexity**: When a relic doesn't trigger, the call chain is:
  EventBus.emit -> TriggerManager.onEvent -> evaluateCondition -> EffectResolver.
  Four layers of indirection between "card played" and "relic effect resolved".
  Mitigation: development-mode event logging that traces the full chain.
- **Event proliferation**: The payload map has 30+ events. As systems are added,
  the event catalog grows. Without curation, developers may create redundant
  events (`onAttackPlayed` vs `onCardPlayed` with cardType check). Mitigation:
  the event catalog is centralized in one file, reviewed during ADR updates.
- **Synchronous blocking**: A slow event handler blocks the game. If a relic's
  condition evaluation or effect resolution takes >1ms, it impacts frame budget.
  Mitigation: all handlers must be pure arithmetic with no I/O, no DOM access,
  no async operations.
- **Two-bus complexity**: Developers must understand which bus to use. A relic
  subscribing to the global bus during combat will miss combat events. Mitigation:
  the TriggerManager abstracts this -- relic code never touches either bus directly.

### Performance Implications

| Metric | Budget | Actual (estimated) |
|--------|--------|--------------------|
| Event emission (no listeners) | <0.01ms | Phaser EventEmitter: ~0.005ms |
| Event emission (10 listeners) | <0.1ms | 10 * 0.01ms per handler = 0.1ms |
| TriggerManager per event (5 relics) | <0.1ms | 5 condition checks * 0.02ms = 0.1ms |
| Full combat turn (20 events) | <2ms | 20 * 0.1ms avg = 2ms |
| EventBus.destroy() | <1ms | Phaser cleanup: <0.5ms |

Total event overhead per combat turn is estimated at 1-2ms, well within the
16.67ms frame budget. The bottleneck is rendering and animation, not event logic.

### Alternatives Considered

1. **Phaser EventEmitter wrapper (original sketch)**: Wrap `Phaser.Events.EventEmitter`
   with a typed layer. This was the original ADR-004 design. Rejected during
   implementation because it requires the Phaser runtime for unit tests. The custom
   Map-based implementation provides identical semantics (synchronous dispatch,
   priority ordering, listener lifecycle) while being fully testable without Phaser.
   An adapter layer bridges Phaser events to the typed bus when Phaser integration
   is needed.

2. **RxJS / Observable streams**: Use reactive programming for event streams.
   Rejected per ADR-001: adds a significant library dependency and learning curve.
   The event patterns in this game are simple fire-and-forget notifications, not
   complex stream transformations. RxJS's power is not needed.

3. **Direct function calls (no events)**: Systems call each other directly
   (e.g., `combatSystem.onDamageDealt()` calls `relicSystem.checkTriggers()`).
   Rejected because it creates tight coupling: CombatSystem must import
   RelicSystem, StatusEffectSystem, UISystem, CombatLogSystem, etc. Adding a
   new system requires modifying every system that should notify it. This is the
   exact problem the event bus solves.

4. **Global event bus (no combat scoping)**: A single bus for all events, with
   combat events simply not firing outside of combat. Rejected because it means
   relic subscriptions from a previous combat could persist into the next combat
   if cleanup fails. The two-bus approach makes the lifecycle explicit: combat
   bus is destroyed, all listeners die, no stale references.
