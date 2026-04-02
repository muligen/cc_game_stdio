/**
 * card-helper.ts — Static utility class for card queries.
 *
 * Implements: design/gdd/card.md (Card Play Flow, Card Keywords, Card Upgrade System)
 * Architecture: Stateless utility — no DI needed. All methods are static.
 *
 * Provides:
 * - canPlay: Eligibility check for card play (energy, target, cost type).
 * - getEffectiveCost: Resolves cost accounting for overrides and upgrades.
 * - Keyword queries: isExhaust, isEthereal, isInnate, isRetain, isUnplayable.
 * - getUpgradedData: Retrieves upgrade delta from CardData.
 *
 * Key design decisions:
 * - costOverride takes priority over upgraded cost (relic override > upgrade delta).
 * - X-cost cards report their data.cost value from getEffectiveCost; the caller
 *   is responsible for the "spend all energy" logic per GDD X-Cost Resolution.
 * - Keyword checks use the Keyword enum values matching cards.json data.
 */

import {
  type CardData,
  type CombatCardInstance,
  CostType,
  Keyword,
  TargetType,
} from '../types/card';
import { Logger } from '../utils/logger';

const LOG = new Logger('CardHelper');

/**
 * Unpacks CardData from either a CardData or CombatCardInstance input.
 * Keeps keyword helper signatures concise.
 */
function unwrapData(card: CardData | CombatCardInstance): CardData {
  return 'data' in card ? (card as CombatCardInstance).data : card;
}

/**
 * CardHelper — static utility class for card play queries.
 *
 * All methods are pure functions (no side effects, no state).
 * Usage: CardHelper.canPlay(instance, energy, hasTarget)
 */
export class CardHelper {
  // Private constructor prevents instantiation — pure static class.
  private constructor() {
    // Not instantiable.
  }

  // ---------------------------------------------------------------
  // Play Eligibility
  // ---------------------------------------------------------------

  /**
   * Check whether a card can be played given current combat state.
   *
   * Per GDD Card Play Flow Step 1 (Eligibility check):
   * 1. Unplayable cards (costType or keyword) -> false
   * 2. X-cost -> currentEnergy > 0
   * 3. Normal cost -> currentEnergy >= getEffectiveCost(card)
   * 4. Targeted cards (ENEMY) need hasTarget = true
   * 5. Self / all_enemy / none targets do not require a target selection
   *
   * @param card - The combat card instance to check.
   * @param currentEnergy - Player's current energy.
   * @param hasTarget - Whether a valid target exists for targeted cards.
   * @returns true if the card can be played.
   */
  static canPlay(card: CombatCardInstance, currentEnergy: number, hasTarget: boolean): boolean {
    const data = card.data;

    // Unplayable by costType
    if (data.costType === CostType.UNPLAYABLE) {
      LOG.debug(`canPlay: ${data.id} is unplayable by costType.`);
      return false;
    }

    // Unplayable by keyword
    if (CardHelper.isUnplayable(card)) {
      LOG.debug(`canPlay: ${data.id} is unplayable by keyword.`);
      return false;
    }

    // Energy check by cost type
    if (data.costType === CostType.X) {
      if (currentEnergy <= 0) {
        LOG.debug(`canPlay: ${data.id} is X-cost but energy is 0.`);
        return false;
      }
    } else {
      // NORMAL cost type
      const cost = CardHelper.getEffectiveCost(card);
      if (currentEnergy < cost) {
        LOG.debug(`canPlay: ${data.id} costs ${cost} but energy is ${currentEnergy}.`);
        return false;
      }
    }

    // Target check: ENEMY target type requires a valid target
    if (data.targets === TargetType.ENEMY && !hasTarget) {
      LOG.debug(`canPlay: ${data.id} targets ENEMY but no valid target.`);
      return false;
    }

    return true;
  }

  // ---------------------------------------------------------------
  // Cost Resolution
  // ---------------------------------------------------------------

  /**
   * Get the effective energy cost for a card.
   *
   * Resolution order (first match wins):
   * 1. costOverride if not null (e.g., relic override) — highest priority
   * 2. upgrade.cost if the card is upgraded and upgrade.cost is defined
   * 3. data.cost as the base cost
   *
   * Special returns:
   * - Unplayable costType -> -1
   * - X-cost -> data.cost (caller handles "spend all" logic)
   *
   * @param card - The combat card instance.
   * @returns The effective energy cost, or -1 for unplayable.
   */
  static getEffectiveCost(card: CombatCardInstance): number {
    const data = card.data;

    if (data.costType === CostType.UNPLAYABLE) {
      return -1;
    }

    // Priority 1: costOverride (relic effects like Simulate Helix)
    if (card.costOverride !== null) {
      return card.costOverride;
    }

    // Priority 2: upgraded cost delta
    if (card.upgraded && data.upgrade?.cost !== undefined) {
      return data.upgrade.cost;
    }

    // Priority 3: base cost
    return data.cost;
  }

  // ---------------------------------------------------------------
  // Keyword Queries
  // ---------------------------------------------------------------

  /**
   * Check if a card has the Exhaust keyword.
   * Per GDD: card is removed from combat (Exhaust pile) after resolution.
   */
  static isExhaust(card: CardData | CombatCardInstance): boolean {
    return unwrapData(card).keywords.includes(Keyword.EXHAUST);
  }

  /**
   * Check if a card has the Ethereal keyword.
   * Per GDD: card is exhausted at end of turn if still in hand.
   */
  static isEthereal(card: CardData | CombatCardInstance): boolean {
    return unwrapData(card).keywords.includes(Keyword.ETHEREAL);
  }

  /**
   * Check if a card has the Innate keyword.
   * Per GDD: card is always in the opening hand of each combat.
   */
  static isInnate(card: CardData | CombatCardInstance): boolean {
    return unwrapData(card).keywords.includes(Keyword.INNATE);
  }

  /**
   * Check if a card has the Retain keyword.
   * Per GDD: card stays in hand at end of turn instead of discarding.
   */
  static isRetain(card: CardData | CombatCardInstance): boolean {
    return unwrapData(card).keywords.includes(Keyword.RETAIN);
  }

  /**
   * Check if a card has the Unplayable keyword.
   * Per GDD: card cannot be voluntarily played.
   *
   * Note: This checks the keywords array only. Callers should also
   * check costType === CostType.UNPLAYABLE for status/curse cards
   * that are unplayable by cost type rather than keyword.
   */
  static isUnplayable(card: CardData | CombatCardInstance): boolean {
    return unwrapData(card).keywords.includes(Keyword.UNPLAYABLE);
  }

  // ---------------------------------------------------------------
  // Upgrade Helpers
  // ---------------------------------------------------------------

  /**
   * Get the upgrade delta data for a card.
   *
   * Per GDD Card Upgrade System: the upgrade field defines delta —
   * changed properties overwrite base values.
   *
   * @param card - The card data to check.
   * @returns The CardUpgrade object if upgrade data exists and has at least
   *          one defined field, or null if no upgrade is defined.
   */
  static getUpgradedData(card: CardData): CardData['upgrade'] | null {
    const upgrade = card.upgrade;
    if (!upgrade) {
      return null;
    }

    // Check if the upgrade object has any defined fields
    const hasDefinedField =
      upgrade.cost !== undefined ||
      upgrade.damage !== undefined ||
      upgrade.block !== undefined ||
      upgrade.description !== undefined ||
      (upgrade.effects !== undefined && upgrade.effects.length > 0);

    return hasDefinedField ? upgrade : null;
  }
}
