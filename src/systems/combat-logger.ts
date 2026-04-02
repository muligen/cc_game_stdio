/**
 * combat-logger.ts -- Combat event logger for debugging and test assertions.
 *
 * Implements: S2-15 (Nice to Have) from Sprint 2
 *   - CombatLogger records every significant event with turn number, phase,
 *     source, target, effect, result.
 *   - Log is queryable for test assertions: `logger.findEvents("onDamageDealt")`.
 *   - Log is clearable between combats.
 *   - No performance impact on combat resolution.
 *
 * Architecture: Monkey-patch approach (Option A).
 *   The logger wraps an event bus's `emit` method to intercept all events
 *   without modifying CombatController or any other system. The original emit
 *   is preserved and called first, so event delivery is unaffected.
 *
 * Usage:
 *   const logger = new CombatLogger();
 *   logger.attach(eventBus);
 *   // ... combat runs ...
 *   const damageEvents = logger.findEvents('onDamageDealt');
 *   logger.clear(); // reset between combats
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * A single recorded combat event.
 * Captures the event name, payload snapshot, and a monotonically-increasing
 * sequence number for ordering assertions.
 */
export interface CombatLogEntry {
  /** Event name (e.g. 'onDamageDealt', 'onPlayerTurnStart'). */
  event: string;
  /** Payload as emitted by the event bus. */
  payload: unknown;
  /** Monotonically increasing sequence number (starts at 0). */
  sequence: number;
}

// ---------------------------------------------------------------------------
// Event bus interface (minimal, matches CombatController's ICombatEventBus)
// ---------------------------------------------------------------------------

/**
 * Minimal event bus contract that CombatLogger can attach to.
 * Matches ICombatEventBus from combat-controller.ts.
 */
export interface ILoggableEventBus {
  emit(event: string, payload: unknown): void;
}

// ---------------------------------------------------------------------------
// CombatLogger
// ---------------------------------------------------------------------------

/**
 * CombatLogger -- intercepts and records all combat events for debugging
 * and test assertions.
 *
 * Lifecycle:
 * 1. Construct a CombatLogger.
 * 2. Call `attach(eventBus)` to begin intercepting events.
 * 3. Combat runs normally; all events are recorded.
 * 4. Use `findEvents()`, `getEntries()`, `lastEntry()` for assertions.
 * 5. Call `clear()` between combats.
 * 6. Call `detach()` to restore the original emit and stop recording.
 *
 * The monkey-patch replaces `eventBus.emit` with a wrapper that:
 *   1. Calls the original emit (event delivery is unaffected).
 *   2. Pushes a CombatLogEntry into the internal entries array.
 *
 * This approach requires no changes to CombatController or GameEventBus.
 */
export class CombatLogger {
  /** Recorded event entries in emission order. */
  private entries: CombatLogEntry[] = [];

  /** Next sequence number for the next recorded entry. */
  private nextSeq: number = 0;

  /** Reference to the original emit before monkey-patching. */
  private originalEmit: ((event: string, payload: unknown) => void) | null = null;

  /** The event bus currently attached to, or null if detached. */
  private attachedBus: ILoggableEventBus | null = null;

  // -----------------------------------------------------------------------
  // Lifecycle
  // -----------------------------------------------------------------------

  /**
   * Attach to an event bus and begin recording events.
   *
   * Monkey-patches the bus's `emit` method. The original emit is preserved
   * and called first for every event, so downstream behavior is unchanged.
   *
   * If already attached to a bus, detaches first before attaching to the new one.
   *
   * @param eventBus - The event bus to intercept.
   */
  attach(eventBus: ILoggableEventBus): void {
    // Detach from previous bus if any
    if (this.attachedBus) {
      this.detach();
    }

    this.originalEmit = eventBus.emit.bind(eventBus);
    this.attachedBus = eventBus;

    const logger = this;

    eventBus.emit = function (event: string, payload: unknown): void {
      // Call original emit first -- event delivery must not be affected.
      logger.originalEmit!.call(eventBus, event, payload);

      // Record the event after successful delivery.
      logger.record(event, payload);
    };
  }

  /**
   * Detach from the event bus and restore the original emit method.
   * Stops recording events. Does not clear existing entries.
   */
  detach(): void {
    if (this.attachedBus && this.originalEmit) {
      this.attachedBus.emit = this.originalEmit;
    }
    this.originalEmit = null;
    this.attachedBus = null;
  }

  /**
   * Clear all recorded entries. Resets sequence counter to 0.
   * Does not detach from the event bus.
   */
  clear(): void {
    this.entries = [];
    this.nextSeq = 0;
  }

  // -----------------------------------------------------------------------
  // Query
  // -----------------------------------------------------------------------

  /**
   * Get all recorded entries as a read-only array.
   */
  getEntries(): ReadonlyArray<CombatLogEntry> {
    return this.entries;
  }

  /**
   * Find all entries matching a specific event name.
   *
   * @param event - The event name to filter by (e.g. 'onDamageDealt').
   * @returns Array of matching entries, in emission order.
   */
  findEvents(event: string): CombatLogEntry[] {
    return this.entries.filter((e) => e.event === event);
  }

  /**
   * Find all entries matching any of the given event names.
   *
   * @param events - Array of event names to filter by.
   * @returns Array of matching entries, in emission order.
   */
  findEventsByAny(events: string[]): CombatLogEntry[] {
    const set = new Set(events);
    return this.entries.filter((e) => set.has(e.event));
  }

  /**
   * Get the last recorded entry, or undefined if no entries exist.
   */
  lastEntry(): CombatLogEntry | undefined {
    return this.entries.length > 0
      ? this.entries[this.entries.length - 1]
      : undefined;
  }

  /**
   * Get the total number of recorded entries.
   */
  get count(): number {
    return this.entries.length;
  }

  /**
   * Check if the logger is currently attached to an event bus.
   */
  get isAttached(): boolean {
    return this.attachedBus !== null;
  }

  // -----------------------------------------------------------------------
  // Private
  // -----------------------------------------------------------------------

  /**
   * Record a single event entry.
   */
  private record(event: string, payload: unknown): void {
    this.entries.push({
      event,
      payload,
      sequence: this.nextSeq++,
    });
  }
}
