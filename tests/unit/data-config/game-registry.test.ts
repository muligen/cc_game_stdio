/**
 * game-registry.test.ts — Acceptance criteria tests for GameRegistryPlugin.
 *
 * Implements: design/gdd/data-config.md (8 acceptance criteria)
 * Covers: loading, query correctness, filtering, validation,
 *         duplicate IDs, empty data, missing data files, no hardcoded values.
 *
 * @vitest-environment node
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock Phaser BEFORE any imports that depend on it
vi.mock('phaser', () => ({
  default: {
    Plugins: {
      BasePlugin: class {
        constructor(_pm: any) {}
      },
    },
  },
}));

// Capture all Logger warn/info/error calls in a module-level store.
// This lets us assert on log output without spying on console methods.
const logStore = {
  warns: [] as string[],
  infos: [] as string[],
  errors: [] as string[],
};

vi.mock('../../../src/utils/logger', () => ({
  Logger: class {
    info = vi.fn((msg: string) => { logStore.infos.push(msg); });
    warn = vi.fn((msg: string) => { logStore.warns.push(msg); });
    error = vi.fn((msg: string) => { logStore.errors.push(msg); });
    debug = vi.fn();
    setLevel = vi.fn();
    child = vi.fn();
  },
}));

import { GameRegistryPlugin, RegistryState } from '../../../src/plugins/game-registry-plugin';
import {
  createCardData,
  createEnemyData,
  createStatusEffectData,
  createRelicData,
  createPotionData,
  createCharacterData,
  createMapConfig,
  createRewardConfig,
  createShopConfig,
  createUIConfig,
  createEventData,
  createAscensionData,
  createFullDataCache,
} from './test-data';
import { CardType, Rarity, RelicTier } from '../../../src/types';

/** Clear the log capture store. Call before each test that inspects logs. */
function clearLogs(): void {
  logStore.warns.length = 0;
  logStore.infos.length = 0;
  logStore.errors.length = 0;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Create a mock Phaser.Scene whose cache returns the provided data. */
function createMockScene(dataCache: Record<string, unknown>) {
  return {
    cache: {
      json: {
        get: (key: string) => dataCache[key],
      },
    },
  } as unknown as Phaser.Scene;
}

/** Create a fresh GameRegistryPlugin instance. */
function createRegistry(): GameRegistryPlugin {
  return new GameRegistryPlugin({} as any);
}

// ===========================================================================
// AC1: Loading (6 tests)
// ===========================================================================
describe('AC1: Loading', () => {
  it('install() with all 12 data types sets state to READY', () => {
    const registry = createRegistry();
    const cache = createFullDataCache();
    registry.install(createMockScene(cache));
    expect(registry.getState()).toBe(RegistryState.READY);
  });

  it('install() with empty cache sets state to READY (all warnings logged)', () => {
    const registry = createRegistry();
    registry.install(createMockScene({}));
    expect(registry.getState()).toBe(RegistryState.READY);
  });

  it('install() with partial data sets state to READY', () => {
    const registry = createRegistry();
    registry.install(createMockScene({ cards: [createCardData()] }));
    expect(registry.getState()).toBe(RegistryState.READY);
  });

  it('install() calls succeed without throwing', () => {
    const registry = createRegistry();
    expect(() => registry.install(createMockScene({}))).not.toThrow();
  });

  it('isReady() returns true after successful install', () => {
    const registry = createRegistry();
    registry.install(createMockScene(createFullDataCache()));
    expect(registry.isReady()).toBe(true);
  });

  it('getState() returns READY after successful install', () => {
    const registry = createRegistry();
    registry.install(createMockScene(createFullDataCache()));
    expect(registry.getState()).toBe(RegistryState.READY);
  });
});

// ===========================================================================
// AC2: Query correctness (10 tests)
// ===========================================================================
describe('AC2: Query correctness', () => {
  it('getCard returns correct CardData by id', () => {
    const card = createCardData({ id: 'strike_red', name: 'Strike' });
    const registry = createRegistry();
    registry.install(createMockScene({ cards: [card] }));
    const result = registry.getCard('strike_red');
    expect(result).toBeDefined();
    expect(result!.id).toBe('strike_red');
    expect(result!.name).toBe('Strike');
  });

  it('getEnemy returns correct EnemyData by id', () => {
    const enemy = createEnemyData({ id: 'enemy_jaw_worm', name: 'Jaw Worm' });
    const registry = createRegistry();
    registry.install(createMockScene({ enemies: [enemy] }));
    const result = registry.getEnemy('enemy_jaw_worm');
    expect(result).toBeDefined();
    expect(result!.id).toBe('enemy_jaw_worm');
    expect(result!.name).toBe('Jaw Worm');
  });

  it('getRelic returns correct RelicData by id', () => {
    const relic = createRelicData({ id: 'burning_blood', name: 'Burning Blood' });
    const registry = createRegistry();
    registry.install(createMockScene({ relics: [relic] }));
    const result = registry.getRelic('burning_blood');
    expect(result).toBeDefined();
    expect(result!.id).toBe('burning_blood');
    expect(result!.name).toBe('Burning Blood');
  });

  it('getPotion returns correct PotionData by id', () => {
    const potion = createPotionData({ id: 'fire_potion', name: 'Fire Potion' });
    const registry = createRegistry();
    registry.install(createMockScene({ potions: [potion] }));
    const result = registry.getPotion('fire_potion');
    expect(result).toBeDefined();
    expect(result!.id).toBe('fire_potion');
    expect(result!.name).toBe('Fire Potion');
  });

  it('getCharacter returns correct CharacterData by id', () => {
    const char = createCharacterData({ id: 'ironclad', name: 'Ironclad' });
    const registry = createRegistry();
    registry.install(createMockScene({ characters: [char] }));
    const result = registry.getCharacter('ironclad');
    expect(result).toBeDefined();
    expect(result!.id).toBe('ironclad');
    expect(result!.name).toBe('Ironclad');
  });

  it('getStatusEffect returns correct StatusEffectData by id', () => {
    const effect = createStatusEffectData({ id: 'vulnerable', name: 'Vulnerable' });
    const registry = createRegistry();
    registry.install(createMockScene({ statusEffects: [effect] }));
    const result = registry.getStatusEffect('vulnerable');
    expect(result).toBeDefined();
    expect(result!.id).toBe('vulnerable');
    expect(result!.name).toBe('Vulnerable');
  });

  it('getMapConfig returns loaded MapConfig', () => {
    const config = createMapConfig({ floorsPerAct: 15 });
    const registry = createRegistry();
    registry.install(createMockScene({ mapConfig: config }));
    const result = registry.getMapConfig();
    expect(result).toBeDefined();
    expect(result!.floorsPerAct).toBe(15);
  });

  it('getRewardConfig returns loaded RewardConfig', () => {
    const config = createRewardConfig({ baseRareChance: 0.12 });
    const registry = createRegistry();
    registry.install(createMockScene({ rewardConfig: config }));
    const result = registry.getRewardConfig();
    expect(result).toBeDefined();
    expect(result!.baseRareChance).toBe(0.12);
  });

  it('getShopConfig returns loaded ShopConfig', () => {
    const config = createShopConfig({ commonCardCost: 50 });
    const registry = createRegistry();
    registry.install(createMockScene({ shopConfig: config }));
    const result = registry.getShopConfig();
    expect(result).toBeDefined();
    expect(result!.commonCardCost).toBe(50);
  });

  it('getUIConfig returns loaded UIConfig', () => {
    const config = createUIConfig({ cardWidth: 120 });
    const registry = createRegistry();
    registry.install(createMockScene({ uiConfig: config }));
    const result = registry.getUIConfig();
    expect(result).toBeDefined();
    expect(result!.cardWidth).toBe(120);
  });
});

// ===========================================================================
// AC3: Filtering (6 tests)
// ===========================================================================
describe('AC3: Filtering', () => {
  it('getCardsByCharacter returns character-specific + null-character cards', () => {
    const cardA = createCardData({ id: 'strike_red', character: 'ironclad' });
    const cardB = createCardData({ id: 'universal_block', character: null });
    const cardC = createCardData({ id: 'quick_strike', character: 'silent' });
    const registry = createRegistry();
    registry.install(createMockScene({ cards: [cardA, cardB, cardC] }));
    const result = registry.getCardsByCharacter('ironclad');
    const ids = result.map((c) => c.id);
    expect(ids).toContain('strike_red');
    expect(ids).toContain('universal_block');
    expect(ids).not.toContain('quick_strike');
    expect(result).toHaveLength(2);
  });

  it('getCardsByCharacter excludes other character cards', () => {
    const cardA = createCardData({ id: 'silent_card', character: 'silent' });
    const cardB = createCardData({ id: 'ironclad_card', character: 'ironclad' });
    const registry = createRegistry();
    registry.install(createMockScene({ cards: [cardA, cardB] }));
    const result = registry.getCardsByCharacter('ironclad');
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('ironclad_card');
  });

  it('getCardsByRarity returns only matching rarity', () => {
    const common = createCardData({ id: 'c1', rarity: Rarity.COMMON });
    const uncommon = createCardData({ id: 'u1', rarity: Rarity.UNCOMMON });
    const rare = createCardData({ id: 'r1', rarity: Rarity.RARE });
    const registry = createRegistry();
    registry.install(createMockScene({ cards: [common, uncommon, rare] }));
    const result = registry.getCardsByRarity(Rarity.COMMON);
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('c1');
  });

  it('getEnemiesByAct filters by act number', () => {
    const e1 = createEnemyData({ id: 'e_act1', act: 1 });
    const e2 = createEnemyData({ id: 'e_act2', act: 2 });
    const registry = createRegistry();
    registry.install(createMockScene({ enemies: [e1, e2] }));
    const result = registry.getEnemiesByAct(1);
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('e_act1');
  });

  it('getBossesByAct returns only bosses in that act', () => {
    const boss1 = createEnemyData({ id: 'boss_act1', type: 'boss', act: 1 });
    const normal1 = createEnemyData({ id: 'norm_act1', type: 'normal', act: 1 });
    const boss2 = createEnemyData({ id: 'boss_act2', type: 'boss', act: 2 });
    const registry = createRegistry();
    registry.install(createMockScene({ enemies: [boss1, normal1, boss2] }));
    const result = registry.getBossesByAct(1);
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('boss_act1');
  });

  it('getRelicsByTier filters by tier', () => {
    const starter = createRelicData({ id: 'r_starter', tier: RelicTier.STARTER });
    const common = createRelicData({ id: 'r_common', tier: RelicTier.COMMON });
    const boss = createRelicData({ id: 'r_boss', tier: RelicTier.BOSS });
    const registry = createRegistry();
    registry.install(createMockScene({ relics: [starter, common, boss] }));
    const result = registry.getRelicsByTier(RelicTier.BOSS);
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('r_boss');
  });
});

// ===========================================================================
// AC4: Validation (4 tests)
// ===========================================================================
describe('AC4: Validation', () => {
  it('Card missing id triggers warning with "missing required field: id"', () => {
    clearLogs();
    const registry = createRegistry();
    const badCard = { name: 'NoId', type: CardType.ATTACK } as any;
    registry.install(createMockScene({ cards: [badCard] }));
    expect(logStore.warns.some((w) => w.includes('missing required field: id'))).toBe(true);
  });

  it('Enemy missing id triggers warning and entity is skipped', () => {
    clearLogs();
    const registry = createRegistry();
    const badEnemy = { name: 'NoId', type: 'normal', hp: 40 } as any;
    registry.install(createMockScene({ enemies: [badEnemy] }));
    expect(logStore.warns.some((w) => w.includes('missing required field: id'))).toBe(true);
    expect(registry.getEnemy('NoId')).toBeUndefined();
  });

  it('Relic missing id triggers warning and entity is skipped', () => {
    clearLogs();
    const registry = createRegistry();
    const badRelic = { name: 'NoId', tier: RelicTier.COMMON } as any;
    registry.install(createMockScene({ relics: [badRelic] }));
    expect(logStore.warns.some((w) => w.includes('missing required field: id'))).toBe(true);
    expect(registry.getRelic('NoId')).toBeUndefined();
  });

  it('Multiple entities with one bad — only good ones loaded', () => {
    clearLogs();
    const registry = createRegistry();
    const good = createCardData({ id: 'good_card' });
    const bad = { name: 'NoId' } as any;
    registry.install(createMockScene({ cards: [good, bad] }));
    expect(logStore.warns.some((w) => w.includes('missing required field: id'))).toBe(true);
    expect(registry.getCard('good_card')).toBeDefined();
    expect(registry.getAllCards()).toHaveLength(1);
  });
});

// ===========================================================================
// AC5: Duplicate IDs (3 tests)
// ===========================================================================
describe('AC5: Duplicate IDs', () => {
  it('Duplicate card ID triggers warning containing "Duplicate"', () => {
    clearLogs();
    const registry = createRegistry();
    const card1 = createCardData({ id: 'dupe_card', name: 'First' });
    const card2 = createCardData({ id: 'dupe_card', name: 'Second' });
    registry.install(createMockScene({ cards: [card1, card2] }));
    expect(logStore.warns.some((w) => w.includes('Duplicate'))).toBe(true);
  });

  it('Second entry overwrites first for duplicate card IDs', () => {
    clearLogs();
    const registry = createRegistry();
    const card1 = createCardData({ id: 'dupe_card', name: 'First' });
    const card2 = createCardData({ id: 'dupe_card', name: 'Second' });
    registry.install(createMockScene({ cards: [card1, card2] }));
    const result = registry.getCard('dupe_card');
    expect(result).toBeDefined();
    expect(result!.name).toBe('Second');
    expect(registry.getAllCards()).toHaveLength(1);
  });

  it('Duplicate relic ID handled correctly — second overwrites', () => {
    clearLogs();
    const registry = createRegistry();
    const r1 = createRelicData({ id: 'dupe_relic', name: 'First Relic' });
    const r2 = createRelicData({ id: 'dupe_relic', name: 'Second Relic' });
    registry.install(createMockScene({ relics: [r1, r2] }));
    const result = registry.getRelic('dupe_relic');
    expect(result).toBeDefined();
    expect(result!.name).toBe('Second Relic');
    expect(registry.getAllRelics()).toHaveLength(1);
  });
});

// ===========================================================================
// AC6: Empty data (3 tests)
// ===========================================================================
describe('AC6: Empty data', () => {
  it('Empty array for cards — zero cards, no validation warnings', () => {
    clearLogs();
    const registry = createRegistry();
    registry.install(createMockScene({ cards: [] }));
    expect(registry.getAllCards()).toHaveLength(0);
    // No validation warnings for empty arrays
    const validationWarns = logStore.warns.filter((w) => w.includes('missing required field'));
    expect(validationWarns).toHaveLength(0);
  });

  it('Empty array for enemies — zero enemies', () => {
    const registry = createRegistry();
    registry.install(createMockScene({ enemies: [] }));
    expect(registry.getAllEnemies()).toHaveLength(0);
  });

  it('All empty arrays — state READY, all queries return empty', () => {
    const registry = createRegistry();
    registry.install(
      createMockScene({
        cards: [],
        enemies: [],
        statusEffects: [],
        relics: [],
        potions: [],
        characters: [],
        events: [],
        ascension: [],
      }),
    );
    expect(registry.getState()).toBe(RegistryState.READY);
    expect(registry.getAllCards()).toHaveLength(0);
    expect(registry.getAllEnemies()).toHaveLength(0);
    expect(registry.getAllRelics()).toHaveLength(0);
    expect(registry.getAllPotions()).toHaveLength(0);
    expect(registry.getAllCharacters()).toHaveLength(0);
    expect(registry.getAllStatusEffects()).toHaveLength(0);
  });
});

// ===========================================================================
// AC7: Missing data files (4 tests)
// ===========================================================================
describe('AC7: Missing data files', () => {
  it('Missing cards cache key triggers warning, registry continues', () => {
    clearLogs();
    const registry = createRegistry();
    registry.install(createMockScene({}));
    expect(logStore.warns.some((w) => w.includes('cards.json not found in cache'))).toBe(true);
    expect(registry.getState()).toBe(RegistryState.READY);
  });

  it('Missing all entity data — state READY, queries return empty/null', () => {
    clearLogs();
    const registry = createRegistry();
    registry.install(createMockScene({}));
    expect(registry.getState()).toBe(RegistryState.READY);
    expect(registry.getCard('anything')).toBeUndefined();
    expect(registry.getEnemy('anything')).toBeUndefined();
    expect(registry.getRelic('anything')).toBeUndefined();
    expect(registry.getPotion('anything')).toBeUndefined();
    expect(registry.getCharacter('anything')).toBeUndefined();
    expect(registry.getStatusEffect('anything')).toBeUndefined();
  });

  it('Missing config data — config getters return null', () => {
    clearLogs();
    const registry = createRegistry();
    registry.install(createMockScene({}));
    expect(registry.getMapConfig()).toBeNull();
    expect(registry.getRewardConfig()).toBeNull();
    expect(registry.getShopConfig()).toBeNull();
    expect(registry.getUIConfig()).toBeNull();
  });

  it('Mix of present and missing — present data loads, missing logged', () => {
    clearLogs();
    const registry = createRegistry();
    const card = createCardData({ id: 'present_card' });
    // Only cards provided; everything else missing
    registry.install(createMockScene({ cards: [card] }));
    expect(registry.getCard('present_card')).toBeDefined();
    // Enemies should be missing
    expect(registry.getEnemy('anything')).toBeUndefined();
    // Should have logged about missing enemies
    expect(logStore.warns.some((w) => w.includes('enemies.json not found in cache'))).toBe(true);
  });
});

// ===========================================================================
// AC8: No hardcoded values (4 tests)
// ===========================================================================
describe('AC8: No hardcoded values', () => {
  it('getCard with non-existent ID returns undefined (not throwing)', () => {
    const registry = createRegistry();
    registry.install(createMockScene(createFullDataCache()));
    expect(() => registry.getCard('nonexistent_card')).not.toThrow();
    expect(registry.getCard('nonexistent_card')).toBeUndefined();
  });

  it('getEnemy with non-existent ID returns undefined', () => {
    const registry = createRegistry();
    registry.install(createMockScene(createFullDataCache()));
    expect(registry.getEnemy('nonexistent_enemy')).toBeUndefined();
  });

  it('getRelic with non-existent ID returns undefined', () => {
    const registry = createRegistry();
    registry.install(createMockScene(createFullDataCache()));
    expect(registry.getRelic('nonexistent_relic')).toBeUndefined();
  });

  it('getAllCards returns array with correct count matching loaded data', () => {
    const registry = createRegistry();
    const c1 = createCardData({ id: 'card_a' });
    const c2 = createCardData({ id: 'card_b' });
    const c3 = createCardData({ id: 'card_c' });
    registry.install(createMockScene({ cards: [c1, c2, c3] }));
    const allCards = registry.getAllCards();
    expect(allCards).toHaveLength(3);
    const ids = allCards.map((c) => c.id).sort();
    expect(ids).toEqual(['card_a', 'card_b', 'card_c']);
  });
});
