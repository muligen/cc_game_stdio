/**
 * combat-hud-layout.ts — Pure layout calculator for the combat HUD chrome.
 *
 * Computes positions and dimensions for all non-card combat UI elements:
 * turn indicator, enemy display area, player HP bar, energy orb, end turn
 * button, potion slots, relic bar, combat log, and pile counters.
 *
 * This is a layout calculator only — NO Phaser rendering happens here.
 * The CombatScene consumes layout results and creates Phaser GameObjects.
 *
 * Implements: design/gdd/combat-ui.md (Screen Layout, UI Components, HP Bar,
 *   Energy Orb, End Turn Button, Potion Slots, Combat Log)
 * Architecture: ADR-001 (data-driven values from config)
 *
 * Key design decisions:
 * - Pure TypeScript math — zero Phaser dependencies
 * - All layout values from CombatHudConfig (data-driven, matches ui-config.json)
 * - HP bar color computed from percentage thresholds in GDD
 * - Block overlay width capped at barMaxWidth per GDD edge case #6
 * - Enemy display distributes horizontally in upper-center zone
 * - Responsive to screen dimensions — minimum supported 1280x720
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * Configuration for the combat HUD layout.
 * All values should come from ui-config.json in production.
 */
export interface CombatHudConfig {
  /** Screen width in pixels. Required. */
  screenWidth: number;
  /** Screen height in pixels. Required. */
  screenHeight: number;
  /** HP bar maximum width in pixels. Default: 200. */
  hpBarMaxWidth?: number;
  /** HP bar height in pixels. Default: 20. */
  hpBarHeight?: number;
  /** Bottom margin for HUD strip (relic bar, hand area). Default: 80. */
  bottomMargin?: number;
  /** Top margin for turn indicator. Default: 20. */
  topMargin?: number;
  /** Side margin for edge-anchored elements. Default: 30. */
  sideMargin?: number;
  /** End turn button width. Default: 160. */
  endTurnButtonWidth?: number;
  /** End turn button height. Default: 50. */
  endTurnButtonHeight?: number;
  /** Potion slot size (square). Default: 40. */
  potionSlotSize?: number;
  /** Potion slot gap. Default: 8. */
  potionSlotGap?: number;
  /** Maximum number of potion slots. Default: 3. */
  maxPotionSlots?: number;
  /** Combat log width. Default: 220. */
  combatLogWidth?: number;
  /** Combat log max entries. Default: 50. */
  combatLogMaxEntries?: number;
  /** Combat log default visible entries. Default: 3. */
  combatLogDefaultVisible?: number;
  /** Enemy display area top offset. Default: 60. */
  enemyAreaTopOffset?: number;
  /** Maximum enemy display count. Default: 5. */
  maxEnemyDisplayCount?: number;
  /** Enemy display card width. Default: 160. */
  enemyDisplayWidth?: number;
  /** Enemy display card height. Default: 200. */
  enemyDisplayHeight?: number;
  /** Enemy display horizontal gap. Default: 20. */
  enemyDisplayGap?: number;
  /** Relic bar icon size. Default: 32. */
  relicIconSize?: number;
  /** Relic bar gap. Default: 6. */
  relicBarGap?: number;
  /** Relic bar bottom offset from screen bottom. Default: 10. */
  relicBarBottomOffset?: number;
  /** Energy orb radius. Default: 30. */
  energyOrbRadius?: number;
  /** Pile counter icon size. Default: 24. */
  pileCounterIconSize?: number;
}

/** HP bar color based on health percentage. */
export enum HPBarColor {
  /** HP > 50% maxHP. */
  GREEN = 0x44bb44,
  /** HP 25-50% maxHP. */
  YELLOW = 0xcccc22,
  /** HP < 25% maxHP. */
  RED = 0xcc3333,
}

/** Layout result for the turn indicator. */
export interface TurnIndicatorLayout {
  /** X position (centered). */
  x: number;
  /** Y position (top margin). */
  y: number;
}

/** Layout result for the player HP bar. */
export interface HPBarLayout {
  /** X position of HP bar left edge. */
  x: number;
  /** Y position of HP bar top edge. */
  y: number;
  /** Total bar width (max). */
  maxWidth: number;
  /** Total bar height. */
  height: number;
  /** Filled width based on current HP. */
  filledWidth: number;
  /** Block overlay width (capped at maxWidth). */
  blockOverlayWidth: number;
  /** Bar color based on HP percentage. */
  color: HPBarColor;
}

/** Layout result for the energy orb. */
export interface EnergyOrbLayout {
  /** Center X position. */
  x: number;
  /** Center Y position. */
  y: number;
  /** Orb radius. */
  radius: number;
}

/** Layout result for the end turn button. */
export interface EndTurnButtonLayout {
  /** X position (top-left). */
  x: number;
  /** Y position (top-left). */
  y: number;
  /** Button width. */
  width: number;
  /** Button height. */
  height: number;
}

/** Layout result for a single potion slot. */
export interface PotionSlotLayout {
  /** Slot index (0-based). */
  index: number;
  /** X position (top-left). */
  x: number;
  /** Y position (top-left). */
  y: number;
  /** Slot size (width and height). */
  size: number;
}

/** Layout result for all potion slots. */
export interface PotionSlotsLayout {
  /** Individual slot positions. */
  slots: PotionSlotLayout[];
}

/** Layout result for the combat log panel. */
export interface CombatLogLayout {
  /** X position (left edge). */
  x: number;
  /** Y position (top edge). */
  y: number;
  /** Panel width. */
  width: number;
  /** Panel height. */
  height: number;
}

/** Layout result for a single enemy display. */
export interface EnemyDisplayLayout {
  /** Enemy index (0-based). */
  index: number;
  /** X position (top-left of enemy card). */
  x: number;
  /** Y position (top-left of enemy card). */
  y: number;
  /** Display card width. */
  width: number;
  /** Display card height. */
  height: number;
}

/** Layout result for the relic bar. */
export interface RelicBarLayout {
  /** X position (left edge of first icon). */
  x: number;
  /** Y position (top edge). */
  y: number;
  /** Icon size (width and height). */
  iconSize: number;
  /** Gap between icons. */
  gap: number;
  /** X position for a relic at a given index. */
  getRelicX: (index: number) => number;
}

/** Layout result for pile counters (draw/discard/exhaust). */
export interface PileCountersLayout {
  /** X position of the first counter. */
  x: number;
  /** Y position (top edge). */
  y: number;
  /** Icon size. */
  iconSize: number;
  /** Gap between counters. */
  gap: number;
  /** X position for a counter at a given index. */
  getCounterX: (index: number) => number;
}

/** Complete combat HUD layout result. */
export interface CombatHudLayoutResult {
  turnIndicator: TurnIndicatorLayout;
  playerHPBar: HPBarLayout;
  energyOrb: EnergyOrbLayout;
  endTurnButton: EndTurnButtonLayout;
  potionSlots: PotionSlotsLayout;
  combatLog: CombatLogLayout;
  enemies: EnemyDisplayLayout[];
  relicBar: RelicBarLayout;
  pileCounters: PileCountersLayout;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** HP percentage threshold for green bar. > 50%. */
const HP_GREEN_THRESHOLD = 0.5;

/** HP percentage threshold for yellow bar. >= 25%. */
const HP_YELLOW_THRESHOLD = 0.25;

/** Minimum HP bar width (1px visible even at 1 HP per GDD edge case #5). */
const MIN_HP_BAR_WIDTH = 1;

/** Maximum number of enemies displayed per GDD edge case #3. */

// ---------------------------------------------------------------------------
// CombatHudLayout
// ---------------------------------------------------------------------------

/**
 * CombatHudLayout -- pure layout calculator for combat HUD chrome elements.
 *
 * Usage:
 *   const hud = new CombatHudLayout(config);
 *   const layout = hud.calculateLayout(hpState, energyState, enemyCount, ...);
 *   // Use layout.playerHPBar, layout.energyOrb, etc. to create Phaser GameObjects
 *
 * This class has no side effects and no Phaser dependencies.
 */
export class CombatHudLayout {
  private readonly screenWidth: number;
  private readonly screenHeight: number;
  private readonly hpBarMaxWidth: number;
  private readonly hpBarHeight: number;
  private readonly bottomMargin: number;
  private readonly topMargin: number;
  private readonly sideMargin: number;
  private readonly endTurnButtonWidth: number;
  private readonly endTurnButtonHeight: number;
  private readonly potionSlotSize: number;
  private readonly potionSlotGap: number;
  private readonly maxPotionSlots: number;
  private readonly combatLogWidth: number;
  private readonly _combatLogMaxEntries: number;
  private readonly _combatLogDefaultVisible: number;
  private readonly enemyAreaTopOffset: number;
  private readonly maxEnemyDisplayCount: number;
  private readonly enemyDisplayWidth: number;
  private readonly enemyDisplayHeight: number;
  private readonly enemyDisplayGap: number;
  private readonly relicIconSize: number;
  private readonly relicBarGap: number;
  private readonly relicBarBottomOffset: number;
  private readonly energyOrbRadius: number;
  private readonly pileCounterIconSize: number;

  /**
   * @param config - Layout configuration. screenWidth and screenHeight are required.
   */
  constructor(config: CombatHudConfig) {
    this.screenWidth = config.screenWidth;
    this.screenHeight = config.screenHeight;
    this.hpBarMaxWidth = config.hpBarMaxWidth ?? 200;
    this.hpBarHeight = config.hpBarHeight ?? 20;
    this.bottomMargin = config.bottomMargin ?? 80;
    this.topMargin = config.topMargin ?? 20;
    this.sideMargin = config.sideMargin ?? 30;
    this.endTurnButtonWidth = config.endTurnButtonWidth ?? 160;
    this.endTurnButtonHeight = config.endTurnButtonHeight ?? 50;
    this.potionSlotSize = config.potionSlotSize ?? 40;
    this.potionSlotGap = config.potionSlotGap ?? 8;
    this.maxPotionSlots = config.maxPotionSlots ?? 3;
    this.combatLogWidth = config.combatLogWidth ?? 220;
    this._combatLogMaxEntries = config.combatLogMaxEntries ?? 50;
    this._combatLogDefaultVisible = config.combatLogDefaultVisible ?? 3;
    this.enemyAreaTopOffset = config.enemyAreaTopOffset ?? 60;
    this.maxEnemyDisplayCount = config.maxEnemyDisplayCount ?? 5;
    this.enemyDisplayWidth = config.enemyDisplayWidth ?? 160;
    this.enemyDisplayHeight = config.enemyDisplayHeight ?? 200;
    this.enemyDisplayGap = config.enemyDisplayGap ?? 20;
    this.relicIconSize = config.relicIconSize ?? 32;
    this.relicBarGap = config.relicBarGap ?? 6;
    this.relicBarBottomOffset = config.relicBarBottomOffset ?? 10;
    this.energyOrbRadius = config.energyOrbRadius ?? 30;
    this.pileCounterIconSize = config.pileCounterIconSize ?? 24;
  }

  // -------------------------------------------------------------------------
  // Public API
  // -------------------------------------------------------------------------

  /**
   * Calculate the complete HUD layout.
   *
   * @param params - Current combat state parameters for layout computation.
   * @returns Complete layout result for all HUD elements.
   */
  calculateLayout(params: HudLayoutParams): CombatHudLayoutResult {
    return {
      turnIndicator: this.calculateTurnIndicator(),
      playerHPBar: this.calculateHPBar(params),
      energyOrb: this.calculateEnergyOrb(),
      endTurnButton: this.calculateEndTurnButton(),
      potionSlots: this.calculatePotionSlots(),
      combatLog: this.calculateCombatLog(),
      enemies: this.calculateEnemyDisplays(params.enemyCount),
      relicBar: this.calculateRelicBar(),
      pileCounters: this.calculatePileCounters(),
    };
  }

  /**
   * Compute the filled width of the HP bar.
   * Per GDD formula: Math.max(1, (currentHP / maxHP) * barMaxWidth)
   */
  calculateHPFilledWidth(currentHP: number, maxHP: number): number {
    if (maxHP <= 0) return MIN_HP_BAR_WIDTH;
    return Math.max(MIN_HP_BAR_WIDTH, (currentHP / maxHP) * this.hpBarMaxWidth);
  }

  /**
   * Compute the block overlay width.
   * Per GDD formula: Math.min((block / maxHP) * barMaxWidth, barMaxWidth)
   */
  calculateBlockOverlayWidth(block: number, maxHP: number): number {
    if (maxHP <= 0) return 0;
    return Math.min((block / maxHP) * this.hpBarMaxWidth, this.hpBarMaxWidth);
  }

  /**
   * Determine HP bar color based on current HP percentage.
   * Per GDD: green > 50%, yellow 25-50%, red < 25%.
   */
  getHPBarColor(currentHP: number, maxHP: number): HPBarColor {
    if (maxHP <= 0) return HPBarColor.RED;
    const pct = currentHP / maxHP;
    if (pct > HP_GREEN_THRESHOLD) return HPBarColor.GREEN;
    if (pct >= HP_YELLOW_THRESHOLD) return HPBarColor.YELLOW;
    return HPBarColor.RED;
  }

  /**
   * Calculate enemy display layouts for a given enemy count.
   * Distributes enemies horizontally in the upper-center area.
   * Caps display at maxEnemyDisplayCount.
   */
  calculateEnemyDisplays(enemyCount: number): EnemyDisplayLayout[] {
    const count = Math.min(enemyCount, this.maxEnemyDisplayCount);
    if (count === 0) return [];

    const totalWidth = count * this.enemyDisplayWidth + (count - 1) * this.enemyDisplayGap;
    const startX = (this.screenWidth - totalWidth) / 2;
    const y = this.enemyAreaTopOffset;

    return Array.from({ length: count }, (_, i) => ({
      index: i,
      x: startX + i * (this.enemyDisplayWidth + this.enemyDisplayGap),
      y,
      width: this.enemyDisplayWidth,
      height: this.enemyDisplayHeight,
    }));
  }

  // -------------------------------------------------------------------------
  // Public Accessors
  // -------------------------------------------------------------------------

  /** Maximum number of combat log entries. From ui-config.json. */
  get combatLogMaxEntries(): number {
    return this._combatLogMaxEntries;
  }

  /** Default number of visible combat log entries before scrolling. */
  get combatLogDefaultVisible(): number {
    return this._combatLogDefaultVisible;
  }

  // -------------------------------------------------------------------------
  // Private Calculations
  // -------------------------------------------------------------------------

  /** Turn indicator: centered at top of screen. */
  private calculateTurnIndicator(): TurnIndicatorLayout {
    return {
      x: this.screenWidth / 2,
      y: this.topMargin,
    };
  }

  /** Player HP bar: bottom-left area. */
  private calculateHPBar(params: HudLayoutParams): HPBarLayout {
    const x = this.sideMargin;
    const y = this.screenHeight - this.bottomMargin - this.hpBarHeight - 30;

    return {
      x,
      y,
      maxWidth: this.hpBarMaxWidth,
      height: this.hpBarHeight,
      filledWidth: this.calculateHPFilledWidth(params.currentHP, params.maxHP),
      blockOverlayWidth: this.calculateBlockOverlayWidth(params.block, params.maxHP),
      color: this.getHPBarColor(params.currentHP, params.maxHP),
    };
  }

  /** Energy orb: bottom-left, above HP bar. */
  private calculateEnergyOrb(): EnergyOrbLayout {
    return {
      x: this.sideMargin + this.energyOrbRadius,
      y: this.screenHeight - this.bottomMargin - this.hpBarHeight - 30 - 20 - this.energyOrbRadius,
      radius: this.energyOrbRadius,
    };
  }

  /** End turn button: bottom-right. */
  private calculateEndTurnButton(): EndTurnButtonLayout {
    return {
      x: this.screenWidth - this.sideMargin - this.endTurnButtonWidth,
      y: this.screenHeight - this.bottomMargin - this.endTurnButtonHeight,
      width: this.endTurnButtonWidth,
      height: this.endTurnButtonHeight,
    };
  }

  /** Potion slots: bottom-right, above end turn button. */
  private calculatePotionSlots(): PotionSlotsLayout {
    const totalSlotWidth =
      this.maxPotionSlots * this.potionSlotSize +
      (this.maxPotionSlots - 1) * this.potionSlotGap;
    const startX = this.screenWidth - this.sideMargin - totalSlotWidth;
    const y =
      this.screenHeight -
      this.bottomMargin -
      this.endTurnButtonHeight -
      15 -
      this.potionSlotSize;

    const slots: PotionSlotLayout[] = Array.from({ length: this.maxPotionSlots }, (_, i) => ({
      index: i,
      x: startX + i * (this.potionSlotSize + this.potionSlotGap),
      y,
      size: this.potionSlotSize,
    }));

    return { slots };
  }

  /** Combat log: right side, below top margin. */
  private calculateCombatLog(): CombatLogLayout {
    return {
      x: this.screenWidth - this.sideMargin - this.combatLogWidth,
      y: this.topMargin + 30,
      width: this.combatLogWidth,
      height: this.screenHeight - this.topMargin - 30 - this.bottomMargin - 100,
    };
  }

  /** Relic bar: bottom edge, centered. */
  private calculateRelicBar(): RelicBarLayout {
    const y = this.screenHeight - this.relicBarBottomOffset - this.relicIconSize;
    const getRelicX = (index: number): number => {
      // Center the relic bar: assume relics are left-anchored at sideMargin
      return this.sideMargin + index * (this.relicIconSize + this.relicBarGap);
    };

    return {
      x: this.sideMargin,
      y,
      iconSize: this.relicIconSize,
      gap: this.relicBarGap,
      getRelicX,
    };
  }

  /** Pile counters: near energy orb (bottom-left). */
  private calculatePileCounters(): PileCountersLayout {
    const x = this.sideMargin + this.energyOrbRadius * 2 + 15;
    const y = this.screenHeight - this.bottomMargin - this.hpBarHeight - 30 + 5;
    const getCounterX = (index: number): number => {
      return x + index * (this.pileCounterIconSize + 10);
    };

    return {
      x,
      y,
      iconSize: this.pileCounterIconSize,
      gap: 10,
      getCounterX,
    };
  }
}

// ---------------------------------------------------------------------------
// Layout Parameter Types
// ---------------------------------------------------------------------------

/** Parameters needed to compute the HUD layout. */
export interface HudLayoutParams {
  /** Player current HP. */
  currentHP: number;
  /** Player max HP. */
  maxHP: number;
  /** Player current block. */
  block: number;
  /** Number of alive enemies to display. */
  enemyCount: number;
}
