# Sprint 2 -- 2026-04-20 to 2026-05-03

## Sprint Goal

Connect Sprint 1's independent systems into a working combat loop: the player can
enter combat, draw a hand, play cards (paying energy, resolving effects), watch
enemies execute intents, and reach a victory or defeat outcome. This sprint builds
the CombatScene, TurnManager, card play pipeline, enemy turn pipeline, death check,
combat initialization, and combat end handling.

## Capacity

- Total days: 10 working days (2 weeks)
- Buffer (20%): 2 days reserved for unplanned work and bug fixes
- Available: 8 days

## Context

- **Milestone**: Milestone 1: Combat System MVP (`production/milestones/milestone-1-combat-system.md`)
- **Systems Index**: `design/gdd/systems-index.md` -- Dependency Layer 3 (Feature), Combat System
- **Architecture**: ADR-001 (scene management, state management, data-driven design), ADR-002 (combat resolution pipeline, turn structure, damage pipeline, death checking, block timing), ADR-003 (effect resolution, handler contract, modifier order), ADR-004 (event bus, typed wrapper)
- **Combat GDD**: `design/gdd/combat.md` -- Turn flow, combat states, damage/block formulas, death handling
- **Card GDD**: `design/gdd/card.md` -- Card play flow (6 steps), pile transitions, keywords
- **Enemy AI GDD**: `design/gdd/enemy-ai.md` -- Intent execution, move selection, boss phases
- **Previous Sprint**: Sprint 1 -- 517 tests passing, all foundation + core systems implemented
- **Carryover**: Technical debt items from Sprint 1 retro (M2, M3, M4 should be addressed early)

### Sprint 1 Technical Debt (Must Address Early)

These items from the Sprint 1 retrospective will block Sprint 2 work if not resolved:

| ID | Issue | Sprint 2 Impact | Fix Location |
|----|-------|-----------------|--------------|
| M3 | cards.json target values mismatch TargetType enum | Card targeting will break in card play pipeline | `assets/data/cards.json` |
| M2 | GameRegistryPlugin no runtime validation | Data bugs surface in combat initialization | `src/plugins/game-registry-plugin.ts` |
| M4 | EnemyInstance type divergence (combat.ts vs enemy.ts) | Event handlers need adapter in combat flow | `src/types/combat.ts`, `src/types/enemy.ts` |

## Tasks

### Must Have (Critical Path)

| ID | Task | Owner | Est. Days | Dependencies | Acceptance Criteria |
|----|------|-------|-----------|-------------|-------------------|
| S2-01 | Fix Sprint 1 tech debt: align cards.json target values with TargetType enum, add shallow JSON validation to GameRegistryPlugin.install(), consolidate EnemyInstance types | gameplay-programmer | 0.5 | None | `tsc --noEmit` passes; all 517 existing tests still pass; cards.json `targets` field matches TargetType enum values; GameRegistryPlugin logs validation errors for missing required fields |
| S2-02 | Define CombatState interface and CombatController class: combat state machine with phase transitions (Initializing -> PlayerTurn -> EnemyTurn -> CombatOver), sub-states per ADR-002 | gameplay-programmer | 1.0 | S2-01 | TurnPhase enum transitions tested: INITIALIZING->PLAYER_TURN, PLAYER_TURN->ENEMY_TURN, ENEMY_TURN->PLAYER_TURN (loop), PLAYER_TURN->COMBAT_OVER (victory), ENEMY_TURN->COMBAT_OVER (defeat); invalid transitions throw; CombatState tracks turnNumber, phase, playerBlock, enemies, piles, energy, cardsPlayedThisTurn |
| S2-03 | Implement CombatScene: Phaser scene class with scene plugin for CombatController, lifecycle methods (create, update, shutdown), CombatEventBus initialization per ADR-004 two-bus design | gameplay-programmer | 0.5 | S2-02 | CombatScene initializes CombatController in create(); combat-scoped GameEventBus created and destroyed on scene lifecycle; scene plugin pattern matches ADR-001 Decision 1; no Phaser rendering logic in this task (logic only) |
| S2-04 | Implement combat initialization: shuffle deck into draw pile via DeckManager (combat RNG stream), spawn enemies with rolled HP via EnemyHelper, set energy via EnergySystem.turnStart(), draw opening hand (5 cards), roll first enemy intents | gameplay-programmer | 1.0 | S2-02, S2-03 | Combat initializes correctly per AC-1: enemies spawned with HP from range, deck shuffled into draw pile, energy reset to base, 5 cards drawn, each enemy has first intent selected; Innate cards guaranteed in opening hand; emits onCombatStart event |
| S2-05 | Implement TurnManager: phase transition methods (startPlayerTurn, endPlayerTurn, startEnemyTurn, endEnemyTurn, checkCombatEnd), block reset timing per ADR-002 (player block reset at player turn start, enemy block reset at individual enemy turn start) | gameplay-programmer | 1.0 | S2-02, S2-04 | Player turn start: block reset to 0, energy refilled, cards drawn, onPlayerTurnStart fired. Player turn end: hand discarded (Retain stays, Ethereal exhausts), status effects ticked, onPlayerTurnEnd fired. Enemy turn: each enemy executes in order, block reset per enemy, status effects ticked per enemy, next intents rolled, onEnemyTurnEnd fired |
| S2-06 | Implement card play pipeline: select card from hand, validate (energy check via EnergySystem.canPlay, target alive check), pay energy, resolve card effects via EffectResolver.resolveAll, handle Exhaust keyword (move to exhaust pile), handle non-Exhaust (move to discard), update cardsPlayedThisTurn, fire onCardPlayed + onCardResolved events | gameplay-programmer | 1.5 | S2-04, S2-05 | Full card play flow per ADR-002 Card Play Pipeline: validate->pay->resolve->post-play. 2-cost card with 3 energy leaves 1 energy. Exhaust card moves to exhaust pile. Non-exhaust card moves to discard. Unplayable card returns false from validate. X-cost consumes all energy. Effect resolution stops if target dies mid-chain |
| S2-07 | Implement enemy turn pipeline: for each living enemy, execute current move effects (attack -> damage pipeline, block gain, status application), check player death after each damage instance, handle stunned enemies (skip execution, clear stun), select next intent after execution | gameplay-programmer | 1.0 | S2-05, S2-06 | Each living enemy executes intent in order per ADR-002 Phase 4. Attack effects go through same damage pipeline as player cards. Block effects applied. Status effects applied. Player death checked after each damage instance. Stunned enemy skips execution, stun cleared. Dead enemies skipped. Next intent selected after execution |
| S2-08 | Implement death check system: check after every individual damage instance (both player and enemy), set isAlive=false, fire onEntityDeath, if player dead -> CombatOver defeat, if enemy dead -> check all enemies dead -> CombatOver victory | gameplay-programmer | 0.5 | S2-06, S2-07 | Death checked after every resolveDamage call per ADR-002. Player death (HP<=0) triggers CombatOver defeat immediately. Enemy death marks isAlive=false, fires onEntityDeath. All enemies dead triggers CombatOver victory. Multi-hit attack stops on target death (remaining hits fizzle). Simultaneous death: player death takes priority |
| S2-09 | Implement combat end handling: fire onCombatEnd with result, clear combat state (StatusEffectManager.clearAll, EnergySystem.resetToZero, DeckManager.destroyCombatPiles), emit victory/defeat signal for scene transition | gameplay-programmer | 0.5 | S2-08 | Combat end per Combat GDD Section 6: onCombatEnd fired with result, all combat effects cleared, energy reset to 0, combat piles destroyed, result stored in CombatState.result, phase set to COMBAT_OVER. Victory: reward trigger signal emitted. Defeat: run-over signal emitted |
| S2-10 | Write comprehensive unit tests for combat loop: full turn cycle (init -> player turn -> card play -> end turn -> enemy turn -> next turn), death scenarios, edge cases from combat GDD | gameplay-programmer | 2.0 | S2-04 through S2-09 | All 12 acceptance criteria from combat.md have passing tests. Full combat loop test: init -> draw hand -> play Strike -> end turn -> enemy acts -> next turn. Death tests: player death mid-card, enemy death mid-multi-hit, all enemies dead -> victory. Edge cases: all enemies killed mid-player-turn (player continues), player dies to Poison at turn end, enemy kills itself via Thorns. Maintain 517+ existing test standard |

### Should Have

| ID | Task | Owner | Est. Days | Dependencies | Acceptance Criteria |
|----|------|-------|-----------|-------------|-------------------|
| S2-11 | Implement block system integration: block calculation with Dexterity and Frail per combat GDD formulas, block absorption in damage pipeline, block additive within a turn, block reset timing verified in TurnManager | gameplay-programmer | 0.5 | S2-06, S2-07 | Block formula: `floor((base + dexterity) * frailMultiplier)`, min 0. Damage pipeline absorbs block before HP. Excess block carries until reset. Player block resets at player turn start. Enemy block resets at individual enemy turn start |
| S2-12 | Implement intent display data pipeline: when enemy selects intent, compute display damage (including Strength, Vulnerable, Weak at selection time per enemy-ai GDD), emit onIntentSelected event with intent data for future UI consumption | gameplay-programmer | 0.5 | S2-07 | Intent display damage = `floor((base + strength) * vulnerable * weak)` per enemy-ai GDD. Snapshot at selection time (does not update if modifiers change). Intent data includes: icon type, damage value, block value, effect name. onIntentSelected event emitted with full intent payload |
| S2-13 | Emit combat display events: onDamageDealt/onDamageTaken with damage amount and blocked amount, onBlockGained with block amount, onHPChanged with new HP, onEnergyChanged with new energy amount -- all for future UI consumption | gameplay-programmer | 0.5 | S2-06, S2-07, S2-11 | All display events emitted at correct timing per ADR-002 pipeline. Damage events carry source, target, raw damage, blocked amount, actual HP lost. Block events carry target and amount. Energy events carry old and new values. No UI rendering -- events only |

### Nice to Have

| ID | Task | Owner | Est. Days | Dependencies | Acceptance Criteria |
|----|------|-------|-----------|-------------|-------------------|
| S2-14 | Implement first turn special handling: guarantee Innate cards in opening hand (already in DeckManager), handle enemy first-move override (conditional `turn_count == 1` moves from enemy-ai GDD) | gameplay-programmer | 0.5 | S2-04, S2-07 | Innate cards always appear in opening hand. Enemy conditional moves with `trigger: "turn_count", operator: "==", value: 1` are selected on first turn. Non-first-turn fallback to weighted pool works correctly |
| S2-15 | Implement combat event logging: CombatLogger class that subscribes to all combat events and builds a structured log (turn number, phase, action, result) for debugging and test assertions | gameplay-programmer | 0.5 | S2-10 | CombatLogger records every significant event with turn number, phase, source, target, effect, result. Log is queryable for test assertions: `logger.findEvents("onDamageDealt")`. Log is clearable between combats. No performance impact on combat resolution |

## Carryover from Previous Sprint

| Task | Reason | New Estimate |
|------|--------|-------------|
| N/A | Sprint 1 completed all planned tasks | N/A |

## Risks

| Risk | Probability | Impact | Mitigation |
|------|------------|--------|------------|
| Sprint 1 tech debt (M3, M4) causes more rework than estimated | Medium | Medium | Address in S2-01 first; if M3/M4 take >0.5 days, defer S2-15 to stay on schedule |
| CombatState + existing types (DeckManager, CardHelper, EnemyHelper) have mismatched interfaces | High | High | S2-02 must audit all Sprint 1 system APIs before defining CombatController; allocate buffer time for adapter code |
| Enemy turn pipeline interactions (Thorns, multi-enemy, death mid-enemy-turn) are more complex than ADR-002 describes | Medium | High | S2-07 includes explicit Thorns death test case; if >1 day overrun, flag immediately and defer S2-14/S2-15 |
| EffectResolver handler contracts don't match CombatController needs (e.g., context missing combatState reference) | Medium | Medium | S2-06 starts with a spike to verify EffectContext has all required fields; extend ResolutionContext as needed per ADR-003 |
| 517-test regression: new combat code breaks existing Sprint 1 tests | Low | High | Run `tsc --noEmit` + `vitest run` after every task per Sprint 1 retro action item A1; fix regressions immediately |
| Multi-hit attack + death check + event emission interaction creates deep call stacks | Low | Medium | ADR-002 notes recursion depth concern; implement max resolution depth counter (50) as safety net in S2-08 |

## Dependencies on External Factors

- Phaser 3.80+ scene lifecycle must support CombatScene create/update/shutdown pattern
- Vitest must continue to support all Sprint 1 tests without breaking changes
- JSON data files (cards.json, enemies.json) must have correct schema per Sprint 1 tech debt fix (S2-01)

## Definition of Done for this Sprint

- [ ] All Must Have tasks (S2-01 through S2-10) completed
- [ ] All tasks pass acceptance criteria
- [ ] No S1 or S2 bugs in delivered features
- [ ] Full combat loop works: init -> draw hand -> play cards -> end turn -> enemy acts -> death check -> next turn or combat end
- [ ] Card play pipeline correctly validates, pays energy, resolves effects, handles exhaust/retain/ethereal
- [ ] Enemy turn pipeline correctly executes intents, applies damage/block/status, checks death
- [ ] Death check fires after every damage instance per ADR-002
- [ ] Combat end correctly clears state and signals victory/defeat
- [ ] All 12 acceptance criteria from combat.md have passing tests
- [ ] All 517 Sprint 1 tests still passing (no regressions)
- [ ] Code follows ADR-001 (scene plugin), ADR-002 (pipeline order), ADR-003 (handler contract), ADR-004 (two-bus events)
- [ ] `tsc --noEmit` passes with zero errors
- [ ] Mini code review after every 2-3 tasks per Sprint 1 retro action item A7

---

## Sprint Notes

### Priority Order

Per `design/gdd/systems-index.md` Dependency Layer 3, Combat System depends on all
Layer 2 systems (Card, Deck Manager, Energy, Enemy AI, Status Effect) which are
complete from Sprint 1. The implementation order respects this:

1. **S2-01**: Fix tech debt first -- blocks everything downstream
2. **S2-02/S2-03**: Combat state machine and scene -- foundation for all combat logic
3. **S2-04**: Combat initialization -- first visible end-to-end result
4. **S2-05**: Turn manager -- enables turn cycling
5. **S2-06**: Card play pipeline -- player agency in combat
6. **S2-07**: Enemy turn pipeline -- enemy agency in combat
7. **S2-08**: Death check -- combat termination condition
8. **S2-09**: Combat end -- cleanup and transitions
9. **S2-10**: Comprehensive tests -- validate entire sprint

### Architecture Alignment

- **ADR-001**: CombatScene follows scene plugin pattern. CombatController is a plain
  TypeScript class injected into the scene, not a Phaser GameObject. This keeps combat
  logic testable without Phaser runtime.
- **ADR-002**: Turn structure, damage pipeline, death checking, and block timing are
  implemented exactly as specified. The TurnManager maps directly to ADR-002's turn
  flow diagram.
- **ADR-003**: Card play pipeline uses EffectResolver.resolveAll() for card effects.
  Enemy turn pipeline uses the same EffectResolver for enemy move effects. Unified
  damage pipeline for both sources.
- **ADR-004**: Combat-scoped GameEventBus created in CombatScene.create(), destroyed
  in shutdown(). All combat events go through this bus. Global bus used for
  onCombatStart/onCombatEnd only.

### Testing Strategy

Following Sprint 1's successful test-first approach:

- **CombatController**: Pure unit tests with mocked DeckManager, EnergySystem,
  StatusEffectManager, EnemyHelper. No Phaser runtime needed.
- **TurnManager**: Unit tests for each phase transition, including invalid transitions.
- **Card play pipeline**: Integration tests using real EffectResolver with real handlers,
  but mocked combat state.
- **Enemy turn pipeline**: Integration tests with real EnemyHelper and real EffectResolver.
- **Death check**: Edge case tests from combat GDD Section 6 (9 edge cases).
- **Full combat loop**: End-to-end test from init to combat-over.

### Sprint 1 Retro Action Items in This Sprint

| Action Item | How Addressed |
|------------|---------------|
| A1: `tsc --noEmit` + `vitest run` after every task | Mandatory verification step in every task's acceptance criteria |
| A2: Add JSON validation to GameRegistryPlugin | S2-01 (tech debt fix) |
| A3: Align cards.json target values | S2-01 (tech debt fix) |
| A4: Extract gameplay constants to JSON config | Deferred to Sprint 3 (not blocking combat loop) |
| A5: Type StateManagerPlugin event API | Deferred to Sprint 3 (few callers currently) |
| A6: Consolidate EnemyInstance types | S2-01 (tech debt fix) |
| A7: Mini code review every 2-3 tasks | Added to Definition of Done checklist |
| A8: Remove dead code | S2-01 includes cleanup of effect-resolver.ts and enemy-helper.ts stubs |

### Effort Summary

| Category | Tasks | Est. Days | Buffer |
|----------|-------|-----------|--------|
| Must Have | S2-01 through S2-10 (10 tasks) | 8.0 | Within 8-day available budget |
| Should Have | S2-11 through S2-13 (3 tasks) | 1.5 | From buffer if needed |
| Nice to Have | S2-14 through S2-15 (2 tasks) | 1.0 | From buffer if needed |
| **Total** | **15 tasks** | **10.5** | **2-day buffer absorbs 2.5 overflow** |

Must Have tasks sum to exactly 8.0 days, fitting the available capacity. Should Have
and Nice to Have tasks total 2.5 additional days, absorbed by the 2-day buffer plus
Sprint 1's observed velocity advantage (estimates were conservative, actual ~30% faster).
