# Meta-Progression

> **Status**: Designed
> **Author**: user + agents
> **Last Updated**: 2026-04-02
> **Implements Pillar**: Adaptive Builds (unlock new content expands build possibilities)

## Overview

The Meta-Progression System manages persistent cross-run unlocks. Players earn points by completing runs, used to unlock new cards, relics, events, and characters. These unlocks enrich the content pool, making each new run offer fresh discoveries. The system provides NO in-run numerical advantage — only content variety.

## Player Fantasy

Every run feels like progress. Even in defeat, you're working toward the next unlock. Unlocking a new card means it might appear in your next reward pool. **Adaptive Builds**: more available cards and relics mean more build directions to explore.

Reference: Unlike Slay the Spire (all cards available from start), this game uses meta-progression as an optional enhancement layer for discovery and variety.

## Detailed Design

### Meta State Schema

```
interface MetaState {
  totalRuns: number
  totalVictories: number
  totalScore: number
  unlockPoints: number
  unlockedCardIds: string[]
  unlockedRelicIds: string[]
  unlockedEventIds: string[]
  unlockedCharacterIds: string[]
  achievements: string[]
}
```

### Earning Unlock Points

```
earnUnlockPoints(runResult):
  points = 0
  points += 1  // base: completing any run
  if runResult.status == VICTORY: points += 3
  points += Math.floor(runResult.combatsWon / 5)
  points += Math.floor(runResult.score / 500)
  return points
```

Average earning: ~5 points per run (victory), ~2 points per run (defeat).

### Unlock Costs

| Item Type | Cost | Pool Size | Notes |
|-----------|------|-----------|-------|
| Common Card | 2 | ~30 per character | Small additions |
| Uncommon Card | 5 | ~25 per character | Mid-tier cards |
| Rare Card | 10 | ~15 per character | Premium cards |
| Common Relic | 5 | ~20 | Shared pool |
| Uncommon Relic | 10 | ~15 | Shared pool |
| Rare Relic | 20 | ~10 | Shared pool |
| Event | 8 | ~10 | New encounters |
| Character | 50 | 3 | New playstyle |

### Default Unlocked Content

Each character starts with:
- Starter deck cards (always available)
- 20 common cards from their pool
- 10 common relics
- All Act 1 events
- Ironclad is always unlocked

### Unlock Flow

```
unlockItem(itemId, metaState):
  cost = getUnlockCost(itemId)
  if metaState.unlockPoints >= cost:
    metaState.unlockPoints -= cost
    metaState.unlockedXIds.push(itemId)
    return true
  return false
```

### Achievements (Bonus Unlocks)

| Achievement | Condition | Reward |
|-------------|-----------|--------|
| First Blood | Complete first combat | 5 points |
| Deck Master | Have 30+ card deck | Uncommon card |
| Minimalist | Win with 10 or fewer cards | Rare card |
| Elite Slayer | Kill 10 elites in one run | Elite relic |
| Speed Demon | Win in under 30 minutes | Title |
| Iron Heart | Win on Ascension 10 | 20 points |
| Ascended | Win on Ascension 20 | Character skin |

## Formulas

### Points Per Run

```
pointsPerRun(victorious, combatsWon, score):
  base = 1
  if victorious: base += 3
  base += Math.floor(combatsWon / 5)
  base += Math.floor(score / 500)
  return base
```

### Progress Tracking

```
unlockPoolSize(totalItems, unlockedItems):
  return totalItems - unlockedItems.length

progressPercent(unlockedItems, totalItems):
  return Math.floor((unlockedItems.length / totalItems) * 100)
```

## Edge Cases

1. **All items unlocked**: Player has full content. No more unlocks available. Points accumulate with no use.

2. **First run experience**: Starter content is sufficient for a complete experience. No "paywall" on core gameplay.

3. **Unlock points persist**: Points stored in meta save file. Never reset between sessions.

4. **Same item unlock attempt**: Prevented by UI — already-unlocked items are not shown in unlock screen.

5. **Character unlock mid-progress**: Unlocking Silent doesn't carry over Ironclad's progress. Each character has independent card pool unlocks.

6. **Achievement already earned**: No duplicate rewards. One-time only.

7. **Negative points**: Impossible. Points are always >= 0.

8. **Very long run score cap**: Score-based point cap at +20 from score alone (prevents extreme farming).

## Dependencies

### Upstream (this system depends on)

| System | Type | Interface |
|--------|------|-----------|
| Data/Config | Hard | All item definitions, unlock costs, achievement conditions |
| Character System | Hard | Character unlock tracking |
| Run State Manager | Hard | Run results (victory, score, stats) |

### Downstream (systems that depend on this)

| System | Type | Interface |
|--------|------|-----------|
| Card System | Soft | Unlocked card pool feeds into card generation |
| Relic System | Soft | Unlocked relic pool feeds into relic generation |
| Event System | Soft | Unlocked event pool feeds into event selection |
| Save/Load System | Hard | Meta state persistence |

## Tuning Knobs

| Knob | Location | Default | Safe Range | What Breaks |
|------|----------|---------|------------|-------------|
| `basePointsPerRun` | `meta-config.json` | 1 | 0-3 | 0: no progress on defeat; 3: too fast |
| `victoryBonus` | `meta-config.json` | 3 | 1-5 | 5: unlocks too fast |
| `scoreDivisor` | `meta-config.json` | 500 | 200-1000 | 200: too generous; 1000: too slow |
| `scorePointCap` | `meta-config.json` | 20 | 10-50 | 10: limits long runs; 50: farmable |
| `commonCardCost` | `meta-config.json` | 2 | 1-5 | 1: trivial; 5: too expensive |
| `characterCost` | `meta-config.json` | 50 | 20-100 | 20: too easy; 100: too grindy |

## Acceptance Criteria

1. Run completion awards unlock points based on performance.
2. Points persist across runs (meta save).
3. Unlock screen shows available items with costs.
4. Purchasing an unlock deducts points and adds item to pool.
5. Unlocked cards appear in card reward pool.
6. Unlocked relics appear in relic pool.
7. Unlocked events appear in event pool.
8. Character unlock makes character selectable.
9. Achievements award bonus points/items on completion.
10. Progress percentage displayed (X/Y items unlocked).

## Open Questions

1. **Prestige system**: Should fully-unlocked players be able to "prestige" for cosmetic rewards?
   Recommend: yes, Post-MVP. Reset unlocks for exclusive cosmetics. Owner: Game Designer.

2. **Daily challenges**: Should daily runs award bonus unlock points?
   Recommend: yes, +2 bonus for daily completion. Owner: Game Designer.

3. **Online sync**: Should meta state sync across devices?
   Recommend: yes if online features exist. Post-MVP. Owner: Technical Director.
