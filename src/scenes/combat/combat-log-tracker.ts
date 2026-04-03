/**
 * combat-log-tracker.ts — Pure logic tracker for combat log entries.
 *
 * Subscribes to combat events on the GameEventBus and builds human-readable
 * log entries. Manages the entry list with a configurable max capacity.
 *
 * Implements: S3-13 (Combat Log Display) from Sprint 3
 *   - Subscribes to: onDamageDealt, onBlockGained, onCardPlayed,
 *     onStatusApplied, onEnemyDeath, onPlayerTurnStart, onHeal
 *   - Respects max entries limit (default 50)
 *   - Provides getRecentEntries(count) for collapsed/expanded views
 *
 * Architecture: Pure TypeScript — zero Phaser dependencies.
 *   Follows the same subscription pattern as CombatUIState:
 *   - registerHandler() stores references for clean unsubscription
 *   - subscribe() is idempotent
 *   - destroy() unsubscribes from all events
 *
 * All numeric values (maxEntries default) come from config, never hardcoded.
 */

import type { GameEventBus } from '../../systems/game-event-bus';
import {
  type CombatLogEntry,
  type CombatLogCategory,
  LOG_COLORS,
} from './combat-log-entry';

// ---------------------------------------------------------------------------
// CombatLogTracker
// ---------------------------------------------------------------------------

/**
 * CombatLogTracker -- event-driven combat log entry builder.
 *
 * Subscribes to combat events and translates them into display-ready
 * CombatLogEntry records. Pure logic — no rendering concerns.
 *
 * Lifecycle:
 * 1. Construct with a GameEventBus and optional maxEntries
 * 2. subscribe() registers all event listeners
 * 3. UI reads entries via getEntries() or getRecentEntries(count)
 * 4. destroy() unsubscribes and optionally clears entries
 */
export class CombatLogTracker {
  private entries: CombatLogEntry[] = [];
  private nextId: number = 0;
  private currentTurn: number = 1;
  private readonly maxEntries: number;
  private subscribed: boolean = false;

  /** Stored listener references for clean unsubscription. */
  private readonly handlers: Map<string, (payload: unknown) => void> = new Map();

  /**
   * @param eventBus - Combat-scoped GameEventBus to subscribe to.
   * @param maxEntries - Maximum entries to retain (older entries pruned). Default: 50.
   */
  constructor(
    private readonly eventBus: GameEventBus,
    maxEntries: number = 50,
  ) {
    this.maxEntries = maxEntries;
  }

  // ---------------------------------------------------------------------------
  // Lifecycle
  // ---------------------------------------------------------------------------

  /**
   * Subscribe to all combat events on the event bus.
   * Idempotent -- calling subscribe() multiple times is safe.
   */
  subscribe(): void {
    if (this.subscribed) return;
    this.subscribed = true;

    this.registerHandler('onDamageDealt', (payload: unknown) => {
      this.handleDamageDealt(payload);
    });

    this.registerHandler('onBlockGained', (payload: unknown) => {
      this.handleBlockGained(payload);
    });

    this.registerHandler('onCardPlayed', (payload: unknown) => {
      this.handleCardPlayed(payload);
    });

    this.registerHandler('onStatusApplied', (payload: unknown) => {
      this.handleStatusApplied(payload);
    });

    this.registerHandler('onEnemyDeath', (payload: unknown) => {
      this.handleEnemyDeath(payload);
    });

    this.registerHandler('onPlayerTurnStart', (payload: unknown) => {
      this.handleTurnStart(payload);
    });

    this.registerHandler('onHeal', (payload: unknown) => {
      this.handleHeal(payload);
    });
  }

  /**
   * Unsubscribe from all events on the event bus.
   * Must be called during combat cleanup to prevent memory leaks.
   * Does not clear entries — call clear() explicitly if needed.
   */
  destroy(): void {
    if (!this.subscribed) return;

    for (const [event, handler] of this.handlers) {
      this.eventBus.off(
        event as keyof import('../../systems/game-event-bus').EventPayloadMap,
        handler as never,
      );
    }
    this.handlers.clear();
    this.subscribed = false;
  }

  /**
   * Clear all stored entries and reset the ID counter.
   * Does not unsubscribe from events.
   */
  clear(): void {
    this.entries = [];
    this.nextId = 0;
  }

  // ---------------------------------------------------------------------------
  // Public Accessors
  // ---------------------------------------------------------------------------

  /**
   * Get all stored log entries as a read-only array.
   * Entries are ordered oldest-first (index 0 = oldest).
   */
  getEntries(): readonly CombatLogEntry[] {
    return this.entries;
  }

  /**
   * Get the N most recent log entries.
   * Returns fewer entries if the log contains less than `count`.
   * Entries are ordered oldest-first within the returned slice.
   *
   * @param count - Maximum number of recent entries to return.
   */
  getRecentEntries(count: number): readonly CombatLogEntry[] {
    if (count >= this.entries.length) {
      return this.entries;
    }
    return this.entries.slice(this.entries.length - count);
  }

  /**
   * Get the total number of stored log entries.
   */
  getEntryCount(): number {
    return this.entries.length;
  }

  /**
   * Get the current turn number tracked by the log.
   */
  getCurrentTurn(): number {
    return this.currentTurn;
  }

  /**
   * Whether this tracker is currently subscribed to events.
   */
  isSubscribed(): boolean {
    return this.subscribed;
  }

  // ---------------------------------------------------------------------------
  // Event Handlers (private)
  // ---------------------------------------------------------------------------

  /**
   * Handle onDamageDealt event.
   * Payload: { source: Entity, target: Entity, damage: number, blocked: number }
   */
  private handleDamageDealt(payload: unknown): void {
    const p = payload as {
      source: { id: string; type: string };
      target: { id: string; type: string };
      damage: number;
      blocked: number;
    };
    const targetName = this.entityLabel(p.target);
    const message = p.blocked > 0
      ? `${targetName} took ${p.damage} damage (${p.blocked} blocked)`
      : `${targetName} took ${p.damage} damage`;
    this.addEntry('damage', message);
  }

  /**
   * Handle onBlockGained event.
   * Payload: { target: Entity, amount: number, total: number }
   */
  private handleBlockGained(payload: unknown): void {
    const p = payload as {
      target: { id: string; type: string };
      amount: number;
      total: number;
    };
    const targetName = this.entityLabel(p.target);
    this.addEntry('block', `${targetName} gained ${p.amount} block (total: ${p.total})`);
  }

  /**
   * Handle onCardPlayed event.
   * Payload: { card: CardInstance, target: Entity | null, source: string }
   */
  private handleCardPlayed(payload: unknown): void {
    const p = payload as {
      card: { instanceId: string; cardId: string; upgraded: boolean };
      target: { id: string; type: string } | null;
      source: string;
    };
    const cardName = this.cardLabel(p.card);
    const message = p.target
      ? `Played ${cardName} targeting ${this.entityLabel(p.target)}`
      : `Played ${cardName}`;
    this.addEntry('card_play', message);
  }

  /**
   * Handle onStatusApplied event.
   * Payload: { target: Entity, status: string, stacks: number }
   */
  private handleStatusApplied(payload: unknown): void {
    const p = payload as {
      target: { id: string; type: string };
      status: string;
      stacks: number;
    };
    const targetName = this.entityLabel(p.target);
    this.addEntry('status', `${targetName} gained ${p.stacks} ${p.status}`);
  }

  /**
   * Handle onEnemyDeath event.
   * Payload: { enemy: CombatEnemyInstance, killer: Entity }
   */
  private handleEnemyDeath(payload: unknown): void {
    const p = payload as {
      enemy: { data: { name: string } };
    };
    this.addEntry('enemy_death', `${p.enemy.data.name} was defeated`);
  }

  /**
   * Handle onPlayerTurnStart event.
   * Payload: { turnNumber: number }
   */
  private handleTurnStart(payload: unknown): void {
    const p = payload as { turnNumber: number };
    this.currentTurn = p.turnNumber;
    this.addEntry('turn', `--- Turn ${p.turnNumber} ---`);
  }

  /**
   * Handle onHeal event.
   * Payload: { target: Entity, amount: number }
   */
  private handleHeal(payload: unknown): void {
    const p = payload as {
      target: { id: string; type: string };
      amount: number;
    };
    const targetName = this.entityLabel(p.target);
    this.addEntry('heal', `${targetName} healed ${p.amount} HP`);
  }

  // ---------------------------------------------------------------------------
  // Private Helpers
  // ---------------------------------------------------------------------------

  /**
   * Add a new log entry. Prunes oldest entries when maxEntries is exceeded.
   */
  private addEntry(category: CombatLogCategory, message: string): void {
    const entry: CombatLogEntry = {
      id: this.nextId++,
      turn: this.currentTurn,
      category,
      message,
      color: LOG_COLORS[category],
    };

    this.entries.push(entry);

    // Prune oldest entries when capacity exceeded
    while (this.entries.length > this.maxEntries) {
      this.entries.shift();
    }
  }

  /**
   * Derive a display label from an entity reference.
   * Uses the entity type for generic labels; callers with more context
   * (like enemy names) should format messages directly.
   */
  private entityLabel(entity: { id: string; type: string }): string {
    if (entity.type === 'player') return 'Player';
    // For enemies, use the ID as a fallback display name
    // (real usage has CombatEnemyInstance.data.name, but events use Entity)
    return entity.id;
  }

  /**
   * Derive a display label from a card instance.
   * Uses the cardId as the display name (e.g. "strike_red" -> "strike_red").
   */
  private cardLabel(card: { cardId: string }): string {
    return card.cardId;
  }

  /**
   * Register a handler on the event bus and store it for later unsubscription.
   * Follows the same pattern as CombatUIState.registerHandler().
   */
  private registerHandler(event: string, handler: (payload: unknown) => void): void {
    this.handlers.set(event, handler);
    (this.eventBus as { on(event: string, callback: (payload: unknown) => void): void })
      .on(event, handler);
  }
}
