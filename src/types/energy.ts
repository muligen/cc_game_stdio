/**
 * energy.ts — Energy state type definitions.
 *
 * Implements: design/gdd/energy.md (Energy States, Formulas)
 * Energy state is managed per-turn during combat.
 */

/**
 * EnergyState — tracks energy during combat.
 * Created at combat start, updated each turn.
 * Per Energy GDD Section 1 and ADR-001 Decision 2.
 */
export interface EnergyState {
  /** Character's base energy from config. */
  baseEnergy: number;
  /** Permanent energy bonus from relics. */
  relicBonus: number;
  /** Temporary energy bonus this turn (from cards/potions). */
  bonusEnergy: number;
  /** Temporary energy penalty this turn (from debuffs). */
  penaltyEnergy: number;
  /** Current energy available to spend. */
  currentEnergy: number;
}

/**
 * Energy cost type for a card. Per Card System GDD.
 */
export type EnergyCostType = 'normal' | 'x' | 'unplayable';
