# ADR-001: Core Architecture

**Status**: Accepted

**Date**: 2026-04-02

**Scope**: Scene Management, State Management, Data-Driven Design

**Supersedes**: None

---

## Context (Global)

This project is a Slay the Spire-inspired roguelike deckbuilder with 24 designed
systems across 5 dependency layers (Foundation, Core, Feature, Presentation, Meta).
The technology stack is Phaser 3.80+ with TypeScript 5.x strict mode, built via
Vite 6+, tested with Vitest, targeting desktop browsers.

Three foundational architectural patterns must be established before any system
implementation begins, because they shape how every one of those 24 systems will
be structured, how they communicate, and where their data lives:

1. How Phaser Scenes map to game screens and how transitions work
2. Where mutable game state lives and how systems read/write it
3. How gameplay content (cards, enemies, relics, etc.) is defined and loaded

These three decisions are bundled into a single ADR because they are mutually
reinforcing: scene transitions carry state, state queries read data-driven content,
and data loading happens at scene boundaries. Deciding any one in isolation risks
inconsistency with the others.

---

## Decision 1: Scene Management Strategy

### Context

The game has 13 distinct screens (Main Menu, Character Select, Map, Combat,
Reward, Shop, Rest Site, Event, Boss Treasure, Death, Victory, Settings, Pause).
Screen transitions follow a defined flow graph with typed animations (fade, slide,
dissolve). Phaser 3 provides a Scene system where each Scene has its own lifecycle
(`init`, `preload`, `create`, `update`) and can be started, stopped, paused, and
resumed independently.

The question is: how do we map our 13 screens to Phaser Scenes, and how do screens
share data during transitions (e.g., Combat needs enemy data from Map, Reward needs
combat results from Combat)?

### Decision

**Each game screen maps to exactly one Phaser Scene.**

```
Game Scenes:
  MainMenuScene, CharacterSelectScene, MapScene, CombatScene,
  RewardScene, ShopScene, RestSiteScene, EventScene,
  BossTreasureScene, DeathScene, VictoryScene

Utility Scenes (always running, never visible):
  SceneFlowController (manages transitions)
  StateManagerPlugin (global state, see Decision 2)
  GameRegistryPlugin (global data, see Decision 3)

Overlay Scenes (parallel, rendered on top):
  PauseScene, SettingsScene
```

**Screen Flow Controller** is a dedicated utility scene that orchestrates all
transitions. No game scene starts or stops another scene directly -- they request
transitions through the controller. This prevents race conditions from concurrent
transition calls and centralizes transition animation logic.

**Data passing between scenes** uses two mechanisms:

1. **Phaser's scene data API** (`this.scene.start('CombatScene', initData)`) for
   per-transition payloads (e.g., which enemies to spawn, what rewards to display).
   This is lightweight, typed, and scoped to a single transition.

2. **Shared registry plugin** (`GameRegistryPlugin`) for read-only content data
   that all scenes need (card definitions, enemy templates, relic data). Loaded
   once at startup, never changes during a run. All scenes access it via
   `this.plugins.get('GameRegistryPlugin')`.

3. **Shared state plugin** (`StateManagerPlugin`) for mutable run state (HP, gold,
   deck, relics -- see Decision 2). All scenes read from it, only specific systems
   write to it.

**Transition flow:**

```
1. Current scene calls SceneFlowController.requestTransition(targetScreen, payload)
2. Controller validates the transition is legal (from/to pair exists in flow graph)
3. Controller plays transition animation on current scene
4. Controller preloads target scene assets if not already cached
5. Controller starts target scene with payload via Phaser scene data API
6. Controller stops current scene (or pauses for overlay scenes)
```

### Consequences

**Positive:**

- **Clear ownership**: Each screen's lifecycle, assets, and cleanup are
  self-contained. A bug in ShopScene cannot leak into CombatScene.
- **Memory efficiency**: Phaser unloads a Scene's display list and textures when
  the scene stops. Only the active screen's visual assets occupy GPU memory.
  This respects the 256MB heap ceiling and <50MB per-scene asset budget.
- **Phaser-native**: No custom screen management framework to maintain. Phaser's
  Scene system handles lifecycle, rendering, and input per-scene out of the box.
- **Testability**: Each scene can be tested in isolation by starting it with mock
  data payloads. No need to bootstrap the entire game to test one screen.
- **Transition queuing**: Centralized control prevents the "rapid clicks cause
  duplicate transitions" edge case defined in the Screen Flow GDD.

**Negative:**

- **Indirection**: Scenes cannot start each other directly. All transitions go
  through the controller. This adds one layer of indirection but prevents
  transition race conditions.
- **Scene data payloads must be serializable**: Phaser's `scene.start(data)` copies
  the data object. Complex objects with methods or circular references will break.
  All payloads must be plain data (interfaces, not classes).
- **Overlay scenes require careful rendering order**: Pause and Settings render
  on top of the game scene. Phaser handles this natively with parallel scenes,
  but the game scene must not receive input while the overlay is active.

**Performance Implications:**

- Scene transitions add 0.3-0.5s (animation duration from Screen Flow GDD). Asset
  preloading may add time for the first visit to each scene type. Subsequent
  visits use Phaser's texture cache.
- The SceneFlowController itself is a zero-update scene (no `update` loop). It
  consumes no frame time outside of transitions.
- Estimated memory per inactive scene: near zero (display list is destroyed on
  stop; only the scene's JS object remains).

**Alternatives Considered:**

1. **Single Scene with UI layers**: One scene manages all screens as container
   groups, showing/hiding as needed. Rejected because it keeps all screen assets
   in memory simultaneously and makes per-screen asset management impossible.

2. **Custom screen framework outside Phaser**: Build a screen stack independent
   of Phaser's Scene system. Rejected because it duplicates Phaser's lifecycle
   management, adds maintenance burden, and fights the engine's design.

3. **Multiple scenes per screen** (e.g., CombatScene + CombatHUDScene): Split
   complex screens into sub-scenes. Rejected for MVP complexity. Can be
   reconsidered if CombatScene exceeds the 16.67ms frame budget.

---

## Decision 2: State Management Pattern

### Context

The game has extensive mutable state: player HP, gold, master deck, relic list,
potion slots, map progress, act/floor tracking, combat state, and run metadata.
This state is read by nearly every system (16 of 24 systems depend on Run State
directly or indirectly) and written to by multiple systems during a run.

Without a clear state management pattern, the risk is:
- State scattered across scenes and objects (no single source of truth)
- Race conditions where two systems modify the same value
- UI components polling or missing updates when state changes
- Difficulty implementing Save/Load (where is all the state?)

### Decision

**Centralized game state via a Phaser Plugin (`StateManagerPlugin`).**

The StateManagerPlugin is installed once at game startup and persists across all
scene transitions. It owns the single canonical `RunState` object.

**Architecture:**

```
StateManagerPlugin (Phaser.Plugin, singleton per game instance)
  |
  +-- RunState (single source of truth)
  |     currentHP, maxHP, gold, masterDeck, relics,
  |     potions, currentAct, currentFloor, mapData, status, ...
  |
  +-- Query API (read-only, any system can call)
  |     getState(): ReadOnlyRunState
  |     getHP(): number
  |     getGold(): number
  |     getDeck(): ReadOnlyCardInstance[]
  |     getRelics(): string[]
  |     ...
  |
  +-- Mutation API (write, specific systems call)
  |     modifyHP(delta: number, source: string): void
  |     modifyGold(delta: number, source: string): void
  |     addCard(card: CardInstance): void
  |     removeCard(instanceId: string): void
  |     addRelic(relicId: string): void
  |     updateMapProgress(nodeId: string): void
  |     setRunStatus(status: RunStatus): void
  |     ...
  |
  +-- Event Emitter (state changes broadcast to subscribers)
  |     on('hp-changed', callback)
  |     on('gold-changed', callback)
  |     on('deck-changed', callback)
  |     on('relic-added', callback)
  |     on('run-status-changed', callback)
  |     on('state-snapshot', callback)  -- full state for save/load
  |     ...
```

**Key rules:**

1. **Read-only queries**: Systems that need state call query methods. The returned
   objects are frozen copies or read-only views, not references to internal state.
   This prevents accidental mutation outside the mutation API.

2. **Named mutations**: Every state change goes through a named mutation method.
   Each mutation validates the change (e.g., HP cannot go below 0, gold cannot go
   negative), applies the change, and emits an event. The `source` parameter tracks
   which system triggered the change for debugging.

3. **Event-driven UI updates**: UI components subscribe to specific events
   (`'hp-changed'`, `'deck-changed'`). They do not poll. This follows the observer
   pattern and ensures UI stays in sync without coupling to mutation logic.

4. **No direct property access**: Internal `RunState` properties are private.
   There is no `state.runState.currentHP = 50`. All access goes through the API.
   TypeScript strict mode enforces this at compile time.

5. **Snapshot for Save/Load**: The `getState()` method returns a serializable
   plain object. The Save/Load system (Post-MVP) calls this to persist state and
   calls a `loadState(snapshot)` method to restore it.

**Combat state separation:**

During combat, a separate `CombatState` object tracks combat-specific mutable
state (current hand, draw pile, discard pile, exhaust pile, current energy,
enemy instances, turn number, status effects). This state is created when combat
starts and destroyed when combat ends. It follows the same pattern (query API,
mutation API, events) but is scoped to the CombatScene rather than the global
plugin. When combat ends, relevant results (cards gained, gold earned, relics
obtained) are committed to the global `RunState` via the StateManagerPlugin.

### Consequences

**Positive:**

- **Single source of truth**: Every system reads from the same state. No stale
  data, no conflicting copies. The `RunState` interface in the GDD maps directly
  to the plugin's internal state.
- **Debuggability**: Every mutation has a `source` tag. Logging all mutations
  during development provides a full audit trail of state changes.
- **Save/Load is trivial**: Serialize the RunState snapshot. Restore it. Done.
  The Post-MVP Save/Load system has a clear, narrow interface from day one.
- **UI synchronization**: Event-driven updates mean UI components automatically
  reflect state changes. No manual refresh logic, no missed updates.
- **Testability**: Systems under test receive a StateManagerPlugin mock. Tests
  verify that the correct mutations are called, without needing the full Phaser
  runtime.
- **Pillar alignment**: Informed Strategy requires that all state is queryable.
  The read-only API ensures any system (including UI tooltips, deck viewer, map
  overlay) can access any state it needs.

**Negative:**

- **Boilerplate**: Each state field needs a query method, a mutation method, and
  an event type. For ~20 fields, this is manageable but requires discipline.
- **Indirection**: Systems cannot directly set `hp = 50`. They call
  `stateManager.modifyHP(50, 'combat')`. This is intentional (enables validation
  and events) but adds a layer between the system and the data.
- **Combat state lifecycle**: Combat state must be carefully initialized and
  cleaned up. If CombatScene is stopped without cleanup, orphaned combat state
  could leak. Mitigation: CombatScene's `shutdown` lifecycle method destroys
  combat state unconditionally.
- **Event flooding**: During complex combat sequences (AOE hitting 3 enemies,
  triggering 5 relics, applying 4 status effects), the event emitter fires many
  events in rapid succession. UI components must batch renders rather than
  re-rendering on every individual event.

**Performance Implications:**

- Query methods return frozen copies for small objects (HP, gold) and read-only
  views for collections (deck, relics). Frozen copy overhead is negligible for
  primitives. Read-only views (JavaScript Proxy or custom wrapper) add ~0.01ms
  per access, well within budget.
- Event emission is synchronous in Phaser. During heavy combat sequences, event
  handlers execute inline. Handlers must be fast (<0.1ms each) to avoid frame
  budget overruns.
- The StateManagerPlugin has no `update` loop. It is purely reactive (called by
  systems, emits events). Zero frame-time cost when idle.

**Alternatives Considered:**

1. **Scattered state (each system owns its data)**: Let Combat manage combat
   state, Deck manage deck state, etc. Rejected because there is no single
   place to read complete game state, making Save/Load extremely difficult and
   creating synchronization bugs between systems.

2. **Redux-style store with actions/reducers**: Full unidirectional data flow
   with action dispatch, reducer functions, and middleware. Rejected as
   over-engineered for a single-player game with no time-travel debugging need.
   The named mutation API provides similar discipline with less boilerplate.

3. **Reactive framework (RxJS, MobX)**: Observable state streams. Rejected
   because it adds a significant library dependency and learning curve for a
   problem that Phaser's built-in EventEmitter already solves adequately.

4. **ECS (Entity Component System)**: Model game entities as compositions of
   components. Rejected because this is a card game, not a simulation-heavy
   game. There are no thousands of entities. The entity count is small and
   well-defined (player, enemies, cards in hand). ECS adds complexity without
   proportional benefit.

---

## Decision 3: Data-Driven Design

### Context

The game has 7 entity types (cards, enemies, relics, potions, events, characters,
ascension modifiers) that define all gameplay content. The Data/Config GDD specifies
that content lives in JSON files and is accessed through a typed registry.

The question is: how strictly do we enforce data-driven design, and what is the
mechanism for connecting data definitions to runtime behavior? Specifically, card
effects like "Deal 6 damage" or "Apply 2 Vulnerable" need to become executable
logic -- how does data become behavior without `eval()` or code generation?

### Decision

**All gameplay values live in JSON config files. Effect behavior uses lookup tables.**

**Data loading:**

```
assets/data/
  cards.json          -- CardData[] (all card definitions)
  enemies.json        -- EnemyData[] (all enemy templates)
  relics.json         -- RelicData[] (all relic definitions)
  potions.json        -- PotionData[] (all potion definitions)
  events.json         -- EventData[] (all event definitions)
  characters.json     -- CharacterData[] (all character definitions)
  ascension.json      -- AscensionData[] (difficulty modifiers)
  status-effects.json -- StatusEffectData[] (buff/debuff definitions)
  reward.json         -- RewardConfig (rarity odds, drop rates)
  map-config.json     -- MapConfig (node weights, floor rules)
  shop-config.json    -- ShopConfig (pricing, stock rules)
  ui-config.json      -- UIConfig (transition timings, layout constants)
```

All JSON files are loaded during a Boot/Preload scene using Phaser's
`this.load.json()` API, before any gameplay scene starts. The `GameRegistryPlugin`
(a Phaser Plugin, analogous to the StateManagerPlugin) receives all loaded data,
validates it, and exposes typed query methods.

**Effect resolution via lookup table:**

Card effects, relic triggers, and potion effects are defined in JSON with a
`effects` array using a structured effect DSL:

```json
{
  "id": "card_strike",
  "name": "Strike",
  "cost": 1,
  "type": "attack",
  "rarity": "starter",
  "target": "single_enemy",
  "effects": [
    { "type": "deal_damage", "value": 6, "upgraded_value": 9 }
  ]
}
```

```json
{
  "id": "card_bash",
  "name": "Bash",
  "cost": 2,
  "type": "attack",
  "rarity": "starter",
  "target": "single_enemy",
  "effects": [
    { "type": "deal_damage", "value": 8, "upgraded_value": 10 },
    { "type": "apply_status", "status": "vulnerable", "value": 2, "upgraded_value": 3 }
  ]
}
```

At runtime, an `EffectResolver` maps effect `type` strings to handler functions:

```
EffectResolver (TypeScript class, not JSON)
  effectHandlers: Map<string, EffectHandler>

  // Registered handlers:
  "deal_damage"      -> (source, target, value) => DamageSystem.apply(source, target, value)
  "apply_status"     -> (source, target, status, value) => StatusEffectSystem.apply(target, status, value)
  "gain_block"       -> (source, target, value) => BlockSystem.apply(target, value)
  "draw_cards"       -> (source, target, value) => DeckManager.draw(value)
  "gain_energy"      -> (source, target, value) => EnergySystem.gain(value)
  "exhaust_card"     -> (source, target, value) => DeckManager.exhaust(value)
  "heal"             -> (source, target, value) => StateManager.modifyHP(value, 'card_effect')
  ... (extensible)
```

This is a **lookup table pattern**, not `eval()` and not code generation:

- **JSON defines WHAT** (effect type, magnitude, target type, upgrade values)
- **TypeScript defines HOW** (effect handler functions with game logic)
- **EffectResolver connects them** (maps type strings to handler functions at
  registration time)

**Adding new content** means:
1. Add a JSON entry to the appropriate data file (new card, enemy, relic, etc.)
2. If the card uses only existing effect types: zero code changes needed.
3. If the card needs a new effect type: add one handler function to EffectResolver
   and register it. This is a TypeScript code change, not a data change.

**Relic triggers** use the same pattern with a `trigger` field:

```json
{
  "id": "relic_burning_blood",
  "name": "Burning Blood",
  "trigger": "on_combat_end",
  "effects": [
    { "type": "heal", "value": 6 }
  ]
}
```

The relic system subscribes to the `on_combat_end` event and invokes the
EffectResolver for all relics with that trigger.

### Consequences

**Positive:**

- **Tunable without recompilation**: Changing card damage from 6 to 7 is a JSON
  edit. Designers can iterate without touching TypeScript. This directly serves
  the Adaptive Builds pillar -- content balance can be adjusted rapidly.
- **Extensible**: Adding a new card or enemy is a data addition, not a code
  change (assuming existing effect types cover it). The content surface area
  grows without code complexity growing proportionally.
- **Type-safe data access**: TypeScript interfaces (`CardData`, `EnemyData`, etc.)
  ensure compile-time type checking for all data queries. A typo in a card ID
  is caught at build time, not runtime.
- **Validatable**: JSON data can be validated at load time (required fields, value
  ranges, reference integrity). The Data/Config GDD specifies comprehensive
  validation rules. Invalid data produces warnings during development and errors
  in production.
- **No `eval()` or code generation**: The EffectResolver lookup table is safe,
  debuggable, and compatible with browser CSP (Content Security Policy). This
  satisfies the project's forbidden patterns.
- **Hot reload in development**: JSON files can be re-read at runtime without
  restarting the game, enabling rapid content iteration.

**Negative:**

- **Effect DSL expressiveness limit**: Complex conditional effects ("if you have
  3 or more attacks in hand, deal double damage") require either compound effect
  definitions in JSON or dedicated handler functions. The DSL must be extended
  carefully to avoid becoming a programming language in disguise.
- **Registration discipline**: Every new effect type requires a corresponding
  handler registration in TypeScript. If a developer adds an effect type to JSON
  but forgets the handler, the effect silently fails (returns no-op). Mitigated
  by validation that checks all effect types referenced in JSON have registered
  handlers.
- **JSON verbosity**: 150+ card definitions as JSON is a large file. Code
  editors handle this well, but diffs can be noisy. Mitigated by keeping each
  JSON file under the 500KB budget from the Data/Config GDD.
- **No visual editor**: Content creators edit raw JSON. A visual card editor
  would improve workflow but is Post-MVP scope.

**Performance Implications:**

- JSON parsing is done once at startup. Phaser's `this.load.json()` parses
  asynchronously. With all data files totaling <5MB (per Data/Config GDD budget),
  parsing completes in well under 2 seconds.
- EffectResolver lookups are O(1) via Map.get(). Effect handlers are function
  calls with no reflection or dynamic dispatch overhead.
- No runtime parsing, no `eval()`, no code generation. Effect resolution is
  a plain function call chain: lookup type -> call handler -> return result.

**Alternatives Considered:**

1. **Scriptable effects (eval / Function constructor)**: Store card logic as
   JavaScript strings in JSON, evaluate at runtime. Rejected per project's
   forbidden patterns ("No `eval()` or `Function()` constructor"). Also a CSP
   violation in browser environments and a security risk.

2. **Hardcoded effects in TypeScript classes**: Each card is a class with an
   `execute()` method. Rejected because adding content requires code changes,
   violating the data-driven principle. Tuning requires recompilation. Also
   violates the "no hardcoded gameplay values" forbidden pattern.

3. **Visual scripting / node-based effects**: A node graph in JSON where effects
   are composed of connected nodes (condition -> modifier -> action). Rejected
   for MVP because it adds significant parsing complexity and the game's effects
   are simple enough that the flat lookup table pattern suffices. Can be
   reconsidered if effect complexity grows beyond what the flat DSL can express.

4. **Embedded scripting language (Lua, Wren)**: Use a lightweight scripting
   language for content definition. Rejected because it adds a language runtime
   dependency, complicates the build pipeline, and the TypeScript lookup table
   pattern already solves the data-to-behavior problem with zero additional
   tooling.

---

## Cross-Cutting Concerns

### Plugin Initialization Order

```
1. BootScene starts
2. Load all JSON data files via Phaser loader
3. Install GameRegistryPlugin (receives loaded data, validates, ready for queries)
4. Install StateManagerPlugin (empty RunState, ready for new run initialization)
5. Transition to MainMenuScene
```

All three plugins (GameRegistry, StateManager, SceneFlowController) are
initialized before any gameplay scene starts. Gameplay scenes never encounter
an uninitialized registry or state manager.

### Testing Implications

- **Unit tests** (Vitest): Mock the StateManagerPlugin and GameRegistryPlugin
  as plain objects implementing the same interfaces. No Phaser runtime needed.
- **Integration tests**: Start specific Phaser scenes with real plugins and
  verify state mutations and scene transitions.
- **Data validation tests**: Load each JSON file, validate against its TypeScript
  interface, check all referenced IDs exist. Run as part of CI.

### Performance Budget Summary

| Concern | Budget | Strategy |
|---------|--------|----------|
| Scene transition | 0.3-0.5s (animation) | Preload assets on first visit, cache for subsequent |
| State query | <0.1ms per call | Frozen primitives, read-only Proxy views |
| Event emission | <0.1ms per handler | Synchronous, batch UI renders |
| Data loading (startup) | <2s total | Async JSON parse, single load pass |
| Effect resolution | <0.05ms per effect | O(1) Map lookup + function call |
| Frame budget (gameplay) | 16.67ms | No system in this ADR has a per-frame update loop |

### Downstream ADRs Needed

This ADR establishes the foundation. The following ADRs will be needed as
implementation progresses:

- **ADR-002**: Combat Resolution Pipeline (damage/block calculation order, effect
  application sequence, timing of status effect ticks)
- **ADR-003**: Event Bus Architecture (event naming conventions, event payload
  types, event ordering guarantees, error handling in handlers)
- **ADR-004**: Effect DSL Specification (complete catalog of effect types,
  compound effects, conditional effects, target resolution rules)
- **ADR-005**: Save/Load Serialization Format (snapshot structure, versioning,
  migration strategy -- Post-MVP)
