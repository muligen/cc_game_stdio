/**
 * combat-log-layout.ts — Pure layout calculator for the combat log panel.
 *
 * Computes positions and dimensions for the combat log display panel and
 * its individual entry rows. Supports collapsed (3 visible) and expanded
 * (up to 10 visible with scrolling) states.
 *
 * This is a layout calculator only — NO Phaser rendering happens here.
 * The CombatLogDisplay consumes layout results and creates GameObjects.
 *
 * Implements: S3-13 (Combat Log Display) from Sprint 3
 *   - Last 3 entries visible when collapsed
 *   - Expandable view with more entries
 *   - Right-side panel positioning
 *
 * Architecture: Pure TypeScript math — zero Phaser dependencies.
 *   Follows the same pattern as CombatHudLayout.
 */

import type { CombatLogEntry } from './combat-log-entry';

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

/**
 * Configuration for the combat log layout.
 * All values should come from ui-config.json in production.
 */
export interface CombatLogLayoutConfig {
  /** Screen width in pixels. Required. */
  screenWidth: number;
  /** Screen height in pixels. Required. */
  screenHeight: number;
  /** Panel width in pixels. Default: 300. */
  panelWidth?: number;
  /** Maximum visible entries in collapsed state. Default: 3. */
  maxVisibleEntries?: number;
  /** Maximum visible entries in expanded state. Default: 10. */
  expandedVisibleEntries?: number;
  /** Line height per entry in pixels. Default: 24. */
  lineHeight?: number;
  /** Padding inside the panel in pixels. Default: 10. */
  padding?: number;
  /** Top margin from screen top in pixels. Default: 80. */
  topMargin?: number;
  /** Side margin from screen edge in pixels. Default: 30. */
  sideMargin?: number;
}

// ---------------------------------------------------------------------------
// Layout Result Types
// ---------------------------------------------------------------------------

/**
 * Layout result for a single log entry row within the panel.
 */
export interface CombatLogEntryLayout {
  /** X position of the text. */
  x: number;
  /** Y position of the text. */
  y: number;
  /** Available width for text. */
  width: number;
  /** Height of this row. */
  height: number;
  /** Display text (truncated if necessary). */
  text: string;
  /** Hex color string for the text. */
  color: string;
}

/**
 * Complete layout result for the combat log panel.
 */
export interface CombatLogLayoutResult {
  /** X position of panel left edge. */
  panelX: number;
  /** Y position of panel top edge. */
  panelY: number;
  /** Panel width. */
  panelWidth: number;
  /** Panel height (varies with visible entry count). */
  panelHeight: number;
  /** Layout for each visible entry row. */
  entries: CombatLogEntryLayout[];
  /** X position of the expand/collapse button. */
  expandButtonX: number;
  /** Y position of the expand/collapse button. */
  expandButtonY: number;
  /** Width of the expand/collapse button. */
  expandButtonWidth: number;
  /** Height of the expand/collapse button. */
  expandButtonHeight: number;
  /** Whether the panel is currently expanded. */
  isExpanded: boolean;
}

// ---------------------------------------------------------------------------
// Defaults
// ---------------------------------------------------------------------------

/** Default panel width in pixels. */
const DEFAULT_PANEL_WIDTH = 300;

/** Default collapsed visible entries. */
const DEFAULT_MAX_VISIBLE = 3;

/** Default expanded visible entries. */
const DEFAULT_EXPANDED_VISIBLE = 10;

/** Default line height per entry. */
const DEFAULT_LINE_HEIGHT = 24;

/** Default padding inside the panel. */
const DEFAULT_PADDING = 10;

/** Default top margin. */
const DEFAULT_TOP_MARGIN = 80;

/** Default side margin. */
const DEFAULT_SIDE_MARGIN = 30;

/** Expand/collapse button height. */
const EXPAND_BUTTON_HEIGHT = 24;

// ---------------------------------------------------------------------------
// CombatLogLayoutCalculator
// ---------------------------------------------------------------------------

/**
 * CombatLogLayoutCalculator -- pure layout calculator for the combat log panel.
 *
 * Usage:
 *   const calc = new CombatLogLayoutCalculator(config);
 *   const layout = calc.calculateLayout(entries, 3, false);
 *   // Use layout.panelX, layout.entries, etc. to create Phaser GameObjects
 *
 * This class has no side effects and no Phaser dependencies.
 */
export class CombatLogLayoutCalculator {
  private readonly screenWidth: number;
  private readonly screenHeight: number;
  private readonly panelWidth: number;
  private readonly maxVisibleEntries: number;
  private readonly expandedVisibleEntries: number;
  private readonly lineHeight: number;
  private readonly padding: number;
  private readonly topMargin: number;
  private readonly sideMargin: number;

  /**
   * @param config - Layout configuration. screenWidth and screenHeight are required.
   */
  constructor(config: CombatLogLayoutConfig) {
    this.screenWidth = config.screenWidth;
    this.screenHeight = config.screenHeight;
    this.panelWidth = config.panelWidth ?? DEFAULT_PANEL_WIDTH;
    this.maxVisibleEntries = config.maxVisibleEntries ?? DEFAULT_MAX_VISIBLE;
    this.expandedVisibleEntries = config.expandedVisibleEntries ?? DEFAULT_EXPANDED_VISIBLE;
    this.lineHeight = config.lineHeight ?? DEFAULT_LINE_HEIGHT;
    this.padding = config.padding ?? DEFAULT_PADDING;
    this.topMargin = config.topMargin ?? DEFAULT_TOP_MARGIN;
    this.sideMargin = config.sideMargin ?? DEFAULT_SIDE_MARGIN;
  }

  // -------------------------------------------------------------------------
  // Public API
  // -------------------------------------------------------------------------

  /**
   * Calculate the complete combat log panel layout.
   *
   * @param entries - All log entries to consider (most recent N will be laid out).
   * @param visibleCount - Number of entries to display (collapsed=3, expanded=10).
   * @param isExpanded - Whether the panel is in expanded state.
   * @returns Complete layout result for the panel and all visible entries.
   */
  calculateLayout(
    entries: readonly CombatLogEntry[],
    visibleCount: number,
    isExpanded: boolean,
  ): CombatLogLayoutResult {
    const panelX = this.screenWidth - this.sideMargin - this.panelWidth;
    const panelY = this.topMargin;

    // Determine which entries to show
    const maxVisible = isExpanded ? this.expandedVisibleEntries : this.maxVisibleEntries;
    const effectiveVisibleCount = Math.min(visibleCount, maxVisible);
    const recentEntries = entries.length > effectiveVisibleCount
      ? entries.slice(entries.length - effectiveVisibleCount)
      : entries;

    // Calculate panel height based on visible entries
    const contentHeight = recentEntries.length * this.lineHeight;
    const panelHeight = this.padding + contentHeight + this.padding + EXPAND_BUTTON_HEIGHT;

    // Layout each entry row
    const entryLayouts: CombatLogEntryLayout[] = recentEntries.map((entry, i) => ({
      x: panelX + this.padding,
      y: panelY + this.padding + i * this.lineHeight,
      width: this.panelWidth - 2 * this.padding,
      height: this.lineHeight,
      text: entry.message,
      color: entry.color,
    }));

    // Expand/collapse button at the bottom of the panel
    const expandButtonY = panelY + this.padding + contentHeight + this.padding;
    const expandButtonWidth = this.panelWidth;

    return {
      panelX,
      panelY,
      panelWidth: this.panelWidth,
      panelHeight,
      entries: entryLayouts,
      expandButtonX: panelX,
      expandButtonY,
      expandButtonWidth,
      expandButtonHeight: EXPAND_BUTTON_HEIGHT,
      isExpanded,
    };
  }

  // -------------------------------------------------------------------------
  // Public Accessors
  // -------------------------------------------------------------------------

  /** Get the default collapsed visible entry count. */
  getDefaultVisibleCount(): number {
    return this.maxVisibleEntries;
  }

  /** Get the expanded visible entry count. */
  getExpandedVisibleCount(): number {
    return this.expandedVisibleEntries;
  }
}
