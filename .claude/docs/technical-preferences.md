# Technical Preferences

## Engine & Language

- **Engine**: Phaser 3.80+ (WebGL2 with Canvas fallback, AUTO mode)
- **Language**: TypeScript 5.x (strict mode enabled)
- **Rendering**: WebGL2 (Phaser AUTO — falls back to Canvas2D)
- **Physics**: None (card game — no physics simulation needed)

## Naming Conventions

- **Classes**: PascalCase — `CombatSystem`, `CardRewardScreen`
- **Variables**: camelCase — `currentHP`, `masterDeck`
- **Signals/Events**: camelCase with `on` prefix — `onCardPlayed`, `onTurnEnd`
- **Files**: kebab-case — `combat-system.ts`, `card-reward-screen.ts`
- **Scenes**: PascalCase — `CombatScene`, `MapScene`
- **Constants**: SCREAMING_SNAKE_CASE — `MAX_HAND_SIZE`, `BASE_RARE_CHANCE`
- **Interfaces**: PascalCase — `CardData`, `RunState`
- **Enums**: PascalCase enum, SCREAMING_SNAKE members — `NodeType.COMBAT`

## Performance Budgets

- **Target Framerate**: 60 FPS
- **Frame Budget**: 16.67ms
- **Draw Calls**: < 100 per frame (Phaser batches well)
- **Memory Ceiling**: 256MB total heap
- **Asset Budget**: < 50MB total loaded assets per scene
- **Card Rendering**: Max 10 cards in hand, each < 4 draw calls

## Testing

- **Framework**: Vitest (Vite-native, fast ESM support)
- **Minimum Coverage**: 80% for core systems
- **Required Tests**: Damage/block formulas, card play flow, status effect interactions, reward generation with seeded RNG, run state transitions, deck manager operations

## Forbidden Patterns

- No `any` types — use `unknown` and type guards
- No singleton game state — use dependency injection via scene plugin system
- No hardcoded gameplay values — all numbers from data config (JSON)
- No `eval()` or `Function()` constructor — data-driven effects use lookup tables
- No mutable global state — state lives in dedicated manager classes

## Allowed Libraries / Addons

- **Phaser 3.80+** — game engine (approved)
- **Vite 6+** — build tool (approved)
- **TypeScript 5.x** — language (approved)
- **Vitest** — testing framework (approved)

## Architecture Decisions Log

- [ADR-001: Core Architecture](../docs/architecture/adr-001-core-architecture.md) — Scene management, state management, data-driven design (Accepted 2026-04-02)
- [ADR-002: Combat Resolution Pipeline](../docs/architecture/adr-002-combat-resolution-pipeline.md) — Turn structure, damage resolution, death checking, block timing, multi-hit attacks (Accepted 2026-04-02)
- [ADR-003: Effect Resolution System](../docs/architecture/adr-003-effect-resolution-system.md) — Effect DSL, handler contracts, modifier application order, trigger system, conditional effects (Accepted 2026-04-02)
- [ADR-004: Event Bus / Pub-Sub Pattern](../docs/architecture/adr-004-event-bus-pub-sub.md) — Typed Phaser EventEmitter wrapper, event catalog, relic subscriptions, two-bus scope (Accepted 2026-04-02)
