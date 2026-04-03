/**
 * main-menu-scene.test.ts — Unit tests for MainMenuScene's Map-building logic.
 *
 * Tests the Approach B integration: reading arrays from GameRegistryPlugin
 * and constructing Map<string, T> instances for CharacterManager.
 *
 * Coverage areas:
 * - buildCharacterManager creates CharacterManager from registry arrays
 * - Map construction from arrays preserves all entities
 * - Duplicate ID handling (last-write-wins per Map constructor)
 * - Empty registry arrays produce working (empty) CharacterManager
 * - Unknown character throws when trying to load
 * - Combat payload generation from built CharacterManager
 */

// @vitest-environment node

import { describe, it, expect } from 'vitest';
import { CharacterManager } from '../../../src/systems/character-manager';
import type { CharacterData } from '../../../src/types/character';
import type { CardData, CardEffect } from '../../../src/types/card';
import type { StatusEffectData } from '../../../src/types/status-effect';
import {
  CardType,
  Rarity,
  CostType,
  TargetType,
} from '../../../src/types/card';
import { DurationType, StackingMode } from '../../../src/types/status-effect';

// ---------------------------------------------------------------------------
// Test Fixtures
// ---------------------------------------------------------------------------

/** Create a minimal CardData for testing. */
function makeCardData(id: string, overrides?: Partial<CardData>): CardData {
  return {
    id,
    name: id,
    type: CardType.ATTACK,
    rarity: Rarity.STARTER,
    cost: 1,
    costType: CostType.NORMAL,
    character: 'ironclad',
    targets: TargetType.ENEMY,
    effects: [{ type: 'deal_damage', value: 6 }],
    keywords: [],
    upgrade: {},
    description: `Test card ${id}`,
    ...overrides,
  };
}

/** Create Ironclad's starter cards. */
function makeIroncladCards(): CardData[] {
  return [
    makeCardData('strike_red', {
      name: 'Strike',
      effects: [{ type: 'deal_damage', value: 6, upgradedValue: 9 }],
      description: 'Deal {damage} damage.',
    }),
    makeCardData('defend_red', {
      name: 'Defend',
      type: CardType.SKILL,
      targets: TargetType.SELF,
      effects: [{ type: 'gain_block', value: 5, upgradedValue: 8 }],
      description: 'Gain {block} Block.',
    }),
    makeCardData('bash', {
      name: 'Bash',
      cost: 2,
      effects: [
        { type: 'deal_damage', value: 8, upgradedValue: 10 },
        { type: 'apply_status', value: 2, upgradedValue: 3, status: 'vulnerable', duration: 2 },
      ],
      description: 'Deal {damage} damage. Apply {amount} Vulnerable.',
    }),
  ];
}

/** Create Ironclad CharacterData. */
function makeIroncladData(): CharacterData {
  return {
    id: 'ironclad',
    name: 'Ironclad',
    description: 'A battle-hardened warrior.',
    hp: 80,
    maxHp: 80,
    energy: 3,
    starterDeck: [
      'strike_red', 'strike_red', 'strike_red', 'strike_red', 'strike_red',
      'defend_red', 'defend_red', 'defend_red', 'defend_red',
      'bash',
    ],
    starterRelics: ['burning_blood'],
    cardPool: ['strike_red', 'defend_red', 'bash'],
    color: '#e74c3c',
    maxPotionSlots: 3,
  };
}

/** Create a Silent CharacterData. */
function makeSilentData(): CharacterData {
  return {
    id: 'silent',
    name: 'The Silent',
    description: 'A huntress of the spire.',
    hp: 70,
    maxHp: 70,
    energy: 3,
    starterDeck: [],
    starterRelics: ['ring_of_the_snake'],
    cardPool: [],
    color: '#2ecc71',
    maxPotionSlots: 3,
  };
}

/** Create minimal StatusEffectData. */
function makeStatusEffectData(id: string): StatusEffectData {
  return {
    id,
    name: id,
    description: `Test status ${id}`,
    category: 'buff',
    durationType: DurationType.COMBAT,
    stackingMode: StackingMode.ADD_STACKS,
  };
}

/**
 * Simulated GameRegistryPlugin interface.
 * Only implements the methods that buildCharacterManager uses:
 * getAllCharacters, getAllCards, getAllStatusEffects.
 */
interface MockRegistry {
  getAllCharacters(): CharacterData[];
  getAllCards(): CardData[];
  getAllStatusEffects(): StatusEffectData[];
}

/** Create a mock registry with Ironclad data. */
function createMockRegistry(overrides?: {
  characters?: CharacterData[];
  cards?: CardData[];
  statusEffects?: StatusEffectData[];
}): MockRegistry {
  return {
    getAllCharacters: () => overrides?.characters ?? [makeIroncladData()],
    getAllCards: () => overrides?.cards ?? makeIroncladCards(),
    getAllStatusEffects: () =>
      overrides?.statusEffects ?? [
        makeStatusEffectData('vulnerable'),
        makeStatusEffectData('strength'),
      ],
  };
}

/**
 * Replicate the buildCharacterManager logic from MainMenuScene.
 * This is the exact Approach B Map construction that runs in the scene.
 */
function buildCharacterManager(registry: MockRegistry): CharacterManager {
  const charsArray = registry.getAllCharacters();
  const cardsArray = registry.getAllCards();
  const statusEffects = registry.getAllStatusEffects();

  const charMap = new Map<string, CharacterData>(charsArray.map(c => [c.id, c]));
  const cardMap = new Map<string, CardData>(cardsArray.map(c => [c.id, c]));

  return new CharacterManager(charMap, cardMap, statusEffects);
}

// ===========================================================================
// Approach B: Map Construction from Registry Arrays
// ===========================================================================

describe('MainMenuScene Approach B — Map construction from registry arrays', () => {
  it('builds character Map with correct ID keys', () => {
    const registry = createMockRegistry();
    const charsArray = registry.getAllCharacters();
    const charMap = new Map(charsArray.map(c => [c.id, c]));

    expect(charMap.has('ironclad')).toBe(true);
    expect(charMap.get('ironclad')?.name).toBe('Ironclad');
  });

  it('builds card Map with correct ID keys', () => {
    const registry = createMockRegistry();
    const cardsArray = registry.getAllCards();
    const cardMap = new Map(cardsArray.map(c => [c.id, c]));

    expect(cardMap.has('strike_red')).toBe(true);
    expect(cardMap.has('defend_red')).toBe(true);
    expect(cardMap.has('bash')).toBe(true);
    expect(cardMap.size).toBe(3);
  });

  it('preserves all entities from array in the Map', () => {
    const registry = createMockRegistry({
      characters: [makeIroncladData(), makeSilentData()],
    });
    const charsArray = registry.getAllCharacters();
    const charMap = new Map(charsArray.map(c => [c.id, c]));

    expect(charMap.size).toBe(2);
    expect(charMap.has('ironclad')).toBe(true);
    expect(charMap.has('silent')).toBe(true);
  });

  it('handles empty arrays (empty Maps)', () => {
    const registry = createMockRegistry({
      characters: [],
      cards: [],
      statusEffects: [],
    });
    const charsArray = registry.getAllCharacters();
    const cardsArray = registry.getAllCards();
    const charMap = new Map(charsArray.map(c => [c.id, c]));
    const cardMap = new Map(cardsArray.map(c => [c.id, c]));

    expect(charMap.size).toBe(0);
    expect(cardMap.size).toBe(0);
  });

  it('last-write-wins for duplicate IDs in array', () => {
    const char1 = makeIroncladData();
    const char2: CharacterData = { ...makeIroncladData(), name: 'Ironclad Override' };
    const registry = createMockRegistry({
      characters: [char1, char2],
    });
    const charsArray = registry.getAllCharacters();
    const charMap = new Map(charsArray.map(c => [c.id, c]));

    // Same ID appears twice — Map constructor last-write-wins
    expect(charMap.size).toBe(1);
    expect(charMap.get('ironclad')?.name).toBe('Ironclad Override');
  });
});

// ===========================================================================
// buildCharacterManager Integration
// ===========================================================================

describe('MainMenuScene.buildCharacterManager', () => {
  it('creates CharacterManager from registry data', () => {
    const registry = createMockRegistry();
    const manager = buildCharacterManager(registry);

    expect(manager).toBeInstanceOf(CharacterManager);
  });

  it('CharacterManager can load ironclad from registry data', () => {
    const registry = createMockRegistry();
    const manager = buildCharacterManager(registry);
    const instance = manager.loadCharacter('ironclad');

    expect(instance.data.id).toBe('ironclad');
    expect(instance.currentHP).toBe(80);
    expect(instance.maxHP).toBe(80);
    expect(instance.deck).toHaveLength(10);
  });

  it('CharacterManager resolves starter deck cards from Map', () => {
    const registry = createMockRegistry();
    const manager = buildCharacterManager(registry);
    const instance = manager.loadCharacter('ironclad');

    const strikes = instance.deck.filter(c => c.data.id === 'strike_red');
    const defends = instance.deck.filter(c => c.data.id === 'defend_red');
    const bashes = instance.deck.filter(c => c.data.id === 'bash');

    expect(strikes).toHaveLength(5);
    expect(defends).toHaveLength(4);
    expect(bashes).toHaveLength(1);
  });

  it('CharacterManager throws for unknown character', () => {
    const registry = createMockRegistry();
    const manager = buildCharacterManager(registry);

    expect(() => manager.loadCharacter('nonexistent')).toThrow(
      'CharacterManager: Character "nonexistent" not found'
    );
  });

  it('CharacterManager creates combat payload from registry data', () => {
    const registry = createMockRegistry();
    const manager = buildCharacterManager(registry);
    const payload = manager.createCombatPayload('ironclad', 12345);

    expect(payload.playerHP).toBe(80);
    expect(payload.playerMaxHP).toBe(80);
    expect(payload.baseEnergy).toBe(3);
    expect(payload.seed).toBe(12345);
    expect(payload.deck).toHaveLength(10);
    expect(payload.cardData).toHaveLength(3); // strike_red, defend_red, bash
    expect(payload.statusEffectData).toHaveLength(2); // vulnerable, strength
    expect(payload.enemies).toHaveLength(1); // demo cultist
  });

  it('handles multi-character registry correctly', () => {
    // Build a registry with both Ironclad and Silent
    // Silent has no starter deck cards in this test, so only Ironclad is loadable
    const registry = createMockRegistry({
      characters: [makeIroncladData(), makeSilentData()],
    });
    const manager = buildCharacterManager(registry);

    // Ironclad loads fine
    const ironclad = manager.loadCharacter('ironclad');
    expect(ironclad.data.id).toBe('ironclad');

    // Silent is in the character map but has empty starter deck
    const silent = manager.loadCharacter('silent');
    expect(silent.data.id).toBe('silent');
    expect(silent.deck).toHaveLength(0);
  });

  it('preserves status effect definitions through to combat payload', () => {
    const statusEffects = [
      makeStatusEffectData('vulnerable'),
      makeStatusEffectData('strength'),
      makeStatusEffectData('poison'),
    ];
    const registry = createMockRegistry({ statusEffects });
    const manager = buildCharacterManager(registry);
    const payload = manager.createCombatPayload('ironclad', 42);

    expect(payload.statusEffectData).toHaveLength(3);
    const ids = payload.statusEffectData.map(e => e.id).sort();
    expect(ids).toEqual(['poison', 'strength', 'vulnerable']);
  });
});
