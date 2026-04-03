/**
 * reward-manager.ts — Generates post-combat rewards: gold, card selection, potion drop.
 *
 * Implements: design/gdd/reward.md (Reward Types, Gold Generation, Card Reward
 * Generation, Rarity Roll with Pity, Potion Drop)
 *
 * Core rules:
 * - Gold: base + random variance, depends on enemy type (normal/elite/boss)
 * - Card rewards: 3 unique cards from character pool, rarity-weighted with pity
 * - Potion: 40% drop chance, random potion from pool
 *
 * All numeric values come from RewardConfig with sensible defaults matching the GDD.
 * The pity counter persists across calls within a run (instance state).
 */

import { Rarity } from '../types/card';
import type { CardData } from '../types/card';
import type { PotionData } from '../types/potion';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Result of generating rewards for a combat victory. */
export interface RewardResult {
  /** Gold awarded. */
  gold: number;
  /** Card rewards: up to 3 cards to pick from (or skip all). */
  cardRewards: CardData[];
  /** Whether a potion dropped. */
  potionDropped: boolean;
  /** Potion data if one dropped. */
  potionData?: PotionData;
}

/** Configurable values for reward generation. Per Reward GDD Tuning Knobs. */
export interface RewardConfig {
  normalGoldBase?: number;
  normalGoldVariance?: number;
  eliteGoldBase?: number;
  eliteGoldVariance?: number;
  bossGoldBase?: number;
  bossGoldVariance?: number;
  potionDropChance?: number;
  cardRewardCount?: number;
  baseRareChance?: number;
  pityIncrement?: number;
  maxRareChance?: number;
}

/** Required form of RewardConfig — all values filled with defaults. */
interface RequiredRewardConfig {
  normalGoldBase: number;
  normalGoldVariance: number;
  eliteGoldBase: number;
  eliteGoldVariance: number;
  bossGoldBase: number;
  bossGoldVariance: number;
  potionDropChance: number;
  cardRewardCount: number;
  baseRareChance: number;
  pityIncrement: number;
  maxRareChance: number;
}

/** RNG interface consumed by RewardManager. Matches RNGStream's public API subset. */
export interface RewardRNG {
  nextInt(min: number, max: number): number;
  nextFloat(): number;
}

/** Enemy type classification for reward scaling. */
export type EnemyType = 'normal' | 'elite' | 'boss';

// ---------------------------------------------------------------------------
// Defaults (per Reward GDD Tuning Knobs)
// ---------------------------------------------------------------------------

const DEFAULT_CONFIG: RequiredRewardConfig = {
  normalGoldBase: 15,
  normalGoldVariance: 5,
  eliteGoldBase: 30,
  eliteGoldVariance: 10,
  bossGoldBase: 60,
  bossGoldVariance: 20,
  potionDropChance: 0.4,
  cardRewardCount: 3,
  baseRareChance: 0.10,
  pityIncrement: 0.03,
  maxRareChance: 0.40,
};

/** Rarity weight constants. Per Reward GDD Formulas. */
const RARITY_WEIGHTS = {
  COMMON: 0.60,
  UNCOMMON: 0.30,
  RARE: 0.10,
} as const;

// ---------------------------------------------------------------------------
// RewardManager
// ---------------------------------------------------------------------------

/**
 * RewardManager — generates post-combat rewards.
 *
 * Lifecycle:
 * 1. Created once per run with the full card and potion registries.
 * 2. Called after each combat victory with enemy type and character ID.
 * 3. Pity counter is maintained internally across calls.
 */
export class RewardManager {
  private readonly cards: Map<string, CardData>;
  private readonly potions: Map<string, PotionData>;
  private readonly config: RequiredRewardConfig;

  /** Pity counter: number of consecutive card rewards without a rare. */
  private pityCounter: number;

  /**
   * @param cards   - Full card registry (id -> CardData).
   * @param potions - Full potion registry (id -> PotionData).
   * @param config  - Optional overrides for default reward values.
   */
  constructor(
    cards: Map<string, CardData>,
    potions: Map<string, PotionData>,
    config?: RewardConfig
  ) {
    this.cards = cards;
    this.potions = potions;
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.pityCounter = 0;
  }

  // ---------------------------------------------------------------
  // Public API
  // ---------------------------------------------------------------

  /**
   * Generate the full set of rewards for a combat victory.
   *
   * Per Reward GDD: every victory provides gold + card selection + possible potion.
   *
   * @param characterId - The character whose card pool to use.
   * @param enemyType   - Type of enemy defeated (normal/elite/boss).
   * @param rng         - Seeded RNG for deterministic generation.
   * @returns RewardResult with gold, card rewards, and potion info.
   */
  generateRewards(
    characterId: string,
    enemyType: EnemyType,
    rng: RewardRNG
  ): RewardResult {
    const gold = this.generateGold(enemyType, rng);
    const cardRewards = this.generateCardRewards(characterId, rng);
    const potionDropped = this.rollPotionDrop(rng);

    let potionData: PotionData | undefined;
    if (potionDropped) {
      potionData = this.pickRandomPotion(rng);
    }

    return { gold, cardRewards, potionDropped, potionData };
  }

  /**
   * Generate gold reward based on enemy type.
   *
   * Per Reward GDD: `gold = base + rng.nextInt(0, variance)`.
   */
  generateGold(enemyType: EnemyType, rng: RewardRNG): number {
    const { base, variance } = this.getGoldParams(enemyType);
    return base + rng.nextInt(0, variance);
  }

  /**
   * Generate card rewards from the character's card pool.
   *
   * Per Reward GDD:
   * 1. Filter cards by character's cardPool that are NOT starter/special rarity.
   * 2. Roll rarity for each card slot with pity system.
   * 3. Pick unique cards for each rarity. Fallback: uncommon -> common.
   * 4. If pool has fewer cards than requested, return what's available.
   */
  generateCardRewards(characterId: string, rng: RewardRNG): CardData[] {
    const pool = this.getAvailablePool(characterId);

    if (pool.length === 0) {
      return [];
    }

    const count = Math.min(this.config.cardRewardCount, pool.length);
    const results: CardData[] = [];
    const usedIds = new Set<string>();

    for (let i = 0; i < count; i++) {
      const rarity = this.rollRarity(rng);
      const card = this.pickCardForRarity(pool, rarity, usedIds, rng);

      if (card) {
        results.push(card);
        usedIds.add(card.id);
      }
    }

    return results;
  }

  /**
   * Roll for potion drop.
   *
   * Per Reward GDD: `rng.nextFloat() < potionDropChance`.
   */
  rollPotionDrop(rng: RewardRNG): boolean {
    return rng.nextFloat() < this.config.potionDropChance;
  }

  // ---------------------------------------------------------------
  // Gold helpers
  // ---------------------------------------------------------------

  /** Get base and variance gold values for an enemy type. */
  private getGoldParams(enemyType: EnemyType): { base: number; variance: number } {
    switch (enemyType) {
      case 'normal':
        return { base: this.config.normalGoldBase, variance: this.config.normalGoldVariance };
      case 'elite':
        return { base: this.config.eliteGoldBase, variance: this.config.eliteGoldVariance };
      case 'boss':
        return { base: this.config.bossGoldBase, variance: this.config.bossGoldVariance };
    }
  }

  // ---------------------------------------------------------------
  // Card pool helpers
  // ---------------------------------------------------------------

  /**
   * Get the available card pool for a character.
   *
   * Filters the character's cardPool to exclude STARTER and SPECIAL rarity.
   * Per Reward GDD Section 3: "pool = pool.filter(c => c.rarity != STARTER && c.rarity != SPECIAL)"
   */
  private getAvailablePool(characterId: string): CardData[] {
    const pool: CardData[] = [];

    for (const card of this.cards.values()) {
      if (card.character === characterId) {
        if (card.rarity !== Rarity.STARTER && card.rarity !== Rarity.SPECIAL) {
          pool.push(card);
        }
      }
    }

    return pool;
  }

  // ---------------------------------------------------------------
  // Rarity rolling
  // ---------------------------------------------------------------

  /**
   * Roll a rarity tier using weighted chances with pity system.
   *
   * Per Reward GDD Formulas:
   * - P(RARE) = min(baseRareChance + pityCounter * pityIncrement, maxRareChance)
   * - P(UNCOMMON) = uncommonWeight / (commonWeight + uncommonWeight) * (1 - P(RARE))
   * - P(COMMON) = commonWeight / (commonWeight + uncommonWeight) * (1 - P(RARE))
   *
   * Pity counter resets on RARE pull, increments otherwise.
   */
  private rollRarity(rng: RewardRNG): Rarity {
    const rareChance = Math.min(
      this.config.baseRareChance + this.pityCounter * this.config.pityIncrement,
      this.config.maxRareChance
    );

    const roll = rng.nextFloat();

    if (roll < rareChance) {
      this.pityCounter = 0;
      return Rarity.RARE;
    }

    this.pityCounter++;

    // Within the non-rare portion, apply common/uncommon weights
    const nonRarePortion = roll - rareChance;
    const totalNonRare = RARITY_WEIGHTS.COMMON + RARITY_WEIGHTS.UNCOMMON;
    const uncommonThreshold = RARITY_WEIGHTS.UNCOMMON / totalNonRare;

    if (nonRarePortion < uncommonThreshold * (1 - rareChance)) {
      return Rarity.UNCOMMON;
    }

    return Rarity.COMMON;
  }

  /**
   * Pick a unique card for the given rarity from the pool.
   *
   * Fallback chain per GDD: if no cards of the target rarity are available
   * (excluding already-picked cards), fall back to UNCOMMON, then COMMON.
   */
  private pickCardForRarity(
    pool: CardData[],
    targetRarity: Rarity,
    usedIds: Set<string>,
    rng: RewardRNG
  ): CardData | undefined {
    // Try the target rarity first
    const targetCards = pool.filter(
      (c) => c.rarity === targetRarity && !usedIds.has(c.id)
    );

    if (targetCards.length > 0) {
      return targetCards[rng.nextInt(0, targetCards.length - 1)];
    }

    // Fallback chain: UNCOMMON -> COMMON (per GDD edge case #1)
    const fallbackOrder =
      targetRarity === Rarity.COMMON
        ? [Rarity.UNCOMMON]
        : targetRarity === Rarity.UNCOMMON
          ? [Rarity.COMMON]
          : [Rarity.UNCOMMON, Rarity.COMMON];

    for (const fallbackRarity of fallbackOrder) {
      const fallbackCards = pool.filter(
        (c) => c.rarity === fallbackRarity && !usedIds.has(c.id)
      );
      if (fallbackCards.length > 0) {
        return fallbackCards[rng.nextInt(0, fallbackCards.length - 1)];
      }
    }

    // Last resort: any remaining card not yet picked
    const anyRemaining = pool.filter((c) => !usedIds.has(c.id));
    if (anyRemaining.length > 0) {
      return anyRemaining[rng.nextInt(0, anyRemaining.length - 1)];
    }

    return undefined;
  }

  // ---------------------------------------------------------------
  // Potion helpers
  // ---------------------------------------------------------------

  /** Pick a random potion from the potion registry. */
  private pickRandomPotion(rng: RewardRNG): PotionData | undefined {
    const potionList = Array.from(this.potions.values());
    if (potionList.length === 0) {
      return undefined;
    }
    return potionList[rng.nextInt(0, potionList.length - 1)];
  }
}
