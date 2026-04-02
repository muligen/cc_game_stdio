# Sprint 1 Retrospective

**Date**: 2026-04-02
**Sprint**: Sprint 1 (2026-04-06 to 2026-04-19)
**Milestone**: Milestone 1 — Combat System MVP

## Summary

Sprint 1 delivered all 18 planned tasks (13 Must Have, 3 Should Have, 2 Nice to Have) with 517 tests passing. A code review identified 2 Critical, 5 Major, 9 Minor issues — both Critical issues were fixed before close. Overall: **successful first sprint** with strong test discipline but notable architecture drift from ADRs.

## 1. What Went Well

- **Test-first discipline**: 517 tests from zero, all deterministic, all passing. Tests cover AC criteria from GDDs, edge cases, and integration flows. This is the strongest outcome of Sprint 1.
- **Task consolidation**: Several tasks (S1-06/07, S1-09, S1-11, S1-13) were naturally covered by their implementation pair, saving ~2 days of estimated effort.
- **Consistent coding patterns**: Static utility classes (CardHelper, EnemyHelper), manager classes (DeckManager, StatusEffectManager), and plugin classes (GameRegistryPlugin, StateManagerPlugin) each follow a consistent pattern.
- **Deterministic RNG**: GameRNG with independent sub-streams worked exactly as designed. Seed sharing, serialization, and isolation all validated by tests.
- **Data-driven design**: All gameplay values in JSON, zero hardcoded gameplay numbers in TypeScript (mostly — see debt items).

## 2. What Could Be Improved

- **ADR drift**: GameEventBus implemented a custom event system instead of wrapping Phaser's EventEmitter (ADR-004). EffectResolver's ResolutionContext diverged from ADR-003's EffectContext. Both were caught in code review, but earlier review cycles (after each task) would have caught them sooner.
- **S1-01 compilation errors**: The project structure setup agent delivered files with syntax errors (missing commas, truncated comments, wrong enum values). These required manual fixes. Root cause: agent didn't run `tsc --noEmit` before reporting completion.
- **Agent test failures**: Three tasks (S1-12, S1-17, S1-18) had test failures on first delivery that required manual diagnosis and fixes. Common pattern: agent's test expectations didn't match the implementation's error handling behavior.
- **No incremental code review**: All code was reviewed at sprint end (Pr.3). Earlier review after each task would have prevented ADR drift accumulation.

## 3. Action Items for Sprint 2

| # | Action | Owner | Priority |
|---|--------|-------|----------|
| A1 | Run `tsc --noEmit` + `vitest run` as mandatory verification after every task | gameplay-programmer | High |
| A2 | Add shallow JSON data validation to GameRegistryPlugin.install() | gameplay-programmer | High |
| A3 | Align cards.json target values with TargetType enum | gameplay-programmer | High |
| A4 | Extract gameplay constants (DEFAULT_BASE_ENERGY, MAX_HAND_SIZE) to JSON config | gameplay-programmer | Medium |
| A5 | Type StateManagerPlugin event API with a StateEventPayloadMap | gameplay-programmer | Medium |
| A6 | Consolidate EnemyInstance (combat.ts) and CombatEnemyInstance (enemy.ts) types | lead-programmer | Medium |
| A7 | Mini code review after every 2-3 tasks during sprint execution | lead-programmer | Medium |
| A8 | Remove dead code in effect-resolver.ts, remove stub methods in enemy-helper.ts | gameplay-programmer | Low |
| A9 | Replace console.warn in rng.ts with Logger | gameplay-programmer | Low |

## 4. Velocity Assessment

| Category | Planned Tasks | Actual Delivered | Est. Days | Actual |
|----------|--------------|-----------------|-----------|--------|
| Must Have | 13 | 13 | 7.5 days | ~4 sessions |
| Should Have | 3 | 3 | 2.5 days | ~2 sessions |
| Nice to Have | 2 | 2 | 1.5 days | ~1 session |
| Code Review | 1 | 1 | — | 1 session |
| **Total** | **18+1** | **18+1** | **11.5 days** | **~8 sessions** |

Estimates were generally conservative. Task consolidation (S1-06/07, S1-09, S1-11, S1-13 covered by implementation pairs) recovered ~2 days. This time was reallocated to Nice to Have tasks and code review fixes.

## 5. Technical Debt Created

### From Code Review (Deferred to Sprint 2)

| Severity | Issue | Sprint 2 Impact |
|----------|-------|-----------------|
| Major | StateManagerPlugin event API untyped (M1) | Low — few callers currently |
| Major | GameRegistryPlugin no runtime validation (M2) | Medium — data bugs will surface in combat |
| Major | cards.json target values mismatch enum (M3) | High — card targeting will break |
| Major | EnemyInstance type divergence (M4) | Medium — event handlers will need adapter |
| Minor | rng.ts console.warn (m1) | Low |
| Minor | Dead code in effect-resolver.ts (m2) | Low |
| Minor | Stub methods in enemy-helper.ts (m3) | Low |
| Minor | Gameplay constants in TypeScript (m5, m8) | Low |
| Minor | No error boundary in GameRegistryPlugin (m7) | Medium |

### Recommendation

Address M2 and M3 early in Sprint 2 — they will cause data-loading bugs when the combat system starts consuming card/enemy data at runtime. M4 should be resolved before event-driven combat flow is implemented.

## 6. Lessons for Sprint 2

1. **Verify after every task**: `tsc --noEmit` + `vitest run` is non-negotiable. Sprint 1 had 3 instances of agents reporting "done" with failing tests.
2. **Mini code reviews during sprint**: Don't wait until sprint end. Review every 2-3 tasks for ADR compliance.
3. **Data validation is critical**: A malformed JSON file will cause silent runtime errors. Add validation in Sprint 2.
4. **Agent delegation needs tighter specs**: S1-12, S1-17, S1-18 all had test failures from ambiguous specs. Include expected error behavior explicitly.
5. **Test coverage is excellent — maintain it**: The 517-test foundation is valuable. Sprint 2 must match this standard for new systems.
