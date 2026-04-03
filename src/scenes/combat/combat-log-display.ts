/**
 * combat-log-display.ts — Phaser display component for the combat log panel.
 *
 * Creates and manages the combat log panel as Phaser GameObjects.
 * Bridges the pure-logic CombatLogTracker and CombatLogLayoutCalculator
 * with the Phaser rendering pipeline.
 *
 * Implements: S3-13 (Combat Log Display) from Sprint 3
 *   - Right-side panel with color-coded entries
 *   - Collapsed: last 3 entries visible
 *   - Expanded: up to 10 entries visible
 *   - Toggle via expand/collapse button
 *
 * Architecture: Thin Phaser wrapper.
 *   - CombatLogTracker owns all logic (testable without Phaser)
 *   - CombatLogLayoutCalculator owns all layout math (testable without Phaser)
 *   - CombatLogDisplay only creates GameObjects and wires input events
 *
 * Uses Phaser 3.80+ API:
 *   - Phaser.GameObjects.Container for panel group
 *   - Phaser.GameObjects.Rectangle for panel background and button
 *   - Phaser.GameObjects.Text for log entries and button label
 */

import type { GameEventBus } from '../../systems/game-event-bus';
import type { CombatLogLayoutConfig } from './combat-log-layout';
import { CombatLogLayoutCalculator } from './combat-log-layout';
import type { CombatLogEntry } from './combat-log-entry';
import { CombatLogTracker } from './combat-log-tracker';

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

/** Default collapsed visible entry count. Per S3-13 acceptance criteria. */
const COLLAPSED_VISIBLE_COUNT = 3;

/** Expanded visible entry count. */
const EXPANDED_VISIBLE_COUNT = 10;

/** Panel background color (semi-transparent black). */
const PANEL_BG_COLOR = 0x000000;

/** Panel background alpha (semi-transparent). */
const PANEL_BG_ALPHA = 0.6;

/** Expand button color. */
const BUTTON_COLOR = 0x333333;

/** Button text for collapsed state. */
const BUTTON_TEXT_COLLAPSED = '[+]';

/** Button text for expanded state. */
const BUTTON_TEXT_EXPANDED = '[-]';

/** Font size for log entries. */
const ENTRY_FONT_SIZE = '14px';

/** Font size for button text. */
const BUTTON_FONT_SIZE = '12px';

/** Maximum text length before truncation. */
const MAX_TEXT_LENGTH = 40;

// ---------------------------------------------------------------------------
// CombatLogDisplay
// ---------------------------------------------------------------------------

/**
 * CombatLogDisplay -- Phaser rendering component for the combat log.
 *
 * Lifecycle:
 * 1. Construct with scene, eventBus, and layout config
 * 2. subscribe() is called internally on construction
 * 3. update() should be called each frame or after combat events
 * 4. toggleExpand() switches between collapsed/expanded views
 * 5. destroy() cleans up all GameObjects and unsubscribes from events
 */
export class CombatLogDisplay {
  private readonly tracker: CombatLogTracker;
  private readonly layoutCalc: CombatLogLayoutCalculator;
  private expanded: boolean = false;
  private readonly container: Phaser.GameObjects.Container;

  // Cached GameObjects for re-rendering
  private panelBg: Phaser.GameObjects.Rectangle | null = null;
  private entryTexts: Phaser.GameObjects.Text[] = [];
  private expandButton: Phaser.GameObjects.Rectangle | null = null;
  private expandButtonText: Phaser.GameObjects.Text | null = null;

  /**
   * @param scene - The Phaser scene this display belongs to.
   * @param eventBus - Combat-scoped GameEventBus to subscribe to.
   * @param config - Layout configuration (screen dimensions, etc.).
   */
  constructor(
    private readonly scene: Phaser.Scene,
    eventBus: GameEventBus,
    config: CombatLogLayoutConfig,
  ) {
    this.tracker = new CombatLogTracker(eventBus);
    this.layoutCalc = new CombatLogLayoutCalculator(config);
    this.container = scene.add.container(0, 0);

    // Subscribe to events immediately
    this.tracker.subscribe();

    // Initial render
    this.update();
  }

  // ---------------------------------------------------------------------------
  // Public API
  // ---------------------------------------------------------------------------

  /**
   * Whether the panel is currently in expanded state.
   */
  isExpanded(): boolean {
    return this.expanded;
  }

  /**
   * Toggle between collapsed and expanded states.
   * Re-renders the panel after toggling.
   */
  toggleExpand(): void {
    this.expanded = !this.expanded;
    this.update();
  }

  /**
   * Get the internal tracker for testing or advanced queries.
   */
  getTracker(): CombatLogTracker {
    return this.tracker;
  }

  /**
   * Re-render the panel based on current entries and expanded state.
   * Call this after combat events to refresh the display.
   */
  update(): void {
    const entries = this.tracker.getEntries();
    const visibleCount = this.expanded
      ? EXPANDED_VISIBLE_COUNT
      : COLLAPSED_VISIBLE_COUNT;
    const layout = this.layoutCalc.calculateLayout(entries, visibleCount, this.expanded);

    // Clear previous GameObjects
    this.clearGameObjects();

    // Draw panel background
    this.panelBg = this.scene.add.rectangle(
      layout.panelX,
      layout.panelY,
      layout.panelWidth,
      layout.panelHeight,
      PANEL_BG_COLOR,
      PANEL_BG_ALPHA,
    );
    this.panelBg.setOrigin(0, 0);
    this.container.add(this.panelBg);

    // Draw entry texts
    for (const entryLayout of layout.entries) {
      const text = this.scene.add.text(
        entryLayout.x,
        entryLayout.y,
        this.truncateText(entryLayout.text),
        {
          fontSize: ENTRY_FONT_SIZE,
          color: entryLayout.color,
          wordWrap: { width: entryLayout.width },
        },
      );
      text.setOrigin(0, 0);
      this.entryTexts.push(text);
      this.container.add(text);
    }

    // Draw expand/collapse button
    this.expandButton = this.scene.add.rectangle(
      layout.expandButtonX,
      layout.expandButtonY,
      layout.expandButtonWidth,
      layout.expandButtonHeight,
      BUTTON_COLOR,
    );
    this.expandButton.setOrigin(0, 0);
    this.expandButton.setInteractive({ useHandCursor: true });
    this.expandButton.on('pointerdown', () => {
      this.toggleExpand();
    });
    this.container.add(this.expandButton);

    this.expandButtonText = this.scene.add.text(
      layout.expandButtonX + layout.expandButtonWidth / 2,
      layout.expandButtonY + layout.expandButtonHeight / 2,
      this.expanded ? BUTTON_TEXT_EXPANDED : BUTTON_TEXT_COLLAPSED,
      {
        fontSize: BUTTON_FONT_SIZE,
        color: '#ffffff',
      },
    );
    this.expandButtonText.setOrigin(0.5, 0.5);
    this.container.add(this.expandButtonText);
  }

  /**
   * Destroy all GameObjects and unsubscribe from events.
   * Must be called during combat cleanup.
   */
  destroy(): void {
    this.tracker.destroy();
    this.clearGameObjects();
    this.container.destroy();
  }

  // ---------------------------------------------------------------------------
  // Private Helpers
  // ---------------------------------------------------------------------------

  /**
   * Remove all managed GameObjects from the container.
   */
  private clearGameObjects(): void {
    if (this.panelBg) {
      this.panelBg.destroy();
      this.panelBg = null;
    }

    for (const text of this.entryTexts) {
      text.destroy();
    }
    this.entryTexts = [];

    if (this.expandButton) {
      this.expandButton.destroy();
      this.expandButton = null;
    }

    if (this.expandButtonText) {
      this.expandButtonText.destroy();
      this.expandButtonText = null;
    }
  }

  /**
   * Truncate text to a maximum character length with ellipsis.
   */
  private truncateText(text: string): string {
    if (text.length <= MAX_TEXT_LENGTH) return text;
    return text.substring(0, MAX_TEXT_LENGTH - 3) + '...';
  }
}
