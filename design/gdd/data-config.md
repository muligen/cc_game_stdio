# Data/Config System

> **Status**: Designed
> **Author**: user + agents
> **Last Updated**: 2026-04-01
> **Implements Pillar**: Adaptive Builds (data-driven content enables extensible card/relic pools)

## Overview

The Data/Config System is the foundational data layer for all game content. It
defines schemas for cards, enemies, relics, potions, events, and other game
entities; loads them from JSON configuration files at runtime; and provides a
typed registry for other systems to query content by ID, type, rarity, character,
and other criteria. Every gameplay system reads from this registry instead of
hardcoding values, enabling content expansion without modifying core game code.

## Player Fantasy

This is an infrastructure system — players never interact with it directly. It
serves the **Adaptive Builds** pillar by ensuring all game content (cards, relics,
enemies, events) is data-driven. Designers can add, modify, or remove content by
editing JSON files, and the game picks up changes without touching gameplay code.
This makes the card pool, relic pool, and enemy roster extensible and tunable
throughout development and post-launch.

## Detailed Design

### Core Rules

**1. Schema Definition**

All game entities are defined as TypeScript interfaces. Each entity type has a
corresponding JSON data file:

| Entity | Schema Type | Data File |
|--------|-------------|-----------|
| Card | `CardData` | `assets/data/cards.json` |
| Enemy | `EnemyData` | `assets/data/enemies.json` |
| Relic | `RelicData` | `assets/data/relics.json` |
| Potion | `PotionData` | `assets/data/potions.json` |
| Event | `EventData` | `assets/data/events.json` |
| Character | `CharacterData` | `assets/data/characters.json` |
| Ascension Modifier | `AscensionData` | `assets/data/ascension.json` |

**2. Data Format**

Each data file is a JSON array of entity records. Every record MUST contain:

- **`id`** (string, required): Unique identifier, format `{type}_{name}`
  (e.g., `card_strike`, `relic_burning_blood`, `enemy_jaw_worm`)
- **`type`** (string, required): Entity category (`attack`, `skill`, `power`,
  `normal`, `elite`, `boss`, etc.)
- **`character`** (string | null): Owning character ID, or `null` for universal
- **`rarity`** (string): Rarity tier (`starter`, `common`, `uncommon`, `rare`,
  `boss`, `shop`, `event`)

Additional fields are type-specific (e.g., cards have `cost`, `damage`, `block`;
enemies have `hp`, `moves`; relics have `effect`).

**3. Registry (GameRegistry)**

The `GameRegistry` class is the single source of truth for all loaded content.
It is initialized once at game startup and provides read-only query methods:

```
getCard(id: string): CardData
getCardsByCharacter(charId: string): CardData[]
getCardsByRarity(rarity: string): CardData[]
getCardPool(charId: string, rarity: string): CardData[]

getEnemy(id: string): EnemyData
getEnemiesByAct(act: number): EnemyData[]
getBossesByAct(act: number): EnemyData[]

getRelic(id: string): RelicData
getRelicsByRarity(rarity: string): RelicData[]

getPotion(id: string): PotionData
getPotionsByRarity(rarity: string): PotionData[]

getEvent(id: string): EventData
getEventsByAct(act: number): EventData[]

getCharacter(id: string): CharacterData
getAllCharacters(): CharacterData[]

getMapConfig(): MapConfig
getShopConfig(): ShopConfig
getRewardConfig(): RewardConfig
getAscensionModifiers(level: number): AscensionModifier[]
```

**4. Data Validation**

On load, the registry validates every record:

- All required fields are present and non-null
- Numeric values are within expected ranges (e.g., card cost 0-3, HP > 0)
- Referenced IDs exist in the registry (e.g., a card referencing a status effect
  ID must find it in the status effect table)
- No duplicate IDs within the same entity type

Validation failures are logged as console warnings but do NOT prevent loading
(defensive design — the game should still run with partially invalid data during
development). In production builds, validation errors are treated as hard errors.

### States and Transitions

| State | Description | Transition To |
|-------|-------------|---------------|
| **Unloaded** | Initial state. Registry is empty. | → Loading (on `loadAll()` call) |
| **Loading** | Async loading and validating all JSON files. | → Ready (all files loaded and validated) / → Error (network or parse failure) |
| **Ready** | All data loaded, validated, and queryable. | → Loading (hot reload in dev mode only) |
| **Error** | Loading failed. Registry may be partially populated. | → Loading (retry) |

State transitions are managed by the `GameRegistry` class. The game should not
proceed past the loading screen until the registry is in Ready state.

### Interactions with Other Systems

Data/Config is read-only during gameplay. All data flows outward from the
registry to dependent systems. No system writes back to the registry.

| Dependent System | Data Provided | Query Methods |
|-----------------|---------------|---------------|
| Card System | `CardData` (cost, type, rarity, effects, upgrade diff) | `getCard()`, `getCardsByCharacter()`, `getCardsByRarity()`, `getCardPool()` |
| Enemy AI System | `EnemyData` (hp, moves, intent patterns, AI rules) | `getEnemy()`, `getEnemiesByAct()`, `getBossesByAct()` |
| Status Effect System | Effect definitions (name, duration type, stacking rules) | `getStatusEffect()` |
| Relic System | `RelicData` (effect, rarity, trigger conditions) | `getRelic()`, `getRelicsByRarity()` |
| Potion System | `PotionData` (effect, rarity, character restriction) | `getPotion()`, `getPotionsByRarity()` |
| Event System | `EventData` (choices, outcomes, conditions, act restriction) | `getEvent()`, `getEventsByAct()` |
| Map System | Node distribution weights per floor, room type probabilities | `getMapConfig()` |
| Shop System | Pricing rules, stock generation rules | `getShopConfig()` |
| Character System | `CharacterData` (starting HP, starter deck IDs, starter relic ID) | `getCharacter()`, `getAllCharacters()` |
| Reward System | Drop rate tables, rarity odds, pity thresholds | `getRewardConfig()` |
| Ascension System | `AscensionModifier[]` for a given level | `getAscensionModifiers()` |

## Formulas

This system defines probability tables and size budgets used by downstream systems.

### Card Rarity Probability (per reward roll)

```
P(rare) = baseRareChance + pityCounter * pityIncrement
P(uncommon) = UNCOMMON_RATE  (fixed 37%)
P(common) = 1 - P(rare) - P(uncommon)

Where:
  baseRareChance = 0.03  (3%)
  pityCounter = number of common cards seen since last rare
  pityIncrement = 0.01   (+1% per common)
  UNCOMMON_RATE = 0.37   (37%)

Modifiers:
  shopBonus = +0.06  (6%)
  eliteBonus = +0.07  (7%)
```

After a rare is rolled, `pityCounter` resets to 0.

### Potion Drop Chance

```
P(potionDrop) = currentDropChance
After drop: currentDropChance -= 0.10
After no drop: currentDropChance increases (recovery)
Reset to BASE_POTION_DROP at start of each Act

Where:
  BASE_POTION_DROP = 0.40  (40%)
  MIN_DROP = 0.10
```

### Data Size Budgets

| Constraint | Limit | Rationale |
|-----------|-------|-----------|
| Single JSON file | < 500 KB | Phaser async load performance |
| Total loaded data | < 5 MB | Memory budget for web |
| Number of entities per file | No hard limit | JSON parse is fast |

These budgets are enforced by validation warnings (not hard errors).

## Edge Cases

1. **Missing JSON file**: If a data file fails to load (404, network error),
   the registry logs an error and treats that entity type as having zero entries.
   The game should display an error screen rather than proceeding with missing
   content.

2. **Duplicate IDs**: If two records share the same `id`, the second one overwrites
   the first. A validation warning is logged.

3. **Invalid reference**: If a card references a status effect ID that does not
   exist, the card still loads but the effect is treated as a no-op. Warning logged.

4. **Empty data file**: A valid JSON array `[]` is acceptable — it means zero
   entities of that type. Useful for testing or work-in-progress content.

5. **Null/optional fields**: Fields marked optional in the schema may be `null`
   or absent. The registry returns default values for missing optional fields
   (e.g., `character: null` for universal cards, `cost: 0` for zero-cost cards).

6. **Hot reload in dev mode**: During development, pressing a key can trigger
   hot reload. The registry re-reads all JSON files. If reload fails, the
   previous data remains in place (never leave the registry in Error state from
   a hot reload). Production builds disable hot reload entirely.

7. **Circular references in data**: Cards should never reference each other in a
   cycle (e.g., card A transforms into card B, card B transforms into card A).
   Validation detects and warns about cycles in transform fields.

## Dependencies

### Upstream (this system depends on)

None. This is a Foundation-layer system with zero external dependencies.

It uses Phaser's built-in `this.load.json()` for file loading and TypeScript's
type system for schema enforcement. No other game system must initialize before
the Data/Config System.

### Downstream (systems that depend on this)

| System | Dependency Type | Interface |
|--------|----------------|-----------|
| Card System | Hard | Reads `CardData` for card definitions and upgrade diffs |
| Enemy AI System | Hard | Reads `EnemyData` for enemy stats and move pools |
| Status Effect System | Hard | Reads effect definitions for buff/debuff configuration |
| Relic System | Hard | Reads `RelicData` for relic definitions |
| Potion System | Hard | Reads `PotionData` for potion definitions |
| Event System | Hard | Reads `EventData` for event choices and outcomes |
| Map System | Hard | Reads `MapConfig` for node distribution weights |
| Shop System | Hard | Reads `ShopConfig` for pricing and stock rules |
| Character System | Hard | Reads `CharacterData` for starting loadouts |
| Reward System | Hard | Reads `RewardConfig` for rarity probabilities and drop rates |
| Ascension System | Hard | Reads `AscensionModifier[]` for difficulty scaling rules |
| Run State Manager | Soft | Reads character/relic IDs for state tracking |

All dependencies are read-only. No downstream system modifies registry data.

## Tuning Knobs

All tuning knobs are defined in the data files themselves, not in code. Changing
a knob requires editing JSON, not recompiling.

| Knob | Location | Default | Safe Range | Affects |
|------|----------|---------|------------|---------|
| `baseRareChance` | `reward.json` | 0.03 | 0.00 - 0.20 | How often rare cards appear |
| `pityIncrement` | `reward.json` | 0.01 | 0.00 - 0.05 | Pity system ramp speed |
| `uncommonRate` | `reward.json` | 0.37 | 0.20 - 0.60 | Uncommon card frequency |
| `shopRareBonus` | `reward.json` | 0.06 | 0.00 - 0.15 | Shop rare card boost |
| `eliteRareBonus` | `reward.json` | 0.07 | 0.00 - 0.15 | Elite rare card boost |
| `basePotionDrop` | `reward.json` | 0.40 | 0.10 - 0.80 | Potion drop frequency |
| `potionDropPenalty` | `reward.json` | 0.10 | 0.05 - 0.20 | Drop rate decrease after drop |
| `maxPotionSlots` | `character.json` | 3 | 1 - 5 | Default potion belt capacity |
| `handSize` | `character.json` | 5 | 3 - 10 | Cards drawn per turn |
| `baseEnergy` | `character.json` | 3 | 1 - 5 | Energy per turn |

**What breaks at extremes:**
- `baseRareChance` at 1.0: every reward is rare, no common cards — deck identity
  loses tension. At 0.0: never see rares — Adaptive Builds pillar violated.
- `handSize` at 3: severely limits combo potential. At 10: information overload,
  violates Readability First pillar.
- `baseEnergy` at 1: game feels slow and restrictive. At 5: too many options,
  turns take too long.

## Acceptance Criteria

1. **Loading**: All 7 JSON data files load successfully within 2 seconds on a
   standard broadband connection. Registry reaches Ready state.

2. **Query correctness**: `getCard("card_strike")` returns a valid `CardData`
   object with all required fields populated. Same for all entity types.

3. **Filtering**: `getCardsByCharacter("ironclad")` returns only cards where
   `character === "ironclad"` or `character === null`. No cross-contamination.

4. **Validation**: Loading a JSON file with a missing required field logs a
   console warning containing the entity ID and the missing field name.

5. **Hot reload (dev only)**: Pressing the reload key re-reads all JSON files.
   If a file has a syntax error, the previous data remains loaded.

6. **Memory**: Total memory for all loaded data stays under 5 MB (verifiable
   via browser DevTools memory profiler).

7. **Zero-hardcoded-values test**: Search `src/` for hardcoded card names,
   enemy names, or relic names as string literals — there should be none.
   All content references go through the registry.

8. **Schema enforcement**: TypeScript compiler catches type mismatches at build
   time (e.g., passing a `RelicData` where `CardData` is expected).

## Open Questions

1. **Mod support**: Should the registry support loading additional data files
   from user-provided mods? If yes, this affects the loading architecture
   (merge strategy, conflict resolution). Owner: Technical Director. Decision
   needed before Production stage.

2. **Localization in data**: Should card text (name, description) live in the
   data JSON files or in separate locale files? Separate locale files are
   cleaner for translation but add a join step at load time. Owner: Lead
   Programmer. Decision needed before UI implementation.

3. **Data versioning**: Should data files include a version number for
   migration when schema changes between game updates? Owner: Technical
   Director. Can defer to post-MVP.
