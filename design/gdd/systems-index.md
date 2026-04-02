# Systems Index

**Last Updated:** 2026-04-01
**Total Systems:** 24
**MVP Systems:** 21
**Post-MVP Systems:** 3

---

## Systems Enumeration

| # | System | Category | Priority | Dependency Layer | Status |
|---|--------|----------|----------|-----------------|--------|
| 1 | Data/Config System | Foundation | MVP | 1 | Approved |
| 2 | RNG System | Foundation | MVP | 1 | Approved |
| 3 | Energy System | Foundation | MVP | 1 | Approved |
| 4 | Status Effect System | Core | MVP | 2 | Approved |
| 5 | Card System | Core | MVP | 2 | Approved |
| 6 | Deck Manager | Core | MVP | 2 | Approved |
| 7 | Enemy AI System | Core | MVP | 2 | Approved |
| 8 | Combat System | Feature | MVP | 3 | Approved |
| 9 | Character System | Feature | MVP | 3 | Approved |
| 10 | Reward System | Feature | MVP | 3 | Approved |
| 11 | Potion System | Feature | MVP | 3 | Approved |
| 12 | Relic System | Feature | MVP | 3 | Approved |
| 13 | Map System | Feature | MVP | 3 | Approved |
| 14 | Rest Site System | Feature | MVP | 3 | Approved |
| 15 | Shop System | Feature | MVP | 3 | Approved |
| 16 | Event System | Feature | MVP | 3 | Approved |
| 17 | Run State Manager | Feature | MVP | 3 | Approved |
| 18 | Combat UI | Presentation | MVP | 4 | Approved |
| 19 | Map UI | Presentation | MVP | 4 | Approved |
| 20 | Reward/UI | Presentation | MVP | 4 | Approved |
| 21 | Screen Flow | Presentation | MVP | 4 | Approved |
| 22 | Ascension System | Meta | Post-MVP | 5 | Approved |
| 23 | Meta-Progression | Meta | Post-MVP | 5 | Approved |
| 24 | Save/Load System | Meta | Post-MVP | 5 | Approved |

---

## Dependency Map

### Layer 1 — Foundation (no dependencies)

| System | Depends on |
|--------|-----------|
| Data/Config System | — |
| RNG System | — |
| Energy System | — |

### Layer 2 — Core (depends on Foundation)

| System | Depends on |
|--------|-----------|
| Status Effect System | Data/Config |
| Card System | Energy, Data/Config |
| Deck Manager | Card System |
| Enemy AI System | Data/Config, RNG, Status Effect |

### Layer 3 — Feature (depends on Core)

| System | Depends on |
|--------|-----------|
| Combat System | Card, Deck Manager, Energy, Enemy AI, Status Effect |
| Character System | Card, Data/Config |
| Reward System | Card, RNG, Data/Config |
| Potion System | Data/Config, Status Effect |
| Relic System | Data/Config, Status Effect |
| Shop System | Card, Relic, Potion, Data/Config |
| Rest Site System | Card (upgrade), Data/Config |
| Event System | RNG, Data/Config, Status Effect |
| Map System | RNG, Data/Config, Run State |
| Run State Manager | Character, Relic, Potion, Deck Manager |

### Layer 4 — Presentation (wraps gameplay systems)

| System | Depends on |
|--------|-----------|
| Combat UI | Combat, Energy, Status Effect |
| Map UI | Map System, Run State |
| Reward/UI | Reward, Relic, Potion |
| Screen Flow | All UI systems |

### Layer 5 — Meta (global systems)

| System | Depends on |
|--------|-----------|
| Ascension System | Run State, Data/Config |
| Meta-Progression | Run State, Data/Config, Character |
| Save/Load System | Run State, Map, Deck Manager |

---

## Bottleneck Systems (high-risk, many dependents)

1. **Data/Config System** — 16 systems depend on it
2. **Card System** — 5 systems depend on it
3. **Status Effect System** — 5 systems depend on it
4. **Run State Manager** — 4 systems depend on it

---

## Recommended Design Order

Systems should be designed (GDD written) in this order, respecting both
dependency constraints and MVP priority.

### Phase A — Foundation GDDs (design first)

1. Data/Config System
2. RNG System
3. Energy System

### Phase B — Core GDDs

4. Status Effect System
5. Card System
6. Deck Manager
7. Enemy AI System

### Phase C — Feature GDDs (gameplay)

8. Combat System
9. Character System
10. Reward System
11. Potion System
12. Relic System
13. Map System
14. Rest Site System
15. Shop System
16. Event System
17. Run State Manager

### Phase D — Presentation GDDs

18. Combat UI
19. Map UI
20. Reward/UI
21. Screen Flow

### Phase E — Post-MVP GDDs

22. Ascension System
23. Meta-Progression
24. Save/Load System

---

## Progress Tracker

| Phase | Total | Not Started | In Review | Approved |
|-------|-------|-------------|-----------|----------|
| A — Foundation | 3 | 0 | 0 | 3 |
| B — Core | 4 | 0 | 0 | 4 |
| C — Feature | 10 | 0 | 0 | 10 |
| D — Presentation | 4 | 0 | 0 | 4 |
| E — Post-MVP | 3 | 0 | 0 | 3 |
| **Total** | **24** | **0** | **0** | **24** |
