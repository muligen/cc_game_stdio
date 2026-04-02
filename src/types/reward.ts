/**
 * reward.ts — Reward type definitions.
 *
 * Implements: design/gdd/reward.md (Reward Types, Rarity Roll, Pity System)
 * Reward configuration is loaded from reward-config.json at runtime.
 */

/** Reward type classification. Per Reward GDD Section 1. */
export type RewardType = 'gold' | 'card' | 'potion' | 'relic' | 'boss_relic';

/** Rarity roll result. */
export type RewardRarity = 'common' | 'uncommon' | 'rare';

/**
 * RewardConfig — reward generation configuration.
 * Loaded from reward-config.json. Per Reward GDD Tuning Knobs.
 */
export interface RewardConfig {
  /** Base rare card chance. Default 0.12. */
  baseRareChance: number;
  /** Pity increment per non-rare roll. Default 0.03. */
  pityIncrement: number;
  /** Hard cap on rare chance. Default 0.40. */
  pityCap: number;
  /** Uncommon card chance (after rare check fails). Default 0.37. */
  uncommonChance: number;
  /** Number of cards offered per reward. Default 3. */
  rewardCardsOffered: number;
  /** Normal combat gold base. Default 15. */
  normalGoldBase: number;
  /** Normal combat gold variance. Default 5. */
  normalGoldVariance: number;
  /** Elite combat gold base. Default 30. */
  eliteGoldBase: number;
  /** Elite combat gold variance. Default 10. */
  eliteGoldVariance: number;
  /** Boss combat gold base. Default 60. */
  bossGoldBase: number;
  /** Boss combat gold variance. Default 20. */
  bossGoldVariance: number;
  /** Potion drop rate per combat. Default 0.40. */
  potionDropRate: number;
  /** Potion drop penalty after a drop. Default 0.10. */
  potionDropPenalty: number;
  /** Common potion rarity weight. Default 0.65. */
  commonPotionWeight: number;
  /** Uncommon potion rarity weight. Default 0.25. */
  uncommonPotionWeight: number;
  /** Rare potion rarity weight. Default 0.10. */
  rarePotionWeight: number;
  /** Rare chance bonus in shop. Default 0.06. */
  shopRareBonus: number;
  /** Rare chance bonus from elite. Default 0.07. */
  eliteRareBonus: number;
}

/**
 * RewardChoice — a single reward item presented to the player.
 */
export interface RewardChoice {
  /** Reward type. */
  type: RewardType;
  /** Entity ID (card ID, relic ID, potion ID, or null for gold). */
  id: string | null;
  /** Gold amount (for gold rewards). */
  amount?: number;
  /** Rarity of the reward item. */
  rarity?: RewardRarity;
}
