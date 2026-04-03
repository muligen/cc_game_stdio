/**
 * reward-ui-layout.ts — Pure layout calculator for the post-combat reward screen.
 *
 * Computes positions for card rewards, gold display, title, and skip button.
 * This is a layout calculator only — NO Phaser rendering happens here.
 * The RewardScene consumes layout results and creates Phaser GameObjects.
 *
 * Implements: design/gdd/reward.md (Reward Screen Layout)
 * Architecture: ADR-001 (data-driven values from config)
 *
 * Key design decisions:
 * - Pure TypeScript math — zero Phaser dependencies
 * - All layout values from RewardUIConfig (data-driven)
 * - Card colors reuse the same palette as CardHandDisplay for visual consistency
 * - Hovered card lifts up by configurable amount (default 20px)
 */

import { CardType } from '../../types/card';
import type { CardData } from '../../types/card';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * Configuration for the reward screen layout.
 * All values should come from ui-config.json in production.
 */
export interface RewardUIConfig {
  /** Screen width in pixels. Required. */
  screenWidth: number;
  /** Screen height in pixels. Required. */
  screenHeight: number;
  /** Card width in pixels. Default: 140. */
  cardWidth?: number;
  /** Card height in pixels. Default: 200. */
  cardHeight?: number;
  /** Gap between cards in pixels. Default: 30. */
  cardGap?: number;
  /** Top margin for card row in pixels. Default: 250 (center vertically). */
  cardTopMargin?: number;
  /** Y position for gold text. Default: 150. */
  goldY?: number;
  /** Skip button width in pixels. Default: 200. */
  skipButtonWidth?: number;
  /** Skip button height in pixels. Default: 50. */
  skipButtonHeight?: number;
  /** Hover lift in pixels. Default: 20. */
  hoverLift?: number;
  /** Title text. Default: "Choose a Card". */
  titleText?: string;
  /** Title Y position in pixels. Default: 60. */
  titleY?: number;
  /** Skip button bottom margin in pixels. Default: 40. */
  skipBottomMargin?: number;
}

/**
 * Layout result for a single card in the reward display.
 * The RewardScene uses this to position Phaser GameObjects.
 */
export interface RewardCardLayout {
  /** Index of this card in the rewards array. */
  index: number;
  /** Center X position. */
  x: number;
  /** Center Y position. */
  y: number;
  /** Card width in pixels. */
  width: number;
  /** Card height in pixels. */
  height: number;
  /** Card color as a hex number (same palette as CardHandDisplay). */
  color: number;
  /** Reference to the source CardData. */
  card: CardData;
  /** Whether this card is the hovered card. */
  isHovered: boolean;
}

/**
 * Gold display layout data.
 */
export interface GoldLayout {
  /** Center X position. */
  x: number;
  /** Center Y position. */
  y: number;
  /** Gold amount. */
  amount: number;
  /** Formatted display text. */
  text: string;
}

/**
 * Skip button layout data.
 */
export interface SkipButtonLayout {
  /** Center X position. */
  x: number;
  /** Center Y position. */
  y: number;
  /** Button width in pixels. */
  width: number;
  /** Button height in pixels. */
  height: number;
  /** Button label text. */
  label: string;
}

/**
 * Title layout data.
 */
export interface TitleLayout {
  /** Center X position. */
  x: number;
  /** Center Y position. */
  y: number;
  /** Title text. */
  text: string;
}

/**
 * Complete reward screen layout result.
 */
export interface RewardUILayout {
  /** Card reward layouts. */
  cards: RewardCardLayout[];
  /** Gold display layout. */
  gold: GoldLayout;
  /** Skip button layout. */
  skipButton: SkipButtonLayout;
  /** Title layout. */
  title: TitleLayout;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Card color map by type — same palette as CardHandDisplay for visual consistency. */
const CARD_COLORS: Record<string, number> = {
  [CardType.ATTACK]: 0xcc3333,
  [CardType.SKILL]: 0x3366cc,
  [CardType.POWER]: 0x33cc66,
  [CardType.STATUS]: 0x888888,
  [CardType.CURSE]: 0x883388,
};

/** Default color for unknown card types. */
const DEFAULT_CARD_COLOR = 0x666666;

// ---------------------------------------------------------------------------
// RewardUILayoutCalculator
// ---------------------------------------------------------------------------

/**
 * RewardUILayoutCalculator — pure layout calculator for the reward screen.
 *
 * Usage:
 *   const calculator = new RewardUILayoutCalculator(config);
 *   const layout = calculator.calculate(cards, goldAmount, hoveredIndex);
 *   // Use layout.cards, layout.gold, layout.skipButton, layout.title
 *   // to create Phaser GameObjects in RewardScene
 *
 * This class has no side effects and no Phaser dependencies.
 */
export class RewardUILayoutCalculator {
  private readonly screenWidth: number;
  private readonly screenHeight: number;
  private readonly cardWidth: number;
  private readonly cardHeight: number;
  private readonly cardGap: number;
  private readonly cardTopMargin: number;
  private readonly goldY: number;
  private readonly skipButtonWidth: number;
  private readonly skipButtonHeight: number;
  private readonly hoverLift: number;
  private readonly titleText: string;
  private readonly titleY: number;
  private readonly skipBottomMargin: number;

  /**
   * @param config - Layout configuration. screenWidth and screenHeight are required.
   */
  constructor(config: RewardUIConfig) {
    this.screenWidth = config.screenWidth;
    this.screenHeight = config.screenHeight;
    this.cardWidth = config.cardWidth ?? 140;
    this.cardHeight = config.cardHeight ?? 200;
    this.cardGap = config.cardGap ?? 30;
    this.cardTopMargin = config.cardTopMargin ?? 250;
    this.goldY = config.goldY ?? 150;
    this.skipButtonWidth = config.skipButtonWidth ?? 200;
    this.skipButtonHeight = config.skipButtonHeight ?? 50;
    this.hoverLift = config.hoverLift ?? 20;
    this.titleText = config.titleText ?? 'Choose a Card';
    this.titleY = config.titleY ?? 60;
    this.skipBottomMargin = config.skipBottomMargin ?? 40;
  }

  // -------------------------------------------------------------------------
  // Public API
  // -------------------------------------------------------------------------

  /**
   * Calculate the complete reward screen layout.
   *
   * @param cards - Array of card data for the card rewards (typically 3).
   * @param goldAmount - Gold amount awarded.
   * @param hoveredIndex - Index of the hovered card, or null.
   * @returns Complete layout data for all reward screen elements.
   */
  calculate(
    cards: CardData[],
    goldAmount: number,
    hoveredIndex: number | null
  ): RewardUILayout {
    return {
      cards: this.calculateCardLayouts(cards, hoveredIndex),
      gold: this.calculateGoldLayout(goldAmount),
      skipButton: this.calculateSkipButtonLayout(),
      title: this.calculateTitleLayout(),
    };
  }

  // -------------------------------------------------------------------------
  // Private Helpers
  // -------------------------------------------------------------------------

  /**
   * Calculate layout for all card rewards.
   *
   * Cards are spread evenly in the center of the screen.
   * The hovered card lifts up by hoverLift pixels.
   */
  private calculateCardLayouts(
    cards: CardData[],
    hoveredIndex: number | null
  ): RewardCardLayout[] {
    if (cards.length === 0) return [];

    return cards.map((card, index) => {
      const isHovered = index === hoveredIndex;
      const x = this.calculateCardCenterX(index, cards.length);
      const baseY = this.cardTopMargin + this.cardHeight / 2;
      const y = isHovered ? baseY - this.hoverLift : baseY;

      return {
        index,
        x,
        y,
        width: this.cardWidth,
        height: this.cardHeight,
        color: this.getCardColor(card.type),
        card,
        isHovered,
      };
    });
  }

  /**
   * Calculate center X position for a card at the given index.
   *
   * Formula:
   *   totalWidth = cardCount * cardWidth + (cardCount - 1) * cardGap
   *   startX = (screenWidth - totalWidth) / 2
   *   centerX = startX + cardWidth/2 + index * (cardWidth + cardGap)
   */
  private calculateCardCenterX(index: number, cardCount: number): number {
    const totalWidth = cardCount * this.cardWidth + (cardCount - 1) * this.cardGap;
    const startX = (this.screenWidth - totalWidth) / 2;
    return startX + this.cardWidth / 2 + index * (this.cardWidth + this.cardGap);
  }

  /**
   * Calculate gold display layout.
   */
  private calculateGoldLayout(amount: number): GoldLayout {
    return {
      x: this.screenWidth / 2,
      y: this.goldY,
      amount,
      text: `${amount} Gold`,
    };
  }

  /**
   * Calculate skip button layout.
   */
  private calculateSkipButtonLayout(): SkipButtonLayout {
    return {
      x: this.screenWidth / 2,
      y: this.screenHeight - this.skipBottomMargin - this.skipButtonHeight / 2,
      width: this.skipButtonWidth,
      height: this.skipButtonHeight,
      label: 'Skip',
    };
  }

  /**
   * Calculate title layout.
   */
  private calculateTitleLayout(): TitleLayout {
    return {
      x: this.screenWidth / 2,
      y: this.titleY,
      text: this.titleText,
    };
  }

  /**
   * Get the display color for a card based on its type.
   * Same palette as CardHandDisplay for visual consistency.
   *
   * @param type - Card type string (e.g. 'attack', 'skill', 'power').
   * @returns Hex color number.
   */
  getCardColor(type: CardType | string): number {
    return CARD_COLORS[type] ?? DEFAULT_CARD_COLOR;
  }
}
