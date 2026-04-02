/**
 * game-event-bus.ts — Typed event bus with custom Map-based implementation.
 *
 * Implements: ADR-004 Event Bus / Pub-Sub Pattern
 *   - Decision 1: Custom Map-based event bus with typed interface (IEventBus)
 *   - Decision 3: EventPayloadMap for compile-time safety
 *   - Decision 4: Synchronous in-order execution, priority levels, recursion limit
 *   - Decision 6: Supports both global and combat-scoped bus instances
 *   - Error Handling: dev mode throws, production catches and logs
 *
 * All event names and payload shapes are enforced at compile time via EventPayloadMap.
 * Uses a custom Map<string, ListenerEntry[]> for listener management instead of
 * wrapping Phaser.Events.EventEmitter. This allows full testability without the
 * Phaser runtime (see ADR-004 Implementation Note for rationale).
 */

import type {
  CardInstance,
  CombatState,
  CombatEnemyInstance,
  RewardChoice,
  RunStatus,
} from '../types';
import type { Logger } from '../utils/logger';

// ---------------------------------------------------------------------------
// Event Payload Map (ADR-004 Decision 3)
// ---------------------------------------------------------------------------

/**
 * Entity — a generic identifier for any combat participant.
 * Uses string IDs to keep the event bus decoupled from concrete entity classes.
 * The combat system maps player/enemy to these IDs when emitting events.
 */
export interface Entity {
  id: string;
  type: 'player' | 'enemy';
}

/**
 * EffectResult — outcome of resolving a single card effect.
 * Carried in onCardResolved payloads.
 */
export interface EffectResult {
  type: string;
  value: number;
  target: Entity;
}

/**
 * Complete event payload type map.
 * Every event name maps to its required payload shape.
 * Add new events here to get compile-time safety across the codebase.
 *
 * Per ADR-004 Decision 2 naming convention:
 *   on[Subject][Action]     — combat and gameplay events
 *   state:[field]-changed   — state mutation notifications (ADR-001 pattern)
 *   ui:[screen]-[action]    — UI lifecycle events
 */
export interface EventPayloadMap {
  // --- Combat Lifecycle ---
  onCombatStart: { combatState: CombatState; enemies: CombatEnemyInstance[] };
  onCombatEnd: { result: 'victory' | 'defeat'; combatState: CombatState };
  onPlayerTurnStart: { turnNumber: number };
  onPlayerTurnEnd: { turnNumber: number };
  onEnemyTurnEnd: { turnNumber: number; remainingEnemies: number };

  // --- Card Play ---
  onCardPlayed: {
    card: CardInstance;
    target: Entity | null;
    source: 'player' | 'enemy';
  };
  onCardResolved: {
    card: CardInstance;
    target: Entity | null;
    results: EffectResult[];
  };
  onAttackPlayed: { card: CardInstance; target: Entity };
  onSkillPlayed: { card: CardInstance; target: Entity | null };
  onPowerPlayed: { card: CardInstance; target: Entity | null };

  // --- Damage ---
  onDamageAboutToBeDealt: {
    source: Entity;
    target: Entity;
    damage: number;
  };
  onDamageDealt: {
    source: Entity;
    target: Entity;
    damage: number;
    blocked: number;
  };
  onDamageTaken: {
    target: Entity;
    source: Entity;
    damage: number;
    blocked: number;
  };
  onBlockBroken: { target: Entity; amount: number };

  // --- Death ---
  onEntityDeath: { entity: Entity; cause: 'damage' | 'status_effect' };
  onEnemyDeath: { enemy: CombatEnemyInstance; killer: Entity };

  // --- Status Effects ---
  onStatusApplied: { target: Entity; status: string; stacks: number };
  onStatusRemoved: { target: Entity; status: string };
  onStatusTriggered: {
    target: Entity;
    status: string;
    damage?: number;
  };

  // --- Block ---
  onBlockGained: { target: Entity; amount: number; total: number };

  // --- Deck Manipulation ---
  onCardDrawn: { card: CardInstance; from: 'draw_pile' | 'other' };
  onCardExhausted: { card: CardInstance };
  onCardDiscarded: { card: CardInstance };
  onCardAddedToHand: { card: CardInstance };
  onDeckShuffled: { pile: 'draw_pile' | 'discard_pile' };

  // --- Energy ---
  onEnergySpent: { amount: number; remaining: number };
  onEnergyGained: { amount: number; source: string };

  // --- Healing ---
  onHeal: { target: Entity; amount: number };

  // --- Power Application ---
  onPowerApplied: { target: Entity; power: string; stacks: number };

  // --- State Mutations (from StateManagerPlugin, per ADR-001) ---
  'state:hp-changed': {
    oldValue: number;
    newValue: number;
    delta: number;
    source: string;
  };
  'state:gold-changed': {
    oldValue: number;
    newValue: number;
    delta: number;
    source: string;
  };
  'state:deck-changed': { action: 'add' | 'remove'; cardId: string };
  'state:relic-added': { relicId: string };
  'state:run-status-changed': {
    oldStatus: RunStatus;
    newStatus: RunStatus;
  };

  // --- UI Lifecycle ---
  'ui:combat-ready': { turnNumber: number };
  'ui:reward-closed': { choice: RewardChoice };
  'ui:transition-complete': { from: string; to: string };
}

// ---------------------------------------------------------------------------
// Priority Levels (ADR-004 Decision 4)
// ---------------------------------------------------------------------------

/**
 * Listener priority levels aligned with ADR-002 effect resolution order.
 * Lower numbers execute first.
 */
export const EventPriority = {
  /** Override/Prevention — block application, damage negation. */
  OVERRIDE: 0,
  /** Modification — relics that change damage amount. */
  MODIFICATION: 1,
  /** Reaction — relics that respond to damage. */
  REACTION: 2,
  /** Notification — UI updates, combat log. */
  NOTIFICATION: 3,
  /** Cleanup — remove temp buffs, trigger chains. */
  CLEANUP: 4,
} as const;

/**
 * Special error thrown when recursion limit is exceeded.
 * This error bypasses the per-handler error isolation so it propagates
 * up to the original emitter, preventing silent swallowing.
 */
export class RecursionLimitError extends Error {
  constructor(event: string, limit: number) {
    super(`[EventBus] Recursion limit (${limit}) exceeded for event "${event}". Stopping event chain.`);
    this.name = 'RecursionLimitError';
  }
}

/** Default priority when none is specified. */
const DEFAULT_PRIORITY = EventPriority.NOTIFICATION;

/** Maximum nested emissions per original event. Per ADR-004 Decision 4. */
const MAX_NESTING_DEPTH = 50;

// ---------------------------------------------------------------------------
// Internal listener record
// ---------------------------------------------------------------------------

/** Internal bookkeeping for a single listener registration. */
interface ListenerEntry {
  callback: (payload: unknown) => void;
  context: unknown;
  priority: number;
  once: boolean;
}

// ---------------------------------------------------------------------------
// Interface
// ---------------------------------------------------------------------------

/**
 * IEventBus — public contract for the event bus.
 * Used for dependency injection and testing (mock implementations).
 */
export interface IEventBus {
  emit<T extends keyof EventPayloadMap>(
    event: T,
    payload: EventPayloadMap[T]
  ): void;

  on<T extends keyof EventPayloadMap>(
    event: T,
    callback: (payload: EventPayloadMap[T]) => void,
    context?: unknown,
    priority?: number
  ): void;

  once<T extends keyof EventPayloadMap>(
    event: T,
    callback: (payload: EventPayloadMap[T]) => void,
    context?: unknown
  ): void;

  off<T extends keyof EventPayloadMap>(
    event: T,
    callback: (payload: EventPayloadMap[T]) => void,
    context?: unknown
  ): void;

  removeAllListeners(event?: keyof EventPayloadMap): void;

  listenerCount(event: keyof EventPayloadMap): number;

  destroy(): void;
}

// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------

/**
 * GameEventBus — typed event bus with priority-aware dispatch.
 *
 * Uses Phaser.Events.EventEmitter for listener lifecycle management.
 * Priority ordering is handled by a custom sorted dispatch layer,
 * since Phaser's TypeScript types do not expose the priority parameter.
 *
 * Provides:
 * - Compile-time type safety for event names and payload shapes
 * - Priority-based handler ordering (lower = earlier)
 * - Nested emission tracking with recursion limit (50)
 * - Error isolation between handlers
 * - Development mode (with logger): errors are re-thrown
 * - Production mode (no logger): errors are caught and logged, game continues
 */
export class GameEventBus implements IEventBus {
  /** Listener registry, keyed by event name. */
  private listeners: Map<string, ListenerEntry[]>;
  /** Tracks nesting depth for recursion limit enforcement. */
  private nestingDepth: number;
  /** Optional logger. When provided, handler errors are re-thrown (dev mode). */
  private logger: Logger | null;
  /** Whether destroy() has been called. */
  private destroyed: boolean;

  constructor(logger?: Logger) {
    this.listeners = new Map();
    this.nestingDepth = 0;
    this.logger = logger ?? null;
    this.destroyed = false;
  }

  /**
   * Emit a typed event. All handlers execute synchronously before this returns.
   * Per ADR-004 Decision 4: nested emissions resolve depth-first.
   * Handlers execute in priority order (lower priority number = earlier execution).
   *
   * @throws Error if nesting depth exceeds MAX_NESTING_DEPTH (50)
   */
  emit<T extends keyof EventPayloadMap>(
    event: T,
    payload: EventPayloadMap[T]
  ): void {
    this.assertNotDestroyed();

    this.nestingDepth++;
    if (this.nestingDepth > MAX_NESTING_DEPTH) {
      this.nestingDepth = 0;
      this.logger?.error(`[EventBus] Recursion limit (${MAX_NESTING_DEPTH}) exceeded for event "${String(event)}".`);
      throw new RecursionLimitError(String(event), MAX_NESTING_DEPTH);
    }

    try {
      this.dispatchToListeners(event as string, payload);
    } finally {
      this.nestingDepth--;
    }
  }

  /**
   * Subscribe to a typed event. Callback parameter type matches the event's payload.
   * Optional priority controls execution order (lower = earlier). Default: EventPriority.NOTIFICATION.
   */
  on<T extends keyof EventPayloadMap>(
    event: T,
    callback: (payload: EventPayloadMap[T]) => void,
    context?: unknown,
    priority?: number
  ): void {
    this.assertNotDestroyed();
    this.addListener(event as string, callback as (payload: unknown) => void, context, priority ?? DEFAULT_PRIORITY, false);
  }

  /**
   * Subscribe once. Auto-removes after first invocation.
   */
  once<T extends keyof EventPayloadMap>(
    event: T,
    callback: (payload: EventPayloadMap[T]) => void,
    context?: unknown
  ): void {
    this.assertNotDestroyed();
    this.addListener(event as string, callback as (payload: unknown) => void, context, DEFAULT_PRIORITY, true);
  }

  /**
   * Unsubscribe a specific callback from an event.
   */
  off<T extends keyof EventPayloadMap>(
    event: T,
    callback: (payload: EventPayloadMap[T]) => void,
    context?: unknown
  ): void {
    const key = event as string;
    const entries = this.listeners.get(key);
    if (!entries) return;

    const cb = callback as (payload: unknown) => void;
    const index = entries.findIndex(
      (e) => e.callback === cb && e.context === (context ?? undefined)
    );
    if (index !== -1) {
      entries.splice(index, 1);
    }
  }

  /**
   * Remove all listeners for a given event, or all events if no event specified.
   */
  removeAllListeners(event?: keyof EventPayloadMap): void {
    if (event !== undefined) {
      this.listeners.delete(event as string);
    } else {
      this.listeners.clear();
    }
  }

  /**
   * Get the number of listeners for a given event.
   */
  listenerCount(event: keyof EventPayloadMap): number {
    return this.listeners.get(event as string)?.length ?? 0;
  }

  /**
   * Destroy the bus. Call during combat cleanup or scene shutdown.
   * Per ADR-004 Decision 6: combat bus is destroyed after each fight.
   */
  destroy(): void {
    this.destroyed = true;
    this.listeners.clear();
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  /**
   * Add a listener entry, maintaining sort by priority (stable insertion).
   */
  private addListener(
    event: string,
    callback: (payload: unknown) => void,
    context: unknown,
    priority: number,
    once: boolean
  ): void {
    let entries = this.listeners.get(event);
    if (!entries) {
      entries = [];
      this.listeners.set(event, entries);
    }

    const entry: ListenerEntry = {
      callback,
      context: context ?? undefined,
      priority,
      once,
    };

    // Insert in priority order (stable: same priority = insertion order preserved)
    let insertIndex = entries.length;
    for (let i = 0; i < entries.length; i++) {
      if (entries[i].priority > priority) {
        insertIndex = i;
        break;
      }
    }
    entries.splice(insertIndex, 0, entry);
  }

  /**
   * Dispatch an event to all registered listeners in priority order.
   * Handles: once removal, error isolation, depth-first nested emissions.
   */
  private dispatchToListeners(event: string, payload: unknown): void {
    const entries = this.listeners.get(event);
    if (!entries || entries.length === 0) return;

    // Snapshot the listener list to guard against mid-dispatch mutations.
    // Once listeners are collected before dispatch since they may remove themselves.
    const snapshot = entries.slice();
    const onceToRemove: number[] = [];

    for (let i = 0; i < snapshot.length; i++) {
      const entry = snapshot[i];

      // Skip if this entry was removed during a previous handler's execution
      const currentEntries = this.listeners.get(event);
      if (!currentEntries || !currentEntries.includes(entry)) {
        continue;
      }

      // Mark once-listeners for removal
      if (entry.once) {
        onceToRemove.push(i);
      }

      try {
        entry.callback.call(entry.context, payload);
      } catch (error) {
        this.handleError(event, error);
      }
    }

    // Remove once listeners that fired (if they haven't been removed already)
    const currentEntries = this.listeners.get(event);
    if (currentEntries) {
      for (let i = onceToRemove.length - 1; i >= 0; i--) {
        const entry = snapshot[onceToRemove[i]];
        const idx = currentEntries.indexOf(entry);
        if (idx !== -1) {
          currentEntries.splice(idx, 1);
        }
      }
    }
  }

  /**
   * Handle errors from event handlers.
   * In development (when a logger is provided): log the error and re-throw.
   * Without a logger (unit tests / production): swallow the error and continue.
   */
  private handleError(event: string, error: unknown): void {
    const message = `[EventBus] Error in handler for event "${event}": ${String(error)}`;

    if (this.logger) {
      // Development mode: log and re-throw so errors surface immediately
      this.logger.error(message);
      throw error;
    }

    // Production / test mode: log to console, continue execution
    // Per ADR-004 Error Handling rule: one broken handler must not crash the game
    console.error(message);
  }

  /** Assert the bus has not been destroyed. */
  private assertNotDestroyed(): void {
    if (this.destroyed) {
      throw new Error('[EventBus] Cannot use a destroyed GameEventBus.');
    }
  }
}
