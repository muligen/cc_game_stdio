/**
 * potion.ts — Potion data type definitions.
 *
 * Implements: design/gdd/potion.md (Potion Data Schema, Rarity, Effect Types)
 * All potion data is loaded from potions.json at runtime.
 */

/** Potion rarity classification. Per Potion GDD Section 2. */
export enum PotionRarity {
  COMMON = 'common',
  UNCOMMON = 'uncommon',
  RARE = 'rare',
}

/** Who or what the potion targets. */
export type PotionTarget = 'self' | 'enemy' | 'all_enemy' | 'none';

/** Effect within a potion. Uses the same DSL as cards per ADR-003. */
export interface PotionEffect {
  /** Effect type string — maps to EffectResolver handler. */
  type: string;
  /** Primary magnitude. */
  value: number;
  /** Status effect ID for status-related effects. */
  status?: string;
  /** Duration for timed effects. */
  duration?: number;
}

/**
 * PotionData — the full data definition of a potion.
 * Loaded from potions.json. Per Potion GDD Section 1.
 */
export interface PotionData {
  /** Unique identifier, e.g. "fire_potion". */
  id: string;
  /** Display name. */
  name: string;
  /** Effect description for tooltips. */
  description: string;
  /** Rarity tier. */
  rarity: PotionRarity;
  /** Who/what the potion targets. */
  target: PotionTarget;
  /** Effects on use. */
  effects: PotionEffect[];
  /** Whether this potion can be used during combat. Default true. */
  canUseInCombat: boolean;
  /** Whether this potion can be used outside combat. */
  canUseOutOfCombat: boolean;
}
