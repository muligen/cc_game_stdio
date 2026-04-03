/**
 * combat-ui-state.ts — UI state projection layer for combat.
 *
 * Subscribes to the combat-scoped GameEventBus and maintains a read-only
 * view-model that UI components can poll or react to. This is a CQRS
 * read-model: CombatController owns the write-model (CombatState), and
 * CombatUIState owns the read-model for UI consumption.
 *
 * Implements: design/gdd/combat-ui.md (Screen Layout, UI Components)
 * Architecture: ADR-004 (Event Bus subscriptions), ADR-001 (state projection)
 *
 * Key design decisions:
 * - Subscribes to raw string event keys on GameEventBus (on/off pattern)
 * - Maintains a denormalized snapshot optimized for UI rendering
 * - Exposes immutable snapshots via getters; UI never mutates state
 * - Destroy unsubscribes from all events and clears state
 * - All numeric values come from events (data-driven, no hardcoded values)
 *
 * Event subscriptions (from CombatController emissions):
 *   onHPChanged        -> updates player/enemy HP
 *   onEnergyChanged    -> updates energy orb display
 *   onBlockGained      -> updates block overlay
 *   onEnemyDeath       -> marks enemy dead
 *   onPlayerTurnStart  -> updates turn phase indicator
 *   onPlayerTurnEnd    -> updates turn phase indicator
 *   onEnemyTurnEnd     -> updates turn phase indicator
 *   onCombatEnd        -> updates combat result
 *   onIntentSelected   -> updates enemy intent display
 *   onStatusApplied    -> tracks active status effects
 *   onCardPlayed       -> updates cards played count
 */

import type { GameEventBus } from '../../systems/game-event-bus';

// ---------------------------------------------------------------------------
// UI State Types
// ---------------------------------------------------------------------------

/** UI-specific enemy view model. */
export interface UIEnemyState {
  /** Unique instance ID. */
  instanceId: string;
  /** Display name. */
  name: string;
  /** Current HP. */
  currentHP: number;
  /** Maximum HP. */
  maxHP: number;
  /** Current block amount. */
  block: number;
  /** Whether this enemy is alive. */
  isAlive: boolean;
  /** Intent display data (null if no intent selected). */
  intent: UIIntentData | null;
}

/** Intent display data for enemy UI rendering. */
export interface UIIntentData {
  /** Intent icon type (attack, defend, buff, etc.). */
  intentType: string | null;
  /** Computed damage value to display. */
  displayDamage: number;
  /** Block amount from the intent. */
  blockAmount: number;
  /** Status effect name (if intent applies a status). */
  effectName: string | null;
}

/** UI turn phase for the turn indicator. */
export enum UITurnPhase {
  PLAYER_TURN = 'player_turn',
  ENEMY_TURN = 'enemy_turn',
  COMBAT_OVER = 'combat_over',
  UNKNOWN = 'unknown',
}

/** Active status effect entry for UI display. */
export interface UIStatusEffectEntry {
  /** Status effect ID. */
  statusId: string;
  /** Target entity ID. */
  targetId: string;
  /** Target type. */
  targetType: 'player' | 'enemy';
  /** Number of stacks. */
  stacks: number;
}

/** Complete combat UI state snapshot. */
export interface CombatUISnapshot {
  /** Player current HP. */
  playerHP: number;
  /** Player maximum HP. */
  playerMaxHP: number;
  /** Player current block. */
  playerBlock: number;
  /** Current energy. */
  currentEnergy: number;
  /** Effective max energy. */
  effectiveMaxEnergy: number;
  /** Current turn phase for UI indicator. */
  turnPhase: UITurnPhase;
  /** Turn number. */
  turnNumber: number;
  /** Cards played this turn. */
  cardsPlayedThisTurn: number;
  /** Combat result (null while combat is active). */
  combatResult: 'victory' | 'defeat' | null;
  /** Enemy view models. */
  enemies: ReadonlyArray<UIEnemyState>;
  /** Active status effects tracked by UI. */
  statusEffects: ReadonlyArray<UIStatusEffectEntry>;
}

// ---------------------------------------------------------------------------
// CombatUIState
// ---------------------------------------------------------------------------

/**
 * CombatUIState -- event-driven UI state projection for combat.
 *
 * Subscribes to the combat GameEventBus and maintains a denormalized snapshot
 * of all data that the combat UI needs to render. UI components read from this
 * snapshot; they never read CombatState directly.
 *
 * Lifecycle:
 * 1. Construct with a GameEventBus and initial values
 * 2. subscribe() registers all event listeners
 * 3. UI components call getSnapshot() to read current state
 * 4. destroy() unsubscribes and clears state
 */
export class CombatUIState {
  private readonly eventBus: GameEventBus;
  private subscribed: boolean;

  // --- Mutable UI state ---
  private playerHP: number;
  private playerMaxHP: number;
  private playerBlock: number;
  private currentEnergy: number;
  private effectiveMaxEnergy: number;
  private turnPhase: UITurnPhase;
  private turnNumber: number;
  private cardsPlayedThisTurn: number;
  private combatResult: 'victory' | 'defeat' | null;
  private enemies: UIEnemyState[];
  private statusEffects: UIStatusEffectEntry[];

  // --- Stored listener references for clean unsubscription ---
  private readonly handlers: Map<string, (payload: unknown) => void>;

  /**
   * @param eventBus - Combat-scoped GameEventBus to subscribe to.
   * @param initialState - Initial combat values (from CombatState at combat start).
   */
  constructor(
    eventBus: GameEventBus,
    initialState: {
      playerHP: number;
      playerMaxHP: number;
      playerBlock: number;
      currentEnergy: number;
      effectiveMaxEnergy: number;
    }
  ) {
    this.eventBus = eventBus;
    this.subscribed = false;

    this.playerHP = initialState.playerHP;
    this.playerMaxHP = initialState.playerMaxHP;
    this.playerBlock = initialState.playerBlock;
    this.currentEnergy = initialState.currentEnergy;
    this.effectiveMaxEnergy = initialState.effectiveMaxEnergy;
    this.turnPhase = UITurnPhase.UNKNOWN;
    this.turnNumber = 0;
    this.cardsPlayedThisTurn = 0;
    this.combatResult = null;
    this.enemies = [];
    this.statusEffects = [];

    this.handlers = new Map();
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

    this.registerHandler('onHPChanged', (payload: unknown) => {
      const p = payload as { target: { id: string; type: string }; oldHP: number; newHP: number; maxHP: number };
      if (p.target.type === 'player') {
        this.playerHP = p.newHP;
        this.playerMaxHP = p.maxHP;
      } else {
        this.updateEnemyHP(p.target.id, p.newHP, p.maxHP);
      }
    });

    this.registerHandler('onEnergyChanged', (payload: unknown) => {
      const p = payload as { oldEnergy: number; newEnergy: number; effectiveMaxEnergy: number };
      this.currentEnergy = p.newEnergy;
      this.effectiveMaxEnergy = p.effectiveMaxEnergy;
    });

    this.registerHandler('onBlockGained', (payload: unknown) => {
      const p = payload as { target: { id: string; type: string }; amount: number; total: number };
      if (p.target.type === 'player') {
        this.playerBlock = p.total;
      } else {
        this.updateEnemyBlock(p.target.id, p.total);
      }
    });

    this.registerHandler('onEnemyDeath', (payload: unknown) => {
      const p = payload as { enemy: { instanceId: string } };
      this.markEnemyDead(p.enemy.instanceId);
    });

    this.registerHandler('onPlayerTurnStart', (payload: unknown) => {
      const p = payload as { turnNumber: number };
      this.turnPhase = UITurnPhase.PLAYER_TURN;
      this.turnNumber = p.turnNumber;
      this.playerBlock = 0;
      this.cardsPlayedThisTurn = 0;
    });

    this.registerHandler('onPlayerTurnEnd', (_payload: unknown) => {
      this.turnPhase = UITurnPhase.ENEMY_TURN;
    });

    this.registerHandler('onEnemyTurnEnd', (_payload: unknown) => {
      // Phase stays ENEMY_TURN -- caller calls startPlayerTurn to advance.
      // This event just signals that enemy actions are done.
    });

    this.registerHandler('onCombatEnd', (payload: unknown) => {
      const p = payload as { result: 'victory' | 'defeat' };
      this.turnPhase = UITurnPhase.COMBAT_OVER;
      this.combatResult = p.result;
    });

    this.registerHandler('onIntentSelected', (payload: unknown) => {
      const p = payload as {
        enemyId: string;
        intentType: string | null;
        displayDamage: number;
        blockAmount: number;
        effectName: string | null;
      };
      this.updateEnemyIntent(p.enemyId, {
        intentType: p.intentType,
        displayDamage: p.displayDamage,
        blockAmount: p.blockAmount,
        effectName: p.effectName,
      });
    });

    this.registerHandler('onStatusApplied', (payload: unknown) => {
      const p = payload as { target: { id: string; type: string }; status: string; stacks: number };
      this.addOrUpdateStatusEffect(p.target.id, p.target.type as 'player' | 'enemy', p.status, p.stacks);
    });

    this.registerHandler('onCardPlayed', (_payload: unknown) => {
      this.cardsPlayedThisTurn += 1;
    });
  }

  /**
   * Unsubscribe from all events and clear state.
   * Must be called during combat cleanup to prevent memory leaks.
   */
  destroy(): void {
    if (!this.subscribed) return;

    for (const [event, handler] of this.handlers) {
      (this.eventBus as { off(event: string, callback: (payload: unknown) => void): void })
        .off(event, handler);
    }
    this.handlers.clear();
    this.subscribed = false;

    this.enemies = [];
    this.statusEffects = [];
  }

  // ---------------------------------------------------------------------------
  // Public Accessors
  // ---------------------------------------------------------------------------

  /**
   * Get a snapshot of the current UI state.
   * The snapshot is a shallow copy -- arrays are new references but
   * elements are shared. UI should not mutate snapshot contents.
   */
  getSnapshot(): CombatUISnapshot {
    return {
      playerHP: this.playerHP,
      playerMaxHP: this.playerMaxHP,
      playerBlock: this.playerBlock,
      currentEnergy: this.currentEnergy,
      effectiveMaxEnergy: this.effectiveMaxEnergy,
      turnPhase: this.turnPhase,
      turnNumber: this.turnNumber,
      cardsPlayedThisTurn: this.cardsPlayedThisTurn,
      combatResult: this.combatResult,
      enemies: this.enemies.slice(),
      statusEffects: this.statusEffects.slice(),
    };
  }

  /** Whether this instance is currently subscribed to events. */
  isSubscribed(): boolean {
    return this.subscribed;
  }

  // ---------------------------------------------------------------------------
  // Enemy Management
  // ---------------------------------------------------------------------------

  /**
   * Register an enemy in the UI state.
   * Called when enemies are spawned during combat initialization.
   *
   * @param instanceId - Unique enemy instance ID.
   * @param name - Display name for the enemy.
   * @param currentHP - Starting HP.
   * @param maxHP - Maximum HP.
   */
  addEnemy(instanceId: string, name: string, currentHP: number, maxHP: number, intent: UIIntentData | null = null): void {
    this.enemies.push({
      instanceId,
      name,
      currentHP,
      maxHP,
      block: 0,
      isAlive: true,
      intent,
    });
  }

  // ---------------------------------------------------------------------------
  // Private Helpers
  // ---------------------------------------------------------------------------

  /**
   * Register a handler on the event bus and store it for later unsubscription.
   */
  private registerHandler(event: string, handler: (payload: unknown) => void): void {
    this.handlers.set(event, handler);
    // GameEventBus.on accepts string keys and (payload: unknown) callbacks
    // when used through the raw string interface.
    (this.eventBus as { on(event: string, callback: (payload: unknown) => void): void })
      .on(event, handler);
  }

  /**
   * Update an enemy's HP in the UI state.
   */
  private updateEnemyHP(enemyId: string, newHP: number, maxHP: number): void {
    const enemy = this.enemies.find((e) => e.instanceId === enemyId);
    if (!enemy) return;
    enemy.currentHP = newHP;
    enemy.maxHP = maxHP;
  }

  /**
   * Update an enemy's block in the UI state.
   */
  private updateEnemyBlock(enemyId: string, total: number): void {
    const enemy = this.enemies.find((e) => e.instanceId === enemyId);
    if (!enemy) return;
    enemy.block = total;
  }

  /**
   * Mark an enemy as dead in the UI state.
   */
  private markEnemyDead(enemyInstanceId: string): void {
    const enemy = this.enemies.find((e) => e.instanceId === enemyInstanceId);
    if (!enemy) return;
    enemy.isAlive = false;
    enemy.intent = null;
  }

  /**
   * Update an enemy's intent display data.
   */
  private updateEnemyIntent(enemyId: string, intent: UIIntentData): void {
    const enemy = this.enemies.find((e) => e.instanceId === enemyId);
    if (!enemy) return;
    enemy.intent = intent;
  }

  /**
   * Add or update a status effect entry in the UI tracking list.
   * If the same statusId+targetId combination exists, updates stacks.
   * Otherwise adds a new entry.
   */
  private addOrUpdateStatusEffect(
    targetId: string,
    targetType: 'player' | 'enemy',
    statusId: string,
    stacks: number
  ): void {
    const existing = this.statusEffects.find(
      (s) => s.targetId === targetId && s.statusId === statusId
    );
    if (existing) {
      existing.stacks = stacks;
    } else {
      this.statusEffects.push({ targetId, targetType, statusId, stacks });
    }
  }
}
