/**
 * reward-scene.ts -- Thin Phaser Scene shell for the post-combat reward screen.
 *
 * Wires together RewardController (business logic) and RewardUILayoutCalculator
 * (layout math). The scene itself only tracks hoveredIndex, forwards clicks to
 * the controller, and re-renders on state change. No game logic lives here.
 *
 * Implements: design/gdd/reward.md (Reward Screen)
 * Architecture: ADR-001 (scene delegates to controller), ADR-004 (events)
 *
 * Key design decisions:
 * - Scene is a thin shell: all logic in RewardController, all layout in RewardUILayoutCalculator
 * - Tracks hoveredIndex for visual feedback (lift hovered card)
 * - Calls onComplete callback when selection finishes (no scene coupling)
 * - Placeholder rendering: Phaser built-in shapes only, no external art
 */

import Phaser from 'phaser';
import { RewardController } from './reward-controller';
import { RewardUILayoutCalculator } from './reward-ui-layout';
import type { RewardUIConfig, RewardUILayout, RewardCardLayout } from './reward-ui-layout';
import { CardType } from '../../types/card';
import type { CardData } from '../../types/card';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * Result of reward selection — passed to the onComplete callback.
 * Extends RewardResult from the controller with extra display metadata.
 */
export interface RewardCompletionResult {
  /** The card to add to the deck, or null if skipped. */
  addedCard: CardData | null;
  /** Gold gained from this combat. */
  goldGained: number;
  /** Whether the player skipped card selection. */
  skipped: boolean;
}

/**
 * Data passed to RewardScene via scene.start(data).
 */
export interface RewardSceneData {
  /** Array of card rewards to choose from (typically 3). */
  cardRewards: CardData[];
  /** Gold awarded for this combat victory. */
  goldReward: number;
  /** Whether a potion dropped (informational, for display). */
  potionDropped: boolean;
}

// ---------------------------------------------------------------------------
// RewardScene
// ---------------------------------------------------------------------------

/**
 * RewardScene -- thin Phaser Scene for post-combat card reward selection.
 *
 * Usage (from a parent scene):
 *   this.scene.start('RewardScene', { cardRewards, goldReward: 50, potionDropped: false });
 *
 * Or programmatically:
 *   const rewardScene = this.scene.get('RewardScene') as RewardScene;
 *   rewardScene.setOnComplete((result) => { ... });
 *
 * The scene creates a RewardController for state management and a
 * RewardUILayoutCalculator for positioning. All interactions forward to
 * the controller; the scene only manages hover state and rendering.
 */
export class RewardScene extends Phaser.Scene {
  private controller: RewardController | null = null;
  private layoutCalc: RewardUILayoutCalculator | null = null;
  private hoveredIndex: number | null = null;
  private onComplete?: (result: RewardCompletionResult) => void;
  private cardContainers: Phaser.GameObjects.Container[] = [];

  constructor() {
    super({ key: 'RewardScene' });
  }

  // -------------------------------------------------------------------------
  // Public API (for parent scenes and tests)
  // -------------------------------------------------------------------------

  /**
   * Set callback invoked when reward selection completes.
   *
   * @param cb - Callback receiving the RewardCompletionResult.
   */
  setOnComplete(cb: (result: RewardCompletionResult) => void): void {
    this.onComplete = cb;
  }

  /**
   * Get the reward result, or null if selection is not yet complete.
   *
   * @returns The completion result, or null.
   */
  getRewardResult(): RewardCompletionResult | null {
    if (!this.controller || !this.controller.isComplete()) return null;
    return this.buildResult();
  }

  /**
   * Check if reward selection is complete.
   *
   * @returns True if a card was selected or the player skipped.
   */
  isComplete(): boolean {
    return this.controller?.isComplete() ?? false;
  }

  /**
   * Get the index of the currently hovered card.
   *
   * @returns Hovered card index, or null.
   */
  getHoveredIndex(): number | null {
    return this.hoveredIndex;
  }

  /**
   * Get the internal controller instance (for testing).
   */
  getController(): RewardController | null {
    return this.controller;
  }

  // -------------------------------------------------------------------------
  // Phaser lifecycle
  // -------------------------------------------------------------------------

  /**
   * Called when the scene starts. Initializes controller, layout calculator,
   * and renders the reward UI.
   *
   * @param data - Scene data containing cardRewards, goldReward, and potionDropped.
   */
  create(data: RewardSceneData): void {
    this.controller = new RewardController(
      data.cardRewards,
      data.goldReward,
      data.potionDropped,
    );

    const config: RewardUIConfig = {
      screenWidth: this.scale.width,
      screenHeight: this.scale.height,
    };
    this.layoutCalc = new RewardUILayoutCalculator(config);

    this.hoveredIndex = null;
    this.cardContainers = [];

    this.renderLayout(data);
  }

  // -------------------------------------------------------------------------
  // Rendering
  // -------------------------------------------------------------------------

  /**
   * Render the full reward layout: title, cards, gold display, skip button.
   */
  private renderLayout(data: RewardSceneData): void {
    if (!this.layoutCalc || !this.controller) return;

    const layout = this.layoutCalc.calculate(
      data.cardRewards,
      data.goldReward,
      this.hoveredIndex,
    );

    this.renderTitle(layout.title);
    this.renderCards(layout.cards, data.cardRewards);
    this.renderGold(layout.gold);
    this.renderSkipButton(layout.skipButton);
  }

  /**
   * Render the title text.
   */
  private renderTitle(title: { x: number; y: number; text: string }): void {
    this.add.text(title.x, title.y, title.text, {
      fontSize: '28px',
      color: '#ffffff',
    }).setOrigin(0.5);
  }

  /**
   * Render card reward containers with interactive hit areas.
   */
  private renderCards(
    cardLayouts: RewardCardLayout[],
    _cardData: CardData[],
  ): void {
    for (let i = 0; i < cardLayouts.length; i++) {
      const cardLayout = cardLayouts[i];
      const container = this.createCardContainer(cardLayout, i);
      this.cardContainers.push(container);
    }
  }

  /**
   * Create a single card container with background, text, and interactivity.
   */
  private createCardContainer(
    cardLayout: RewardCardLayout,
    index: number,
  ): Phaser.GameObjects.Container {
    const { x, y, width, height, color } = cardLayout;

    // Card background with border
    const bg = this.add.rectangle(0, 0, width, height, color)
      .setStrokeStyle(2, 0xffffff);

    // Card name
    const nameText = this.add.text(0, -height * 0.3, cardLayout.card.name, {
      fontSize: '16px',
      color: '#ffffff',
    }).setOrigin(0.5);

    // Energy cost
    const costText = this.add.text(
      -width * 0.35, -height * 0.35,
      `${cardLayout.card.cost}`,
      { fontSize: '14px', color: '#44ddff' },
    ).setOrigin(0.5);

    // Card description
    const descText = this.add.text(0, height * 0.15, cardLayout.card.description, {
      fontSize: '12px',
      color: '#cccccc',
      wordWrap: { width: width - 16 },
    }).setOrigin(0.5);

    const container = this.add.container(x, y, [bg, nameText, costText, descText]);
    container.setSize(width, height);
    container.setInteractive({ useHandCursor: true });

    // Hover: track hovered index (scene state, not controller state)
    container.on('pointerover', () => {
      if (this.controller && !this.controller.isComplete()) {
        this.hoveredIndex = index;
        container.setY(y - 10);
      }
    });
    container.on('pointerout', () => {
      this.hoveredIndex = null;
      container.setY(y);
    });

    // Click: forward to controller
    container.on('pointerdown', () => {
      this.handleCardClick(index);
    });

    return container;
  }

  /**
   * Render the gold display text.
   */
  private renderGold(gold: { x: number; y: number; amount: number; text: string }): void {
    this.add.text(gold.x, gold.y, gold.text, {
      fontSize: '20px',
      color: '#ffdd44',
    }).setOrigin(0.5);
  }

  /**
   * Render the skip button with hover feedback.
   */
  private renderSkipButton(skip: { x: number; y: number; width: number; height: number; label: string }): void {
    const skipBg = this.add.rectangle(
      skip.x, skip.y,
      skip.width, skip.height,
      0x666666,
    ).setOrigin(0.5).setInteractive({ useHandCursor: true });

    this.add.text(skip.x, skip.y, skip.label, {
      fontSize: '18px',
      color: '#ffffff',
    }).setOrigin(0.5);

    skipBg.on('pointerover', () => skipBg.setFillStyle(0x888888));
    skipBg.on('pointerout', () => skipBg.setFillStyle(0x666666));
    skipBg.on('pointerdown', () => this.handleSkip());
  }

  // -------------------------------------------------------------------------
  // Interaction handlers
  // -------------------------------------------------------------------------

  /**
   * Handle card click -- forward to controller, complete if successful.
   */
  private handleCardClick(index: number): void {
    if (!this.controller || this.controller.isComplete()) return;

    const selected = this.controller.selectCard(index);
    if (selected) {
      this.completeReward();
    }
  }

  /**
   * Handle skip button click -- forward to controller, complete.
   */
  private handleSkip(): void {
    if (!this.controller || this.controller.isComplete()) return;

    this.controller.skip();
    this.completeReward();
  }

  /**
   * Finalize the reward selection: clear hover, gray out cards, notify callback.
   */
  private completeReward(): void {
    this.hoveredIndex = null;

    // Gray out all card containers to show selection is finalized
    for (const container of this.cardContainers) {
      container.setAlpha(0.5);
    }

    const result = this.buildResult();
    if (this.onComplete) {
      this.onComplete(result);
    }
  }

  /**
   * Build the completion result from controller state.
   */
  private buildResult(): RewardCompletionResult {
    if (!this.controller) {
      return { addedCard: null, goldGained: 0, skipped: true };
    }
    const controllerResult = this.controller.getResult();
    return {
      addedCard: controllerResult.addedCard,
      goldGained: controllerResult.goldGained,
      skipped: this.controller.getState().skipped,
    };
  }
}
