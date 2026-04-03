/**
 * map-layout.ts -- Pure layout calculator for map nodes.
 *
 * Implements: design/gdd/map-ui.md (Minimal Map Spec)
 * Architecture: ADR-001 Decision 3 (data-driven layout, no Phaser deps)
 *
 * Computes positions, colors, and visual properties for each map node.
 * MapScene consumes MapNodeLayout results and creates Phaser GameObjects.
 *
 * Key design decisions:
 * - Pure TypeScript math -- zero Phaser dependencies
 * - All layout values from MapLayoutConfig (data-driven)
 * - Nodes arranged vertically with configurable gap
 * - Colors mapped by node type, alpha by state
 * - Centers nodes horizontally on screen
 *
 * Usage:
 *   const calc = new MapLayoutCalculator({ screenWidth: 1920, screenHeight: 1080 });
 *   const layouts = calc.calculateLayout(nodes);
 *   // Use layouts[i].x, .y, .color, .alpha to render Phaser objects
 */

import type { MapNode, MapNodeState, MapNodeType } from './map-node';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * Configuration for map layout computation.
 * All values should come from ui-config.json in production.
 */
export interface MapLayoutConfig {
  /** Screen width in pixels. Required. */
  screenWidth: number;
  /** Screen height in pixels. Required. */
  screenHeight: number;
  /** Node circle radius in pixels. Default: 30. */
  nodeRadius?: number;
  /** Vertical gap between node centers in pixels. Default: 120. */
  verticalGap?: number;
  /** Top margin before first node in pixels. Default: 100. */
  topMargin?: number;
}

/**
 * Layout result for a single map node.
 * MapScene uses this to create Phaser GameObjects.
 */
export interface MapNodeLayout {
  /** Node ID (matches MapNode.id). */
  nodeId: string;
  /** Center X position. */
  x: number;
  /** Center Y position. */
  y: number;
  /** Circle radius. */
  radius: number;
  /** Fill color as hex number. */
  color: number;
  /** Border color as hex number. */
  borderColor: number;
  /** Opacity (0.0 to 1.0). */
  alpha: number;
  /** Display label text. */
  label: string;
  /** Node state (for scene to determine visual effects). */
  state: MapNodeState;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Fill color map by node type. */
const NODE_COLORS: Record<MapNodeType, number> = {
  combat: 0xcc3333,
  elite: 0xdd8833,
  rest: 0x44bb44,
  boss: 0x883388,
  shop: 0x3366cc,
  event: 0xcccc22,
  treasure: 0xddaa22,
};

/** Default fill color for unknown types. */
const DEFAULT_NODE_COLOR = 0x666666;

/** Default border color (yellow for available, green for completed). */
const BORDER_COLORS: Record<MapNodeState, number> = {
  locked: 0x555555,
  available: 0xffdd44,
  current: 0xffdd44,
  completed: 0x44bb44,
};

/** Alpha values by node state. */
const STATE_ALPHA: Record<MapNodeState, number> = {
  locked: 0.4,
  available: 1.0,
  current: 1.0,
  completed: 0.6,
};

/** Display labels by node type. */
const NODE_LABELS: Record<MapNodeType, string> = {
  combat: 'Combat',
  elite: 'Elite',
  rest: 'Rest',
  boss: 'Boss',
  shop: 'Shop',
  event: 'Event',
  treasure: 'Treasure',
};

/** Default label for unknown types. */
const DEFAULT_NODE_LABEL = '???';

// ---------------------------------------------------------------------------
// MapLayoutCalculator
// ---------------------------------------------------------------------------

/**
 * MapLayoutCalculator -- pure layout calculator for the map screen.
 *
 * Computes positions for a vertical list of nodes, centered horizontally.
 * Node appearance (color, alpha, border) is derived from node type and state.
 */
export class MapLayoutCalculator {
  private readonly screenWidth: number;
  private readonly nodeRadius: number;
  private readonly verticalGap: number;
  private readonly topMargin: number;

  /**
   * @param config - Layout configuration. screenWidth and screenHeight are required.
   */
  constructor(config: MapLayoutConfig) {
    this.screenWidth = config.screenWidth;
    this.nodeRadius = config.nodeRadius ?? 30;
    this.verticalGap = config.verticalGap ?? 120;
    this.topMargin = config.topMargin ?? 100;
  }

  // ---------------------------------------------------------------------------
  // Public API
  // ---------------------------------------------------------------------------

  /**
   * Calculate layout for all map nodes.
   *
   * Nodes are arranged in a vertical line, centered horizontally.
   * The vertical position is computed to distribute nodes evenly
   * within the screen height, starting from topMargin.
   *
   * @param nodes - Array of MapNode instances (from MapState).
   * @returns Array of MapNodeLayout with positions and visual properties.
   */
  calculateLayout(nodes: readonly MapNode[]): MapNodeLayout[] {
    if (nodes.length === 0) return [];

    return nodes.map((node, index) => ({
      nodeId: node.id,
      x: this.screenWidth / 2,
      y: this.calculateNodeY(index),
      radius: this.nodeRadius,
      color: this.getNodeColor(node.type),
      borderColor: this.getBorderColor(node.state),
      alpha: this.getAlpha(node.state),
      label: this.getNodeLabel(node.type),
      state: node.state,
    }));
  }

  // ---------------------------------------------------------------------------
  // Public Helpers (exposed for testing)
  // ---------------------------------------------------------------------------

  /**
   * Get the fill color for a node type.
   *
   * @param type - The MapNodeType.
   * @returns Hex color number.
   */
  getNodeColor(type: MapNodeType): number {
    return NODE_COLORS[type] ?? DEFAULT_NODE_COLOR;
  }

  /**
   * Get the border color for a node state.
   *
   * @param state - The MapNodeState.
   * @returns Hex color number.
   */
  getBorderColor(state: MapNodeState): number {
    return BORDER_COLORS[state];
  }

  /**
   * Get the alpha (opacity) for a node state.
   *
   * @param state - The MapNodeState.
   * @returns Alpha value between 0 and 1.
   */
  getAlpha(state: MapNodeState): number {
    return STATE_ALPHA[state];
  }

  /**
   * Get the display label for a node type.
   *
   * @param type - The MapNodeType.
   * @returns Display label string.
   */
  getNodeLabel(type: MapNodeType): string {
    return NODE_LABELS[type] ?? DEFAULT_NODE_LABEL;
  }

  // ---------------------------------------------------------------------------
  // Private Helpers
  // ---------------------------------------------------------------------------

  /**
   * Calculate center Y position for a node at the given floor index.
   *
   * Formula:
   *   y = topMargin + floor * verticalGap
   */
  private calculateNodeY(floor: number): number {
    return this.topMargin + floor * this.verticalGap;
  }
}
