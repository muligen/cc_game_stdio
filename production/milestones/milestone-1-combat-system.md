# Milestone 1: Combat System MVP

**Status**: In Planning
**Created**: 2026-04-02
**Target Start**: Sprint 1
**Target End**: Sprint 6

---

## Overview

Milestone 1 delivers a fully playable end-to-end combat experience. The player can
select a character, enter a combat encounter, play cards using the energy system,
watch enemies execute intents, receive rewards, and transition between screens. All
combat formulas produce correct values matching the GDDs. The milestone transforms
the validated prototype concept into production-quality code following the architecture
decisions in ADR-001 through ADR-004.

---

## Workflow Phase

```
Phase A1: Prototype (card combat)       -- COMPLETE (verified)
Phase A2: Playtest / skip               -- SKIP (prototype validated)
Phase A3: Go/no-go decision             -- GO
Phase 5:  Milestone 1 definition        -- THIS DOCUMENT
Phase 6:  Sprint 1 plan                 -- production/sprints/sprint-1.md
Phase 7:  Gate check                    -- End of Sprint 6
```

**Prototype findings** (from `prototypes/card-combat/README.md`):
- Core loop validated: draw/play/end turn rhythm feels right
- 3 energy + 5 cards creates meaningful decisions
- Block mechanic works against 6-damage attacks
- Bash (cost 2, 8 dmg + 2 Vulnerable) feels impactful
- Prototype code is throwaway -- production rewrite follows ADR patterns

---

## Scope

### Systems in Scope (by Dependency Layer)

#### Layer 1 -- Foundation (no dependencies)

| # | System | GDD | Status | Notes |
|---|--------|-----|--------|-------|
| 1 | Data/Config System | `data-config.md` | Approved | GameRegistry, JSON loading, validation |
| 2 | RNG System | `rng.md` | Approved | mulberry32, sub-streams, serialization |
| 3 | Energy System | `energy.md` | Approved | Turn-based energy, cost payment, X-cost |

#### Layer 2 -- Core (depends on Foundation)

| # | System | GDD | Status | Notes |
|---|--------|-----|--------|-------|
| 4 | Status Effect System | `status-effect.md` | Approved | Buffs/debuffs, stacking, turn-end processing |
| 5 | Card System | `card.md` | Approved | Card data, play flow, keywords, upgrade |
| 6 | Deck Manager | `deck-manager.md` | Approved | Draw/shuffle/discard/exhaust piles |
| 7 | Enemy AI System | `enemy-ai.md` | Approved | Intent display, weighted pool, boss phases |

#### Layer 3 -- Feature (depends on Core)

| # | System | GDD | Status | Notes |
|---|--------|-----|--------|-------|
| 8 | Combat System | `combat.md` | Approved | Turn flow, damage pipeline, death handling |
| 9 | Character System | `character.md` | Approved | Character data, starter deck, HP management |
| 10 | Reward System | `reward.md` | Approved | Card rewards, gold, potion drops, relics |
| 11 | Potion System | `potion.md` | Approved | Inventory, use rules, effect resolution |
| 12 | Relic System | `relic.md` | Approved | Passive triggers, counters, pool management |

#### Layer 4 -- Presentation (wraps gameplay systems)

| # | System | GDD | Status | Notes |
|---|--------|-----|--------|-------|
| 13 | Combat UI | `combat-ui.md` | Approved | Hand, energy orb, HP bars, intent display |
| 14 | Map UI | `map-ui.md` | Approved | Map navigation, node selection |
| 15 | Reward/UI | `reward-ui.md` | Approved | Card selection, potion/relic display |
| 16 | Screen Flow | `screen-flow.md` | Approved | Transitions, scene management |

### Architecture References

| ADR | Title | Key Decisions |
|-----|-------|---------------|
| ADR-001 | Core Architecture | Scene management (one scene per screen), StateManagerPlugin (centralized state), Data-driven design (JSON + EffectResolver) |
| ADR-002 | Combat Resolution Pipeline | Turn structure, damage pipeline, multi-hit attacks, death checking, block timing |
| ADR-003 | Effect Resolution System | Effect DSL, handler contract, modifier application order, trigger system, conditional effects |
| ADR-004 | Event Bus / Pub-Sub | Typed Phaser EventEmitter wrapper, event payload map, TriggerManager bridge for relics |

### Systems OUT of Scope (Post-MVP, Layer 5)

| System | Reason |
|--------|--------|
| Map System (generation logic) | Map generation is complex; MVP uses predefined encounter sequence |
| Rest Site System | Post-combat healing + upgrade; not combat-critical |
| Shop System | Shopping is a map node type; separate milestone |
| Event System | Random events are map nodes; separate milestone |
| Run State Manager (full) | Minimal run state for combat MVP; full manager in later milestone |
| Ascension System | Post-MVP |
| Meta-Progression | Post-MVP |
| Save/Load System | Post-MVP |

---

## Milestone Acceptance Criteria

### Critical Path (all must pass for milestone sign-off)

- [ ] **AC-1**: Combat initializes correctly -- enemies spawned, deck shuffled, initial hand drawn, energy reset
- [ ] **AC-2**: Player turn -- cards drawn, cards playable (energy check), end turn button available
- [ ] **AC-3**: Enemy turn -- each enemy executes intent in order, selects next intent
- [ ] **AC-4**: Damage formula matches unified formula from combat GDD (Strength, Vulnerable, Weak applied in correct order per ADR-002/003)
- [ ] **AC-5**: Block absorbs damage before HP; excess Block carries until next turn start
- [ ] **AC-6**: Block resets to 0 at start of entity's turn (player at turn start, enemy at turn start)
- [ ] **AC-7**: Player death (HP <= 0) triggers CombatOver defeat
- [ ] **AC-8**: All enemies dead triggers CombatOver victory -> Reward System
- [ ] **AC-9**: Poison damage at turn end can kill player (checked during turn-end processing)
- [ ] **AC-10**: Stunned enemy skips turn execution
- [ ] **AC-11**: Multi-hit attack applies damage per hit with Block chipped between hits
- [ ] **AC-12**: Combat end clears all combat effects, resets energy, destroys combat piles
- [ ] **AC-13**: All combat formulas produce values matching GDD specs within 1 unit
- [ ] **AC-14**: Combat rewards display correctly (gold + 3 cards + potion if dropped)
- [ ] **AC-15**: All card interactions work -- play, hover, target selection
- [ ] **AC-16**: Combat end triggers screen flow (victory/defeat states)
- [ ] **AC-17**: Performance within budget -- 60 FPS on combat scene

### Per-System Acceptance Criteria Summary

| System | AC Count | Source GDD Section |
|--------|----------|--------------------|
| Data/Config | 8 | `data-config.md` Acceptance Criteria |
| RNG | 7 | `rng.md` Acceptance Criteria |
| Energy | 9 | `energy.md` Acceptance Criteria |
| Status Effect | 10 | `status-effect.md` Acceptance Criteria |
| Card | 11 | `card.md` Acceptance Criteria |
| Deck Manager | 11 | `deck-manager.md` Acceptance Criteria |
| Enemy AI | 10 | `enemy-ai.md` Acceptance Criteria |
| Combat | 12 | `combat.md` Acceptance Criteria |
| Character | 8 | `character.md` Acceptance Criteria |
| Reward | 11 | `reward.md` Acceptance Criteria |
| Potion | 11 | `potion.md` Acceptance Criteria |
| Relic | 10 | `relic.md` Acceptance Criteria |
| Combat UI | 14 | `combat-ui.md` Acceptance Criteria |
| Reward UI | 12 | `reward-ui.md` Acceptance Criteria |
| Screen Flow | 13 | `screen-flow.md` Acceptance Criteria |

---

## Sprint Plan (6 sprints, 2 weeks each)

### Velocity Parameters

| Parameter | Value |
|-----------|-------|
| Sprint length | 2 weeks |
| Weekly capacity | ~4 hours/day x 5 days = 20 hours/week |
| Sprint capacity | ~40 hours (2 weeks x 20 hours) |
| Buffer (20%) | ~8 hours reserved for unplanned work |
| Available capacity | ~32 hours per sprint |
| Assignee | gameplay-programmer |

### Sprint Overview

| Sprint | Focus | Systems | Key Deliverables |
|--------|-------|---------|-----------------|
| **Sprint 1** | Foundation | Data/Config, RNG, Energy, Status Effect | JSON loading, seeded RNG with sub-streams, energy operations, status effect apply/remove/tick |
| **Sprint 2** | Core Systems | Card, Deck Manager, Enemy AI | Card play resolution, deck pile management, enemy intent patterns, weighted move selection |
| **Sprint 3** | Combat Integration | Combat System, Character | Full turn cycle (init -> player turn -> enemy turn -> resolution), damage pipeline, death handling |
| **Sprint 4** | Feature Systems | Reward, Potion, Relic | Reward generation, potion inventory/use, relic triggers and counter system |
| **Sprint 5** | UI + Presentation | Combat UI, Reward UI, Screen Flow | Combat scene rendering, card hand, energy orb, HP bars, intent display, screen transitions |
| **Sprint 6** | Polish + Gate | All systems | Performance optimization, code review, edge case tests, gate check |

### Sprint Detail

#### Sprint 1: Foundation (Layer 1 + Status Effect)

**Goal**: All foundation-layer systems operational with unit tests passing. Status Effect system functional (Layer 2 dependency for Card and Enemy AI).

| ID | Task | Owner | Est. Days | Dependencies | Acceptance Criteria |
|----|------|-------|-----------|-------------|--------------------|
| S1-01 | Implement GameRegistry with JSON loading and validation | gameplay-programmer | 2 | None | Data/Config AC 1-8 |
| S1-02 | Implement mulberry32 PRNG with sub-streams | gameplay-programmer | 1.5 | None | RNG AC 1-7 |
| S1-03 | Implement Energy System (turn start calc, spend, gain, X-cost) | gameplay-programmer | 1.5 | None | Energy AC 1-9 |
| S1-04 | Implement Status Effect System (apply, remove, tick, stacking) | gameplay-programmer | 3 | S1-01 (effect definitions from Data/Config) | Status Effect AC 1-10 |
| S1-05 | Write unit tests for all Sprint 1 systems | gameplay-programmer | 2 | S1-01 through S1-04 | All foundation unit tests passing |

**Sprint 1 Tests**:
- Data/Config: Registry loads all JSON files, queries return correct typed data, validation catches missing fields
- RNG: Determinism test (same seed = same sequence), sub-stream isolation, serialization roundtrip, distribution uniformity
- Energy: Turn start calculation, cost payment, X-cost resolution, edge cases (0 energy, overflow)
- Status Effect: Stacking modes (addDuration, addStacks, overwriteMax), turn-end processing order, Artifact negation, Poison tick

#### Sprint 2: Core Systems (Card, Deck Manager, Enemy AI)

**Goal**: Card play resolution works. Deck manages all four piles. Enemy AI selects and displays intents from weighted pools.

| ID | Task | Owner | Est. Days | Dependencies | Acceptance Criteria |
|----|------|-------|-----------|-------------|--------------------|
| S2-01 | Implement Card data model + CardData loading from GameRegistry | gameplay-programmer | 1.5 | S1-01 | Card AC 1-4 (data schema, pile states) |
| S2-02 | Implement Card play flow (validate, pay cost, resolve effects) | gameplay-programmer | 2 | S1-03 (Energy), S1-04 (Status Effect for effect resolution) | Card AC 1-6, 10-11 |
| S2-03 | Implement Deck Manager (draw, shuffle, discard, exhaust) | gameplay-programmer | 2 | S2-01 (Card instances), S1-02 (combat RNG stream) | Deck Manager AC 1-11 |
| S2-04 | Implement Enemy AI (intent types, weighted pool, rotating, conditional) | gameplay-programmer | 2.5 | S1-01 (enemy data), S1-02 (AI RNG stream), S1-04 (Status Effect) | Enemy AI AC 1-10 |
| S2-05 | Implement EffectResolver with core handlers (deal_damage, gain_block, apply_status, draw_cards) | gameplay-programmer | 2 | S1-04, S2-01, S2-03 | ADR-003 handler contract compliance |
| S2-06 | Write unit tests for all Sprint 2 systems | gameplay-programmer | 2 | S2-01 through S2-05 | All core system unit tests passing |

**Sprint 2 Tests**:
- Card: Play validation, cost deduction, effect resolution, keyword interactions (Exhaust, Ethereal, Innate, Retain)
- Deck Manager: Draw from pile, shuffle when empty, hand overflow, combat pile lifecycle
- Enemy AI: Weighted pool determinism, consecutive limits, boss phase transitions, conditional triggers
- EffectResolver: Each handler produces correct EffectResult, modifier chain order per ADR-003

#### Sprint 3: Combat Integration

**Goal**: Full combat turn cycle works end-to-end. Damage pipeline produces correct values. Combat state machine transitions correctly.

| ID | Task | Owner | Est. Days | Dependencies | Acceptance Criteria |
|----|------|-------|-----------|-------------|--------------------|
| S3-01 | Implement Combat System state machine (Initializing -> PlayerTurn -> EnemyTurn -> CombatOver) | gameplay-programmer | 2 | S2-01 through S2-06 | Combat AC 1-3 |
| S3-02 | Implement Damage Pipeline (base -> Strength -> Vulnerable -> Weak -> Block -> HP -> Death check) | gameplay-programmer | 1.5 | S3-01, S1-04 | Combat AC 4-6, 11 |
| S3-03 | Implement turn-end processing (status effect tick, duration decrement, removal, triggers) | gameplay-programmer | 1.5 | S3-01, S1-04 | Combat AC 9, 12 |
| S3-04 | Implement Character System (data loading, starter deck, HP management) | gameplay-programmer | 1 | S1-01 | Character AC 1-8 |
| S3-05 | Implement CombatEventBus (combat-scoped, per ADR-004) | gameplay-programmer | 1 | S3-01 | Event bus lifecycle, typed payload dispatch |
| S3-06 | Implement TriggerManager bridge (relic/event triggers via EventBus) | gameplay-programmer | 1.5 | S3-05 | ADR-004 Decision 5 compliance |
| S3-07 | Write integration tests for combat turn cycle | gameplay-programmer | 1.5 | S3-01 through S3-06 | Combat AC 1-12 verified in integration |

**Sprint 3 Tests**:
- Full combat: Initialize -> draw hand -> play cards -> end turn -> enemy acts -> check death -> next turn
- Damage pipeline: Verify formula outputs match GDD values for all modifier combinations
- Death handling: Player death mid-card, enemy death mid-multi-hit, simultaneous death
- Edge cases: All enemies killed mid-player-turn, player dies to Poison at turn end, enemy kills itself via Thorns

#### Sprint 4: Feature Systems (Reward, Potion, Relic)

**Goal**: Post-combat rewards generate correctly. Potion inventory and use works. Relic triggers fire at correct timing.

| ID | Task | Owner | Est. Days | Dependencies | Acceptance Criteria |
|----|------|-------|-----------|-------------|--------------------|
| S4-01 | Implement Reward System (gold generation, card reward with pity, potion drops) | gameplay-programmer | 2 | S2-01 (card data), S1-02 (reward RNG) | Reward AC 1-11 |
| S4-02 | Implement Potion System (slots, use, effects, Fairy Potion special) | gameplay-programmer | 1.5 | S1-01, S1-04 | Potion AC 1-11 |
| S4-03 | Implement Relic System (triggers, counters, pool management, boss relic costs) | gameplay-programmer | 2 | S1-01, S1-04, S3-06 (TriggerManager) | Relic AC 1-10 |
| S4-04 | Wire reward generation into combat end (victory -> reward generation) | gameplay-programmer | 1 | S3-07, S4-01 | Combat victory produces valid rewards |
| S4-05 | Wire potion use into combat (player turn -> select potion -> execute) | gameplay-programmer | 0.5 | S4-02, S3-01 | Potion usable during player turn |
| S4-06 | Wire relic triggers into combat events | gameplay-programmer | 1 | S4-03, S3-06 | Relics fire on onCardPlayed, onDamageDealt, onTurnEnd, etc. |
| S4-07 | Write integration tests for reward/potion/relic + combat | gameplay-programmer | 2 | S4-01 through S4-06 | Full combat -> reward flow passing |

**Sprint 4 Tests**:
- Reward: Correct gold amounts, 3 unique cards, pity system, potion drop probability
- Potion: Slot management, use during combat, Fairy Potion revive, targeting rules
- Relic: Trigger timing, counter increment/reset, pool deduplication, acquisition order
- Integration: Win combat -> receive rewards -> pick card -> card added to deck

#### Sprint 5: UI + Presentation

**Goal**: Combat scene renders all game state. Player can interact with cards, enemies, potions, and the End Turn button. Screen transitions work.

| ID | Task | Owner | Est. Days | Dependencies | Acceptance Criteria |
|----|------|-------|-----------|-------------|--------------------|
| S5-01 | Implement SceneFlowController (transition management, animation types per screen-flow GDD) | gameplay-programmer | 1.5 | ADR-001 Decision 1 | Screen Flow AC 9-11 |
| S5-02 | Implement CombatScene (Phaser scene with all combat UI components) | gameplay-programmer | 3 | S3-07, S5-01 | Combat UI AC 1-14 |
| S5-03 | Implement card hand rendering (fan layout, hover lift, targeting highlight) | gameplay-programmer | 1.5 | S5-02 | Combat UI AC 1-4 |
| S5-04 | Implement enemy display (HP bars, block, intent icons, status effect icons) | gameplay-programmer | 1.5 | S5-02 | Combat UI AC 5 |
| S5-05 | Implement energy orb, HP bar, end turn button, potion slots, relic bar | gameplay-programmer | 1.5 | S5-02 | Combat UI AC 6-11 |
| S5-06 | Implement RewardScene (card selection, gold display, potion/relic reward) | gameplay-programmer | 1.5 | S4-07, S5-01 | Reward UI AC 1-12 |
| S5-07 | Implement MapScene (minimal: encounter selection for combat testing) | gameplay-programmer | 1 | S5-01 | Map node clickable -> triggers combat |
| S5-08 | Write visual/UI tests (screenshot comparison, interaction tests) | gameplay-programmer | 1.5 | S5-02 through S5-07 | All UI acceptance criteria verified |

**Sprint 5 Tests**:
- Visual: Card hand renders correctly at 5/10 cards, energy orb displays current/max, HP bar color coding
- Interaction: Click card -> select, click enemy -> play, click End Turn -> enemy turn, click potion -> use
- Screen flow: Combat -> Reward -> Map -> Combat cycle works without crashes
- Edge cases: 10-card hand overflow, empty hand, all enemies dead mid-animation

#### Sprint 6: Polish + Gate Check

**Goal**: Performance within 60 FPS budget. Code review complete. Zero critical/blocker bugs. All acceptance criteria verified.

| ID | Task | Owner | Est. Days | Dependencies | Acceptance Criteria |
|----|------|-------|-----------|-------------|--------------------|
| S6-01 | Performance profiling and optimization (combat scene at 60 FPS) | gameplay-programmer | 2 | S5-08 | Frame time < 16.67ms, no GC spikes |
| S6-02 | Edge case testing (all GDD edge cases covered by tests) | gameplay-programmer | 2 | S5-08 | All edge cases from all GDDs have passing tests |
| S6-03 | Code review and refactoring (ADR compliance, no forbidden patterns) | gameplay-programmer | 1.5 | S6-02 | Code review checklist passed |
| S6-04 | Bug fix buffer (S1/S2 bugs from testing) | gameplay-programmer | 2 | S6-02 | Zero S1/S2 bugs remaining |
| S6-05 | Milestone acceptance test suite (full pass of all AC from all GDDs) | gameplay-programmer | 2 | S6-01 through S6-04 | All milestone AC items checked |
| S6-06 | Gate check documentation (milestone review report) | gameplay-programmer | 0.5 | S6-05 | Milestone review generated |

**Sprint 6 Exit Criteria**:
- All 17 system GDD acceptance criteria passing
- All combat formulas verified against GDD formula values within 1 unit
- Performance: 60 FPS sustained during combat on target hardware
- Zero S1/S2 bugs
- Code review complete with no open action items
- ADR compliance verified (no forbidden patterns, no hardcoded values)

---

## Risk Register

| Risk | Probability | Impact | Owner | Mitigation |
|------|------------|--------|-------|------------|
| Effect DSL expressiveness insufficient for card designs | Medium | High | gameplay-programmer | ADR-003 provides CONDITIONAL and REPEAT escape hatches; new handler types are cheap to add |
| Combat resolution pipeline performance under load (multi-hit + relic triggers) | Low | Medium | gameplay-programmer | ADR-002 estimates <3ms per turn; early profiling in Sprint 3 catches issues |
| Phaser scene lifecycle bugs (stale listeners, memory leaks between combats) | Medium | High | gameplay-programmer | ADR-004 two-bus design isolates combat events; destroy() on combat end clears all references |
| JSON data volume exceeds load budget | Low | Low | gameplay-programmer | Data/Config GDD budgets <5MB total; validate early in Sprint 1 |
| Scope creep from edge cases discovered during integration | Medium | Medium | gameplay-programmer | Sprint 6 buffer absorbs edge case work; defer non-critical edge cases to post-milestone |
| UI rendering performance (10 cards + 5 enemies + relics + effects) | Medium | High | gameplay-programmer | Profile in Sprint 5; batch UI updates per ADR-001 event-driven pattern |
| Single assignee bottleneck | High | High | gameplay-programmer | Strict scope control; 20% buffer per sprint; defer non-critical features aggressively |

---

## Dependencies

### Internal Dependencies

| Dependency | Provider Sprint | Consumer Sprint | Risk if Delayed |
|-----------|----------------|-----------------|-----------------|
| GameRegistry + data validation | Sprint 1 | All subsequent | Blocks everything |
| RNG sub-streams | Sprint 1 | Sprint 2 (AI, Deck), Sprint 4 (Reward) | Blocks AI and shuffle |
| Energy System | Sprint 1 | Sprint 2 (Card play) | Blocks card play |
| Status Effect System | Sprint 1 | Sprint 2 (Card effects), Sprint 3 (Combat) | Blocks card resolution |
| Card play resolution | Sprint 2 | Sprint 3 (Combat) | Blocks combat turn cycle |
| Deck Manager | Sprint 2 | Sprint 3 (Combat draw/discard) | Blocks combat flow |
| Enemy AI | Sprint 2 | Sprint 3 (Combat enemy turn) | Blocks enemy turn |
| Combat System | Sprint 3 | Sprint 4 (Reward generation), Sprint 5 (UI) | Blocks reward and UI |
| Reward/Potion/Relic | Sprint 4 | Sprint 5 (Reward UI, potion slots) | Blocks UI |

### External Dependencies

| Dependency | Status | Impact if Unavailable |
|-----------|--------|----------------------|
| Phaser 3.80+ npm package | Available | Core rendering engine -- no alternative |
| Vitest testing framework | Available | Test runner -- could fall back to Jest |
| TypeScript 5.x strict mode | Available | Language requirement |
| JSON data files (cards, enemies, relics, etc.) | Must be created | Blocks Data/Config system -- create minimal valid datasets in Sprint 1 |

---

## Definition of Done

A system or task is "Done" when ALL of the following are true:

1. **GDD acceptance criteria met**: Every acceptance criterion from the relevant GDD section has a passing test
2. **ADR compliance**: Code follows the patterns established in ADR-001 through ADR-004 (no forbidden patterns, no hardcoded gameplay values, data-driven design)
3. **Unit tests passing**: All unit tests for the system pass with >80% code coverage on the module
4. **Integration tests passing**: Where applicable, integration tests connecting to dependent systems pass
5. **No S1/S2 bugs**: Zero critical or blocker bugs open against the delivered code
6. **Code reviewed**: Code has been reviewed against the coding standards in `.claude/docs/coding-standards.md`
7. **Performance within budget**: Frame time < 16.67ms, no memory leaks, no GC spikes during combat

---

## Success Metrics

We will know this milestone was successful if:

1. A player can complete a full combat encounter from start to finish (init -> play cards -> enemy acts -> victory/defeat)
2. A player can receive and select rewards after combat victory
3. A player can navigate from map -> combat -> reward -> map without crashes
4. All damage/block/status effect calculations produce the same values as the GDD formulas
5. The combat scene runs at 60 FPS with no visible stutters
6. A QA tester can verify every acceptance criterion from every GDD as pass/fail
