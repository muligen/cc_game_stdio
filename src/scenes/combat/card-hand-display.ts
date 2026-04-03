/**
 * card-hand-display.ts — Pure layout calculator for the card hand fan display.
 *
 * Computes card positions, colors, and playability for the combat hand area.
 * This is a layout calculator only — NO Phaser rendering happens here.
 * The CombatScene consumes layout results and creates Phaser GameObjects.
 *
 * Implements: design/gdd/combat-ui.md (Card Display in Hand, Fan Layout Formula)
 * Architecture: ADR-001 (data-driven values from config)
 *
 * Key design decisions:
 * - Pure TypeScript math — zero Phaser dependencies
 * - All layout values from CardHandConfig (data-driven)
 * - Handles overflow by compressing effective spacing (minimum card width enforced)
 * - isPlayable respects turn phase and energy constraints
 * - Card colors mapped by type from config lookup
 */

import { CardType } from '../../types/card';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * CardUIState — the UI projection of a card in the player's hand.
 *
 * This is the input contract for the layout calculator. CombatUIStateSync
 * (or a future hand tracker) produces these from CombatCardInstance data.
 */
export interface CardUIState {
  /** Unique instance ID for this combat. */
  instanceId: string;
  /** Card definition ID (e.g. "strike_red"). */
  cardId: string;
  /** Display name. */
  name: string;
  /** Card type — determines color. */
  type: CardType | string;
  /** Energy cost to play. */
  cost: number;
  /** Description text with computed values. */
  description: string;
  /** Whether this card has been upgraded. */
  upgraded: boolean;
}

/**
 * Configuration for the card hand layout.
 * All values should come from ui-config.json in production.
 */
export interface CardHandConfig {
  /** Card width in pixels. Default: 120. */
  cardWidth?: number;
  /** Card height in pixels. Default: 170. */
  cardHeight?: number;
  /** Gap between cards in pixels. Default: 10. */
  gap?: number;
  /** Bottom margin from screen edge in pixels. Default: 80. */
  bottomMargin?: number;
  /** Y lift when card is hovered. Default: 20. */
  hoverLift?: number;
  /** Y lift when card is selected/targeting. Default: 40. */
  selectLift?: number;
  /** Screen width in pixels. Required. */
  screenWidth: number;
  /** Screen height in pixels. Required. */
  screenHeight: number;
}

/**
 * Layout result for a single card in the hand.
 * The CombatScene uses this to position Phaser GameObjects.
 */
export interface CardLayoutResult {
  /** Index of this card in the hand array. */
  index: number;
  /** X position of the card's top-left corner. */
  x: number;
  /** Y position of the card's top-left corner. */
  y: number;
  /** Card width in pixels. */
  width: number;
  /** Card height in pixels. */
  height: number;
  /** Card color as a hex number (e.g. 0xCC3333 for attack). */
  color: number;
  /** Alpha opacity: 1.0 for playable, 0.5 for unplayable. */
  alpha: number;
  /** Reference to the source CardUIState. */
  card: CardUIState;
  /** Whether this card is the hovered card. */
  isHovered: boolean;
  /** Whether this card is the selected/targeting card. */
  isSelected: boolean;
  /** Whether this card can be played given current energy and phase. */
  isPlayable: boolean;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Minimum card width enforced during overflow compression. */
const MIN_CARD_WIDTH = 80;

/** Alpha for unplayable cards. */
const UNPLAYABLE_ALPHA = 0.5;

/** Alpha for playable cards. */
const PLAYABLE_ALPHA = 1.0;

/** Card color map by type. Per combat-ui GDD tuning knobs. */
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
// CardHandDisplay
// ---------------------------------------------------------------------------

/**
 * CardHandDisplay — pure layout calculator for the card hand fan display.
 *
 * Usage:
 *   const display = new CardHandDisplay(config);
 *   const layout = display.calculateLayout(handCards, hoveredIdx, selectedIdx, energy, phase);
 *   // Use layout[].x, .y, .color, .alpha to create Phaser GameObjects
 *
 * This class has no side effects and no Phaser dependencies.
 */
export class CardHandDisplay {
  private readonly cardWidth: number;
  private readonly cardHeight: number;
  private readonly gap: number;
  private readonly bottomMargin: number;
  private readonly hoverLift: number;
  private readonly selectLift: number;
  private readonly screenWidth: number;
  private readonly screenHeight: number;

  /**
   * @param config - Layout configuration. screenWidth and screenHeight are required.
   */
  constructor(config: CardHandConfig) {
    this.cardWidth = config.cardWidth ?? 120;
    this.cardHeight = config.cardHeight ?? 170;
    this.gap = config.gap ?? 10;
    this.bottomMargin = config.bottomMargin ?? 80;
    this.hoverLift = config.hoverLift ?? 20;
    this.selectLift = config.selectLift ?? 40;
    this.screenWidth = config.screenWidth;
    this.screenHeight = config.screenHeight;
  }

  // -------------------------------------------------------------------------
  // Public API
  // -------------------------------------------------------------------------

  /**
   * Calculate layout positions for all cards in the hand.
   *
   * @param cards - Array of card UI states in hand order (left to right).
   * @param hoveredIndex - Index of the hovered card, or null.
   * @param selectedIndex - Index of the selected/targeting card, or null.
   * @param currentEnergy - Current available energy.
   * @param phase - Current turn phase string ('player_turn', 'enemy_turn', etc.).
   * @returns Array of layout results, one per card.
   */
  calculateLayout(
    cards: CardUIState[],
    hoveredIndex: number | null,
    selectedIndex: number | null,
    currentEnergy: number = 0,
    phase: string = 'unknown'
  ): CardLayoutResult[] {
    if (cards.length === 0) return [];

    const handSize = cards.length;
    const step = this.calculateStep(handSize);

    return cards.map((card, index) => {
      const isHovered = index === hoveredIndex;
      const isSelected = index === selectedIndex;
      const playable = this.isPlayable(card, currentEnergy, phase);
      const baseY = this.screenHeight - this.cardHeight - this.bottomMargin;

      return {
        index,
        x: this.calculateCardX(index, handSize, step),
        y: this.calculateCardY(baseY, isHovered, isSelected),
        width: this.cardWidth,
        height: this.cardHeight,
        color: this.getCardColor(card.type),
        alpha: playable ? PLAYABLE_ALPHA : UNPLAYABLE_ALPHA,
        card,
        isHovered,
        isSelected,
        isPlayable: playable,
      };
    });
  }

  /**
   * Get the display color for a card based on its type.
   *
   * @param type - Card type string (e.g. 'attack', 'skill', 'power').
   * @returns Hex color number.
   */
  getCardColor(type: string): number {
    return CARD_COLORS[type] ?? DEFAULT_CARD_COLOR;
  }

  /**
   * Check if a card is playable given current energy and turn phase.
   *
   * A card is playable when:
   * - The current phase is 'player_turn'
   * - The player has enough energy to pay the cost
   *
   * @param card - Card to check.
   * @param currentEnergy - Current available energy.
   * @param phase - Current turn phase string.
   * @returns True if the card can be played.
   */
  isPlayable(card: CardUIState, currentEnergy: number, phase: string): boolean {
    if (phase !== 'player_turn') return false;
    return currentEnergy >= card.cost;
  }

  // -------------------------------------------------------------------------
  // Private Helpers
  // -------------------------------------------------------------------------

  /**
   * Calculate the horizontal step between card origins.
   *
   * For small hands, step = cardWidth + gap (standard fan).
   * For large hands that would overflow, step is compressed so that
   * cards fit within the screen width, ensuring a minimum effective
   * card width of MIN_CARD_WIDTH pixels.
   */
  private calculateStep(handSize: number): number {
    const naturalStep = this.cardWidth + this.gap;
    const totalNaturalWidth = handSize * this.cardWidth + (handSize - 1) * this.gap;

    // If natural layout fits, use it
    if (totalNaturalWidth <= this.screenWidth) {
      return naturalStep;
    }

    // Overflow: compress step to fit within screen
    // totalWidth = handSize * cardWidth + (handSize - 1) * compressedGap
    // We want totalWidth <= screenWidth
    // cardWidth + compressedGap = screenWidth / handSize (approximately)
    // But we enforce minimum card width in terms of step:
    // step = (screenWidth - cardWidth) / (handSize - 1)
    // This ensures the last card's right edge is at or near screenWidth.
    const compressedStep =
      (this.screenWidth - this.cardWidth) / (handSize - 1);

    // Enforce minimum effective card width: step must be at least MIN_CARD_WIDTH
    return Math.max(compressedStep, MIN_CARD_WIDTH);
  }

  /**
   * Calculate X position for a card using the GDD formula.
   */
  private calculateCardX(index: number, handSize: number, step: number): number {
    const totalWidth = (handSize - 1) * step + this.cardWidth;
    const startX = (this.screenWidth - totalWidth) / 2;
    return startX + index * step;
  }

  /**
   * Calculate Y position for a card.
   * Select lift takes priority over hover lift.
   */
  private calculateCardY(baseY: number, isHovered: boolean, isSelected: boolean): number {
    if (isSelected) return baseY - this.selectLift;
    if (isHovered) return baseY - this.hoverLift;
    return baseY;
  }
}
