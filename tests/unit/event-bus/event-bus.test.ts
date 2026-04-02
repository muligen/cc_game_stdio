/**
 * event-bus.test.ts — Unit tests for GameEventBus.
 *
 * Implements acceptance criteria from ADR-004: Event Bus / Pub-Sub Pattern.
 *
 * Coverage areas (18 test cases):
 *  1. emit delivers payload to on listener
 *  2. multiple listeners receive same event
 *  3. off removes specific listener
 *  4. once fires only once then auto-removes
 *  5. removeAllListeners (no arg) removes everything
 *  6. removeAllListeners (with event) removes only that event
 *  7. emit with context binds this correctly
 *  8. off with context removes correct listener
 *  9. emit with no listeners is a no-op
 * 10. off for non-existent listener is a no-op
 * 11. handler error does not crash (production mode)
 * 12. priority ordering — lower number executes first
 * 13. nested emit resolves depth-first
 * 14. recursion limit prevents infinite loops
 * 15. destroy cleans up all listeners
 * 16. type safety — payload shape matches event
 * 17. listenerCount returns correct count
 * 18. emit during removal is safe (Phaser guarantees)
 */

// @vitest-environment node

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  GameEventBus,
  EventPriority,
  type EventPayloadMap,
  type Entity,
} from '../../../src/systems/game-event-bus';
import type { CardInstance } from '../../../src/types';

// ---------------------------------------------------------------------------
// Test Helpers
// ---------------------------------------------------------------------------

/** Create a minimal Entity for test payloads. */
function createEntity(overrides: Partial<Entity> = {}): Entity {
  return { id: 'player', type: 'player', ...overrides };
}

/** Create a minimal CardInstance for test payloads. */
function createCardInstance(): CardInstance {
  return { instanceId: 'card_001', cardId: 'strike_red', upgraded: false };
}

/** Create a fresh GameEventBus for each test (no logger = production mode). */
function createBus(): GameEventBus {
  return new GameEventBus();
}

// ===========================================================================
// 1. emit delivers payload to on listener
// ===========================================================================

describe('emit delivers payload to on listener', () => {
  it('handler receives the exact payload emitted', () => {
    const bus = createBus();
    const handler = vi.fn();

    bus.on('onPlayerTurnStart', handler);

    const payload: EventPayloadMap['onPlayerTurnStart'] = { turnNumber: 1 };
    bus.emit('onPlayerTurnStart', payload);

    expect(handler).toHaveBeenCalledOnce();
    expect(handler).toHaveBeenCalledWith(payload);
  });
});

// ===========================================================================
// 2. Multiple listeners receive same event
// ===========================================================================

describe('multiple listeners receive same event', () => {
  it('all registered handlers are invoked for a single emit', () => {
    const bus = createBus();
    const handler1 = vi.fn();
    const handler2 = vi.fn();
    const handler3 = vi.fn();

    bus.on('onPlayerTurnStart', handler1);
    bus.on('onPlayerTurnStart', handler2);
    bus.on('onPlayerTurnStart', handler3);

    bus.emit('onPlayerTurnStart', { turnNumber: 3 });

    expect(handler1).toHaveBeenCalledOnce();
    expect(handler2).toHaveBeenCalledOnce();
    expect(handler3).toHaveBeenCalledOnce();
  });
});

// ===========================================================================
// 3. off removes specific listener
// ===========================================================================

describe('off removes specific listener', () => {
  it('removed handler no longer receives events', () => {
    const bus = createBus();
    const handler1 = vi.fn();
    const handler2 = vi.fn();

    bus.on('onPlayerTurnStart', handler1);
    bus.on('onPlayerTurnStart', handler2);
    bus.off('onPlayerTurnStart', handler1);

    bus.emit('onPlayerTurnStart', { turnNumber: 1 });

    expect(handler1).not.toHaveBeenCalled();
    expect(handler2).toHaveBeenCalledOnce();
  });
});

// ===========================================================================
// 4. once fires only once then auto-removes
// ===========================================================================

describe('once fires only once then auto-removes', () => {
  it('handler is invoked on first emit only', () => {
    const bus = createBus();
    const handler = vi.fn();

    bus.once('onPlayerTurnStart', handler);

    bus.emit('onPlayerTurnStart', { turnNumber: 1 });
    bus.emit('onPlayerTurnStart', { turnNumber: 2 });

    expect(handler).toHaveBeenCalledOnce();
    expect(handler).toHaveBeenCalledWith({ turnNumber: 1 });
  });
});

// ===========================================================================
// 5. removeAllListeners (no arg) removes everything
// ===========================================================================

describe('removeAllListeners without event removes all listeners', () => {
  it('no handlers fire after removeAllListeners()', () => {
    const bus = createBus();
    const handler1 = vi.fn();
    const handler2 = vi.fn();

    bus.on('onPlayerTurnStart', handler1);
    bus.on('onEnergySpent', handler2);

    bus.removeAllListeners();

    bus.emit('onPlayerTurnStart', { turnNumber: 1 });
    bus.emit('onEnergySpent', { amount: 1, remaining: 2 });

    expect(handler1).not.toHaveBeenCalled();
    expect(handler2).not.toHaveBeenCalled();
  });
});

// ===========================================================================
// 6. removeAllListeners (with event) removes only that event
// ===========================================================================

describe('removeAllListeners with event removes only that event', () => {
  it('only the specified event listeners are removed', () => {
    const bus = createBus();
    const turnHandler = vi.fn();
    const energyHandler = vi.fn();

    bus.on('onPlayerTurnStart', turnHandler);
    bus.on('onEnergySpent', energyHandler);

    bus.removeAllListeners('onPlayerTurnStart');

    bus.emit('onPlayerTurnStart', { turnNumber: 1 });
    bus.emit('onEnergySpent', { amount: 1, remaining: 2 });

    expect(turnHandler).not.toHaveBeenCalled();
    expect(energyHandler).toHaveBeenCalledOnce();
  });
});

// ===========================================================================
// 7. emit with context binds this correctly
// ===========================================================================

describe('emit with context binds this correctly', () => {
  it('handler called with provided context', () => {
    const bus = createBus();
    const context = { value: 42 };
    let capturedThis: unknown = null;

    bus.on('onPlayerTurnStart', function (this: unknown) {
      capturedThis = this;
    }, context);

    bus.emit('onPlayerTurnStart', { turnNumber: 1 });

    expect(capturedThis).toBe(context);
  });
});

// ===========================================================================
// 8. off with context removes correct listener
// ===========================================================================

describe('off with context removes correct listener', () => {
  it('removes only the handler with matching context', () => {
    const bus = createBus();
    const ctx1 = { id: 'a' };
    const ctx2 = { id: 'b' };
    const handler = vi.fn();

    bus.on('onPlayerTurnStart', handler, ctx1);
    bus.off('onPlayerTurnStart', handler, ctx1);

    bus.emit('onPlayerTurnStart', { turnNumber: 1 });

    expect(handler).not.toHaveBeenCalled();

    // Re-register with different context
    bus.on('onPlayerTurnStart', handler, ctx2);
    bus.emit('onPlayerTurnStart', { turnNumber: 2 });

    expect(handler).toHaveBeenCalledOnce();
  });
});

// ===========================================================================
// 9. emit with no listeners is a no-op
// ===========================================================================

describe('emit with no listeners is a no-op', () => {
  it('does not throw when emitting an event with no subscribers', () => {
    const bus = createBus();
    expect(() => {
      bus.emit('onPlayerTurnStart', { turnNumber: 1 });
    }).not.toThrow();
  });
});

// ===========================================================================
// 10. off for non-existent listener is a no-op
// ===========================================================================

describe('off for non-existent listener is a no-op', () => {
  it('does not throw when removing a handler that was never registered', () => {
    const bus = createBus();
    const handler = vi.fn();

    expect(() => {
      bus.off('onPlayerTurnStart', handler);
    }).not.toThrow();
  });
});

// ===========================================================================
// 11. Handler error does not crash (production mode — no logger)
// ===========================================================================

describe('handler error does not crash in production mode', () => {
  it('throwing handler does not prevent other handlers or crash emit', () => {
    const bus = createBus(); // no logger = production mode
    const errorHandler = vi.fn(() => {
      throw new Error('Handler exploded');
    });
    const goodHandler = vi.fn();

    bus.on('onPlayerTurnStart', errorHandler);
    bus.on('onPlayerTurnStart', goodHandler);

    // Should not throw — error is caught and logged to console
    bus.emit('onPlayerTurnStart', { turnNumber: 1 });

    expect(errorHandler).toHaveBeenCalledOnce();
    // In production mode, goodHandler still runs after the error
    expect(goodHandler).toHaveBeenCalledOnce();
  });
});

// ===========================================================================
// 12. Priority ordering — lower number executes first
// ===========================================================================

describe('priority ordering', () => {
  it('handlers execute in priority order (lower first)', () => {
    const bus = createBus();
    const order: number[] = [];

    bus.on('onPlayerTurnStart', () => order.push(3), undefined, EventPriority.NOTIFICATION);
    bus.on('onPlayerTurnStart', () => order.push(0), undefined, EventPriority.OVERRIDE);
    bus.on('onPlayerTurnStart', () => order.push(2), undefined, EventPriority.REACTION);
    bus.on('onPlayerTurnStart', () => order.push(1), undefined, EventPriority.MODIFICATION);

    bus.emit('onPlayerTurnStart', { turnNumber: 1 });

    expect(order).toEqual([0, 1, 2, 3]);
  });
});

// ===========================================================================
// 13. Nested emit resolves depth-first
// ===========================================================================

describe('nested emit resolves depth-first', () => {
  it('child event resolves fully before parent handlers continue', () => {
    const bus = createBus();
    const log: string[] = [];

    bus.on('onDamageDealt', () => {
      log.push('damage-handler-1');
      // Nested emit: handler fires a child event
      bus.emit('onEnergySpent', { amount: 1, remaining: 2 });
      log.push('damage-handler-1-after-nested');
    });

    bus.on('onEnergySpent', () => {
      log.push('energy-handler');
    });

    bus.on('onDamageDealt', () => {
      log.push('damage-handler-2');
    });

    bus.emit('onDamageDealt', {
      source: createEntity(),
      target: createEntity({ id: 'enemy1', type: 'enemy' }),
      damage: 10,
      blocked: 0,
    });

    // Depth-first: energy handler runs between damage-handler-1's statements
    expect(log).toEqual([
      'damage-handler-1',
      'energy-handler',
      'damage-handler-1-after-nested',
      'damage-handler-2',
    ]);
  });
});

// ===========================================================================
// 14. Recursion limit prevents infinite loops
// ===========================================================================

describe('recursion limit prevents infinite loops', () => {
  it('prevents infinite recursion by stopping at depth limit', () => {
    const bus = createBus();
    let callCount = 0;

    // Handler re-emits the same event, creating infinite recursion
    bus.on('onPlayerTurnStart', () => {
      callCount++;
      bus.emit('onPlayerTurnStart', { turnNumber: callCount });
    });

    // The bus catches the RecursionLimitError internally (error isolation),
    // so emit() does not throw. It just stops calling handlers at depth 50.
    expect(() => {
      bus.emit('onPlayerTurnStart', { turnNumber: 0 });
    }).not.toThrow();

    // Should have been called roughly 50 times before the limit kicked in
    expect(callCount).toBeGreaterThan(0);
    expect(callCount).toBeLessThanOrEqual(51);
  });
});

// ===========================================================================
// 15. destroy cleans up all listeners
// ===========================================================================

describe('destroy cleans up all listeners', () => {
  it('no handlers fire after destroy', () => {
    const bus = createBus();
    const handler = vi.fn();

    bus.on('onPlayerTurnStart', handler);
    bus.destroy();

    expect(() => {
      bus.emit('onPlayerTurnStart', { turnNumber: 1 });
    }).toThrow(/destroyed/);

    expect(handler).not.toHaveBeenCalled();
  });
});

// ===========================================================================
// 16. Type safety — payload shape matches event
// ===========================================================================

describe('type safety — payload shape matches event', () => {
  it('onCardPlayed receives correct payload shape', () => {
    const bus = createBus();
    const handler = vi.fn();

    bus.on('onCardPlayed', handler);

    const card = createCardInstance();
    const target = createEntity({ id: 'enemy1', type: 'enemy' });
    const payload: EventPayloadMap['onCardPlayed'] = {
      card,
      target,
      source: 'player',
    };

    bus.emit('onCardPlayed', payload);

    expect(handler).toHaveBeenCalledWith(payload);
    expect(handler.mock.calls[0][0].card).toBe(card);
    expect(handler.mock.calls[0][0].target).toBe(target);
    expect(handler.mock.calls[0][0].source).toBe('player');
  });

  it('state:hp-changed receives correct payload shape', () => {
    const bus = createBus();
    const handler = vi.fn();

    bus.on('state:hp-changed', handler);

    const payload: EventPayloadMap['state:hp-changed'] = {
      oldValue: 80,
      newValue: 70,
      delta: -10,
      source: 'enemy_attack',
    };

    bus.emit('state:hp-changed', payload);

    expect(handler).toHaveBeenCalledWith(payload);
    expect(handler.mock.calls[0][0].delta).toBe(-10);
  });
});

// ===========================================================================
// 17. listenerCount returns correct count
// ===========================================================================

describe('listenerCount returns correct count', () => {
  it('returns 0 for event with no listeners', () => {
    const bus = createBus();
    expect(bus.listenerCount('onPlayerTurnStart')).toBe(0);
  });

  it('returns correct count after adding and removing listeners', () => {
    const bus = createBus();
    const handler1 = vi.fn();
    const handler2 = vi.fn();
    const handler3 = vi.fn();

    bus.on('onPlayerTurnStart', handler1);
    expect(bus.listenerCount('onPlayerTurnStart')).toBe(1);

    bus.on('onPlayerTurnStart', handler2);
    expect(bus.listenerCount('onPlayerTurnStart')).toBe(2);

    bus.off('onPlayerTurnStart', handler1);
    expect(bus.listenerCount('onPlayerTurnStart')).toBe(1);

    bus.once('onPlayerTurnStart', handler3);
    expect(bus.listenerCount('onPlayerTurnStart')).toBe(2);
  });

  it('once handler decrements count after firing', () => {
    const bus = createBus();
    const handler = vi.fn();

    bus.once('onPlayerTurnStart', handler);
    expect(bus.listenerCount('onPlayerTurnStart')).toBe(1);

    bus.emit('onPlayerTurnStart', { turnNumber: 1 });
    expect(bus.listenerCount('onPlayerTurnStart')).toBe(0);
  });
});

// ===========================================================================
// 18. Emit during removal is safe (Phaser guarantees)
// ===========================================================================

describe('emit during removal is safe', () => {
  it('handler that removes itself during emit does not crash', () => {
    const bus = createBus();
    const handler = vi.fn(() => {
      bus.off('onPlayerTurnStart', handler);
    });

    bus.on('onPlayerTurnStart', handler);
    bus.emit('onPlayerTurnStart', { turnNumber: 1 });

    expect(handler).toHaveBeenCalledOnce();

    // Second emit should not call the removed handler
    bus.emit('onPlayerTurnStart', { turnNumber: 2 });
    expect(handler).toHaveBeenCalledOnce();
  });

  it('handler that calls removeAllListeners during emit does not crash', () => {
    const bus = createBus();
    const handler1 = vi.fn(() => {
      bus.removeAllListeners('onPlayerTurnStart');
    });
    const handler2 = vi.fn();

    bus.on('onPlayerTurnStart', handler1);
    bus.on('onPlayerTurnStart', handler2);
    bus.emit('onPlayerTurnStart', { turnNumber: 1 });

    // handler1 fires first, removes all listeners including handler2
    // Phaser may or may not call handler2 depending on internal iteration
    // The key assertion is: no crash
    expect(handler1).toHaveBeenCalledOnce();
  });
});

// ===========================================================================
// Cross-event isolation
// ===========================================================================

describe('cross-event isolation', () => {
  it('subscribing to one event does not receive another', () => {
    const bus = createBus();
    const turnHandler = vi.fn();
    const energyHandler = vi.fn();

    bus.on('onPlayerTurnStart', turnHandler);
    bus.on('onEnergySpent', energyHandler);

    bus.emit('onPlayerTurnStart', { turnNumber: 1 });

    expect(turnHandler).toHaveBeenCalledOnce();
    expect(energyHandler).not.toHaveBeenCalled();
  });
});
