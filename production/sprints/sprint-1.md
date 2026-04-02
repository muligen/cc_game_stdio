# Sprint 1 -- 2026-04-06 to 2026-04-19

## Sprint Goal

Build the Foundation and Core data layer: Data/Config registry, seeded RNG with sub-streams,
Energy system with turn-based operations, and Status Effect system with apply/remove/tick
methods. These systems have zero external dependencies and are the load-bearing foundation
for every system built in subsequent sprints.

## Capacity

- Total days: 10 working days (2 weeks)
- Buffer (20%): 2 days reserved for unplanned work and bug fixes
- Available: 8 days

## Context

- **Milestone**: Milestone 1: Combat System MVP (`production/milestones/milestone-1-combat-system.md`)
- **Systems Index**: `design/gdd/systems-index.md` -- Dependency Layer 1 (Foundation) and partial Layer 2 (Core)
- **Architecture**: ADR-001 (core architecture, data-driven design, state management), ADR-003 (effect resolution, handler contract, modifier order), ADR-004 (event bus, typed wrapper)
- **Prototype Reference**: `prototypes/card-combat/` -- validated core loop, throwaway code
- **Previous Sprint**: None (first sprint)
- **Carryover**: None

## Tasks

### Must Have (Critical Path)

| ID | Task | Owner | Est. Days | Dependencies | Acceptance Criteria |
|----|------|-------|-----------|-------------|--------------------|
| S1-01 | Set up Phaser project structure (BootScene, plugins, config) | gameplay-programmer | 0.5 | None | Phaser BootScene loads and transitions to a test scene; GameRegistryPlugin and StateManagerPlugin install correctly |
| S1-02 | Implement GameRegistryPlugin with JSON loading and validation | gameplay-programmer | 1.0 | S1-01 | All 8 JSON data files load; `getCard("strike_red")` returns valid CardData; missing field logs warning; duplicate ID handled |
| S1-03 | Create minimal JSON data files (cards, enemies, relics, potions, characters, status-effects, reward, map-config) | gameplay-programmer | 1.0 | S1-02 | Each file is valid JSON array; at least Ironclad starter cards, 3 enemies, 3 relics, 3 potions, Burning Blood relic defined |
| S1-04 | Implement Data/Config acceptance criteria tests | gameplay-programmer | 0.5 | S1-03 | All 8 acceptance criteria from `data-config.md` pass; test: load, query, filter, validation, zero-hardcoded-values |
| S1-05 | Implement mulberry32 PRNG and RNGStream class | gameplay-programmer | 0.5 | None | Same seed produces same sequence; `nextInt(0, 100)` distribution within +-10% uniformity over 10,000 calls |
| S1-06 | Implement GameRNG with master seed and sub-streams (map, combat, ai, reward, event) | gameplay-programmer | 0.5 | S1-05 | Sub-stream isolation: 1000 calls to mapRNG do not affect combatRNG output; hex serialization roundtrip works |
| S1-07 | Implement RNG acceptance criteria tests | gameplay-programmer | 0.5 | S1-06 | All 7 acceptance criteria from `rng.md` pass; determinism, isolation, serialization, distribution, hex sharing, no Math.random in src/ |
| S1-08 | Implement EnergySystem class (turnStart, spendEnergy, gainEnergy, canPlay) | gameplay-programmer | 1.0 | S1-02 | Turn start calculates effectiveMax + bonus - penalty; X-cost consumes all; floor at 0; 0-cost always playable |
| S1-09 | Implement Energy acceptance criteria tests | gameplay-programmer | 0.5 | S1-08 | All 9 acceptance criteria from `energy.md` pass; edge case: penalty >= effectiveMax results in 0 |
| S1-10 | Implement StatusEffectManager (apply, remove, getStacks, processTurnEnd, clearAll) | gameplay-programmer | 1.5 | S1-02 | Stacking modes work (addDuration, addStacks, overwriteMax, doesNotStack); Artifact negation; turn-end processing order correct |
| S1-11 | Implement StatusEffect acceptance criteria tests | gameplay-programmer | 0.5 | S1-10 | All 10 acceptance criteria from `status-effect.md` pass; edge cases: same effect twice, negative stacks, Poison at 0, Artifact negation |
| S1-12 | Implement GameEventBus (typed wrapper around Phaser.Events.EventEmitter) | gameplay-programmer | 0.5 | S1-01 | emit/on/once/off work with typed payload map; error handling wraps handlers; destroy clears all listeners |
| S1-13 | Write unit tests for EventPayloadMap type safety (compile-time + runtime) | gameplay-programmer | 0.5 | S1-12 | TypeScript compiler catches mismatched payload types; runtime emit/receive works for 10+ event types from ADR-004 |

### Should Have

| ID | Task | Owner | Est. Days | Dependencies | Acceptance Criteria |
|----|------|-------|-----------|-------------|--------------------|
| S1-14 | Implement CardData schema and CardInstance class | gameplay-programmer | 1.0 | S1-02, S1-08, S1-10 | Card play validation (energy check, target check); keyword flags (Exhaust, Ethereal, Innate, Retain, Unplayable) |
| S1-15 | Implement DeckManager class (draw, discard, exhaust, shuffle, pile queries) | gameplay-programmer | 1.0 | S1-06, S1-14 | Draw from pile; shuffle when empty; Fisher-Yates uses combat RNG stream; hand limit 10 with overflow to discard |
| S1-16 | Write Card + Deck acceptance criteria tests | gameplay-programmer | 0.5 | S1-14, S1-15 | All 11 card AC + all 11 deck AC pass; edge cases: empty piles, 10-card hand, Innate guarantee |

### Nice to Have

| ID | Task | Owner | Est. Days | Dependencies | Acceptance Criteria |
|----|------|-------|-----------|-------------|--------------------|
| S1-17 | Implement EffectResolver with handler registration and resolveAll | gameplay-programmer | 1.0 | S1-10, S1-12 | deal_damage handler registered; apply_status handler registered; resolveAll stops on dead target |
| S1-18 | Implement EnemyData schema and EnemyInstance class | gameplay-programmer | 0.5 | S1-02 | EnemyData loaded from JSON; EnemyInstance tracks HP, block, isAlive, currentMove |

## Carryover from Previous Sprint

| Task | Reason | New Estimate |
|------|--------|-------------|
| N/A | First sprint | N/A |

## Risks

| Risk | Probability | Impact | Mitigation |
|------|------------|--------|------------|
| JSON data files require more content than expected for valid testing | Medium | Medium | Start with minimal datasets (Ironclad + 3 enemies); expand in Sprint 2 if needed |
| Phaser plugin lifecycle differs from expectations (init timing, scene access) | Medium | High | Test plugin installation in S1-01 before building on it; read Phaser docs on Plugin lifecycle |
| StatusEffect stacking edge cases are more complex than GDD describes | Low | Medium | Strict test coverage of all 10 acceptance criteria; defer non-critical stacking modes to Sprint 2 |
| EffectResolver handler registration pattern too restrictive for future cards | Low | Low | ADR-003 extensibility model (3-step add) is proven pattern; defer concern to Sprint 2 |

## Dependencies on External Factors

- Phaser 3.80+ must be installed and configured (npm package)
- Vitest must be configured for unit testing (no Phaser runtime needed for logic tests)
- JSON data files must be created manually -- no tooling yet

## Definition of Done for this Sprint

- [ ] All Must Have tasks (S1-01 through S1-13) completed
- [ ] All tasks pass acceptance criteria
- [ ] No S1 or S2 bugs in delivered features
- [ ] GameRegistryPlugin loads all data files without errors
- [ ] RNG produces deterministic output with sub-stream isolation
- [ ] EnergySystem handles all edge cases from GDD
- [ ] StatusEffectManager handles all stacking modes and Artifact negation
- [ ] GameEventBus emits and receives typed events correctly
- [ ] Code follows ADR-001 (data-driven) and ADR-004 (typed event bus) patterns
- [ ] All unit tests passing (target: 40+ tests covering foundation systems)

---

## Sprint Notes

### Priority Order for systems-index.md Compliance

Per `design/gdd/systems-index.md`, systems must be implemented respecting dependency layers:

1. **Layer 1** (Foundation, no deps): Data/Config, RNG, Energy -- all targeted in this sprint
2. **Layer 2** (Core, depends on Foundation): Status Effect, Card, Deck Manager, Enemy AI -- partial coverage this sprint

The Card System (S1-14) and Deck Manager (S1-15) are "Should Have" rather than "Must Have" because they depend on Energy and Status Effect completing first. If foundation tasks take longer than estimated, Card and Deck slide to Sprint 2 without blocking the critical path.

### Testing Strategy

All logic systems (RNG, Energy, Status Effect, Card, Deck) are tested with pure unit tests using Vitest. No Phaser runtime is needed for these tests -- mock the registry and event bus as plain objects implementing the same interfaces (per ADR-001 testing implications). This keeps tests fast and isolated.

### Architecture Alignment

- **ADR-001**: GameRegistryPlugin and StateManagerPlugin follow the plugin pattern. JSON data loading uses Phaser's `this.load.json()`. Card effects use the EffectResolver lookup table (no eval, no code generation).
- **ADR-003**: EffectResolver follows the handler registration pattern. Modifier application order (Strength -> Vulnerable -> Weak -> Block -> Floor at 0) is enforced in the deal_damage handler.
- **ADR-004**: GameEventBus wraps Phaser's EventEmitter with typed payload map. Two-bus design (global + combat-scoped) is set up in S1-12.
