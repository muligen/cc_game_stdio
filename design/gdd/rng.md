# RNG System

> **Status**: Designed
> **Author**: user + agents
> **Last Updated**: 2026-04-01
> **Implements Pillar**: Adaptive Builds (seeded RNG enables varied but reproducible runs)

## Overview

The RNG System provides deterministic pseudo-random number generation for all game
randomness. Each run is initialized with a seed, and the same seed plus the same
player actions always produces the same outcomes. This enables run replayability
for debugging and sharing, while different seeds produce varied experiences. The
system uses a seeded PRNG algorithm (mulberry32) with independent sub-streams for
different game subsystems, ensuring that changes to one system's random consumption
do not affect other systems' outcomes.

## Player Fantasy

This is an infrastructure system — players never interact with it directly. It
serves the **Adaptive Builds** pillar by ensuring each run's card offerings, map
layout, and events differ based on the seed. It also supports **Calculated
Tension**: deterministic RNG means player death is always traceable to decisions,
not invisible randomness — the same seed played identically yields identical
outcomes, proving that strategy (not luck) determines success.

## Detailed Design

### Core Rules

**1. PRNG Algorithm**

The system uses **mulberry32** as its core 32-bit PRNG. Properties:
- Deterministic: same seed always produces the same sequence
- Fast: single multiplication and XOR per value
- Good distribution: passes statistical tests for game use
- No patent issues

```typescript
function mulberry32(state: number): () => number {
  return () => {
    state |= 0; state = state + 0x6D2B79F5 | 0;
    let t = Math.imul(state ^ state >>> 15, 1 | state);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}
```

**2. Seed Management**

- Each run is initialized with a **master seed** (32-bit unsigned integer)
- Master seed can be: auto-generated (Date.now() + Math.random()), or manually
  entered by the player (hex string like `#A3F7B2C1`)
- Master seed is split into **sub-seeds** using splitMix64 for each subsystem

**3. Sub-streams (Independent RNG Instances)**

Each consuming system gets its own RNG instance, derived from the master seed.
This ensures that consuming random numbers in one system does not affect the
sequence in another system.

| Sub-stream ID | Consumer | Purpose |
|--------------|----------|---------|
| `mapRNG` | Map System | Node generation, room type assignment, path branching |
| `combatRNG` | Combat System | Initial hand order (shuffle at combat start) |
| `aiRNG` | Enemy AI System | Intent selection from weighted move pools |
| `rewardRNG` | Reward System | Card rarity rolls, potion drops, gold variance |
| `eventRNG` | Event System | Event selection, event outcome randomization |

**4. Public API**

```typescript
class GameRNG {
  // Construction
  constructor(masterSeed: number);

  // Sub-stream access (lazy-initialized, deterministic order)
  getStream(id: RNGStreamId): RNGStream;

  // Seed sharing
  getSeedHex(): string;          // "#A3F7B2C1"
  static fromHex(hex: string): GameRNG;

  // Serialization (for save/load)
  serialize(): RNGSnapshot;
  static deserialize(snapshot: RNGSnapshot): GameRNG;
}

class RNGStream {
  // Basic generation
  nextInt(min: number, max: number): number;  // [min, max] inclusive
  nextFloat(): number;                         // [0, 1)

  // Collection operations
  shuffle<T>(array: T[]): T[];                 // Fisher-Yates
  pick<T>(array: T[]): T;                      // Random element
  weightedPick<T>(items: WeightedItem<T>[]): T; // Weighted random

  // Probability
  chance(probability: number): boolean;         // true with given probability

  // Serialization
  serialize(): StreamSnapshot;
}
```

**5. Seed Sharing**

Players can copy their seed hex string at any time and share it. Entering the
same seed starts a run with identical map layout, enemy intents, and reward
offers — enabling "daily challenge" style sharing and competitive comparison.

### States and Transitions

| State | Description | Transition To |
|-------|-------------|---------------|
| **Uninitialized** | No seed set. No RNG calls valid. | → Seeded (on `new GameRNG(seed)`) |
| **Seeded** | Master seed set. Sub-streams derived but not yet consumed. | → Consuming (first RNG call) |
| **Consuming** | Active run. RNG values being consumed by game systems. | → Snapshotted (save or share) |
| **Snapshotted** | All sub-stream states captured. | → Consuming (resume) |

The system is always either Seeded or Consuming during normal gameplay.
Snapshotted is transient — used only during save serialization.

### Interactions with Other Systems

| System | Data Provided | Sub-stream | When Called |
|--------|--------------|------------|------------|
| Map System | Random values for node type, branching, boss selection | `mapRNG` | Run start (Act generation), each floor transition |
| Combat System | Shuffle order for initial hand draw | `combatRNG` | Start of each combat |
| Enemy AI System | Weighted pick from enemy move pool | `aiRNG` | Start of each enemy turn (intent selection) |
| Reward System | Rarity rolls, potion drop chance, gold amount variance | `rewardRNG` | After each combat victory |
| Event System | Event selection from pool, outcome randomization | `eventRNG` | On event node entry |

**Data flow**: RNG → (read-only) → consuming systems. Systems never push data
back to RNG. Each system calls its assigned sub-stream exclusively.

**Important constraint**: Systems MUST only use their assigned sub-stream. If a
system needs randomness outside its assigned stream (e.g., a relic that affects
map generation), it must request the appropriate stream from the GameRNG instance.

## Formulas

### Master Seed Derivation

```
masterSeed: uint32 (0 to 4294967295)
```

If auto-generated: `masterSeed = (Date.now() ^ (Math.random() * 0x100000000)) >>> 0`

### Sub-seed Derivation (32-bit Safe)

Each sub-stream gets a unique seed derived from the master using a single round
of mulberry32 mixing applied to a seed-mixed input. All operations use `Math.imul`
for correct 32-bit multiplication and `>>> 0` for unsigned conversion. No BigInt
or 64-bit arithmetic required.

```
subSeed(i):
  // Mix the index into the master seed (32-bit safe)
  let s = (masterSeed + Math.imul(i, 0x9E3779B9)) | 0
  // Single round of mulberry32 mixing
  s = (s + 0x6D2B79F5) | 0
  let t = Math.imul(s ^ (s >>> 15), 1 | s)
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t) ^ t) | 0
  return ((t ^ (t >>> 14)) >>> 0)

Indices:
  0 = mapRNG, 1 = combatRNG, 2 = aiRNG, 3 = rewardRNG, 4 = eventRNG
```

### Core Generation

```
nextFloat():
  Returns mulberry32(state) output: [0.0, 1.0)

nextInt(min, max):
  return min + Math.floor(nextFloat() * (max - min + 1))
  // Result in [min, max], inclusive both ends
```

### Weighted Pick (Linear Scan)

```
weightedPick(items):
  totalWeight = sum(max(0, item.weight) for item in items)
  if totalWeight <= 0: throw Error("No valid items to pick from")
  roll = nextFloat() * totalWeight
  cumulative = 0
  for item in items:
    cumulative += max(0, item.weight)
    if roll < cumulative: return item
  return items[items.length - 1]  // fallback for floating-point edge case
```

Time complexity: O(n) linear scan. Intentionally simple — typical item pools
are small (< 20 items), making binary search overhead unnecessary. If pools grow
large in future, replace with cumulative-sum array + binary search.

### Seed Hex Encoding

```
toHex(seed): "#" + seed.toString(16).toUpperCase().padStart(8, '0')
fromHex(hex): parseInt(hex.replace('#', ''), 16)
```

## Edge Cases

1. **Seed = 0**: Mulberry32 produces valid output from seed 0. splitMix64 also
   handles 0 correctly. No special case needed.

2. **Integer overflow (JavaScript)**: All arithmetic uses `Math.imul` for
   correct 32-bit multiplication and `>>> 0` for unsigned conversion. The
   sub-seed derivation is specifically designed to be 32-bit safe — no BigInt
   or 64-bit constants needed. Standard JavaScript bitwise ops (`|`, `>>>`, `^`)
   are all 32-bit by spec.

3. **Empty array passed to pick/pickWeighted**: Throws `Error("Cannot pick from empty array")`.
   Calling systems must check array length before calling.

4. **All weights = 0 in weightedPick**: Throws `Error("No valid items to pick from")`.
   Defensive — this indicates a data error, not a valid game state.

5. **Negative weights in weightedPick**: Treated as weight = 0 (silently clamped).
   Items with weight ≤ 0 can never be selected.

6. **nextInt(min > max)**: Swaps min and max, so `nextInt(10, 1)` returns the
   same as `nextInt(1, 10)`. Logs a warning in dev mode.

7. **Serialization mid-combat**: The snapshot captures each sub-stream's internal
   state. On deserialize, the exact next value is produced, ensuring combat replay
   continues deterministically even if saved mid-fight.

8. **Adding new sub-streams**: If a new system needs RNG after initial design,
   it gets the next available index (5, 6, ...). Existing sub-stream indices
   never change, so old seeds remain compatible for existing sub-streams. New
   sub-streams get different values on old seeds (acceptable — not a breaking change).

## Dependencies

### Upstream (this system depends on)

None. This is a Foundation-layer system. It uses only JavaScript built-in
operations (bitwise, Math.imul).

### Downstream (systems that depend on this)

| System | Dependency Type | Sub-stream | What They Use |
|--------|----------------|------------|---------------|
| Map System | Hard | `mapRNG` | Node type, branching, boss selection |
| Combat System | Hard | `combatRNG` | Initial hand shuffle order |
| Enemy AI System | Hard | `aiRNG` | Weighted pick from enemy move pools |
| Reward System | Hard | `rewardRNG` | Rarity rolls, potion drops, gold variance |
| Event System | Hard | `eventRNG` | Event selection, outcome randomization |
| Save/Load System | Soft | (all streams) | Serialization/deserialization of RNG state |

### Serialization Types

```typescript
interface RNGSnapshot {
  masterSeed: number;            // Original master seed (for seed sharing)
  streams: Record<RNGStreamId, StreamSnapshot>;
}

interface StreamSnapshot {
  state: number;                  // Internal mulberry32 state (single uint32)
  consumed: number;               // Count of values consumed (for debugging)
}
```

The snapshot captures each stream's internal `state` uint32. For mulberry32,
saving just the state is sufficient — the next call produces the same value
regardless of history. The `consumed` count is informational only (for debug
display), not used in restoration.

## Tuning Knobs

The RNG system itself has no tuning knobs — it is a pure mathematical function.
All probability tuning is owned by the consuming systems and defined in their
respective GDDs and data files (loaded via Data/Config System).

| What you might want to tune | Where to tune it | Defined in |
|----------------------------|-----------------|------------|
| Card rarity probability | `reward.json` | Reward System GDD |
| Potion drop rate | `reward.json` | Reward System GDD |
| Map node type weights | `map.json` | Map System GDD |
| Enemy move weights | `enemies.json` | Enemy AI System GDD |

## Acceptance Criteria

1. **Determinism**: Given seed `0xA3F7B2C1`, calling `mapRNG.nextInt(0, 100)`
   10 times produces the same sequence on Chrome, Firefox, and Safari.

2. **Sub-stream isolation**: After consuming 1000 values from `mapRNG`, the first
   value from `combatRNG.nextInt(0, 100)` matches what it would be with zero
   `mapRNG` consumption.

3. **Serialization roundtrip**: `GameRNG.deserialize(rng.serialize())` produces
   an instance where the next `nextInt()` call returns the same value as the
   original instance would have.

4. **Distribution uniformity**: `mapRNG.nextInt(0, 9)` called 10,000 times
   produces each digit (0-9) between 900 and 1,100 times (±10% tolerance).

5. **Seed hex sharing**: `GameRNG.fromHex(rng.getSeedHex())` produces an instance
   that generates identical sequences to the original.

6. **No raw Math.random() in game code**: Grep `src/` for `Math.random()` —
   must only appear inside `GameRNG` constructor (default seed generation).
   All other game randomness goes through `GameRNG`.

7. **Performance**: Generating 10,000 random values takes < 5ms. No frame budget
   impact during gameplay.

## Open Questions

1. **Seed input UI**: How should players input seeds? Text field on run start
   screen? Dedicated "seed input" mode? Owner: UX Designer. Decision needed
   before Screen Flow GDD.

2. **Daily challenge integration**: Should the game fetch a daily seed from a
   server, or derive it deterministically from the calendar date? Server-based
   enables leaderboards; date-based works offline. Owner: Game Designer + Tech
   Director. Can defer to post-MVP.

3. **Seed visibility**: Should the seed be visible during gameplay (always in
   corner) or only on run summary / death screen? Owner: UX Designer. Can defer
   to UI GDD phase.
