/**
 * combat-logger.test.ts -- Unit tests for CombatLogger.
 *
 * Implements: S2-15 acceptance criteria
 *   - CombatLogger records every significant event with event name and payload.
 *   - Log is queryable for test assertions: `logger.findEvents("onDamageDealt")`.
 *   - Log is clearable between combats.
 *   - No modification to existing systems.
 *
 * Uses independent mock eventBus objects for each test (no CombatController
 * dependency). Pure unit tests verifying attach/detach/record/query/clear behavior.
 */

// @vitest-environment node

import { describe, it, expect } from 'vitest';
import { CombatLogger, type CombatLogEntry, type ILoggableEventBus } from '../../../src/systems/combat-logger';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Create a simple mock event bus with an emit method and a delivery log.
 * The delivery log records what the emit actually delivered, allowing tests
 * to verify that the original emit behavior is preserved after attach().
 */
function createMockEventBus(): ILoggableEventBus & { delivered: Array<{ event: string; payload: unknown }> } {
  const delivered: Array<{ event: string; payload: unknown }> = [];
  return {
    delivered,
    emit(event: string, payload: unknown): void {
      delivered.push({ event, payload });
    },
  };
}

// ===========================================================================
// CombatLogger -- attach and recording
// ===========================================================================

describe('CombatLogger attach and recording', () => {
  it('records events emitted after attach', () => {
    const bus = createMockEventBus();
    const logger = new CombatLogger();

    logger.attach(bus);

    bus.emit('onDamageDealt', { source: 'player', target: 'enemy', damage: 10 });
    bus.emit('onBlockGained', { target: 'player', amount: 5, total: 5 });

    expect(logger.count).toBe(2);
    expect(logger.getEntries()[0].event).toBe('onDamageDealt');
    expect(logger.getEntries()[1].event).toBe('onBlockGained');
  });

  it('captures full payload for each event', () => {
    const bus = createMockEventBus();
    const logger = new CombatLogger();
    logger.attach(bus);

    const payload = { source: 'player', target: 'enemy', damage: 15, blocked: 3 };
    bus.emit('onDamageDealt', payload);

    const entry = logger.getEntries()[0];
    expect(entry.payload).toEqual(payload);
  });

  it('assigns sequential sequence numbers starting at 0', () => {
    const bus = createMockEventBus();
    const logger = new CombatLogger();
    logger.attach(bus);

    bus.emit('a', {});
    bus.emit('b', {});
    bus.emit('c', {});

    const entries = logger.getEntries();
    expect(entries[0].sequence).toBe(0);
    expect(entries[1].sequence).toBe(1);
    expect(entries[2].sequence).toBe(2);
  });

  it('preserves original emit behavior', () => {
    const bus = createMockEventBus();
    const logger = new CombatLogger();
    logger.attach(bus);

    bus.emit('onDamageDealt', { damage: 10 });
    bus.emit('onBlockGained', { amount: 5 });

    // Original emit should still have been called for each event.
    expect(bus.delivered).toHaveLength(2);
    expect(bus.delivered[0].event).toBe('onDamageDealt');
    expect(bus.delivered[1].event).toBe('onBlockGained');
  });

  it('does not record events emitted before attach', () => {
    const bus = createMockEventBus();

    bus.emit('beforeAttach', {});

    const logger = new CombatLogger();
    logger.attach(bus);

    bus.emit('afterAttach', {});

    expect(logger.count).toBe(1);
    expect(logger.getEntries()[0].event).toBe('afterAttach');
  });

  it('records events with correct ordering', () => {
    const bus = createMockEventBus();
    const logger = new CombatLogger();
    logger.attach(bus);

    bus.emit('first', {});
    bus.emit('second', {});
    bus.emit('third', {});

    const events = logger.getEntries().map((e) => e.event);
    expect(events).toEqual(['first', 'second', 'third']);
  });
});

// ===========================================================================
// CombatLogger -- detach
// ===========================================================================

describe('CombatLogger detach', () => {
  it('stops recording events after detach', () => {
    const bus = createMockEventBus();
    const logger = new CombatLogger();

    logger.attach(bus);
    bus.emit('recorded', {});

    logger.detach();
    bus.emit('notRecorded', {});

    expect(logger.count).toBe(1);
    expect(logger.getEntries()[0].event).toBe('recorded');
  });

  it('restores original emit behavior after detach', () => {
    const bus = createMockEventBus();
    const logger = new CombatLogger();

    logger.attach(bus);
    // While attached, emit should both deliver and record
    bus.emit('during', {});
    expect(bus.delivered).toHaveLength(1);
    expect(logger.count).toBe(1);

    logger.detach();

    // After detach, emit should deliver but NOT record
    bus.emit('after', {});
    expect(bus.delivered).toHaveLength(2);
    expect(logger.count).toBe(1);
  });

  it('emit works normally after detach', () => {
    const bus = createMockEventBus();
    const logger = new CombatLogger();

    logger.attach(bus);
    logger.detach();

    bus.emit('afterDetach', { value: 42 });

    expect(bus.delivered).toHaveLength(1);
    expect(bus.delivered[0].event).toBe('afterDetach');
  });

  it('detach when not attached is a no-op', () => {
    const logger = new CombatLogger();
    // Should not throw
    logger.detach();
    expect(logger.isAttached).toBe(false);
  });

  it('isAttached reflects attach/detach state', () => {
    const bus = createMockEventBus();
    const logger = new CombatLogger();

    expect(logger.isAttached).toBe(false);

    logger.attach(bus);
    expect(logger.isAttached).toBe(true);

    logger.detach();
    expect(logger.isAttached).toBe(false);
  });
});

// ===========================================================================
// CombatLogger -- clear
// ===========================================================================

describe('CombatLogger clear', () => {
  it('removes all recorded entries', () => {
    const bus = createMockEventBus();
    const logger = new CombatLogger();
    logger.attach(bus);

    bus.emit('a', {});
    bus.emit('b', {});
    expect(logger.count).toBe(2);

    logger.clear();
    expect(logger.count).toBe(0);
    expect(logger.getEntries()).toEqual([]);
  });

  it('resets sequence counter after clear', () => {
    const bus = createMockEventBus();
    const logger = new CombatLogger();
    logger.attach(bus);

    bus.emit('a', {});
    expect(logger.getEntries()[0].sequence).toBe(0);

    logger.clear();

    bus.emit('b', {});
    expect(logger.getEntries()[0].sequence).toBe(0);
  });

  it('does not detach from bus after clear', () => {
    const bus = createMockEventBus();
    const logger = new CombatLogger();
    logger.attach(bus);

    logger.clear();

    expect(logger.isAttached).toBe(true);

    bus.emit('afterClear', {});
    expect(logger.count).toBe(1);
  });
});

// ===========================================================================
// CombatLogger -- findEvents
// ===========================================================================

describe('CombatLogger findEvents', () => {
  it('finds entries by exact event name', () => {
    const bus = createMockEventBus();
    const logger = new CombatLogger();
    logger.attach(bus);

    bus.emit('onDamageDealt', { damage: 10 });
    bus.emit('onBlockGained', { amount: 5 });
    bus.emit('onDamageDealt', { damage: 7 });

    const results = logger.findEvents('onDamageDealt');
    expect(results).toHaveLength(2);
    expect(results[0].payload).toEqual({ damage: 10 });
    expect(results[1].payload).toEqual({ damage: 7 });
  });

  it('returns empty array when no events match', () => {
    const bus = createMockEventBus();
    const logger = new CombatLogger();
    logger.attach(bus);

    bus.emit('onBlockGained', {});

    const results = logger.findEvents('onDamageDealt');
    expect(results).toEqual([]);
  });

  it('returns empty array when no events recorded', () => {
    const logger = new CombatLogger();
    expect(logger.findEvents('any')).toEqual([]);
  });

  it('preserves order in filtered results', () => {
    const bus = createMockEventBus();
    const logger = new CombatLogger();
    logger.attach(bus);

    bus.emit('onDamageDealt', { hit: 1 });
    bus.emit('onBlockGained', {});
    bus.emit('onDamageDealt', { hit: 2 });
    bus.emit('onHPChanged', {});
    bus.emit('onDamageDealt', { hit: 3 });

    const results = logger.findEvents('onDamageDealt');
    const hits = results.map((e) => (e.payload as { hit: number }).hit);
    expect(hits).toEqual([1, 2, 3]);
  });
});

// ===========================================================================
// CombatLogger -- findEventsByAny
// ===========================================================================

describe('CombatLogger findEventsByAny', () => {
  it('finds entries matching any of the given event names', () => {
    const bus = createMockEventBus();
    const logger = new CombatLogger();
    logger.attach(bus);

    bus.emit('onDamageDealt', {});
    bus.emit('onBlockGained', {});
    bus.emit('onHPChanged', {});
    bus.emit('onEnergyChanged', {});

    const results = logger.findEventsByAny(['onDamageDealt', 'onHPChanged']);
    expect(results).toHaveLength(2);
    expect(results[0].event).toBe('onDamageDealt');
    expect(results[1].event).toBe('onHPChanged');
  });

  it('returns empty array for no matches', () => {
    const bus = createMockEventBus();
    const logger = new CombatLogger();
    logger.attach(bus);

    bus.emit('onBlockGained', {});

    expect(logger.findEventsByAny(['onDamageDealt', 'onHPChanged'])).toEqual([]);
  });
});

// ===========================================================================
// CombatLogger -- lastEntry
// ===========================================================================

describe('CombatLogger lastEntry', () => {
  it('returns the last recorded entry', () => {
    const bus = createMockEventBus();
    const logger = new CombatLogger();
    logger.attach(bus);

    bus.emit('first', { value: 1 });
    bus.emit('second', { value: 2 });

    const last = logger.lastEntry();
    expect(last).toBeDefined();
    expect(last!.event).toBe('second');
    expect(last!.payload).toEqual({ value: 2 });
  });

  it('returns undefined when no entries exist', () => {
    const logger = new CombatLogger();
    expect(logger.lastEntry()).toBeUndefined();
  });

  it('tracks last entry after clear', () => {
    const bus = createMockEventBus();
    const logger = new CombatLogger();
    logger.attach(bus);

    bus.emit('old', {});
    logger.clear();

    expect(logger.lastEntry()).toBeUndefined();

    bus.emit('new', {});
    expect(logger.lastEntry()!.event).toBe('new');
  });
});

// ===========================================================================
// CombatLogger -- reattach
// ===========================================================================

describe('CombatLogger reattach to different bus', () => {
  it('detaches from previous bus when attaching to new one', () => {
    const bus1 = createMockEventBus();
    const bus2 = createMockEventBus();
    const logger = new CombatLogger();

    logger.attach(bus1);
    bus1.emit('fromBus1', {});

    // Reattach to bus2 -- should auto-detach from bus1
    logger.attach(bus2);
    bus1.emit('notRecorded', {});
    bus2.emit('fromBus2', {});

    expect(logger.count).toBe(2);
    expect(logger.getEntries()[0].event).toBe('fromBus1');
    expect(logger.getEntries()[1].event).toBe('fromBus2');
  });

  it('stops recording from previous bus when reattaching', () => {
    const bus1 = createMockEventBus();
    const logger = new CombatLogger();

    logger.attach(bus1);
    bus1.emit('fromBus1', {});
    expect(logger.count).toBe(1);

    logger.attach(createMockEventBus());

    // Emitting on bus1 should no longer be recorded
    bus1.emit('notRecorded', {});
    expect(logger.count).toBe(1);
  });
});

// ===========================================================================
// CombatLogger -- multi-event combat simulation
// ===========================================================================

describe('CombatLogger multi-event combat simulation', () => {
  it('records a full combat turn sequence', () => {
    const bus = createMockEventBus();
    const logger = new CombatLogger();
    logger.attach(bus);

    // Simulate combat init
    bus.emit('onCombatInit', { playerHP: 50, enemyCount: 2 });

    // Player turn start
    bus.emit('onPlayerTurnStart', { turnNumber: 1 });

    // Player plays Strike
    bus.emit('onEnergyChanged', { oldEnergy: 3, newEnergy: 2 });
    bus.emit('onDamageDealt', { source: 'player', target: 'enemy_0', damage: 6 });
    bus.emit('onHPChanged', { target: 'enemy_0', oldHP: 20, newHP: 14 });
    bus.emit('onCardPlayed', { card: 'strike', target: 'enemy_0' });

    // Player plays Defend
    bus.emit('onEnergyChanged', { oldEnergy: 2, newEnergy: 1 });
    bus.emit('onBlockGained', { target: 'player', amount: 5, total: 5 });

    // End player turn
    bus.emit('onPlayerTurnEnd', { turnNumber: 1 });

    // Enemy turn
    bus.emit('onIntentSelected', { enemyId: 'enemy_0', intentType: 'attack' });
    bus.emit('onDamageDealt', { source: 'enemy_0', target: 'player', damage: 8 });

    // Enemy dies
    bus.emit('onEnemyDeath', { enemyId: 'enemy_0', killer: 'player' });

    bus.emit('onEnemyTurnEnd', { turnNumber: 1, remainingEnemies: 1 });

    // Assert total count
    expect(logger.count).toBe(13);

    // Assert query works
    const damageEvents = logger.findEvents('onDamageDealt');
    expect(damageEvents).toHaveLength(2);
    expect((damageEvents[0].payload as { source: string }).source).toBe('player');
    expect((damageEvents[1].payload as { source: string }).source).toBe('enemy_0');

    // Assert last entry
    expect(logger.lastEntry()!.event).toBe('onEnemyTurnEnd');

    // Assert sequence ordering
    const entries = logger.getEntries();
    for (let i = 1; i < entries.length; i++) {
      expect(entries[i].sequence).toBeGreaterThan(entries[i - 1].sequence);
    }
  });

  it('supports clear between combats', () => {
    const bus = createMockEventBus();
    const logger = new CombatLogger();
    logger.attach(bus);

    // Combat 1
    bus.emit('onCombatInit', {});
    bus.emit('onPlayerTurnStart', { turnNumber: 1 });
    expect(logger.count).toBe(2);

    // Clear between combats
    logger.clear();
    expect(logger.count).toBe(0);

    // Combat 2
    bus.emit('onCombatInit', {});
    bus.emit('onPlayerTurnStart', { turnNumber: 1 });
    expect(logger.count).toBe(2);

    // Only combat 2 events present
    expect(logger.findEvents('onCombatInit')).toHaveLength(1);
  });
});
