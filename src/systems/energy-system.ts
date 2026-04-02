/**
 * energy-system.ts — Energy management system for combat.
 *
 * Implements: design/gdd/energy.md (Core Rules, Formulas, Edge Cases)
 * Architecture: ADR-001 Decision 2 (combat-scoped state), ADR-004 (event bus)
 *
 * Turn-based energy is the primary resource for playing cards.
 * At turn start, energy is recalculated from base + relic bonus - penalties.
 * Mid-turn energy gains/losses modify currentEnergy directly.
 * At turn end, all unspent energy is lost.
 *
 * Key formulas (GDD Section "Formulas"):
 *   effectiveMaxEnergy = baseEnergy + relicBonus
 *   currentEnergy = max(0, effectiveMaxEnergy + bonusEnergy - penaltyEnergy)
 *
 * Note: effectiveMax does NOT include penalty. Penalty is applied only to
 * the turn-start calculation, not baked into the max.
 */

import type { EnergyState } from '../types/energy';
import { DEFAULT_BASE_ENERGY } from '../config/game-config';
import { Logger } from '../utils/logger';

const LOG = new Logger('EnergySystem');

/** Energy state machine phases per GDD "States and Transitions". */
export enum EnergyPhase {
  /** Before first turn-start calculation. */
  RESET = 'RESET',
  /** Turn start calculation complete, no cards played yet. */
  FULL = 'FULL',
  /** At least one card played this turn. */
  SPENDING = 'SPENDING',
  /** Mid-turn energy gain pushed current above initial. */
  BONUS = 'BONUS',
  /** currentEnergy is 0. */
  DEPLETED = 'DEPLETED',
  /** Turn ended, energy forced to 0. */
  END = 'END',
}

/**
 * EnergySystem — manages turn-based energy during combat.
 *
 * Lifecycle:
 * 1. Created at combat start with character's baseEnergy and any relic bonus.
 * 2. onTurnStart() called each player turn to recalculate energy.
 * 3. canPlay() / spendEnergy() called when playing cards.
 * 4. gainEnergy() called by card effects, relics, potions mid-turn.
 * 5. onTurnEnd() called at end of each player turn.
 *
 * All numeric values come from config. baseEnergy defaults to
 * DEFAULT_BASE_ENERGY (3) when no character config is provided.
 */
export class EnergySystem {
  /** Internal energy state. */
  private state: EnergyState;

  /** Current state machine phase. */
  private phase: EnergyPhase;

  /**
   * @param baseEnergy - Character's base energy from config. Default: 3.
   * @param relicBonus - Permanent energy bonus from relics. Default: 0.
   */
  constructor(baseEnergy: number = DEFAULT_BASE_ENERGY, relicBonus: number = 0) {
    this.state = {
      baseEnergy,
      relicBonus,
      bonusEnergy: 0,
      penaltyEnergy: 0,
      currentEnergy: 0,
    };
    this.phase = EnergyPhase.RESET;
  }

  // ---------------------------------------------------------------
  // Turn Lifecycle
  // ---------------------------------------------------------------

  /**
   * Called at the start of each player turn.
   *
   * GDD formula:
   *   effectiveMaxEnergy = baseEnergy + relicBonus
   *   currentEnergy = max(0, effectiveMaxEnergy + bonusEnergy - penaltyEnergy)
   *
   * Temporary bonuses and penalties are cleared before recalculation.
   */
  onTurnStart(bonusEnergy: number = 0, penaltyEnergy: number = 0): void {
    this.state.bonusEnergy = bonusEnergy;
    this.state.penaltyEnergy = penaltyEnergy;

    const effectiveMax = this.getEffectiveMaxEnergy();
    const raw = effectiveMax + this.state.bonusEnergy - this.state.penaltyEnergy;
    this.state.currentEnergy = Math.max(0, raw);

    this.phase = this.state.currentEnergy > 0 ? EnergyPhase.FULL : EnergyPhase.DEPLETED;

    LOG.info(
      `Turn start: effectiveMax=${effectiveMax}, bonus=${bonusEnergy}, penalty=${penaltyEnergy}, current=${this.state.currentEnergy}`
    );
  }

  /**
   * Called at the end of each player turn.
   *
   * GDD rule: unspent energy is lost. Temporary modifiers expire.
   */
  onTurnEnd(): void {
    this.state.currentEnergy = 0;
    this.state.bonusEnergy = 0;
    this.state.penaltyEnergy = 0;
    this.phase = EnergyPhase.END;
  }

  // ---------------------------------------------------------------
  // Energy Queries
  // ---------------------------------------------------------------

  /**
   * Effective maximum energy for display and calculations.
   *
   * GDD formula: effectiveMaxEnergy = baseEnergy + relicBonus
   * Note: penalty is NOT subtracted here — it only applies at turn start.
   */
  getEffectiveMaxEnergy(): number {
    return this.state.baseEnergy + this.state.relicBonus;
  }

  /** Current energy available to spend. */
  getCurrentEnergy(): number {
    return this.state.currentEnergy;
  }

  /** Current state machine phase. */
  getPhase(): EnergyPhase {
    return this.phase;
  }

  /** Get a read-only snapshot of the current energy state. */
  getState(): Readonly<EnergyState> {
    return { ...this.state };
  }

  // ---------------------------------------------------------------
  // Card Play
  // ---------------------------------------------------------------

  /**
   * Check if a card can be played with current energy.
   *
   * GDD Card Cost Check formula:
   *   X-cost:   currentEnergy > 0
   *   Unplayable: always false
   *   Normal:   currentEnergy >= cost
   *   Zero-cost: always true (currentEnergy >= 0 is trivially true)
   */
  canPlay(cost: number, costType: string): boolean {
    if (costType === 'unplayable') {
      return false;
    }
    if (costType === 'x') {
      return this.state.currentEnergy > 0;
    }
    // Normal cost (including 0-cost cards)
    return this.state.currentEnergy >= cost;
  }

  /**
   * Spend energy for a card play.
   *
   * GDD rule: currentEnergy -= actualCost, floor at 0.
   * For X-cost cards, pass currentEnergy as cost.
   *
   * @returns The actual amount spent (may differ if currentEnergy < cost due to edge cases).
   * @throws Error if insufficient energy (call canPlay first).
   */
  spendEnergy(cost: number): number {
    if (cost < 0) {
      LOG.warn(`spendEnergy called with negative cost: ${cost}. Clamping to 0.`);
      return 0;
    }

    if (this.state.currentEnergy < cost) {
      throw new Error(
        `Insufficient energy: have ${this.state.currentEnergy}, need ${cost}`
      );
    }

    this.state.currentEnergy = Math.max(0, this.state.currentEnergy - cost);

    // Update state machine phase
    if (this.state.currentEnergy === 0) {
      this.phase = EnergyPhase.DEPLETED;
    } else {
      this.phase = EnergyPhase.SPENDING;
    }

    return cost;
  }

  /**
   * Spend energy for an X-cost card. Consumes all current energy.
   *
   * GDD: X-cost cards consume all currentEnergy and report the amount.
   *
   * @returns The amount of energy spent (the X value).
   */
  spendAllEnergy(): number {
    const xValue = this.state.currentEnergy;
    this.state.currentEnergy = 0;
    this.phase = EnergyPhase.DEPLETED;
    return xValue;
  }

  // ---------------------------------------------------------------
  // Mid-Turn Energy Changes
  // ---------------------------------------------------------------

  /**
   * Gain energy mid-turn (from card effects, potions, relics).
   *
   * GDD: increases currentEnergy directly. Does NOT affect effectiveMaxEnergy.
   * No upper bound on currentEnergy.
   */
  gainEnergy(amount: number): void {
    if (amount < 0) {
      LOG.warn(`gainEnergy called with negative amount: ${amount}. Ignoring.`);
      return;
    }
    this.state.currentEnergy += amount;
    this.phase = EnergyPhase.BONUS;
  }

  /**
   * Lose energy mid-turn (from enemy debuffs, card effects).
   *
   * GDD: reduces currentEnergy, floor at 0.
   */
  loseEnergy(amount: number): void {
    if (amount < 0) {
      LOG.warn(`loseEnergy called with negative amount: ${amount}. Ignoring.`);
      return;
    }
    this.state.currentEnergy = Math.max(0, this.state.currentEnergy - amount);
    if (this.state.currentEnergy === 0) {
      this.phase = EnergyPhase.DEPLETED;
    }
  }

  // ---------------------------------------------------------------
  // Relic Bonus Management
  // ---------------------------------------------------------------

  /**
   * Add a permanent relic energy bonus.
   *
   * GDD: relic bonus is additive and uncapped.
   * Takes effect at next turn start recalculation.
   */
  addRelicBonus(bonus: number): void {
    if (bonus <= 0) {
      LOG.warn(`addRelicBonus called with non-positive value: ${bonus}. Ignoring.`);
      return;
    }
    this.state.relicBonus += bonus;
  }

  /**
   * Remove a relic energy bonus (e.g., relic lost or disabled).
   *
   * Takes effect at next turn start recalculation.
   */
  removeRelicBonus(bonus: number): void {
    if (bonus <= 0) {
      LOG.warn(`removeRelicBonus called with non-positive value: ${bonus}. Ignoring.`);
      return;
    }
    this.state.relicBonus = Math.max(0, this.state.relicBonus - bonus);
  }

  // ---------------------------------------------------------------
  // Combat Lifecycle
  // ---------------------------------------------------------------

  /**
   * Reset energy system for a new combat.
   * Per GDD Edge Case #7: energy resets to 0 when combat ends,
   * no energy carries between combats.
   */
  resetForCombat(): void {
    this.state.currentEnergy = 0;
    this.state.bonusEnergy = 0;
    this.state.penaltyEnergy = 0;
    // relicBonus persists across combats (it is permanent)
    this.phase = EnergyPhase.RESET;
  }
}
