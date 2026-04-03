/**
 * character-manager.test.ts — Unit tests for CharacterManager.
 *
 * Implements acceptance criteria for S3-01 (CharacterManager).
 *
 * Coverage areas:
 * - loadCharacter: correct HP, deck composition, unique instanceIds
 * - Deck composition: 5 Strike + 4 Defend + 1 Bash for Ironclad
 * - Each deck card has correct CardData resolved
 * - Unknown character throws descriptive error
 * - createCombatPayload returns valid CombatSceneData
 * - gold starts at 0, potionSlots defaults to 3
 * - InstanceId format: {characterId}_{cardId}_{index}
 */

// @vitest-environment node

import { describe, it, expect } from 'vitest';
import { CharacterManager } from '../../../src/systems/character-manager';
import type { CharacterData } from '../../../src/types/character';
import type { CardData } from '../../../src/types/card';
import type { StatusEffectData } from '../../../src/types/status-effect';
import { CardType, Rarity, CostType, TargetType } from '../../../src/types/card';
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

/** Create Ironclad's actual starter cards from cards.json. */
function makeIroncladCards(): Map<string, CardData> {
  const map = new Map<string, CardData>();

  map.set('strike_red', makeCardData('strike_red', {
    name: 'Strike',
    effects: [{ type: 'deal_damage', value: 6, upgradedValue: 9 }],
    description: 'Deal {damage} damage.',
  }));

  map.set('defend_red', makeCardData('defend_red', {
    name: 'Defend',
    type: CardType.SKILL,
    targets: TargetType.SELF,
    effects: [{ type: 'gain_block', value: 5, upgradedValue: 8 }],
    description: 'Gain {block} Block.',
  }));

  map.set('bash', makeCardData('bash', {
    name: 'Bash',
    cost: 2,
    effects: [
      { type: 'deal_damage', value: 8, upgradedValue: 10 },
      { type: 'apply_status', value: 2, upgradedValue: 3, status: 'vulnerable', duration: 2 },
    ],
    description: 'Deal {damage} damage. Apply {amount} Vulnerable.',
  }));

  return map;
}

/** Create Ironclad CharacterData matching characters.json. */
function makeIroncladData(): CharacterData {
  return {
    id: 'ironclad',
    name: 'Ironclad',
    description: 'A battle-hardened warrior who relies on strength and resilience.',
    hp: 80,
    maxHp: 80,
    energy: 3,
    starterDeck: [
      'strike_red',
      'strike_red',
      'strike_red',
      'strike_red',
      'strike_red',
      'defend_red',
      'defend_red',
      'defend_red',
      'defend_red',
      'bash',
    ],
    starterRelics: ['burning_blood'],
    cardPool: ['strike_red', 'defend_red', 'bash'],
    color: '#e74c3c',
    maxPotionSlots: 3,
  };
}

/** Create minimal StatusEffectData for testing. */
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

/** Create a CharacterManager with Ironclad data pre-loaded. */
function createManager(): CharacterManager {
  const characters = new Map<string, CharacterData>();
  characters.set('ironclad', makeIroncladData());

  const cards = makeIroncladCards();
  const statusEffects = [
    makeStatusEffectData('vulnerable'),
    makeStatusEffectData('strength'),
  ];

  return new CharacterManager(characters, cards, statusEffects);
}

// ===========================================================================
// loadCharacter
// ===========================================================================

describe('CharacterManager.loadCharacter', () => {
  it('loads ironclad with correct HP (80/80)', () => {
    const manager = createManager();
    const instance = manager.loadCharacter('ironclad');

    expect(instance.currentHP).toBe(80);
    expect(instance.maxHP).toBe(80);
  });

  it('loads ironclad with 10 cards in deck', () => {
    const manager = createManager();
    const instance = manager.loadCharacter('ironclad');

    expect(instance.deck).toHaveLength(10);
  });

  it('has correct deck composition: 5 Strike + 4 Defend + 1 Bash', () => {
    const manager = createManager();
    const instance = manager.loadCharacter('ironclad');

    const strikes = instance.deck.filter((c) => c.data.id === 'strike_red');
    const defends = instance.deck.filter((c) => c.data.id === 'defend_red');
    const bashes = instance.deck.filter((c) => c.data.id === 'bash');

    expect(strikes).toHaveLength(5);
    expect(defends).toHaveLength(4);
    expect(bashes).toHaveLength(1);
  });

  it('each deck card has a unique instanceId starting with "ironclad_"', () => {
    const manager = createManager();
    const instance = manager.loadCharacter('ironclad');

    const instanceIds = instance.deck.map((c) => c.instanceId);

    // All instanceIds start with "ironclad_"
    for (const id of instanceIds) {
      expect(id).toMatch(/^ironclad_/);
    }

    // All instanceIds are unique
    const uniqueIds = new Set(instanceIds);
    expect(uniqueIds.size).toBe(instanceIds.length);
  });

  it('instanceIds follow {characterId}_{cardId}_{index} format', () => {
    const manager = createManager();
    const instance = manager.loadCharacter('ironclad');

    const strikes = instance.deck.filter((c) => c.data.id === 'strike_red');
    const strikeIds = strikes.map((c) => c.instanceId).sort();

    // Should be: ironclad_strike_red_0 through ironclad_strike_red_4
    expect(strikeIds).toEqual([
      'ironclad_strike_red_0',
      'ironclad_strike_red_1',
      'ironclad_strike_red_2',
      'ironclad_strike_red_3',
      'ironclad_strike_red_4',
    ]);

    const defends = instance.deck.filter((c) => c.data.id === 'defend_red');
    const defendIds = defends.map((c) => c.instanceId).sort();

    expect(defendIds).toEqual([
      'ironclad_defend_red_0',
      'ironclad_defend_red_1',
      'ironclad_defend_red_2',
      'ironclad_defend_red_3',
    ]);

    const bashes = instance.deck.filter((c) => c.data.id === 'bash');
    expect(bashes[0].instanceId).toBe('ironclad_bash_0');
  });

  it('each deck card has correct CardData resolved', () => {
    const manager = createManager();
    const instance = manager.loadCharacter('ironclad');

    for (const card of instance.deck) {
      expect(card.data).toBeDefined();
      expect(card.data.id).toBeTruthy();
      expect(card.data.effects).toBeDefined();
      expect(card.data.effects.length).toBeGreaterThan(0);
    }
  });

  it('each deck card starts with correct default combat state', () => {
    const manager = createManager();
    const instance = manager.loadCharacter('ironclad');

    for (const card of instance.deck) {
      expect(card.upgraded).toBe(false);
      expect(card.costOverride).toBeNull();
      expect(card.timesPlayedThisCombat).toBe(0);
      expect(card.retained).toBe(false);
    }
  });

  it('throws descriptive error for unknown character', () => {
    const manager = createManager();

    expect(() => manager.loadCharacter('nonexistent')).toThrow(
      'CharacterManager: Character "nonexistent" not found',
    );
  });

  it('gold starts at 0', () => {
    const manager = createManager();
    const instance = manager.loadCharacter('ironclad');

    expect(instance.gold).toBe(0);
  });

  it('potionSlots is 3 when specified in character data', () => {
    const manager = createManager();
    const instance = manager.loadCharacter('ironclad');

    expect(instance.potionSlots).toBe(3);
  });

  it('potionSlots defaults to 3 when not specified in character data', () => {
    const characters = new Map<string, CharacterData>();
    const charData = makeIroncladData();
    // Remove maxPotionSlots to test fallback
    const { maxPotionSlots: _, ...charWithoutSlots } = charData;
    characters.set('ironclad', charWithoutSlots as CharacterData);

    const manager = new CharacterManager(characters, makeIroncladCards(), []);
    const instance = manager.loadCharacter('ironclad');

    expect(instance.potionSlots).toBe(3);
  });

  it('stores the full CharacterData reference in data field', () => {
    const manager = createManager();
    const instance = manager.loadCharacter('ironclad');

    expect(instance.data.id).toBe('ironclad');
    expect(instance.data.name).toBe('Ironclad');
    expect(instance.data.energy).toBe(3);
    expect(instance.data.starterDeck).toHaveLength(10);
  });
});

// ===========================================================================
// createCombatPayload
// ===========================================================================

describe('CharacterManager.createCombatPayload', () => {
  it('returns valid CombatSceneData with all required fields', () => {
    const manager = createManager();
    const payload = manager.createCombatPayload('ironclad', 42);

    expect(payload.playerHP).toBe(80);
    expect(payload.playerMaxHP).toBe(80);
    expect(payload.baseEnergy).toBe(3);
    expect(payload.seed).toBe(42);
    expect(payload.deck).toHaveLength(10);
    expect(payload.cardData).toBeDefined();
    expect(payload.statusEffectData).toBeDefined();
  });

  it('deck entries have { instanceId, cardId, upgraded } format', () => {
    const manager = createManager();
    const payload = manager.createCombatPayload('ironclad', 42);

    for (const entry of payload.deck) {
      expect(entry).toHaveProperty('instanceId');
      expect(entry).toHaveProperty('cardId');
      expect(entry).toHaveProperty('upgraded');
      expect(typeof entry.instanceId).toBe('string');
      expect(typeof entry.cardId).toBe('string');
      expect(typeof entry.upgraded).toBe('boolean');
    }
  });

  it('cardData contains all unique card definitions from deck', () => {
    const manager = createManager();
    const payload = manager.createCombatPayload('ironclad', 42);

    const cardIds = payload.cardData.map((c) => c.id).sort();
    // Ironclad starter deck has 3 unique card types: bash, defend_red, strike_red
    expect(cardIds).toEqual(['bash', 'defend_red', 'strike_red']);
  });

  it('includes statusEffectData from constructor', () => {
    const manager = createManager();
    const payload = manager.createCombatPayload('ironclad', 42);

    expect(payload.statusEffectData).toHaveLength(2);
    expect(payload.statusEffectData[0].id).toBe('vulnerable');
    expect(payload.statusEffectData[1].id).toBe('strength');
  });

  it('includes demo Cultist enemy encounter', () => {
    const manager = createManager();
    const payload = manager.createCombatPayload('ironclad', 42);

    expect(payload.enemies).toBeDefined();
    expect(payload.enemies).toHaveLength(1);
    expect(payload.enemies![0].id).toBe('cultist');
    expect(payload.enemies![0].name).toBe('Cultist');
    expect(payload.enemies![0].hp).toBe(50);
  });

  it('uses character energy as baseEnergy', () => {
    const characters = new Map<string, CharacterData>();
    characters.set('test_char', {
      ...makeIroncladData(),
      id: 'test_char',
      energy: 4,
    });

    const manager = new CharacterManager(characters, makeIroncladCards(), []);
    const payload = manager.createCombatPayload('test_char', 99);

    expect(payload.baseEnergy).toBe(4);
  });

  it('throws descriptive error for unknown character', () => {
    const manager = createManager();

    expect(() => manager.createCombatPayload('nonexistent', 42)).toThrow(
      'CharacterManager: Character "nonexistent" not found',
    );
  });

  it('throws descriptive error when starter deck card is missing', () => {
    const characters = new Map<string, CharacterData>();
    characters.set('broken_char', {
      ...makeIroncladData(),
      id: 'broken_char',
      starterDeck: ['strike_red', 'nonexistent_card'],
    });

    const cards = makeIroncladCards();
    // Only has strike_red, not nonexistent_card
    const manager = new CharacterManager(characters, cards, []);

    expect(() => manager.createCombatPayload('broken_char', 42)).toThrow(
      'CharacterManager: Card "nonexistent_card" not found',
    );
  });
});
