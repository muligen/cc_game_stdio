/**
 * combat-log.test.ts — Unit tests for combat log system.
 *
 * Tests CombatLogTracker (pure logic) and CombatLogLayoutCalculator (pure layout).
 * No Phaser dependencies — all tests use the real GameEventBus.
 *
 * Implements: S3-13 (Combat Log Display) acceptance criteria
 *   - Combat log shows last 3 entries
 *   - Color coded: damage=red, block=blue, heal=green, status=purple
 *   - Expandable to 50 entries
 *
 * Coverage:
 * 1.  CombatLogTracker initializes empty
 * 2.  CombatLogTracker adds damage entry on damage event
 * 3.  CombatLogTracker adds block entry on block event
 * 4.  CombatLogTracker adds card play entry on card played event
 * 5.  CombatLogTracker adds status entry on status applied event
 * 6.  CombatLogTracker adds enemy death entry on enemy death event
 * 7.  CombatLogTracker updates turn on turn start event
 * 8.  CombatLogTracker respects max entries limit
 * 9.  CombatLogTracker getRecentEntries returns correct count
 * 10. CombatLogTracker getRecentEntries returns most recent
 * 11. CombatLogTracker entries have correct colors
 * 12. CombatLogTracker entries have correct messages
 * 13. CombatLogTracker destroy unsubscribes
 * 14. CombatLogTracker re-subscribe works after destroy
 * 15. CombatLogLayoutCalculator positions panel on right side
 * 16. CombatLogLayoutCalculator limits visible entries when collapsed
 * 17. CombatLogLayoutCalculator shows more entries when expanded
 * 18. CombatLogLayoutCalculator handles empty entries
 * 19. CombatLogLayoutCalculator uses defaults for optional config
 * 20. CombatLogLayoutCalculator entries within panel bounds
 * 21. CombatLogTracker heal event
 * 22. CombatLogTracker clear resets entries
 * 23. CombatLogLayoutCalculator expand button positioned below entries
 * 24. CombatLogTracker idempotent subscribe
 */

// @vitest-environment node

import { describe, it, expect, beforeEach } from 'vitest';
import { GameEventBus } from '../../../src/systems/game-event-bus';
import { CombatLogTracker } from '../../../src/scenes/combat/combat-log-tracker';
import { CombatLogLayoutCalculator, type CombatLogLayoutConfig } from '../../../src/scenes/combat/combat-log-layout';
import { LOG_COLORS, type CombatLogEntry, type CombatLogCategory } from '../../../src/scenes/combat/combat-log-entry';

// ---------------------------------------------------------------------------
// Test Helpers
// ---------------------------------------------------------------------------

/** Create a fresh GameEventBus + CombatLogTracker pair. */
function createTestFixture(maxEntries: number = 50): {
  bus: GameEventBus;
  tracker: CombatLogTracker;
} {
  const bus = new GameEventBus();
  const tracker = new CombatLogTracker(bus, maxEntries);
  return { bus, tracker };
}

/** Type-safe event emission helper using `as never` pattern from codebase. */
type EventKey = keyof import('../../../src/systems/game-event-bus').EventPayloadMap;

/** Default layout config matching GDD 1920x1080 reference. */
const DEFAULT_LAYOUT_CONFIG: CombatLogLayoutConfig = {
  screenWidth: 1920,
  screenHeight: 1080,
  panelWidth: 300,
  maxVisibleEntries: 3,
  expandedVisibleEntries: 10,
  lineHeight: 24,
  padding: 10,
  topMargin: 80,
  sideMargin: 30,
};

/** Create a CombatLogEntry for testing. */
function makeEntry(id: number, category: CombatLogCategory, message: string): CombatLogEntry {
  return {
    id,
    turn: 1,
    category,
    message,
    color: LOG_COLORS[category],
  };
}

// ===========================================================================
// CombatLogTracker Tests
// ===========================================================================

describe('CombatLogTracker', () => {
  // -------------------------------------------------------------------------
  // 1. Initializes empty
  // -------------------------------------------------------------------------
  describe('initial state', () => {
    it('starts with no entries', () => {
      const { tracker } = createTestFixture();
      expect(tracker.getEntryCount()).toBe(0);
      expect(tracker.getEntries()).toEqual([]);
    });

    it('starts with turn 1', () => {
      const { tracker } = createTestFixture();
      expect(tracker.getCurrentTurn()).toBe(1);
    });

    it('starts unsubscribed', () => {
      const { tracker } = createTestFixture();
      expect(tracker.isSubscribed()).toBe(false);
    });
  });

  // -------------------------------------------------------------------------
  // 2. Damage entry on damage event
  // -------------------------------------------------------------------------
  describe('onDamageDealt', () => {
    it('adds a damage entry', () => {
      const { bus, tracker } = createTestFixture();
      tracker.subscribe();

      bus.emit('onDamageDealt' as EventKey, {
        source: { id: 'player', type: 'player' },
        target: { id: 'enemy_0', type: 'enemy' },
        damage: 12,
        blocked: 0,
      } as never);

      expect(tracker.getEntryCount()).toBe(1);
      const entry = tracker.getEntries()[0];
      expect(entry.category).toBe('damage');
      expect(entry.color).toBe(LOG_COLORS.damage);
    });

    it('includes damage amount in message', () => {
      const { bus, tracker } = createTestFixture();
      tracker.subscribe();

      bus.emit('onDamageDealt' as EventKey, {
        source: { id: 'player', type: 'player' },
        target: { id: 'enemy_0', type: 'enemy' },
        damage: 8,
        blocked: 0,
      } as never);

      expect(tracker.getEntries()[0].message).toContain('8');
      expect(tracker.getEntries()[0].message).toContain('damage');
    });

    it('includes blocked amount in message when blocked > 0', () => {
      const { bus, tracker } = createTestFixture();
      tracker.subscribe();

      bus.emit('onDamageDealt' as EventKey, {
        source: { id: 'player', type: 'player' },
        target: { id: 'enemy_0', type: 'enemy' },
        damage: 6,
        blocked: 4,
      } as never);

      const message = tracker.getEntries()[0].message;
      expect(message).toContain('6');
      expect(message).toContain('4 blocked');
    });
  });

  // -------------------------------------------------------------------------
  // 3. Block entry on block event
  // -------------------------------------------------------------------------
  describe('onBlockGained', () => {
    it('adds a block entry', () => {
      const { bus, tracker } = createTestFixture();
      tracker.subscribe();

      bus.emit('onBlockGained' as EventKey, {
        target: { id: 'player', type: 'player' },
        amount: 5,
        total: 5,
      } as never);

      expect(tracker.getEntryCount()).toBe(1);
      const entry = tracker.getEntries()[0];
      expect(entry.category).toBe('block');
      expect(entry.color).toBe(LOG_COLORS.block);
    });

    it('includes block amount in message', () => {
      const { bus, tracker } = createTestFixture();
      tracker.subscribe();

      bus.emit('onBlockGained' as EventKey, {
        target: { id: 'player', type: 'player' },
        amount: 8,
        total: 12,
      } as never);

      const message = tracker.getEntries()[0].message;
      expect(message).toContain('8');
      expect(message).toContain('block');
      expect(message).toContain('12');
    });
  });

  // -------------------------------------------------------------------------
  // 4. Card play entry on card played event
  // -------------------------------------------------------------------------
  describe('onCardPlayed', () => {
    it('adds a card_play entry', () => {
      const { bus, tracker } = createTestFixture();
      tracker.subscribe();

      bus.emit('onCardPlayed' as EventKey, {
        card: { instanceId: 'c1', cardId: 'strike_red', upgraded: false },
        target: { id: 'enemy_0', type: 'enemy' },
        source: 'player',
      } as never);

      expect(tracker.getEntryCount()).toBe(1);
      const entry = tracker.getEntries()[0];
      expect(entry.category).toBe('card_play');
      expect(entry.color).toBe(LOG_COLORS.card_play);
    });

    it('includes card name in message', () => {
      const { bus, tracker } = createTestFixture();
      tracker.subscribe();

      bus.emit('onCardPlayed' as EventKey, {
        card: { instanceId: 'c1', cardId: 'defend_red', upgraded: false },
        target: null,
        source: 'player',
      } as never);

      expect(tracker.getEntries()[0].message).toContain('defend_red');
    });

    it('includes target in message when target exists', () => {
      const { bus, tracker } = createTestFixture();
      tracker.subscribe();

      bus.emit('onCardPlayed' as EventKey, {
        card: { instanceId: 'c1', cardId: 'strike_red', upgraded: false },
        target: { id: 'enemy_0', type: 'enemy' },
        source: 'player',
      } as never);

      expect(tracker.getEntries()[0].message).toContain('targeting');
    });
  });

  // -------------------------------------------------------------------------
  // 5. Status entry on status applied event
  // -------------------------------------------------------------------------
  describe('onStatusApplied', () => {
    it('adds a status entry', () => {
      const { bus, tracker } = createTestFixture();
      tracker.subscribe();

      bus.emit('onStatusApplied' as EventKey, {
        target: { id: 'enemy_0', type: 'enemy' },
        status: 'vulnerable',
        stacks: 2,
      } as never);

      expect(tracker.getEntryCount()).toBe(1);
      const entry = tracker.getEntries()[0];
      expect(entry.category).toBe('status');
      expect(entry.color).toBe(LOG_COLORS.status);
    });

    it('includes status name and stacks in message', () => {
      const { bus, tracker } = createTestFixture();
      tracker.subscribe();

      bus.emit('onStatusApplied' as EventKey, {
        target: { id: 'player', type: 'player' },
        status: 'strength',
        stacks: 3,
      } as never);

      const message = tracker.getEntries()[0].message;
      expect(message).toContain('strength');
      expect(message).toContain('3');
    });
  });

  // -------------------------------------------------------------------------
  // 6. Enemy death entry on enemy death event
  // -------------------------------------------------------------------------
  describe('onEnemyDeath', () => {
    it('adds an enemy_death entry', () => {
      const { bus, tracker } = createTestFixture();
      tracker.subscribe();

      bus.emit('onEnemyDeath' as EventKey, {
        enemy: { data: { name: 'Cultist' } },
        killer: { id: 'player', type: 'player' },
      } as never);

      expect(tracker.getEntryCount()).toBe(1);
      const entry = tracker.getEntries()[0];
      expect(entry.category).toBe('enemy_death');
      expect(entry.color).toBe(LOG_COLORS.enemy_death);
    });

    it('includes enemy name in message', () => {
      const { bus, tracker } = createTestFixture();
      tracker.subscribe();

      bus.emit('onEnemyDeath' as EventKey, {
        enemy: { data: { name: 'Jaw Worm' } },
        killer: { id: 'player', type: 'player' },
      } as never);

      expect(tracker.getEntries()[0].message).toContain('Jaw Worm');
      expect(tracker.getEntries()[0].message).toContain('defeated');
    });
  });

  // -------------------------------------------------------------------------
  // 7. Updates turn on turn start event
  // -------------------------------------------------------------------------
  describe('onPlayerTurnStart', () => {
    it('updates current turn', () => {
      const { bus, tracker } = createTestFixture();
      tracker.subscribe();

      bus.emit('onPlayerTurnStart' as EventKey, {
        turnNumber: 3,
      } as never);

      expect(tracker.getCurrentTurn()).toBe(3);
    });

    it('adds a turn entry', () => {
      const { bus, tracker } = createTestFixture();
      tracker.subscribe();

      bus.emit('onPlayerTurnStart' as EventKey, {
        turnNumber: 2,
      } as never);

      expect(tracker.getEntryCount()).toBe(1);
      const entry = tracker.getEntries()[0];
      expect(entry.category).toBe('turn');
      expect(entry.message).toContain('Turn 2');
      expect(entry.color).toBe(LOG_COLORS.turn);
    });
  });

  // -------------------------------------------------------------------------
  // 8. Respects max entries limit
  // -------------------------------------------------------------------------
  describe('max entries limit', () => {
    it('prunes oldest entries when max is exceeded', () => {
      const { bus, tracker } = createTestFixture(5);
      tracker.subscribe();

      // Emit 7 damage events
      for (let i = 1; i <= 7; i++) {
        bus.emit('onDamageDealt' as EventKey, {
          source: { id: 'player', type: 'player' },
          target: { id: 'enemy_0', type: 'enemy' },
          damage: i,
          blocked: 0,
        } as never);
      }

      expect(tracker.getEntryCount()).toBe(5);
    });

    it('keeps the most recent entries after pruning', () => {
      const { bus, tracker } = createTestFixture(3);
      tracker.subscribe();

      for (let i = 1; i <= 5; i++) {
        bus.emit('onDamageDealt' as EventKey, {
          source: { id: 'player', type: 'player' },
          target: { id: 'enemy_0', type: 'enemy' },
          damage: i,
          blocked: 0,
        } as never);
      }

      const entries = tracker.getEntries();
      // Should keep damage=3,4,5 (pruned 1,2)
      expect(entries[0].message).toContain('3');
      expect(entries[1].message).toContain('4');
      expect(entries[2].message).toContain('5');
    });
  });

  // -------------------------------------------------------------------------
  // 9. getRecentEntries returns correct count
  // -------------------------------------------------------------------------
  describe('getRecentEntries count', () => {
    it('returns at most the requested count', () => {
      const { bus, tracker } = createTestFixture();
      tracker.subscribe();

      for (let i = 0; i < 10; i++) {
        bus.emit('onDamageDealt' as EventKey, {
          source: { id: 'player', type: 'player' },
          target: { id: 'enemy_0', type: 'enemy' },
          damage: i,
          blocked: 0,
        } as never);
      }

      expect(tracker.getRecentEntries(3)).toHaveLength(3);
      expect(tracker.getRecentEntries(5)).toHaveLength(5);
    });

    it('returns all entries if count exceeds total', () => {
      const { bus, tracker } = createTestFixture();
      tracker.subscribe();

      bus.emit('onDamageDealt' as EventKey, {
        source: { id: 'player', type: 'player' },
        target: { id: 'enemy_0', type: 'enemy' },
        damage: 5,
        blocked: 0,
      } as never);

      expect(tracker.getRecentEntries(10)).toHaveLength(1);
    });
  });

  // -------------------------------------------------------------------------
  // 10. getRecentEntries returns most recent
  // -------------------------------------------------------------------------
  describe('getRecentEntries most recent', () => {
    it('returns the most recent entries in order', () => {
      const { bus, tracker } = createTestFixture();
      tracker.subscribe();

      for (let i = 1; i <= 5; i++) {
        bus.emit('onDamageDealt' as EventKey, {
          source: { id: 'player', type: 'player' },
          target: { id: 'enemy_0', type: 'enemy' },
          damage: i,
          blocked: 0,
        } as never);
      }

      const recent = tracker.getRecentEntries(2);
      expect(recent[0].message).toContain('4');
      expect(recent[1].message).toContain('5');
    });
  });

  // -------------------------------------------------------------------------
  // 11. Entries have correct colors
  // -------------------------------------------------------------------------
  describe('entry colors', () => {
    it('maps each category to the correct color', () => {
      const categories: CombatLogCategory[] = [
        'damage', 'block', 'heal', 'status', 'card_play', 'enemy_death', 'turn', 'info',
      ];

      for (const cat of categories) {
        const entry = makeEntry(0, cat, 'test');
        expect(entry.color).toBe(LOG_COLORS[cat]);
      }
    });

    it('damage color is red (#cc3333)', () => {
      expect(LOG_COLORS.damage).toBe('#cc3333');
    });

    it('block color is blue (#3366cc)', () => {
      expect(LOG_COLORS.block).toBe('#3366cc');
    });

    it('heal color is green (#44bb44)', () => {
      expect(LOG_COLORS.heal).toBe('#44bb44');
    });

    it('status color is purple (#8833aa)', () => {
      expect(LOG_COLORS.status).toBe('#8833aa');
    });
  });

  // -------------------------------------------------------------------------
  // 12. Entries have correct messages
  // -------------------------------------------------------------------------
  describe('entry messages', () => {
    it('damage message mentions target and damage amount', () => {
      const { bus, tracker } = createTestFixture();
      tracker.subscribe();

      bus.emit('onDamageDealt' as EventKey, {
        source: { id: 'player', type: 'player' },
        target: { id: 'enemy_0', type: 'enemy' },
        damage: 15,
        blocked: 0,
      } as never);

      const msg = tracker.getEntries()[0].message;
      expect(msg).toContain('enemy_0');
      expect(msg).toContain('15');
    });

    it('block message mentions target, amount, and total', () => {
      const { bus, tracker } = createTestFixture();
      tracker.subscribe();

      bus.emit('onBlockGained' as EventKey, {
        target: { id: 'player', type: 'player' },
        amount: 6,
        total: 10,
      } as never);

      const msg = tracker.getEntries()[0].message;
      expect(msg).toContain('Player');
      expect(msg).toContain('6');
      expect(msg).toContain('10');
    });
  });

  // -------------------------------------------------------------------------
  // 13. Destroy unsubscribes
  // -------------------------------------------------------------------------
  describe('destroy', () => {
    it('unsubscribes from events', () => {
      const { bus, tracker } = createTestFixture();
      tracker.subscribe();
      expect(tracker.isSubscribed()).toBe(true);

      tracker.destroy();
      expect(tracker.isSubscribed()).toBe(false);
    });

    it('does not receive events after destroy', () => {
      const { bus, tracker } = createTestFixture();
      tracker.subscribe();
      tracker.destroy();

      bus.emit('onDamageDealt' as EventKey, {
        source: { id: 'player', type: 'player' },
        target: { id: 'enemy_0', type: 'enemy' },
        damage: 10,
        blocked: 0,
      } as never);

      expect(tracker.getEntryCount()).toBe(0);
    });

    it('is safe to call destroy before subscribe', () => {
      const { tracker } = createTestFixture();
      expect(() => tracker.destroy()).not.toThrow();
    });

    it('is safe to call destroy twice', () => {
      const { tracker } = createTestFixture();
      tracker.subscribe();
      tracker.destroy();
      expect(() => tracker.destroy()).not.toThrow();
    });
  });

  // -------------------------------------------------------------------------
  // 14. Re-subscribe works after destroy
  // -------------------------------------------------------------------------
  describe('re-subscribe after destroy', () => {
    it('can subscribe again after destroy', () => {
      const { bus, tracker } = createTestFixture();

      tracker.subscribe();
      tracker.destroy();

      tracker.subscribe();
      expect(tracker.isSubscribed()).toBe(true);

      bus.emit('onDamageDealt' as EventKey, {
        source: { id: 'player', type: 'player' },
        target: { id: 'enemy_0', type: 'enemy' },
        damage: 5,
        blocked: 0,
      } as never);

      expect(tracker.getEntryCount()).toBe(1);
    });
  });

  // -------------------------------------------------------------------------
  // 21. Heal event
  // -------------------------------------------------------------------------
  describe('onHeal', () => {
    it('adds a heal entry', () => {
      const { bus, tracker } = createTestFixture();
      tracker.subscribe();

      bus.emit('onHeal' as EventKey, {
        target: { id: 'player', type: 'player' },
        amount: 6,
      } as never);

      expect(tracker.getEntryCount()).toBe(1);
      const entry = tracker.getEntries()[0];
      expect(entry.category).toBe('heal');
      expect(entry.color).toBe(LOG_COLORS.heal);
      expect(entry.message).toContain('6');
      expect(entry.message).toContain('healed');
    });
  });

  // -------------------------------------------------------------------------
  // 22. Clear resets entries
  // -------------------------------------------------------------------------
  describe('clear', () => {
    it('removes all entries', () => {
      const { bus, tracker } = createTestFixture();
      tracker.subscribe();

      bus.emit('onDamageDealt' as EventKey, {
        source: { id: 'player', type: 'player' },
        target: { id: 'enemy_0', type: 'enemy' },
        damage: 5,
        blocked: 0,
      } as never);
      expect(tracker.getEntryCount()).toBe(1);

      tracker.clear();
      expect(tracker.getEntryCount()).toBe(0);
    });

    it('does not unsubscribe', () => {
      const { bus, tracker } = createTestFixture();
      tracker.subscribe();
      tracker.clear();

      expect(tracker.isSubscribed()).toBe(true);

      bus.emit('onDamageDealt' as EventKey, {
        source: { id: 'player', type: 'player' },
        target: { id: 'enemy_0', type: 'enemy' },
        damage: 3,
        blocked: 0,
      } as never);

      expect(tracker.getEntryCount()).toBe(1);
    });
  });

  // -------------------------------------------------------------------------
  // 24. Idempotent subscribe
  // -------------------------------------------------------------------------
  describe('idempotent subscribe', () => {
    it('does not double-register on second subscribe', () => {
      const { bus, tracker } = createTestFixture();
      tracker.subscribe();
      tracker.subscribe();

      bus.emit('onDamageDealt' as EventKey, {
        source: { id: 'player', type: 'player' },
        target: { id: 'enemy_0', type: 'enemy' },
        damage: 5,
        blocked: 0,
      } as never);

      // Should get exactly 1 entry, not 2
      expect(tracker.getEntryCount()).toBe(1);
    });
  });
});

// ===========================================================================
// CombatLogLayoutCalculator Tests
// ===========================================================================

describe('CombatLogLayoutCalculator', () => {
  // -------------------------------------------------------------------------
  // 15. Positions panel on right side
  // -------------------------------------------------------------------------
  describe('panel position', () => {
    it('positions panel on the right side of the screen', () => {
      const calc = new CombatLogLayoutCalculator(DEFAULT_LAYOUT_CONFIG);
      const layout = calc.calculateLayout([], 3, false);

      expect(layout.panelX).toBeGreaterThan(DEFAULT_LAYOUT_CONFIG.screenWidth / 2);
    });

    it('right edge aligns with screenWidth - sideMargin', () => {
      const calc = new CombatLogLayoutCalculator(DEFAULT_LAYOUT_CONFIG);
      const layout = calc.calculateLayout([], 3, false);

      expect(layout.panelX + layout.panelWidth).toBe(
        DEFAULT_LAYOUT_CONFIG.screenWidth - (DEFAULT_LAYOUT_CONFIG.sideMargin ?? 30),
      );
    });

    it('top edge starts at topMargin', () => {
      const calc = new CombatLogLayoutCalculator(DEFAULT_LAYOUT_CONFIG);
      const layout = calc.calculateLayout([], 3, false);

      expect(layout.panelY).toBe(DEFAULT_LAYOUT_CONFIG.topMargin);
    });
  });

  // -------------------------------------------------------------------------
  // 16. Limits visible entries when collapsed
  // -------------------------------------------------------------------------
  describe('collapsed state', () => {
    it('limits entries to maxVisibleEntries', () => {
      const calc = new CombatLogLayoutCalculator(DEFAULT_LAYOUT_CONFIG);
      const entries: CombatLogEntry[] = Array.from({ length: 10 }, (_, i) =>
        makeEntry(i, 'damage', `Entry ${i}`)
      );

      const layout = calc.calculateLayout(entries, 3, false);
      expect(layout.entries).toHaveLength(3);
      expect(layout.isExpanded).toBe(false);
    });

    it('shows the most recent entries when collapsed', () => {
      const calc = new CombatLogLayoutCalculator(DEFAULT_LAYOUT_CONFIG);
      const entries: CombatLogEntry[] = Array.from({ length: 10 }, (_, i) =>
        makeEntry(i, 'damage', `Entry ${i}`)
      );

      const layout = calc.calculateLayout(entries, 3, false);
      expect(layout.entries[0].text).toBe('Entry 7');
      expect(layout.entries[1].text).toBe('Entry 8');
      expect(layout.entries[2].text).toBe('Entry 9');
    });
  });

  // -------------------------------------------------------------------------
  // 17. Shows more entries when expanded
  // -------------------------------------------------------------------------
  describe('expanded state', () => {
    it('shows more entries when expanded', () => {
      const calc = new CombatLogLayoutCalculator(DEFAULT_LAYOUT_CONFIG);
      const entries: CombatLogEntry[] = Array.from({ length: 15 }, (_, i) =>
        makeEntry(i, 'damage', `Entry ${i}`)
      );

      const collapsed = calc.calculateLayout(entries, 3, false);
      const expanded = calc.calculateLayout(entries, 10, true);

      expect(collapsed.entries.length).toBeLessThan(expanded.entries.length);
      expect(expanded.entries).toHaveLength(10);
      expect(expanded.isExpanded).toBe(true);
    });

    it('shows all entries if fewer than expandedVisibleEntries', () => {
      const calc = new CombatLogLayoutCalculator(DEFAULT_LAYOUT_CONFIG);
      const entries: CombatLogEntry[] = Array.from({ length: 5 }, (_, i) =>
        makeEntry(i, 'damage', `Entry ${i}`)
      );

      const layout = calc.calculateLayout(entries, 10, true);
      expect(layout.entries).toHaveLength(5);
    });
  });

  // -------------------------------------------------------------------------
  // 18. Handles empty entries
  // -------------------------------------------------------------------------
  describe('empty entries', () => {
    it('returns empty entries array when no entries', () => {
      const calc = new CombatLogLayoutCalculator(DEFAULT_LAYOUT_CONFIG);
      const layout = calc.calculateLayout([], 3, false);

      expect(layout.entries).toEqual([]);
    });

    it('still positions panel correctly with no entries', () => {
      const calc = new CombatLogLayoutCalculator(DEFAULT_LAYOUT_CONFIG);
      const layout = calc.calculateLayout([], 3, false);

      expect(layout.panelX).toBeGreaterThan(0);
      expect(layout.panelY).toBeGreaterThan(0);
      expect(layout.panelWidth).toBeGreaterThan(0);
      expect(layout.panelHeight).toBeGreaterThan(0);
    });
  });

  // -------------------------------------------------------------------------
  // 19. Uses defaults for optional config
  // -------------------------------------------------------------------------
  describe('defaults', () => {
    it('uses default panelWidth when not specified', () => {
      const calc = new CombatLogLayoutCalculator({
        screenWidth: 1920,
        screenHeight: 1080,
      });
      const layout = calc.calculateLayout([], 3, false);

      expect(layout.panelWidth).toBe(300);
    });

    it('uses default topMargin when not specified', () => {
      const calc = new CombatLogLayoutCalculator({
        screenWidth: 1920,
        screenHeight: 1080,
      });
      const layout = calc.calculateLayout([], 3, false);

      expect(layout.panelY).toBe(80);
    });

    it('uses default sideMargin when not specified', () => {
      const calc = new CombatLogLayoutCalculator({
        screenWidth: 1920,
        screenHeight: 1080,
      });
      const layout = calc.calculateLayout([], 3, false);

      expect(layout.panelX + layout.panelWidth).toBe(1920 - 30);
    });

    it('getDefaultVisibleCount returns 3', () => {
      const calc = new CombatLogLayoutCalculator({
        screenWidth: 1920,
        screenHeight: 1080,
      });
      expect(calc.getDefaultVisibleCount()).toBe(3);
    });

    it('getExpandedVisibleCount returns 10', () => {
      const calc = new CombatLogLayoutCalculator({
        screenWidth: 1920,
        screenHeight: 1080,
      });
      expect(calc.getExpandedVisibleCount()).toBe(10);
    });
  });

  // -------------------------------------------------------------------------
  // 20. Entries within panel bounds
  // -------------------------------------------------------------------------
  describe('entries within bounds', () => {
    it('all entries are within panel horizontal bounds', () => {
      const calc = new CombatLogLayoutCalculator(DEFAULT_LAYOUT_CONFIG);
      const entries: CombatLogEntry[] = Array.from({ length: 5 }, (_, i) =>
        makeEntry(i, 'damage', `Entry ${i}`)
      );

      const layout = calc.calculateLayout(entries, 5, false);

      for (const entry of layout.entries) {
        expect(entry.x).toBeGreaterThanOrEqual(layout.panelX);
        expect(entry.x + entry.width).toBeLessThanOrEqual(layout.panelX + layout.panelWidth);
      }
    });

    it('all entries are within panel vertical bounds', () => {
      const calc = new CombatLogLayoutCalculator(DEFAULT_LAYOUT_CONFIG);
      const entries: CombatLogEntry[] = Array.from({ length: 5 }, (_, i) =>
        makeEntry(i, 'damage', `Entry ${i}`)
      );

      const layout = calc.calculateLayout(entries, 5, false);

      for (const entry of layout.entries) {
        expect(entry.y).toBeGreaterThanOrEqual(layout.panelY);
        expect(entry.y + entry.height).toBeLessThanOrEqual(
          layout.panelY + layout.panelHeight,
        );
      }
    });

    it('expand button is below all entries', () => {
      const calc = new CombatLogLayoutCalculator(DEFAULT_LAYOUT_CONFIG);
      const entries: CombatLogEntry[] = Array.from({ length: 5 }, (_, i) =>
        makeEntry(i, 'damage', `Entry ${i}`)
      );

      const layout = calc.calculateLayout(entries, 5, false);

      if (layout.entries.length > 0) {
        const lastEntry = layout.entries[layout.entries.length - 1];
        expect(layout.expandButtonY).toBeGreaterThanOrEqual(lastEntry.y + lastEntry.height);
      }
    });
  });

  // -------------------------------------------------------------------------
  // 23. Expand button positioned below entries
  // -------------------------------------------------------------------------
  describe('expand button', () => {
    it('is positioned within the panel horizontally', () => {
      const calc = new CombatLogLayoutCalculator(DEFAULT_LAYOUT_CONFIG);
      const layout = calc.calculateLayout([], 3, false);

      expect(layout.expandButtonX).toBe(layout.panelX);
      expect(layout.expandButtonWidth).toBe(layout.panelWidth);
    });

    it('is positioned below the content area', () => {
      const calc = new CombatLogLayoutCalculator(DEFAULT_LAYOUT_CONFIG);
      const entries: CombatLogEntry[] = Array.from({ length: 3 }, (_, i) =>
        makeEntry(i, 'damage', `Entry ${i}`)
      );

      const layout = calc.calculateLayout(entries, 3, false);

      const lastEntryBottom = layout.entries[2].y + layout.entries[2].height;
      // Button should start after padding gap
      expect(layout.expandButtonY).toBeGreaterThanOrEqual(lastEntryBottom);
    });

    it('has the correct button height', () => {
      const calc = new CombatLogLayoutCalculator(DEFAULT_LAYOUT_CONFIG);
      const layout = calc.calculateLayout([], 3, false);

      expect(layout.expandButtonHeight).toBe(24);
    });
  });

  // -------------------------------------------------------------------------
  // Entry text and color
  // -------------------------------------------------------------------------
  describe('entry text and color', () => {
    it('preserves entry text in layout', () => {
      const calc = new CombatLogLayoutCalculator(DEFAULT_LAYOUT_CONFIG);
      const entries: CombatLogEntry[] = [
        makeEntry(0, 'damage', 'Player dealt 6 damage'),
      ];

      const layout = calc.calculateLayout(entries, 1, false);
      expect(layout.entries[0].text).toBe('Player dealt 6 damage');
    });

    it('preserves entry color in layout', () => {
      const calc = new CombatLogLayoutCalculator(DEFAULT_LAYOUT_CONFIG);
      const entries: CombatLogEntry[] = [
        makeEntry(0, 'heal', 'Player healed 5 HP'),
      ];

      const layout = calc.calculateLayout(entries, 1, false);
      expect(layout.entries[0].color).toBe(LOG_COLORS.heal);
    });
  });

  // -------------------------------------------------------------------------
  // Panel height varies with content
  // -------------------------------------------------------------------------
  describe('panel height', () => {
    it('taller with more entries', () => {
      const calc = new CombatLogLayoutCalculator(DEFAULT_LAYOUT_CONFIG);

      const few = calc.calculateLayout(
        Array.from({ length: 1 }, (_, i) => makeEntry(i, 'damage', `E${i}`)),
        1,
        false,
      );
      const many = calc.calculateLayout(
        Array.from({ length: 5 }, (_, i) => makeEntry(i, 'damage', `E${i}`)),
        5,
        false,
      );

      expect(many.panelHeight).toBeGreaterThan(few.panelHeight);
    });
  });
});
