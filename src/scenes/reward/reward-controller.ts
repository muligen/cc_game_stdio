/**
 * reward-controller.ts — Business logic for the post-combat reward screen.
 *
 * Manages reward state: card selection, skipping, and completion tracking.
 * This is pure business logic — NO Phaser rendering happens here.
 * The RewardScene delegates user interactions to this controller.
 *
 * Implements: design/gdd/reward.md (Card Reward Selection, Skip, Gold)
 * Architecture: ADR-001 (state management via dedicated controller class)
 *
 * Key design decisions:
 * - Pure TypeScript — zero Phaser dependencies
 * - Immutable state exposure via getState() returning Readonly
 * - Single selection: once a card is picked or skip is called, no further changes
 * - Invalid operations (re-select, invalid index) return null gracefully
 */

import type { CardData } from '../../types/card';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * Reward screen state — tracks what rewards are available and what was chosen.
 */
export interface RewardState {
  /** Gold awarded for this combat victory. */
  goldReward: number;
  /** Card rewards to choose from (typically 3). */
  cardRewards: CardData[];
  /** Whether a potion dropped (for display purposes). */
  potionDropped: boolean;
  /** Index of the selected card reward, or null if not yet selected. */
  selectedCardIndex: number | null;
  /** Whether the player skipped all card rewards. */
  skipped: boolean;
}

/**
 * Final result of the reward selection — what to apply to the run state.
 */
export interface RewardResult {
  /** The card to add to the deck, or null if skipped. */
  addedCard: CardData | null;
  /** Gold gained from this combat. */
  goldGained: number;
}

// ---------------------------------------------------------------------------
// RewardController
// ---------------------------------------------------------------------------

/**
 * RewardController — manages the reward selection lifecycle.
 *
 * Usage:
 *   const controller = new RewardController(cards, gold, potionDropped);
 *   // User clicks a card:
 *   const selected = controller.selectCard(1);
 *   // Check completion:
 *   if (controller.isComplete()) {
 *     const result = controller.getResult();
 *     // Apply result.addedCard to deck, result.goldGained to run state
 *   }
 *
 * This class has no side effects and no Phaser dependencies.
 */
export class RewardController {
  private readonly state: RewardState;

  /**
   * @param cardRewards  - Array of card data for the card reward selection.
   * @param goldReward   - Gold amount awarded for this combat.
   * @param potionDropped - Whether a potion dropped (informational).
   */
  constructor(
    cardRewards: CardData[],
    goldReward: number,
    potionDropped: boolean
  ) {
    this.state = {
      goldReward,
      cardRewards: [...cardRewards],
      potionDropped,
      selectedCardIndex: null,
      skipped: false,
    };
  }

  // -------------------------------------------------------------------------
  // Public API
  // -------------------------------------------------------------------------

  /**
   * Get the current reward state (read-only).
   *
   * @returns A read-only view of the current reward state.
   */
  getState(): Readonly<RewardState> {
    return this.state;
  }

  /**
   * Player selects a card reward by index.
   *
   * Once a card is selected, the reward flow is complete and no further
   * selections are allowed.
   *
   * @param index - Index of the card to select (0-based).
   * @returns The selected CardData, or null if already done or index invalid.
   */
  selectCard(index: number): CardData | null {
    // Already complete — no further selection allowed
    if (this.isComplete()) {
      return null;
    }

    // Invalid index
    if (index < 0 || index >= this.state.cardRewards.length) {
      return null;
    }

    this.state.selectedCardIndex = index;
    return this.state.cardRewards[index];
  }

  /**
   * Player skips all card rewards.
   *
   * Once skipped, the reward flow is complete and selectCard will return null.
   */
  skip(): void {
    if (this.isComplete()) {
      return;
    }

    this.state.skipped = true;
  }

  /**
   * Check if the reward selection is complete.
   *
   * Complete means either a card was selected or the player skipped.
   *
   * @returns True if the selection is finalized.
   */
  isComplete(): boolean {
    return this.state.selectedCardIndex !== null || this.state.skipped;
  }

  /**
   * Get the final result of the reward selection.
   *
   * @returns Object with the added card (or null if skipped) and gold gained.
   */
  getResult(): RewardResult {
    const addedCard =
      this.state.selectedCardIndex !== null
        ? this.state.cardRewards[this.state.selectedCardIndex]
        : null;

    return {
      addedCard,
      goldGained: this.state.goldReward,
    };
  }
}
