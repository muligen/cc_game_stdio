/**
 * test-data.ts — Factory functions for all entity types.
 *
 * Provides createX(partial) helpers that return fully valid objects
 * with sensible defaults. Used across the data-config test suite.
 */

import type {
  CardData,
  CardEffect,
  EnemyData,
  EnemyMove,
  MoveEntry,
  StatusEffectData,
  RelicData,
  RelicTriggerData,
  PotionData,
  CharacterData,
  MapConfig,
  RewardConfig,
  ShopConfig,
  UIConfig,
  EventData,
  AscensionData,
} from '../../../src/types';
import {
  CardType,
  Rarity,
  CostType,
  TargetType,
  Keyword,
  IntentType,
  DurationType,
  StackingMode,
  RelicTier,
  PotionRarity,
} from '../../../src/types';

// ---------------------------------------------------------------------------
// Card helpers
// ---------------------------------------------------------------------------

/** Create a valid CardEffect with optional overrides. */
export function createCardEffect(overrides: Partial<CardEffect> = {}): CardEffect {
  return {
    type: 'deal_damage',
    value: 6,
    ...overrides,
  };
}

/** Create a valid CardData with optional overrides. */
export function createCardData(overrides: Partial<CardData> = {}): CardData {
  return {
    id: 'strike_red',
    name: 'Strike',
    type: CardType.ATTACK,
    rarity: Rarity.STARTER,
    cost: 1,
    costType: CostType.NORMAL,
    character: 'ironclad',
    targets: TargetType.ENEMY,
    effects: [createCardEffect()],
    keywords: [],
    upgrade: {},
    description: 'Deal 6 damage.',
    flavorText: undefined,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Enemy helpers
// ---------------------------------------------------------------------------

/** Create a valid MoveEntry with optional overrides. */
export function createMoveEntry(overrides: Partial<MoveEntry> = {}): MoveEntry {
  return {
    moveId: 'bite',
    weight: 3,
    ...overrides,
  };
}

/** Create a valid EnemyMove with optional overrides. */
export function createEnemyMove(overrides: Partial<EnemyMove> = {}): EnemyMove {
  return {
    id: 'bite',
    name: 'Bite',
    intent: IntentType.ATTACK,
    effects: [{ type: 'deal_damage', value: 6 }],
    damage: 6,
    ...overrides,
  };
}

/** Create a valid EnemyData with optional overrides. */
export function createEnemyData(overrides: Partial<EnemyData> = {}): EnemyData {
  return {
    id: 'enemy_jaw_worm',
    name: 'Jaw Worm',
    type: 'normal',
    hp: 40,
    act: 1,
    moves: [createMoveEntry()],
    selectionMode: 'weighted',
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Status effect helpers
// ---------------------------------------------------------------------------

/** Create a valid StatusEffectData with optional overrides. */
export function createStatusEffectData(overrides: Partial<StatusEffectData> = {}): StatusEffectData {
  return {
    id: 'vulnerable',
    name: 'Vulnerable',
    description: 'Takes 50% more attack damage.',
    category: 'debuff',
    durationType: DurationType.TURNS,
    stackingMode: StackingMode.ADD_DURATION,
    defaultValue: 1,
    defaultDuration: 2,
    icon: 'vulnerable',
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Relic helpers
// ---------------------------------------------------------------------------

/** Create a valid RelicTriggerData with optional overrides. */
export function createRelicTriggerData(overrides: Partial<RelicTriggerData> = {}): RelicTriggerData {
  return {
    event: 'on_combat_end',
    effects: [{ type: 'heal', value: 6 }],
    priority: 0,
    ...overrides,
  };
}

/** Create a valid RelicData with optional overrides. */
export function createRelicData(overrides: Partial<RelicData> = {}): RelicData {
  return {
    id: 'burning_blood',
    name: 'Burning Blood',
    description: 'Heal 6 HP at end of combat.',
    tier: RelicTier.STARTER,
    triggers: [createRelicTriggerData()],
    stackable: false,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Potion helpers
// ---------------------------------------------------------------------------

/** Create a valid PotionData with optional overrides. */
export function createPotionData(overrides: Partial<PotionData> = {}): PotionData {
  return {
    id: 'fire_potion',
    name: 'Fire Potion',
    description: 'Deal 20 damage to an enemy.',
    rarity: PotionRarity.COMMON,
    target: 'enemy',
    effects: [{ type: 'deal_damage', value: 20 }],
    canUseInCombat: true,
    canUseOutOfCombat: false,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Character helpers
// ---------------------------------------------------------------------------

/** Create a valid CharacterData with optional overrides. */
export function createCharacterData(overrides: Partial<CharacterData> = {}): CharacterData {
  return {
    id: 'ironclad',
    name: 'Ironclad',
    description: 'A warrior clad in iron.',
    hp: 80,
    maxHp: 80,
    energy: 3,
    starterDeck: ['strike_red', 'strike_red', 'defend_red', 'defend_red', 'bash'],
    starterRelics: ['burning_blood'],
    cardPool: ['strike_red', 'defend_red', 'bash'],
    color: '#ff4444',
    maxPotionSlots: 3,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Map config helpers
// ---------------------------------------------------------------------------

/** Create a valid MapConfig with optional overrides. */
export function createMapConfig(overrides: Partial<MapConfig> = {}): MapConfig {
  return {
    floorsPerAct: 15,
    nodesPerFloorMin: 2,
    nodesPerFloorMax: 5,
    eliteMinFloor: 4,
    maxElitesPerAct: 3,
    restSiteMinPerAct: 2,
    restSiteMaxPerAct: 4,
    restHealPercent: 0.3,
    floorWeights: [
      {
        floorStart: 0,
        floorEnd: 14,
        combatWeight: 0.5,
        eliteWeight: 0.1,
        shopWeight: 0.1,
        restWeight: 0.1,
        eventWeight: 0.15,
        treasureWeight: 0.05,
      },
    ],
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Reward config helpers
// ---------------------------------------------------------------------------

/** Create a valid RewardConfig with optional overrides. */
export function createRewardConfig(overrides: Partial<RewardConfig> = {}): RewardConfig {
  return {
    baseRareChance: 0.12,
    pityIncrement: 0.03,
    pityCap: 0.4,
    uncommonChance: 0.37,
    rewardCardsOffered: 3,
    normalGoldBase: 15,
    normalGoldVariance: 5,
    eliteGoldBase: 30,
    eliteGoldVariance: 10,
    bossGoldBase: 60,
    bossGoldVariance: 20,
    potionDropRate: 0.4,
    potionDropPenalty: 0.1,
    commonPotionWeight: 0.65,
    uncommonPotionWeight: 0.25,
    rarePotionWeight: 0.1,
    shopRareBonus: 0.06,
    eliteRareBonus: 0.07,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Shop config helpers
// ---------------------------------------------------------------------------

/** Create a valid ShopConfig with optional overrides. */
export function createShopConfig(overrides: Partial<ShopConfig> = {}): ShopConfig {
  return {
    commonCardCost: 50,
    uncommonCardCost: 75,
    rareCardCost: 150,
    removeCost: 75,
    relicPrices: { common: 150, uncommon: 200, rare: 300, shop: 150 },
    shopCardCount: 5,
    shopRelicCount: 3,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// UI config helpers
// ---------------------------------------------------------------------------

/** Create a valid UIConfig with optional overrides. */
export function createUIConfig(overrides: Partial<UIConfig> = {}): UIConfig {
  return {
    cardWidth: 120,
    cardHeight: 170,
    cardHoverLift: 30,
    cardSelectLift: 50,
    animationSpeedMultiplier: 1.0,
    combatLogMaxEntries: 50,
    intentUpdateDuration: 300,
    hpBarMaxWidth: 200,
    fadeDuration: 200,
    slideDuration: 300,
    dissolveDuration: 400,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Event helpers
// ---------------------------------------------------------------------------

/** Create a valid EventData with optional overrides. */
export function createEventData(overrides: Partial<EventData> = {}): EventData {
  return {
    id: 'event_shining_light',
    name: 'Shining Light',
    act: 1,
    choices: [
      {
        description: 'Enter the light.',
        effects: [{ type: 'upgrade_random_card', value: 1 }],
      },
    ],
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Ascension helpers
// ---------------------------------------------------------------------------

/** Create a valid AscensionData with optional overrides. */
export function createAscensionData(overrides: Partial<AscensionData> = {}): AscensionData {
  return {
    id: 'asc_1',
    level: 1,
    description: 'Less gold from combat.',
    modifications: [{ target: 'normalGoldBase', operation: 'subtract', value: 2 }],
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Full data cache helper
// ---------------------------------------------------------------------------

/**
 * Build a complete data cache (simulating Phaser's JSON cache)
 * with one of each entity type plus all configs.
 * Override individual keys via the `overrides` parameter.
 */
export function createFullDataCache(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    cards: [createCardData()],
    enemies: [createEnemyData()],
    statusEffects: [createStatusEffectData()],
    relics: [createRelicData()],
    potions: [createPotionData()],
    characters: [createCharacterData()],
    events: [createEventData()],
    ascension: [createAscensionData()],
    mapConfig: createMapConfig(),
    rewardConfig: createRewardConfig(),
    shopConfig: createShopConfig(),
    uiConfig: createUIConfig(),
    ...overrides,
  };
}
