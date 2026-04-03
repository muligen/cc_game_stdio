/**
 * enemy-display.ts — Pure layout calculator for enemy display in combat.
 *
 * Computes enemy positions, HP bar dimensions, block overlay, intent rendering
 * data, and targeting highlight state. This is a layout calculator only — NO
 * Phaser rendering happens here. The CombatScene consumes layout results and
 * creates Phaser GameObjects.
 *
 * Implements: design/gdd/combat-ui.md (Enemy Intent Display, HP Bar Design,
 *   Enemy Display positioning, Card Targeting highlights)
 * Architecture: ADR-001 (data-driven values from config)
 *
 * Key design decisions:
 * - Pure TypeScript math — zero Phaser dependencies
 * - All layout values from EnemyDisplayConfig (data-driven)
 * - HP bar width uses the GDD formula: max(1, (currentHP / maxHP) * barMaxWidth)
 * - HP bar color: green > 50%, yellow 25-50%, red < 25%
 * - Block overlay width capped at barMaxWidth per GDD edge case #6
 * - Dead enemies are included in layout with isAlive=false for fade-out rendering
 * - Intent display data carried as-is from UIEnemyState.intent
 * - Targeting highlight computed from hoveredCardTargetType + enemy index
 * - Positions enemies evenly across the upper-center zone
 */

import type { UIEnemyState, UIIntentData } from './combat-ui-state';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * Configuration for the enemy display layout.
 * All values should come from ui-config.json in production.
 */
export interface EnemyDisplayConfig {
  /** Maximum width of the HP bar in pixels. Default: 200. */
  hpBarMaxWidth?: number;
  /** Height of the HP bar in pixels. Default: 16. */
  hpBarHeight?: number;
  /** Height of the block overlay in pixels. Default: 16 (same as HP bar). */
  blockOverlayHeight?: number;
  /** Width of the enemy panel (sprite + info area). Default: 160. */
  panelWidth?: number;
  /** Height of the enemy panel. Default: 220. */
  panelHeight?: number;
  /** Horizontal gap between enemy panels in pixels. Default: 40. */
  gap?: number;
  /** Top margin from screen edge in pixels. Default: 80. */
  topMargin?: number;
  /** Y offset for the HP bar relative to panel bottom. Default: 0. */
  hpBarYOffset?: number;
  /** Y offset for intent display relative to panel top. Default: -40. */
  intentYOffset?: number;
  /** Y offset for block value display relative to HP bar. Default: -20. */
  blockValueYOffset?: number;
  /** Screen width in pixels. Required. */
  screenWidth: number;
  /** Screen height in pixels. Required. */
  screenHeight: number;
}

/**
 * HP bar color based on health percentage.
 */
export enum HPBarColor {
  /** HP > 50% maxHP. */
  GREEN = 'green',
  /** HP 25-50% maxHP. */
  YELLOW = 'yellow',
  /** HP < 25% maxHP. */
  RED = 'red',
}

/**
 * Layout result for a single enemy's display.
 * The CombatScene uses this to create Phaser GameObjects.
 */
export interface EnemyLayoutResult {
  /** Index of this enemy in the enemies array. */
  index: number;
  /** X position of the panel's center. */
  x: number;
  /** Y position of the panel's top edge. */
  y: number;
  /** Panel width in pixels. */
  width: number;
  /** Panel height in pixels. */
  height: number;
  /** HP bar rendering data. */
  hpBar: {
    /** X position of the HP bar (centered within panel). */
    x: number;
    /** Y position of the HP bar. */
    y: number;
    /** Full bar width (max). */
    maxWidth: number;
    /** Filled width based on current HP. */
    filledWidth: number;
    /** Height of the bar. */
    height: number;
    /** Color based on HP percentage. */
    color: HPBarColor;
  };
  /** Block overlay rendering data. */
  blockOverlay: {
    /** X position (same as HP bar). */
    x: number;
    /** Y position (overlaid on HP bar). */
    y: number;
    /** Filled width based on block amount. Capped at barMaxWidth. */
    filledWidth: number;
    /** Height of the overlay. */
    height: number;
    /** The actual block value to display as text. */
    blockValue: number;
    /** Y position for the block value text. */
    valueY: number;
  };
  /** Intent display data. */
  intent: {
    /** Whether intent should be displayed. */
    visible: boolean;
    /** X position of intent icon (centered on panel). */
    x: number;
    /** Y position of intent display. */
    y: number;
    /** Intent data from UIEnemyState (null if no intent). */
    data: UIIntentData | null;
  };
  /** Whether this enemy is alive. */
  isAlive: boolean;
  /** Whether this enemy is highlighted as a valid target. */
  isTargeted: boolean;
  /** Whether this enemy is hovered by the player. */
  isHovered: boolean;
  /** Reference to the source UIEnemyState. */
  enemy: UIEnemyState;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Minimum HP bar width in pixels. Per GDD: "Minimum 1px visible even at 1 HP." */
const MIN_HP_BAR_WIDTH = 1;

/** HP percentage thresholds for color changes. Per GDD HP Bar Design. */
const HP_GREEN_THRESHOLD = 0.5;
const HP_YELLOW_THRESHOLD = 0.25;

// ---------------------------------------------------------------------------
// EnemyDisplay
// ---------------------------------------------------------------------------

/**
 * EnemyDisplay — pure layout calculator for enemy rendering in combat.
 *
 * Usage:
 *   const display = new EnemyDisplay(config);
 *   const layout = display.calculateLayout(enemies, hoveredIdx, targetedIdx, isTargeting);
 *   // Use layout[].x, .y, .hpBar, .intent to create Phaser GameObjects
 *
 * This class has no side effects and no Phaser dependencies.
 */
export class EnemyDisplay {
  private readonly hpBarMaxWidth: number;
  private readonly hpBarHeight: number;
  private readonly blockOverlayHeight: number;
  private readonly panelWidth: number;
  private readonly panelHeight: number;
  private readonly gap: number;
  private readonly topMargin: number;
  private readonly hpBarYOffset: number;
  private readonly intentYOffset: number;
  private readonly blockValueYOffset: number;
  private readonly screenWidth: number;
  private readonly _screenHeight: number;

  /**
   * @param config - Layout configuration. screenWidth and screenHeight are required.
   */
  constructor(config: EnemyDisplayConfig) {
    this.hpBarMaxWidth = config.hpBarMaxWidth ?? 200;
    this.hpBarHeight = config.hpBarHeight ?? 16;
    this.blockOverlayHeight = config.blockOverlayHeight ?? 16;
    this.panelWidth = config.panelWidth ?? 160;
    this.panelHeight = config.panelHeight ?? 220;
    this.gap = config.gap ?? 40;
    this.topMargin = config.topMargin ?? 80;
    this.hpBarYOffset = config.hpBarYOffset ?? 0;
    this.intentYOffset = config.intentYOffset ?? -40;
    this.blockValueYOffset = config.blockValueYOffset ?? -20;
    this.screenWidth = config.screenWidth;
    this._screenHeight = config.screenHeight;
  }

  // ---------------------------------------------------------------------------
  // Public API
  // ---------------------------------------------------------------------------

  /**
   * Calculate layout positions for all enemies in the combat.
   *
   * @param enemies - Array of UIEnemyState from CombatUIState.
   * @param hoveredIndex - Index of the hovered enemy, or null.
   * @param targetedIndex - Index of the targeted enemy (during card targeting), or null.
   * @param isTargeting - Whether the player is currently targeting (card requiring enemy target).
   * @returns Array of layout results, one per enemy.
   */
  calculateLayout(
    enemies: UIEnemyState[],
    hoveredIndex: number | null,
    targetedIndex: number | null,
    isTargeting: boolean = false
  ): EnemyLayoutResult[] {
    if (enemies.length === 0) return [];

    const totalEnemies = enemies.length;

    return enemies.map((enemy, index) => {
      const isHovered = index === hoveredIndex;
      const isTargeted = isTargeting && index === targetedIndex && enemy.isAlive;
      const panelX = this.calculateEnemyX(index, totalEnemies);
      const panelY = this.topMargin;

      const hpBarX = panelX - this.hpBarMaxWidth / 2;
      const hpBarY = panelY + this.panelHeight + this.hpBarYOffset;

      return {
        index,
        x: panelX,
        y: panelY,
        width: this.panelWidth,
        height: this.panelHeight,
        hpBar: {
          x: hpBarX,
          y: hpBarY,
          maxWidth: this.hpBarMaxWidth,
          filledWidth: this.calculateHPBarWidth(enemy.currentHP, enemy.maxHP),
          height: this.hpBarHeight,
          color: this.getHPBarColor(enemy.currentHP, enemy.maxHP),
        },
        blockOverlay: {
          x: hpBarX,
          y: hpBarY,
          filledWidth: this.calculateBlockOverlayWidth(enemy.block, enemy.maxHP),
          height: this.blockOverlayHeight,
          blockValue: enemy.block,
          valueY: hpBarY + this.blockValueYOffset,
        },
        intent: {
          visible: enemy.isAlive && enemy.intent !== null,
          x: panelX,
          y: panelY + this.intentYOffset,
          data: enemy.intent,
        },
        isAlive: enemy.isAlive,
        isTargeted,
        isHovered,
        enemy,
      };
    });
  }

  /**
   * Calculate the filled width of an HP bar.
   * Per GDD formula: max(1, (currentHP / maxHP) * barMaxWidth)
   *
   * @param currentHP - Current HP value.
   * @param maxHP - Maximum HP value.
   * @returns Filled width in pixels (minimum 1px).
   */
  calculateHPBarWidth(currentHP: number, maxHP: number): number {
    if (maxHP <= 0) return MIN_HP_BAR_WIDTH;
    const ratio = Math.max(0, currentHP) / maxHP;
    return Math.max(MIN_HP_BAR_WIDTH, ratio * this.hpBarMaxWidth);
  }

  /**
   * Calculate the block overlay width.
   * Per GDD formula: min((block / maxHP) * barMaxWidth, barMaxWidth)
   * Capped at barMaxWidth per edge case #6.
   *
   * @param block - Current block amount.
   * @param maxHP - Maximum HP value (used as reference scale).
   * @returns Block overlay width in pixels.
   */
  calculateBlockOverlayWidth(block: number, maxHP: number): number {
    if (block <= 0 || maxHP <= 0) return 0;
    return Math.min((block / maxHP) * this.hpBarMaxWidth, this.hpBarMaxWidth);
  }

  /**
   * Determine HP bar color based on health percentage.
   * Per GDD: green > 50%, yellow 25-50%, red < 25%.
   *
   * @param currentHP - Current HP value.
   * @param maxHP - Maximum HP value.
   * @returns HP bar color.
   */
  getHPBarColor(currentHP: number, maxHP: number): HPBarColor {
    if (maxHP <= 0) return HPBarColor.RED;
    const ratio = Math.max(0, currentHP) / maxHP;
    if (ratio > HP_GREEN_THRESHOLD) return HPBarColor.GREEN;
    if (ratio > HP_YELLOW_THRESHOLD) return HPBarColor.YELLOW;
    return HPBarColor.RED;
  }

  // ---------------------------------------------------------------------------
  // Private Helpers
  // ---------------------------------------------------------------------------

  /**
   * Calculate the X center position for an enemy panel.
   * Enemies are evenly distributed across the upper-center area.
   *
   * Formula:
   *   totalWidth = count * panelWidth + (count - 1) * gap
   *   startX = (screenWidth - totalWidth) / 2
   *   panelCenterX = startX + index * (panelWidth + gap) + panelWidth / 2
   */
  private calculateEnemyX(index: number, count: number): number {
    const totalWidth = count * this.panelWidth + (count - 1) * this.gap;
    const startX = (this.screenWidth - totalWidth) / 2;
    return startX + index * (this.panelWidth + this.gap) + this.panelWidth / 2;
  }
}
