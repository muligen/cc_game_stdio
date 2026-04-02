/**
 * state-manager-plugin.ts — Singleton Phaser plugin for mutable run state.
 *
 * Implements: ADR-001 Decision 2 (State Management Pattern)
 * Implements: design/gdd/run-state.md (RunState, Query API, Mutation API)
 *
 * The StateManagerPlugin is installed once at game startup and persists
 * across all scene transitions. It owns the single canonical RunState.
 *
 * Key rules:
 * - Read-only queries return frozen copies or read-only views
 * - Named mutations validate changes, apply them, and emit events
 * - Event-driven UI updates via Phaser's EventEmitter
 * - No direct property access — all access through API methods
 * - Snapshot for save/load returns serializable plain object
 */

import Phaser from 'phaser';
import type { RunState, RunStatus } from '../types';
import { Logger } from '../utils/logger';

const LOG = new Logger('StateManagerPlugin');

/**
 * StateManagerPlugin — Phaser global plugin that owns the RunState.
 *
 * Installed during BootScene after GameRegistryPlugin.
 * Provides query (read) and mutation (write) APIs for all run state.
 */
export class StateManagerPlugin extends Phaser.Plugins.BasePlugin {
  /** The single source of truth for the current run. */
  private runState: RunState | null = null;

  /** Event emitter for state change notifications. */
  private emitter: Phaser.Events.EventEmitter;

  constructor(pluginManager: Phaser.Plugins.PluginManager) {
    super(pluginManager);
    this.emitter = new Phaser.Events.EventEmitter();
  }

  /**
   * Install the state manager. Called from BootScene.create().
   * Per ADR-001: StateManagerPlugin initializes with empty RunState.
   * Actual run initialization happens when player starts a new run.
   */
  install(_scene: Phaser.Scene): void {
    LOG.info('StateManagerPlugin installed. RunState is null until run starts.');
  }

  // ---------------------------------------------------------------
  // RUN LIFECYCLE
  // design/gdd/run-state.md — Run Initialization Flow
  // ---------------------------------------------------------------

  /**
   * Initialize a new run with the given character.
   * Called when player starts a new run from CharacterSelectScene.
   */
  initializeRun(
    characterId: string,
    seed: number,
    initialState: Partial<RunState>,
  ): void {
    const runId = `run_${seed.toString(16).toUpperCase().padStart(8, '0')}`;

    this.runState = {
      runId,
      seed,
      characterId,
      currentHP: 0,
      maxHP: 0,
      gold: 0,
      masterDeck: [],
      relics: [],
      potions: [],
      currentAct: 1,
      currentFloor: 0,
      currentNodeId: null,
      visitedNodes: [],
      mapData: [],
      combatsWon: 0,
      elitesKilled: [],
      bossesKilled: [],
      turnCount: 0,
      cardsPlayedCount: 0,
      status: 'ACTIVE' as RunStatus,
      score: 0,
      ...initialState,
    };

    this.emit('state:run-status-changed', {
      oldStatus: null,
      newStatus: this.runState.status,
    });

    LOG.info(`Run initialized: ${runId}, character: ${characterId}`);
  }

  /** Check if a run is currently active. */
  hasActiveRun(): boolean {
    return this.runState !== null;
  }

  // ---------------------------------------------------------------
  // QUERY API (Read-only)
  // design/gdd/run-state.md — State Query Interface
  // Returns frozen copies for primitives, read-only views for collections.
  // ---------------------------------------------------------------

  /** Get current and max HP. Returns null if no active run. */
  getHP(): { current: number; max: number } | null {
    if (!this.runState) return null;
    return { current: this.runState.currentHP, max: this.runState.maxHP };
  }

  /** Get current gold. Returns 0 if no active run. */
  getGold(): number {
    return this.runState?.gold ?? 0;
  }

  /** Get the master deck as a read-only copy. */
  getDeck(): readonly import('../types').CardInstance[] {
    if (!this.runState) return [];
    return Object.freeze([...this.runState.masterDeck]);
  }

  /** Get the relic list as a read-only copy. */
  getRelics(): readonly string[] {
    if (!this.runState) return [];
    return Object.freeze([...this.runState.relics]);
  }

  /** Get potion slots as a read-only copy. */
  getPotions(): readonly (string | null)[] {
    if (!this.runState) return [];
    return Object.freeze([...this.runState.potions]);
  }

  /** Get current act number. */
  getAct(): number {
    return this.runState?.currentAct ?? 1;
  }

  /** Get current floor number. */
  getFloor(): number {
    return this.runState?.currentFloor ?? 0;
  }

  /** Get current map node ID. */
  getNodeId(): string | null {
    return this.runState?.currentNodeId ?? null;
  }

  /** Get the full run status. */
  getStatus(): RunStatus | null {
    return this.runState?.status ?? null;
  }

  /** Get the character ID for the current run. */
  getCharacterId(): string | null {
    return this.runState?.characterId ?? null;
  }

  /** Get the master seed for the current run. */
  getSeed(): number | null {
    return this.runState?.seed ?? null;
  }

  /** Get the run ID. */
  getRunId(): string | null {
    return this.runState?.runId ?? null;
  }

  /** Get combats won count. */
  getCombatsWon(): number {
    return this.runState?.combatsWon ?? 0;
  }

  /** Get elites killed list. */
  getElitesKilled(): readonly string[] {
    if (!this.runState) return [];
    return Object.freeze([...this.runState.elitesKilled]);
  }

  /** Get bosses killed list. */
  getBossesKilled(): readonly string[] {
    if (!this.runState) return [];
    return Object.freeze([...this.runState.bossesKilled]);
  }

  /**
   * Get a serializable snapshot of the full run state.
   * Used by Save/Load system (Post-MVP).
   */
  getState(): Readonly<RunState> | null {
    if (!this.runState) return null;
    return Object.freeze({ ...this.runState }) as Readonly<RunState>;
  }

  // ---------------------------------------------------------------
  // MUTATION API (Write)
  // design/gdd/run-state.md — State Write Interface
  // Each mutation validates, applies, and emits an event.
  // ---------------------------------------------------------------

  /**
   * Modify HP by a delta. Clamped to [0, maxHP].
   * If HP reaches 0, status changes to DEFEATED.
   */
  modifyHP(delta: number, source: string): void {
    if (!this.runState) {
      LOG.warn('modifyHP called with no active run.');
      return;
    }

    const oldValue = this.runState.currentHP;
    this.runState.currentHP = Math.max(
      0,
      Math.min(this.runState.currentHP + delta, this.runState.maxHP),
    );

    this.emit('state:hp-changed', {
      oldValue,
      newValue: this.runState.currentHP,
      delta,
      source,
    });

    if (this.runState.currentHP <= 0) {
      this.setStatus('defeated', source);
    }
  }

  /**
   * Modify gold by a delta. Clamped to 0 (no negative gold).
   */
  modifyGold(delta: number, source: string): void {
    if (!this.runState) {
      LOG.warn('modifyGold called with no active run.');
      return;
    }

    const oldValue = this.runState.gold;
    this.runState.gold = Math.max(0, this.runState.gold + delta);

    this.emit('state:gold-changed', {
      oldValue,
      newValue: this.runState.gold,
      delta,
      source,
    });
  }

  /**
   * Add a card instance to the master deck.
   */
  addCard(cardInstanceId: string, cardId: string): void {
    if (!this.runState) {
      LOG.warn('addCard called with no active run.');
      return;
    }

    this.runState.masterDeck.push({
      instanceId: cardInstanceId,
      cardId,
      upgraded: false,
    });

    this.emit('state:deck-changed', {
      action: 'add' as const,
      cardId,
    });
  }

  /**
   * Remove a card instance from the master deck.
   */
  removeCard(instanceId: string): void {
    if (!this.runState) {
      LOG.warn('removeCard called with no active run.');
      return;
    }

    const index = this.runState.masterDeck.findIndex(
      (card) => card.instanceId === instanceId,
    );
    if (index === -1) {
      LOG.warn(`Card instance not found: ${instanceId}`);
      return;
    }

    const removed = this.runState.masterDeck.splice(index, 1)[0];
    if (removed) {
      this.emit('state:deck-changed', {
        action: 'remove' as const,
        cardId: removed.cardId,
      });
    }
  }

  /**
   * Mark a card as upgraded in the master deck.
   */
  upgradeCard(instanceId: string): void {
    if (!this.runState) {
      LOG.warn('upgradeCard called with no active run.');
      return;
    }

    const card = this.runState.masterDeck.find(
      (c) => c.instanceId === instanceId,
    );
    if (card) {
      card.upgraded = true;
    } else {
      LOG.warn(`Card instance not found for upgrade: ${instanceId}`);
    }
  }

  /**
   * Add a relic to the relic list. Prevents duplicates.
   */
  addRelic(relicId: string): void {
    if (!this.runState) {
      LOG.warn('addRelic called with no active run.');
      return;
    }

    if (this.runState.relics.includes(relicId)) {
      LOG.warn(`Relic already obtained: ${relicId}. Skipping.`);
      return;
    }

    this.runState.relics.push(relicId);
    this.emit('state:relic-added', { relicId });
  }

  /**
   * Add a potion to the first empty slot.
   * Returns true if added, false if all slots are full.
   */
  addPotion(potionId: string): boolean {
    if (!this.runState) {
      LOG.warn('addPotion called with no active run.');
      return false;
    }

    const emptySlot = this.runState.potions.indexOf(null);
    if (emptySlot === -1) {
      LOG.warn('All potion slots full. Cannot add potion.');
      return false;
    }

    this.runState.potions[emptySlot] = potionId;
    this.emit('state:potion-added', { potionId, slot: emptySlot });
    return true;
  }

  /**
   * Remove a potion from a specific slot.
   */
  removePotion(slot: number): void {
    if (!this.runState) {
      LOG.warn('removePotion called with no active run.');
      return;
    }

    if (slot < 0 || slot >= this.runState.potions.length) {
      LOG.warn(`Potion slot out of bounds: ${slot}`);
      return;
    }

    const removed = this.runState.potions[slot];
    this.runState.potions[slot] = null;
    if (removed) {
      this.emit('state:potion-removed', { potionId: removed, slot });
    }
  }

  /**
   * Set the current map node and mark it as visited.
   */
  setCurrentNode(nodeId: string): void {
    if (!this.runState) {
      LOG.warn('setCurrentNode called with no active run.');
      return;
    }

    this.runState.currentNodeId = nodeId;
    if (!this.runState.visitedNodes.includes(nodeId)) {
      this.runState.visitedNodes.push(nodeId);
    }
  }

  /**
   * Increment the combat won counter.
   */
  incrementCombatsWon(): void {
    if (!this.runState) return;
    this.runState.combatsWon++;
  }

  /**
   * Record an elite kill.
   */
  addEliteKilled(eliteId: string): void {
    if (!this.runState) return;
    this.runState.elitesKilled.push(eliteId);
  }

  /**
   * Record a boss kill.
   */
  addBossKilled(bossId: string): void {
    if (!this.runState) return;
    this.runState.bossesKilled.push(bossId);
  }

  /**
   * Advance to the next act. Increments act, resets floor and node.
   */
  advanceAct(): void {
    if (!this.runState) return;
    this.runState.currentAct++;
    this.runState.currentFloor = 0;
    this.runState.currentNodeId = null;
    this.emit('state:act-advanced', { act: this.runState.currentAct });
  }

  /**
   * Set the run status. Handles lifecycle transitions.
   */
  setStatus(status: RunStatus, source: string = 'system'): void {
    if (!this.runState) return;

    const oldStatus = this.runState.status;
    this.runState.status = status;

    this.emit('state:run-status-changed', {
      oldStatus,
      newStatus: status,
      source,
    });

    LOG.info(`Run status changed: ${oldStatus} -> ${status} (source: ${source})`);
  }

  /**
   * Set the max HP. Clamps current HP if it exceeds new max.
   */
  setMaxHP(maxHP: number): void {
    if (!this.runState) return;
    this.runState.maxHP = Math.max(1, maxHP);
    if (this.runState.currentHP > this.runState.maxHP) {
      this.runState.currentHP = this.runState.maxHP;
    }
  }

  // ---------------------------------------------------------------
  // EVENT SUBSCRIPTION
  // ADR-001 Decision 2 — Event-driven UI updates
  // ADR-004 — Event Bus pattern using Phaser's EventEmitter
  // ---------------------------------------------------------------

  /** Subscribe to a state change event. */
  on(event: string, callback: (...args: unknown[]) => void, context?: unknown): void {
    this.emitter.on(event, callback, context);
  }

  /** Subscribe once to a state change event. */
  once(event: string, callback: (...args: unknown[]) => void, context?: unknown): void {
    this.emitter.once(event, callback, context);
  }

  /** Unsubscribe from a state change event. */
  off(event: string, callback: (...args: unknown[]) => void, context?: unknown): void {
    this.emitter.off(event, callback, context);
  }

  /** Emit a state change event. Internal use only. */
  private emit(event: string, data?: unknown): void {
    this.emitter.emit(event, data);
  }

  // ---------------------------------------------------------------
  // LIFECYCLE
  // ---------------------------------------------------------------

  /** Destroy the plugin and clean up the event emitter. */
  override destroy(): void {
    this.emitter.destroy();
    this.runState = null;
    super.destroy();
    LOG.info('StateManagerPlugin destroyed.');
  }
}
