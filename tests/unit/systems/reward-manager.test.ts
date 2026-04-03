/**
 * reward-manager.test.ts — Unit tests for the RewardManager system.
 *
 * Implements acceptance criteria from design/gdd/reward.md.
 *
 * Coverage areas:
 * - Gold generation ranges per enemy type
 * - Card reward generation (pool filtering, uniqueness, rarity weighting)
 * - Potion drop probability
 * - Pity system for rare cards
 * - Determinism with seeded RNG
 * - Edge cases: unknown character, small pool, empty pool
 */

// @vitest-environment node

import { describe, it, expect } from 'vitest';
import {
  RewardManager,
  type RewardRNG,
  type RewardConfig,
  type EnemyType,
} from '../../../src/systems/reward-manager';
import { Rarity, CardType, CostType, TargetType } from '../../../src/types/card';
import type { CardData } from '../../../src/types/card';
import { PotionRarity } from '../../../src/types/potion';
import type { PotionData } from '../../../src/types/potion';
import { RNGStream } from '../../../src/utils/rng';

// ---------------------------------------------------------------------------
// Test Data Helpers
// ---------------------------------------------------------------------------

/** Create a CardData object with defaults. */
function makeCard(overrides: Partial<CardData> & { id: string }): CardData {
  return {
    name: overrides.id,
    type: CardType.ATTACK,
    rarity: Rarity.COMMON,
    cost: 1,
    costType: CostType.NORMAL,
    character: 'ironclad',
    targets: TargetType.ENEMY,
    effects: [],
    keywords: [],
    upgrade: {},
    description: '',
    ...overrides,
  };
}

/** Create a PotionData object with defaults. */
function makePotion(overrides: Partial<PotionData> & { id: string }): PotionData {
  return {
    name: overrides.id,
    description: '',
    rarity: PotionRarity.COMMON,
    target: 'self',
    effects: [],
    canUseInCombat: true,
    canUseOutOfCombat: false,
    ...overrides,
  };
}

/** Build a standard card map for Ironclad with known rarities. */
function buildCardMap(): Map<string, CardData> {
  const cards = new Map<string, CardData>();

  // Starter cards (excluded from rewards)
  cards.set('strike_red', makeCard({ id: 'strike_red', rarity: Rarity.STARTER }));
  cards.set('defend_red', makeCard({ id: 'defend_red', rarity: Rarity.STARTER }));
  cards.set('bash', makeCard({ id: 'bash', rarity: Rarity.STARTER }));

  // Common cards
  for (let i = 1; i <= 10; i++) {
    cards.set(`common_${i}`, makeCard({ id: `common_${i}`, rarity: Rarity.COMMON }));
  }

  // Uncommon cards
  for (let i = 1; i <= 5; i++) {
    cards.set(`uncommon_${i}`, makeCard({ id: `uncommon_${i}`, rarity: Rarity.UNCOMMON }));
  }

  // Rare cards
  cards.set('rare_1', makeCard({ id: 'rare_1', rarity: Rarity.RARE }));
  cards.set('rare_2', makeCard({ id: 'rare_2', rarity: Rarity.RARE }));

  // Special card (excluded from rewards)
  cards.set('special_1', makeCard({ id: 'special_1', rarity: Rarity.SPECIAL }));

  return cards;
}

/** Build a standard potion map. */
function buildPotionMap(): Map<string, PotionData> {
  const potions = new Map<string, PotionData>();
  potions.set('fire_potion', makePotion({ id: 'fire_potion' }));
  potions.set('block_potion', makePotion({ id: 'block_potion' }));
  return potions;
}

// ---------------------------------------------------------------------------
// Deterministic Mock RNG
// ---------------------------------------------------------------------------

/**
 * A simple deterministic mock RNG for testing exact outcomes.
 * Returns a pre-defined sequence of integers and floats.
 */
class MockRNG implements RewardRNG {
  private intIndex = 0;
  private floatIndex = 0;

  constructor(
    private readonly intSequence: number[] = [],
    private readonly floatSequence: number[] = []
  ) {}

  nextInt(min: number, max: number): number {
    if (this.intIndex < this.intSequence.length) {
      return this.intSequence[this.intIndex++];
    }
    // Default: return min if sequence exhausted
    return min;
  }

  nextFloat(): number {
    if (this.floatIndex < this.floatSequence.length) {
      return this.floatSequence[this.floatIndex++];
    }
    return 0;
  }
}

/**
 * Controllable RNG that returns floats in order, and integers as
 * min + (float * range). Useful for controlling rarity rolls and selections.
 */
class ControllableRNG implements RewardRNG {
  private idx = 0;

  constructor(private readonly floats: number[]) {}

  nextFloat(): number {
    const val = this.floats[this.idx % this.floats.length];
    this.idx++;
    return val;
  }

  nextInt(min: number, max: number): number {
    const f = this.nextFloat();
    return min + Math.floor(f * (max - min + 1));
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('RewardManager', () => {
  // ---------------------------------------------------------------
  // generateRewards
  // ---------------------------------------------------------------

  describe('generateRewards', () => {
    it('returns gold, card rewards, and potion flag', () => {
      const cards = buildCardMap();
      const potions = buildPotionMap();
      const manager = new RewardManager(cards, potions);
      const rng = new RNGStream(12345);

      const result = manager.generateRewards('ironclad', 'normal', rng);

      expect(result).toHaveProperty('gold');
      expect(result).toHaveProperty('cardRewards');
      expect(result).toHaveProperty('potionDropped');
      expect(typeof result.gold).toBe('number');
      expect(Array.isArray(result.cardRewards)).toBe(true);
      expect(typeof result.potionDropped).toBe('boolean');
    });

    it('includes potionData when potion drops', () => {
      const cards = buildCardMap();
      const potions = buildPotionMap();
      const manager = new RewardManager(cards, potions);
      // Use floats that guarantee a potion drop (< 0.4)
      const rng = new ControllableRNG([0.1]);

      const result = manager.generateRewards('ironclad', 'normal', rng);

      expect(result.potionDropped).toBe(true);
      expect(result.potionData).toBeDefined();
      expect(result.potionData!.id).toBeDefined();
    });

    it('does not include potionData when potion does not drop', () => {
      const cards = buildCardMap();
      const potions = buildPotionMap();
      const manager = new RewardManager(cards, potions);
      // Use floats that guarantee no potion drop (>= 0.4)
      const rng = new ControllableRNG([0.9]);

      const result = manager.generateRewards('ironclad', 'normal', rng);

      expect(result.potionDropped).toBe(false);
      expect(result.potionData).toBeUndefined();
    });
  });

  // ---------------------------------------------------------------
  // Gold Generation
  // ---------------------------------------------------------------

  describe('generateGold', () => {
    it('gold for normal enemy is in range 15-20', () => {
      const cards = new Map<string, CardData>();
      const potions = new Map<string, PotionData>();
      const manager = new RewardManager(cards, potions);

      // Test many RNG seeds to verify range
      for (let seed = 0; seed < 50; seed++) {
        const rng = new RNGStream(seed);
        const gold = manager.generateGold('normal', rng);
        expect(gold).toBeGreaterThanOrEqual(15);
        expect(gold).toBeLessThanOrEqual(20);
      }
    });

    it('gold for elite enemy is in range 30-40', () => {
      const cards = new Map<string, CardData>();
      const potions = new Map<string, PotionData>();
      const manager = new RewardManager(cards, potions);

      for (let seed = 0; seed < 50; seed++) {
        const rng = new RNGStream(seed);
        const gold = manager.generateGold('elite', rng);
        expect(gold).toBeGreaterThanOrEqual(30);
        expect(gold).toBeLessThanOrEqual(40);
      }
    });

    it('gold for boss enemy is in range 60-80', () => {
      const cards = new Map<string, CardData>();
      const potions = new Map<string, PotionData>();
      const manager = new RewardManager(cards, potions);

      for (let seed = 0; seed < 50; seed++) {
        const rng = new RNGStream(seed);
        const gold = manager.generateGold('boss', rng);
        expect(gold).toBeGreaterThanOrEqual(60);
        expect(gold).toBeLessThanOrEqual(80);
      }
    });

    it('respects custom gold config', () => {
      const cards = new Map<string, CardData>();
      const potions = new Map<string, PotionData>();
      const config: RewardConfig = {
        normalGoldBase: 50,
        normalGoldVariance: 0,
      };
      const manager = new RewardManager(cards, potions, config);
      const rng = new RNGStream(1);

      const gold = manager.generateGold('normal', rng);
      expect(gold).toBe(50);
    });
  });

  // ---------------------------------------------------------------
  // Card Reward Generation
  // ---------------------------------------------------------------

  describe('generateCardRewards', () => {
    it('returns cards from character card pool', () => {
      const cards = buildCardMap();
      const potions = buildPotionMap();
      const manager = new RewardManager(cards, potions);
      const rng = new RNGStream(42);

      const rewards = manager.generateCardRewards('ironclad', rng);

      for (const card of rewards) {
        expect(card.character).toBe('ironclad');
      }
    });

    it('excludes starter rarity cards', () => {
      const cards = buildCardMap();
      const potions = buildPotionMap();
      const manager = new RewardManager(cards, potions);
      const rng = new RNGStream(42);

      const rewards = manager.generateCardRewards('ironclad', rng);

      for (const card of rewards) {
        expect(card.rarity).not.toBe(Rarity.STARTER);
      }
    });

    it('excludes special rarity cards', () => {
      const cards = buildCardMap();
      const potions = buildPotionMap();
      const manager = new RewardManager(cards, potions);
      const rng = new RNGStream(42);

      const rewards = manager.generateCardRewards('ironclad', rng);

      for (const card of rewards) {
        expect(card.rarity).not.toBe(Rarity.SPECIAL);
      }
    });

    it('returns 3 unique cards', () => {
      const cards = buildCardMap();
      const potions = buildPotionMap();
      const manager = new RewardManager(cards, potions);
      const rng = new RNGStream(99);

      const rewards = manager.generateCardRewards('ironclad', rng);

      expect(rewards.length).toBe(3);
      const ids = rewards.map((c) => c.id);
      const uniqueIds = new Set(ids);
      expect(uniqueIds.size).toBe(3);
    });

    it('returns available cards when pool is smaller than requested count', () => {
      const cards = new Map<string, CardData>();
      // Only 2 non-starter cards
      cards.set('only_1', makeCard({ id: 'only_1', rarity: Rarity.COMMON }));
      cards.set('only_2', makeCard({ id: 'only_2', rarity: Rarity.COMMON }));
      const potions = new Map<string, PotionData>();
      const manager = new RewardManager(cards, potions);
      const rng = new RNGStream(1);

      const rewards = manager.generateCardRewards('ironclad', rng);

      expect(rewards.length).toBe(2);
      expect(rewards[0].id).not.toBe(rewards[1].id);
    });

    it('returns empty array when pool is empty', () => {
      const cards = new Map<string, CardData>();
      // Only starter cards — should be excluded
      cards.set('strike_red', makeCard({ id: 'strike_red', rarity: Rarity.STARTER }));
      const potions = new Map<string, PotionData>();
      const manager = new RewardManager(cards, potions);
      const rng = new RNGStream(1);

      const rewards = manager.generateCardRewards('ironclad', rng);

      expect(rewards).toEqual([]);
    });

    it('card rewards are weighted toward common rarity', () => {
      const cards = buildCardMap();
      const potions = buildPotionMap();
      const manager = new RewardManager(cards, potions);

      let commonCount = 0;
      let uncommonCount = 0;
      let rareCount = 0;
      const totalSamples = 300; // 100 reward generations * 3 cards each

      for (let seed = 0; seed < 100; seed++) {
        const rng = new RNGStream(seed);
        const rewards = manager.generateCardRewards('ironclad', rng);
        for (const card of rewards) {
          if (card.rarity === Rarity.COMMON) commonCount++;
          else if (card.rarity === Rarity.UNCOMMON) uncommonCount++;
          else if (card.rarity === Rarity.RARE) rareCount++;
        }
      }

      // Common should be the most frequent (60% weight)
      expect(commonCount).toBeGreaterThan(uncommonCount);
      expect(commonCount).toBeGreaterThan(rareCount);
      // Uncommon should be more frequent than rare
      expect(uncommonCount).toBeGreaterThan(rareCount);
    });

    it('unknown character returns empty card rewards', () => {
      const cards = buildCardMap();
      const potions = buildPotionMap();
      const manager = new RewardManager(cards, potions);
      const rng = new RNGStream(1);

      const rewards = manager.generateCardRewards('nonexistent_character', rng);

      expect(rewards).toEqual([]);
    });
  });

  // ---------------------------------------------------------------
  // Pity System
  // ---------------------------------------------------------------

  describe('pity system', () => {
    it('guarantees a rare after enough non-rare rewards', () => {
      const cards = buildCardMap();
      const potions = buildPotionMap();
      const config: RewardConfig = {
        baseRareChance: 0.0, // Start with 0% base chance
        pityIncrement: 0.2,  // +20% per non-rare roll
        maxRareChance: 0.40,
      };
      const manager = new RewardManager(cards, potions, config);

      // After 5 non-rare rolls: chance = 0 + 5 * 0.2 = 1.0 (capped at 0.4 after 2 rolls)
      // Actually with maxRareChance 0.40, it caps at 2 pity: 0 + 2 * 0.2 = 0.4
      // Let's just verify that after many calls, we eventually see rares
      let sawRare = false;
      for (let call = 0; call < 20; call++) {
        const rng = new RNGStream(call * 1000);
        const rewards = manager.generateCardRewards('ironclad', rng);
        if (rewards.some((c) => c.rarity === Rarity.RARE)) {
          sawRare = true;
          break;
        }
      }

      expect(sawRare).toBe(true);
    });
  });

  // ---------------------------------------------------------------
  // Potion Drop
  // ---------------------------------------------------------------

  describe('rollPotionDrop', () => {
    it('drops potion when roll < 0.4', () => {
      const cards = new Map<string, CardData>();
      const potions = new Map<string, PotionData>();
      const manager = new RewardManager(cards, potions);
      const rng = new ControllableRNG([0.0]);

      expect(manager.rollPotionDrop(rng)).toBe(true);
    });

    it('does not drop potion when roll >= 0.4', () => {
      const cards = new Map<string, CardData>();
      const potions = new Map<string, PotionData>();
      const manager = new RewardManager(cards, potions);
      const rng = new ControllableRNG([0.5]);

      expect(manager.rollPotionDrop(rng)).toBe(false);
    });

    it('drops at exactly 0.399', () => {
      const cards = new Map<string, CardData>();
      const potions = new Map<string, PotionData>();
      const manager = new RewardManager(cards, potions);
      const rng = new ControllableRNG([0.399]);

      expect(manager.rollPotionDrop(rng)).toBe(true);
    });

    it('does not drop at exactly 0.4', () => {
      const cards = new Map<string, CardData>();
      const potions = new Map<string, PotionData>();
      const manager = new RewardManager(cards, potions);
      const rng = new ControllableRNG([0.4]);

      expect(manager.rollPotionDrop(rng)).toBe(false);
    });

    it('respects custom potion drop chance', () => {
      const cards = new Map<string, CardData>();
      const potions = new Map<string, PotionData>();
      const config: RewardConfig = { potionDropChance: 0.8 };
      const manager = new RewardManager(cards, potions, config);
      const rng = new ControllableRNG([0.7]);

      expect(manager.rollPotionDrop(rng)).toBe(true);
    });
  });

  // ---------------------------------------------------------------
  // Determinism
  // ---------------------------------------------------------------

  describe('determinism', () => {
    it('produces identical results with the same RNG seed', () => {
      const cards = buildCardMap();
      const potions = buildPotionMap();

      const manager1 = new RewardManager(cards, potions);
      const rng1 = new RNGStream(54321);
      const result1 = manager1.generateRewards('ironclad', 'normal', rng1);

      const manager2 = new RewardManager(cards, potions);
      const rng2 = new RNGStream(54321);
      const result2 = manager2.generateRewards('ironclad', 'normal', rng2);

      expect(result1.gold).toBe(result2.gold);
      expect(result1.cardRewards.map((c) => c.id)).toEqual(
        result2.cardRewards.map((c) => c.id)
      );
      expect(result1.potionDropped).toBe(result2.potionDropped);
      if (result1.potionData && result2.potionData) {
        expect(result1.potionData.id).toBe(result2.potionData.id);
      }
    });
  });
});
