/**
 * combat-log-entry.ts — Combat log entry data types and color mapping.
 *
 * Defines the data model for combat log entries displayed to the player.
 * Each entry captures a single combat action (damage dealt, block gained,
 * card played, etc.) with turn context and display color.
 *
 * Implements: S3-13 (Combat Log Display) from Sprint 3
 *   - Color coded: damage=red, block=blue, heal=green, status=purple
 *   - Last 3 entries visible; expandable to 50
 *
 * Architecture: Pure TypeScript types — zero Phaser dependencies.
 *   CombatLogTracker owns the logic; CombatLogDisplay owns the rendering.
 */

// ---------------------------------------------------------------------------
// Log Category
// ---------------------------------------------------------------------------

/**
 * Combat log entry category.
 * Determines display color and grouping in the log panel.
 */
export type CombatLogCategory =
  | 'damage'
  | 'block'
  | 'heal'
  | 'status'
  | 'card_play'
  | 'enemy_death'
  | 'turn'
  | 'info';

// ---------------------------------------------------------------------------
// Log Entry
// ---------------------------------------------------------------------------

/**
 * A single combat log entry for display.
 * Immutable record — created by CombatLogTracker, consumed by CombatLogDisplay.
 */
export interface CombatLogEntry {
  /** Unique sequential ID for this entry. */
  readonly id: number;
  /** Turn number when this entry was created. */
  readonly turn: number;
  /** Category determines color and icon. */
  readonly category: CombatLogCategory;
  /** Human-readable message describing the action. */
  readonly message: string;
  /** Hex color string for display (e.g. '#cc3333'). */
  readonly color: string;
}

// ---------------------------------------------------------------------------
// Color Mapping
// ---------------------------------------------------------------------------

/**
 * Color mapping for each combat log category.
 * Per S3-13 acceptance criteria:
 *   damage=red, block=blue, heal=green, status=purple
 * Additional categories use distinct colors for readability.
 */
export const LOG_COLORS: Record<CombatLogCategory, string> = {
  damage: '#cc3333',
  block: '#3366cc',
  heal: '#44bb44',
  status: '#8833aa',
  card_play: '#cccccc',
  enemy_death: '#dd8833',
  turn: '#ffffff',
  info: '#888888',
} as const;
