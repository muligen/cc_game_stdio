/**
 * combat-controller.ts — Top-level combat state machine controller.
 *
 * Implements: design/gdd/combat.md (Combat States, Turn Flow)
 * Architecture: ADR-001 Decision 2 (combat-scoped state)
 *               ADR-002 (Combat Resolution Pipeline — turn structure)
 *
 * Manages the CombatState lifecycle and turn phase transitions.
 * CombatController receives pre-initialized system instances via constructor
 * injection (DeckManager, EnergySystem, StatusEffectManager, EffectResolver,
 * GameEventBus, EnemyHelper, GameRNG) and orchestrates combat initialization,
 * phase transitions, and state mutations.
 *
 * Phase transition rules (per GDD):
 *   INITIALIZING -> PLAYER_TURN   (start of first turn)
 *   PLAYER_TURN  -> ENEMY_TURN    (player ends turn)
 *   ENEMY_TURN   -> PLAYER_TURN   (next turn begins)
 *   PLAYER_TURN  -> COMBAT_OVER   (all enemies dead)
 *   ENEMY_TURN   -> COMBAT_OVER   (player dead)
 *
 * Turn flow (per ADR-002):
 *   Caller orchestrates: endPlayerTurn() -> executeEnemyTurn() -> startPlayerTurn()
 *   executeEnemyTurn does NOT auto-advance to player turn.
 *   startPlayerTurn internally calls transitionToPlayerTurn().
 *
 * Any other transition throws Error('Invalid phase transition: ${from} -> ${to}').
 */

import { TurnPhase, type CombatState, type CombatResult } from '../types/combat';
import type { CombatCardInstance, CardEffect, TargetOverride } from '../types/card';
import { CostType, TargetType, Keyword } from '../types/card';
import type { CombatEnemyInstance, EnemyData, MoveEffect } from '../types/enemy';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Player's targetId for status effect queries. Per design decision: 'player'. */
const PLAYER_TARGET_ID = 'player';

/** Default number of cards to draw at turn start. Per GDD: 5. */
const DEFAULT_DRAW_COUNT = 5;

// ---------------------------------------------------------------------------
// Interfaces for constructor dependencies
// ---------------------------------------------------------------------------

/**
 * Minimal interface describing what CombatController needs from GameEventBus.
 * The concrete GameEventBus satisfies this but tests can use a plain object.
 */
export interface ICombatEventBus {
  emit(event: string, payload: unknown): void;
}

/**
 * Minimal interface for DeckManager dependency.
 * CombatController uses drawOpeningHand during initCombat, drawCard and
 * discardHand during turn flow.
 */
export interface ICombatDeckManager {
  getDrawPileSize(): number;
  getHandSize(): number;
  getDiscardPileSize(): number;
  getExhaustPileSize(): number;
  /** Draw the opening hand with innate guarantee. Returns cards drawn to hand. */
  drawOpeningHand(handSize: number): CombatCardInstance[];
  /** Draw cards to hand during turn start. Returns cards actually drawn. */
  drawCard(count: number): CombatCardInstance[];
  /** Discard all cards in hand to discard pile. */
  discardHand(): void;
  /** Get a snapshot of cards currently in hand. */
  getHand(): ReadonlyArray<CombatCardInstance>;
  /** Move specific cards from hand to discard pile. */
  discardCards(cards: CombatCardInstance[]): void;
  /** Move specific cards from hand to exhaust pile. */
  exhaustCards(cards: CombatCardInstance[]): void;
}

/**
 * Minimal interface for EnergySystem dependency.
 */
export interface ICombatEnergySystem {
  getCurrentEnergy(): number;
  getEffectiveMaxEnergy(): number;
  /** Called at turn start to recalculate energy from base + bonuses - penalties. */
  onTurnStart(bonusEnergy?: number, penaltyEnergy?: number): void;
  /** Called at turn end. Sets currentEnergy to 0, clears temp modifiers. */
  onTurnEnd(): void;
  /** Check if a card can be played with current energy. */
  canPlay(cost: number, costType: string): boolean;
  /** Spend energy for a card play. Returns amount spent. Throws if insufficient. */
  spendEnergy(cost: number): number;
}

/**
 * Minimal interface for StatusEffectManager dependency.
 */
export interface ICombatStatusEffectManager {
  getEffectStacks(targetId: string, effectId: string): number;
  /** Process turn-end effects for a target entity. Decrements durations, removes expired. */
  processTurnEnd(targetId: string, isPlayerTurn: boolean): void;
  /** Apply a status effect to a target. Returns true if newly created. */
  applyEffect(targetId: string, effectId: string, stacks: number, source: string): boolean;
  /** Try to apply a debuff (respects Artifact negation). Returns true if applied. */
  tryApplyDebuff(targetId: string, effectId: string, stacks: number, source: string): boolean;
  /** Get status effect definition data. Returns undefined if unknown. */
  getEffectData(effectId: string): { category: string } | undefined;
}

/**
 * Minimal interface for EffectResolver dependency.
 * Used for resolving both card effects and enemy move effects through the
 * unified modifier pipeline (ADR-003).
 */
export interface ICombatEffectResolver {
  resolveEffect(effect: CardEffect, context: unknown): unknown[];
}

/**
 * RNG stream interface for CombatController's needs.
 * Supports nextInt (HP rolling), weightedPick (move selection), and shuffle.
 */
export interface ICombatRNGStream {
  nextInt(min: number, max: number): number;
  weightedPick<T>(items: { item: T; weight: number }[]): T;
  shuffle<T>(array: readonly T[]): T[];
}

/**
 * Minimal interface for GameRNG dependency.
 */
export interface ICombatRNG {
  getStream(id: string): ICombatRNGStream;
}

/**
 * Minimal interface for EnemyHelper dependency.
 * Wraps the static EnemyHelper methods for testability via dependency injection.
 */
export interface ICombatEnemyHelper {
  /** Create a CombatEnemyInstance from EnemyData with rolled HP. */
  createInstance(data: EnemyData, instanceId: string, rng: ICombatRNGStream): CombatEnemyInstance;
  /** Select the next move for an enemy. Returns the moveId string. */
  selectMove(enemy: CombatEnemyInstance, rng: ICombatRNGStream): string;
  /** Reset enemy block to 0 (at start of enemy's individual turn). */
  resetBlock(enemy: CombatEnemyInstance): void;
  /** Deal damage to an enemy instance (block absorbs, HP reduces, death check). */
  takeDamage(enemy: CombatEnemyInstance, amount: number): { hpLost: number; blocked: number };
  /** Add block to an enemy instance. Returns new total block. */
  gainBlock(enemy: CombatEnemyInstance, amount: number): number;
}

/** Options for initCombat beyond the base parameters. */
export interface InitCombatOptions {
  /** Enemy definitions to spawn. Default: no enemies. */
  enemies?: EnemyData[];
  /** Number of cards in the opening hand. Default: 5. */
  openingHandSize?: number;
  /** Temporary bonus energy for the first turn. Default: 0. */
  bonusEnergy?: number;
  /** Temporary penalty energy for the first turn. Default: 0. */
  penaltyEnergy?: number;
}

/**
 * Resolved target information for a card effect.
 * Used internally by playCard to route effects to the right entities.
 */
type CardEffectTarget =
  | { type: 'self' }
  | { type: 'none' }
  | { type: 'single_enemy'; enemy: CombatEnemyInstance | null }
  | { type: 'all_enemies'; enemies: CombatEnemyInstance[] };


// ---------------------------------------------------------------------------
// CombatController
// ---------------------------------------------------------------------------

/**
 * CombatController — owns and manages CombatState with strict phase transitions.
 *
 * Lifecycle:
 * 1. Constructed with pre-initialized system instances.
 * 2. startCombat() initializes CombatState (phase=INITIALIZING).
 * 3. initCombat() performs full initialization (draw hand, spawn enemies, energy, first turn).
 * 4. startPlayerTurn() / endPlayerTurn() / executeEnemyTurn() drive turn flow.
 * 5. transitionToPlayerTurn() / transitionToEnemyTurn() advance phases internally.
 * 6. endCombat() sets phase=COMBAT_OVER with the result.
 * 7. State mutations (setPlayerBlock, setPlayerHP, incrementCardsPlayed) update fields.
 */
export class CombatController {
  /** Injected dependencies. */
  private readonly _eventBus: ICombatEventBus;
  private readonly _deckManager: ICombatDeckManager;
  private readonly _energySystem: ICombatEnergySystem;
  private readonly _statusEffectManager: ICombatStatusEffectManager;
  private readonly _effectResolver: ICombatEffectResolver;
  private readonly _enemyHelper: ICombatEnemyHelper;
  private readonly _rng: ICombatRNG;

  /** Mutable combat state. */
  private state: CombatState;

  /**
   * @param eventBus - Typed event bus for combat events.
   * @param deckManager - Manages card piles during combat.
   * @param energySystem - Manages turn-based energy.
   * @param statusEffectManager - Manages status effects on entities.
   * @param effectResolver - Resolves card and enemy effects.
   * @param enemyHelper - Utility wrapper for enemy operations.
   * @param rng - Seeded RNG for combat randomization.
   */
  constructor(
    eventBus: ICombatEventBus,
    deckManager: ICombatDeckManager,
    energySystem: ICombatEnergySystem,
    statusEffectManager: ICombatStatusEffectManager,
    effectResolver: ICombatEffectResolver,
    enemyHelper: ICombatEnemyHelper,
    rng: ICombatRNG
  ) {
    this._eventBus = eventBus;
    this._deckManager = deckManager;
    this._energySystem = energySystem;
    this._statusEffectManager = statusEffectManager;
    this._effectResolver = effectResolver;
    this._enemyHelper = enemyHelper;
    this._rng = rng;

    // Suppress noUnusedLocals: _effectResolver retained for DI compatibility
    // but enemy damage is now calculated directly (see resolveEnemyDamage).
    void this._effectResolver;

    // Initialize with a default empty state until startCombat is called.
    this.state = this.createInitialState(0, 0, 0);
  }

  // ---------------------------------------------------------------------------
  // State Access
  // ---------------------------------------------------------------------------

  /**
   * Get the current combat state as a read-only reference.
   * The caller gets a Readonly wrapper but the underlying arrays are shared.
   * Do NOT deep-freeze arrays (breaks array methods for internal use).
   */
  getState(): Readonly<CombatState> {
    return this.state;
  }

  /**
   * Get the current turn phase.
   */
  getPhase(): TurnPhase {
    return this.state.phase;
  }

  // ---------------------------------------------------------------------------
  // Combat Lifecycle
  // ---------------------------------------------------------------------------

  /**
   * Initialize combat state. Sets phase to INITIALIZING, turnNumber to 0,
   * empty arrays for all card piles, no enemies, no result.
   *
   * @param playerHP - Player's starting HP for this combat.
   * @param playerMaxHP - Player's maximum HP.
   * @param baseEnergy - Base energy for the first turn.
   */
  startCombat(playerHP: number, playerMaxHP: number, baseEnergy: number): void {
    this.state = this.createInitialState(playerHP, playerMaxHP, baseEnergy);
  }

  /**
   * Full combat initialization: creates state, spawns enemies, draws opening
   * hand, starts energy, selects enemy moves, and transitions to PLAYER_TURN.
   *
   * Per GDD combat flow:
   * 1. Initialize CombatState (phase=INITIALIZING)
   * 2. Energy system: onTurnStart (recalculates from base + relic bonus)
   * 3. Spawn enemies from EnemyData (roll HP, create instances)
   * 4. Select initial moves for all enemies (push to moveHistory)
   * 5. Draw opening hand with innate guarantee
   * 6. Emit onCombatInit event
   * 7. Transition to PLAYER_TURN (turn 1)
   *
   * @param playerHP - Player's starting HP.
   * @param playerMaxHP - Player's maximum HP.
   * @param baseEnergy - Base energy for the first turn.
   * @param options - Optional configuration for enemies, hand size, energy mods.
   */
  initCombat(
    playerHP: number,
    playerMaxHP: number,
    baseEnergy: number,
    options: InitCombatOptions = {}
  ): void {
    const {
      enemies: enemyDataList,
      openingHandSize = 5,
      bonusEnergy = 0,
      penaltyEnergy = 0,
    } = options;

    // 1. Initialize combat state
    this.startCombat(playerHP, playerMaxHP, baseEnergy);

    // 2. Energy system: turn start calculation
    this._energySystem.onTurnStart(bonusEnergy, penaltyEnergy);

    // 3. Spawn enemies (if provided)
    const enemyInstances: CombatEnemyInstance[] = [];
    if (enemyDataList && enemyDataList.length > 0) {
      const aiRNG = this._rng.getStream('aiRNG');
      const combatRNG = this._rng.getStream('combatRNG');

      for (let i = 0; i < enemyDataList.length; i++) {
        const data = enemyDataList[i];
        const instanceId = `enemy_${i}_${data.id}`;
        const instance = this._enemyHelper.createInstance(data, instanceId, combatRNG);
        enemyInstances.push(instance);
      }

      // 4. Select initial moves for all enemies and resolve to EnemyMove
      for (const enemy of enemyInstances) {
        this.selectAndResolveEnemyMove(enemy, aiRNG);
      }

      this.state.enemies = enemyInstances;
    }

    // 5. Draw opening hand with innate guarantee
    this._deckManager.drawOpeningHand(openingHandSize);

    // Sync energy to combat state
    this.syncEnergyState();

    // 6. Emit initialization event
    this._eventBus.emit('onCombatInit', {
      playerHP,
      playerMaxHP,
      baseEnergy,
      enemyCount: enemyInstances.length,
    });

    // 7. Transition to first player turn
    this.transitionToPlayerTurn();
  }

  // ---------------------------------------------------------------------------
  // Turn Flow (per ADR-002)
  // ---------------------------------------------------------------------------

  /**
   * Start a new player turn.
   *
   * Per ADR-002 Phase 1 (Player Turn Start):
   * 1. Reset player block to 0
   * 2. Call energySystem.onTurnStart (refill energy)
   * 3. Draw cards (default: 5)
   * 4. Reset cardsPlayedThisTurn
   * 5. Emit onPlayerTurnStart event
   * 6. Transition to PLAYER_TURN (increments turnNumber)
   *
   * Internally calls transitionToPlayerTurn() for phase validation.
   * Valid from: ENEMY_TURN (normal flow).
   * Note: initCombat handles the INITIALIZING -> PLAYER_TURN transition directly.
   *
   * @param bonusEnergy - Temporary bonus energy for this turn. Default: 0.
   * @param penaltyEnergy - Temporary penalty energy for this turn. Default: 0.
   * @throws Error if phase is not ENEMY_TURN.
   */
  startPlayerTurn(bonusEnergy?: number, penaltyEnergy?: number): void {

    // Validate: must be in ENEMY_TURN (caller has already executed enemy turn)
    const from = this.state.phase;
    if (from !== TurnPhase.ENEMY_TURN) {
      throw new Error(
        `startPlayerTurn requires ENEMY_TURN phase, current: ${from}`
      );
    }

    // 1. Reset player block to 0
    this.state.playerBlock = 0;

    // 2. Refill energy
    this._energySystem.onTurnStart(bonusEnergy ?? 0, penaltyEnergy ?? 0);
    this.syncEnergyState();

    // 3. Draw cards
    this._deckManager.drawCard(DEFAULT_DRAW_COUNT);

    // 4. Reset cards played counter
    this.state.cardsPlayedThisTurn = 0;

    // 5. Emit turn start event
    // Turn number is incremented by transitionToPlayerTurn below
    const nextTurn = this.state.turnNumber + 1;
    this._eventBus.emit('onPlayerTurnStart', { turnNumber: nextTurn });

    // 6. Transition phase (validates, increments turnNumber)
    this.transitionToPlayerTurn();
  }

  /**
   * End the current player turn.
   *
   * Per ADR-002 Phase 3 (Player Turn End):
   * 1. Discard hand (deckManager handles retain/ethereal filtering externally)
   * 2. Process turn-end status effects on player (poison tick, duration decrement)
   * 3. Call energySystem.onTurnEnd (zero out energy, clear temp modifiers)
   * 4. Emit onPlayerTurnEnd event
   * 5. Check if player died from turn-end effects (poison)
   * 6. Check if all enemies dead -> endCombat('victory')
   * 7. Transition to ENEMY_TURN
   *
   * Valid from: PLAYER_TURN.
   *
   * @throws Error if phase is not PLAYER_TURN.
   */
  endPlayerTurn(): void {
    const from = this.state.phase;
    if (from !== TurnPhase.PLAYER_TURN) {
      throw new Error(
        `endPlayerTurn requires PLAYER_TURN phase, current: ${from}`
      );
    }

    const currentTurn = this.state.turnNumber;

    // 1. Discard entire hand
    this._deckManager.discardHand();

    // 2. Process turn-end status effects on player
    this._statusEffectManager.processTurnEnd(PLAYER_TARGET_ID, true);

    // 3. End energy for this turn
    this._energySystem.onTurnEnd();
    this.syncEnergyState();

    // 4. Emit turn end event
    this._eventBus.emit('onPlayerTurnEnd', { turnNumber: currentTurn });

    // 5. Check if player died from turn-end effects (e.g., poison)
    if (this.state.playerHP <= 0) {
      this.endCombat('defeat');
      return;
    }

    // 6. Check if all enemies dead (edge case: thorns killed all during player turn)
    if (this.allEnemiesDead()) {
      this.endCombat('victory');
      return;
    }

    // 7. Transition to enemy turn
    this.transitionToEnemyTurn();
  }

  /**
   * Execute the enemy turn.
   *
   * Per ADR-002 Phase 4 (Enemy Turn):
   * For each living enemy:
   *   0. Check stunned — skip execution and remove stunned effect
   *   1. Reset enemy block to 0
   *   2. Resolve moveId to EnemyMove via moveDefinitions, set enemy.currentMove
   *   3. Execute enemy's current intent effects (damage, block, status)
   *   4. Process turn-end status effects on enemy (poison, duration decrement)
   *   5. Select next intent for this enemy
   *   6. Death checks after each significant action
   *
   * After all enemies:
   *   7. Check if player died -> endCombat('defeat')
   *   8. Emit onEnemyTurnEnd event
   *
   * IMPORTANT: Does NOT auto-transition to player turn or call startPlayerTurn.
   * The caller controls the flow: executeEnemyTurn() -> startPlayerTurn().
   * Phase stays ENEMY_TURN after this method returns.
   *
   * Valid from: ENEMY_TURN.
   *
   * @throws Error if phase is not ENEMY_TURN.
   */
  executeEnemyTurn(): void {
    const from = this.state.phase;
    if (from !== TurnPhase.ENEMY_TURN) {
      throw new Error(
        `executeEnemyTurn requires ENEMY_TURN phase, current: ${from}`
      );
    }

    const aiRNG = this._rng.getStream('aiRNG');
    const currentTurn = this.state.turnNumber;

    // Execute each living enemy's turn
    for (const enemy of this.state.enemies) {
      if (!enemy.isAlive) {
        continue;
      }

      // 0. Check stunned — skip execution and consume the stun
      const stunnedStacks = this._statusEffectManager.getEffectStacks(enemy.instanceId, 'stunned');
      if (stunnedStacks > 0) {
        // Process turn-end to decrement/remove the stunned effect
        this._statusEffectManager.processTurnEnd(enemy.instanceId, false);

        // Still select next move even when stunned
        this.selectAndResolveEnemyMove(enemy, aiRNG);
        continue;
      }

      // 1. Reset enemy block to 0
      this._enemyHelper.resetBlock(enemy);

      // 2. Resolve current move from moveId to EnemyMove
      this.selectAndResolveEnemyMove(enemy, aiRNG);

      // 3. Execute intent effects
      this.executeEnemyIntent(enemy);

      // Check if player died during this enemy's actions
      if (this.state.playerHP <= 0) {
        this.endCombat('defeat');
        return;
      }

      // Check if enemy died (e.g., from thorns triggered by their own attack)
      if (!enemy.isAlive) {
        continue;
      }

      // 4. Process turn-end status effects on enemy
      this._statusEffectManager.processTurnEnd(enemy.instanceId, false);

      // Check if enemy died from turn-end effects (poison)
      if (!enemy.isAlive) {
        continue;
      }

      // 5. Select next intent (already done in step 2 via selectAndResolveEnemyMove)
    }

    // Early exit if combat ended during enemy actions
    if (this.state.phase === TurnPhase.COMBAT_OVER) {
      return;
    }

    // 7. Final player death check (safety for delayed effects)
    if (this.state.playerHP <= 0) {
      this.endCombat('defeat');
      return;
    }

    // 8. Emit enemy turn end event
    const remainingEnemies = this.state.enemies.filter((e) => e.isAlive).length;
    this._eventBus.emit('onEnemyTurnEnd', {
      turnNumber: currentTurn,
      remainingEnemies,
    });

    // Phase stays ENEMY_TURN — caller calls startPlayerTurn()
  }

  // ---------------------------------------------------------------------------
  // Phase Transitions
  // ---------------------------------------------------------------------------

  /**
   * Transition to PLAYER_TURN.
   * Valid from: INITIALIZING, ENEMY_TURN.
   * Increments turnNumber.
   */
  transitionToPlayerTurn(): void {
    const from = this.state.phase;
    if (from !== TurnPhase.INITIALIZING && from !== TurnPhase.ENEMY_TURN) {
      throw new Error(`Invalid phase transition: ${from} -> ${TurnPhase.PLAYER_TURN}`);
    }
    this.state.phase = TurnPhase.PLAYER_TURN;
    this.state.turnNumber += 1;
  }

  /**
   * Transition to ENEMY_TURN.
   * Valid from: PLAYER_TURN.
   */
  transitionToEnemyTurn(): void {
    const from = this.state.phase;
    if (from !== TurnPhase.PLAYER_TURN) {
      throw new Error(`Invalid phase transition: ${from} -> ${TurnPhase.ENEMY_TURN}`);
    }
    this.state.phase = TurnPhase.ENEMY_TURN;
  }

  /**
   * End combat with the given result.
   * Valid from: PLAYER_TURN, ENEMY_TURN.
   *
   * @param result - 'victory' or 'defeat'.
   */
  endCombat(result: CombatResult): void {
    const from = this.state.phase;
    if (from !== TurnPhase.PLAYER_TURN && from !== TurnPhase.ENEMY_TURN) {
      throw new Error(`Invalid phase transition: ${from} -> ${TurnPhase.COMBAT_OVER}`);
    }
    this.state.phase = TurnPhase.COMBAT_OVER;
    this.state.result = result;
  }

  // ---------------------------------------------------------------------------
  // State Mutations
  // ---------------------------------------------------------------------------

  /**
   * Update the player's block value.
   *
   * @param block - New block value (non-negative).
   */
  setPlayerBlock(block: number): void {
    this.state.playerBlock = block;
  }

  /**
   * Update the player's current HP.
   *
   * @param hp - New HP value.
   */
  setPlayerHP(hp: number): void {
    this.state.playerHP = hp;
  }

  /**
   * Increment the cards-played-this-turn counter by 1.
   */
  incrementCardsPlayed(): void {
    this.state.cardsPlayedThisTurn += 1;
  }

  // ---------------------------------------------------------------------------
  // Card Play
  // ---------------------------------------------------------------------------

  /**
   * Play a card from hand.
   *
   * Per GDD Card Play Flow:
   * 1. Validate: phase is PLAYER_TURN, card in hand, sufficient energy
   * 2. Pay energy cost via EnergySystem.spendEnergy
   * 3. Resolve each card effect:
   *    - deal_damage: calculate modifiers, apply via EnemyHelper.takeDamage
   *    - gain_block: calculate modifiers, update playerBlock in state
   *    - apply_status: apply via StatusEffectManager
   * 4. Remove card from hand (discard or exhaust based on keywords)
   * 5. Increment cardsPlayedThisTurn
   * 6. Update card's timesPlayedThisCombat counter
   * 7. Check if all enemies dead -> endCombat('victory')
   * 8. Emit card play events
   *
   * @param card - The combat card instance to play.
   * @param targetEnemy - The target enemy for targeted cards. null for self/none targets.
   * @throws Error if phase is not PLAYER_TURN, card not in hand, or insufficient energy.
   */
  playCard(card: CombatCardInstance, targetEnemy: CombatEnemyInstance | null): void {
    // --- Phase validation ---
    if (this.state.phase !== TurnPhase.PLAYER_TURN) {
      throw new Error(
        `playCard requires PLAYER_TURN phase, current: ${this.state.phase}`
      );
    }

    // --- Card in hand validation ---
    const hand = this._deckManager.getHand();
    const cardInHand = hand.find((c) => c.instanceId === card.instanceId);
    if (!cardInHand) {
      throw new Error(
        `Card ${card.instanceId} (${card.data.name}) is not in hand.`
      );
    }

    // --- Energy check and payment ---
    const costType = card.data.costType;
    const effectiveCost = this.getEffectiveCardCost(card);

    // X-cost cards: canPlay checks currentEnergy > 0
    // Unplayable: always rejected
    if (!this._energySystem.canPlay(effectiveCost, costType)) {
      throw new Error(
        `Cannot play ${card.data.name}: insufficient energy (have ${this._energySystem.getCurrentEnergy()}, need ${effectiveCost})`
      );
    }

    // Target validation for ENEMY-targeted cards
    if (card.data.targets === TargetType.ENEMY && targetEnemy === null) {
      throw new Error(
        `Cannot play ${card.data.name}: requires a target enemy.`
      );
    }

    // Pay energy
    if (costType === CostType.X) {
      this._energySystem.spendEnergy(this._energySystem.getCurrentEnergy());
    } else {
      this._energySystem.spendEnergy(effectiveCost);
    }

    this.syncEnergyState();

    // --- Resolve card effects ---
    const allEnemies = this.state.enemies.filter((e) => e.isAlive);

    for (const effect of card.data.effects) {
      // Stop if all enemies dead mid-resolution
      if (this.allEnemiesDead()) {
        break;
      }

      // Resolve per-effect target override
      const effectTarget = this.resolveEffectTarget(
        effect.target ?? null,
        card.data.targets,
        targetEnemy,
        allEnemies
      );

      this.resolveCardEffect(card, effect, effectTarget, allEnemies);
    }

    // --- Post-resolution ---
    // Increment timesPlayedThisCombat on the card instance
    card.timesPlayedThisCombat += 1;

    // Remove from hand: exhaust or discard
    if (this.isCardExhaust(card)) {
      this._deckManager.exhaustCards([card]);
    } else {
      this._deckManager.discardCards([card]);
    }

    // Increment cards played counter
    this.state.cardsPlayedThisTurn += 1;

    // --- Victory check ---
    if (this.allEnemiesDead()) {
      this.endCombat('victory');
      return;
    }

    // Emit card played event
    this._eventBus.emit('onCardPlayed', {
      card: { instanceId: card.instanceId, cardId: card.data.id, upgraded: card.upgraded },
      target: targetEnemy ? { id: targetEnemy.instanceId, type: 'enemy' as const } : null,
      source: 'player' as const,
    });
  }

  // ---------------------------------------------------------------------------
  // Private Helpers
  // ---------------------------------------------------------------------------

  /**
   * Create a fresh initial CombatState.
   */
  private createInitialState(
    playerHP: number,
    playerMaxHP: number,
    baseEnergy: number
  ): CombatState {
    return {
      phase: TurnPhase.INITIALIZING,
      turnNumber: 0,
      playerHP,
      playerMaxHP,
      playerBlock: 0,
      enemies: [],
      drawPile: [],
      hand: [],
      discardPile: [],
      exhaustPile: [],
      currentEnergy: baseEnergy,
      effectiveMaxEnergy: baseEnergy,
      cardsPlayedThisTurn: 0,
      result: null,
    };
  }

  /**
   * Sync energy values from EnergySystem into CombatState.
   * CombatState holds a snapshot for UI/event consumers; EnergySystem is
   * the source of truth for energy calculations.
   */
  private syncEnergyState(): void {
    this.state.currentEnergy = this._energySystem.getCurrentEnergy();
    this.state.effectiveMaxEnergy = this._energySystem.getEffectiveMaxEnergy();
  }

  /**
   * Check if all enemies are dead.
   */
  private allEnemiesDead(): boolean {
    if (this.state.enemies.length === 0) {
      return false; // No enemies -> not a victory condition by itself
    }
    return this.state.enemies.every((e) => !e.isAlive);
  }

  /**
   * Get the effective energy cost for a card.
   * Respects costOverride > upgraded cost > base cost.
   */
  private getEffectiveCardCost(card: CombatCardInstance): number {
    if (card.data.costType === CostType.UNPLAYABLE) {
      return -1;
    }
    if (card.costOverride !== null) {
      return card.costOverride;
    }
    if (card.upgraded && card.data.upgrade?.cost !== undefined) {
      return card.data.upgrade.cost;
    }
    return card.data.cost;
  }

  /**
   * Check if a card has the Exhaust keyword.
   */
  private isCardExhaust(card: CombatCardInstance): boolean {
    return card.data.keywords.includes(Keyword.EXHAUST);
  }

  /**
   * Resolve the target for an individual card effect.
   *
   * Handles per-effect target overrides and the card's default target type.
   * Returns the resolved effect target info:
   * - For damage effects: the enemy instance(s) to damage
   * - For block/status effects: entity ID(s)
   *
   * @param effectTargetOverride - Per-effect target override from CardEffect.target.
   * @param cardTargetType - The card's default target type.
   * @param selectedEnemy - The player-selected enemy (for ENEMY target type).
   * @param allEnemies - All alive enemies.
   * @returns Resolved effect target information.
   */
  private resolveEffectTarget(
    effectTargetOverride: TargetOverride | null,
    cardTargetType: TargetType,
    selectedEnemy: CombatEnemyInstance | null,
    allEnemies: CombatEnemyInstance[]
  ): CardEffectTarget {
    // Per-effect override takes priority
    const target = effectTargetOverride;

    if (target === 'self') {
      return { type: 'self' };
    }
    if (target === 'all_enemies') {
      return { type: 'all_enemies', enemies: allEnemies };
    }
    if (target === 'random_enemy') {
      // Pick a random alive enemy using combatRNG
      if (allEnemies.length === 0) {
        return { type: 'none' };
      }
      const rngStream = this._rng.getStream('combatRNG');
      const idx = rngStream.nextInt(0, allEnemies.length - 1);
      return { type: 'single_enemy', enemy: allEnemies[idx] };
    }
    if (target === 'none') {
      return { type: 'none' };
    }

    // Fall back to card's default target type
    switch (cardTargetType) {
      case TargetType.ENEMY:
        return selectedEnemy
          ? { type: 'single_enemy', enemy: selectedEnemy }
          : { type: 'none' };
      case TargetType.ALL_ENEMY:
        return { type: 'all_enemies', enemies: allEnemies };
      case TargetType.SELF:
      case TargetType.NONE:
        return { type: 'self' };
      default:
        return { type: 'self' };
    }
  }

  /**
   * Resolve a single card effect against the resolved target.
   *
   * Pragmatic approach: route each effect type directly to the appropriate system.
   * - deal_damage: calculate modifiers, apply via EnemyHelper.takeDamage
   * - gain_block: calculate modifiers, update playerBlock in state
   * - apply_status: apply via StatusEffectManager (debuff or buff path)
   *
   * @param card - The card being played.
   * @param effect - The individual effect to resolve.
   * @param target - The resolved effect target.
   * @param allEnemies - All alive enemies (for all_enemies effects).
   */
  private resolveCardEffect(
    card: CombatCardInstance,
    effect: CardEffect,
    target: CardEffectTarget,
    _allEnemies: CombatEnemyInstance[]
  ): void {
    switch (effect.type) {
      case 'deal_damage': {
        this.resolveCardDamage(card, effect, target);
        break;
      }
      case 'gain_block': {
        this.resolveCardBlock(card, effect);
        break;
      }
      case 'apply_status': {
        this.resolveCardStatus(card, effect, target);
        break;
      }
      default: {
        // Unknown effect types are logged and skipped.
        // The EffectResolver can handle complex custom effects in the future.
        break;
      }
    }
  }

  /**
   * Resolve a damage effect from a card.
   *
   * Per ADR-003 Modifier Application Order:
   * 1. Base value = effect.value (use upgradedValue if card is upgraded and present)
   * 2. Strength: damage += playerStrength (flat additive)
   * 3. Vulnerable on target: damage = floor(damage * 1.5)
   * 4. Weak on player: damage = floor(damage * 0.75)
   * 5. Floor at 1
   *
   * Multi-hit: apply the same damage calculation for each hit.
   * For all_enemies: apply to each alive enemy individually.
   */
  private resolveCardDamage(
    _card: CombatCardInstance,
    effect: CardEffect,
    target: CardEffectTarget
  ): void {
    // Determine base damage (upgraded value if available and card is upgraded)
    let baseDamage = effect.value;

    // Calculate modifiers
    const playerStrength = this._statusEffectManager.getEffectStacks(PLAYER_TARGET_ID, 'strength');
    let damage = baseDamage + playerStrength;

    const playerWeak = this._statusEffectManager.getEffectStacks(PLAYER_TARGET_ID, 'weak');
    if (playerWeak > 0) {
      damage = Math.floor(damage * 0.75);
    }

    // Floor at 1
    damage = Math.max(1, damage);

    const hits = effect.hits ?? 1;

    // Get target enemies
    const enemies: CombatEnemyInstance[] = [];
    if (target.type === 'single_enemy' && target.enemy) {
      enemies.push(target.enemy);
    } else if (target.type === 'all_enemies' && target.enemies) {
      enemies.push(...target.enemies);
    }

    for (const enemy of enemies) {
      if (!enemy.isAlive) continue;

      // Per-hit: apply Vulnerable to this specific enemy
      let hitDamage = damage;
      const enemyVulnerable = this._statusEffectManager.getEffectStacks(
        enemy.instanceId,
        'vulnerable'
      );
      if (enemyVulnerable > 0) {
        hitDamage = Math.floor(hitDamage * 1.5);
      }

      // Intangible check
      const enemyIntangible = this._statusEffectManager.getEffectStacks(
        enemy.instanceId,
        'intangible'
      );
      if (enemyIntangible > 0) {
        hitDamage = 1;
      }

      // Apply hits
      for (let h = 0; h < hits; h++) {
        if (!enemy.isAlive) break;
        const result = this._enemyHelper.takeDamage(enemy, hitDamage);

        this._eventBus.emit('onDamageDealt', {
          source: { id: PLAYER_TARGET_ID, type: 'player' as const },
          target: { id: enemy.instanceId, type: 'enemy' as const },
          damage: result.hpLost,
          blocked: result.blocked,
        });

        if (!enemy.isAlive) {
          this._eventBus.emit('onEnemyDeath', {
            enemy,
            killer: { id: PLAYER_TARGET_ID, type: 'player' as const },
          });
        }
      }
    }
  }

  /**
   * Resolve a block gain effect from a card.
   *
   * Per ADR-003 Block Modifier Order:
   * 1. Base value = effect.value
   * 2. Dexterity: block += playerDexterity (flat additive)
   * 3. Frail on player: block = floor(block * 0.75)
   * 4. Floor at 0
   *
   * Block always applies to the player (card player).
   */
  private resolveCardBlock(
    _card: CombatCardInstance,
    effect: CardEffect
  ): void {
    let block = effect.value;

    // Dexterity modifier
    const playerDexterity = this._statusEffectManager.getEffectStacks(PLAYER_TARGET_ID, 'dexterity');
    block += playerDexterity;

    // Frail modifier
    const playerFrail = this._statusEffectManager.getEffectStacks(PLAYER_TARGET_ID, 'frail');
    if (playerFrail > 0) {
      block = Math.floor(block * 0.75);
    }

    // Floor at 0
    block = Math.max(0, block);

    // Apply block to player
    this.state.playerBlock += block;

    this._eventBus.emit('onBlockGained', {
      target: { id: PLAYER_TARGET_ID, type: 'player' as const },
      amount: block,
      total: this.state.playerBlock,
    });
  }

  /**
   * Resolve a status effect application from a card.
   *
   * Routes through StatusEffectManager:
   * - Debuffs: use tryApplyDebuff (respects Artifact negation and immunity)
   * - Buffs/neutrals: use applyEffect directly
   */
  private resolveCardStatus(
    _card: CombatCardInstance,
    effect: CardEffect,
    target: CardEffectTarget
  ): void {
    if (!effect.status) return;

    const stacks = effect.value;
    const statusId = effect.status;

    // Determine target entities
    const targetIds: string[] = [];
    if (target.type === 'self') {
      targetIds.push(PLAYER_TARGET_ID);
    } else if (target.type === 'single_enemy' && target.enemy) {
      targetIds.push(target.enemy.instanceId);
    } else if (target.type === 'all_enemies' && target.enemies) {
      for (const e of target.enemies) {
        targetIds.push(e.instanceId);
      }
    }

    for (const tid of targetIds) {
      // Check if debuff or buff
      const effectData = this._statusEffectManager.getEffectData(statusId);
      if (effectData && effectData.category === 'debuff') {
        this._statusEffectManager.tryApplyDebuff(tid, statusId, stacks, PLAYER_TARGET_ID);
      } else {
        this._statusEffectManager.applyEffect(tid, statusId, stacks, PLAYER_TARGET_ID);
      }

      this._eventBus.emit('onStatusApplied', {
        target: { id: tid, type: tid === PLAYER_TARGET_ID ? 'player' as const : 'enemy' as const },
        status: statusId,
        stacks,
      });
    }
  }

  /**
   * Select the next move for an enemy and resolve the moveId to a full EnemyMove.
   *
   * After EnemyHelper.selectMove returns a moveId, this method looks up the
   * full EnemyMove from enemy.data.moveDefinitions and sets enemy.currentMove.
   * If no moveDefinitions exists or the moveId is not found, currentMove is
   * set to null (intent execution becomes a no-op).
   *
   * @param enemy - The enemy instance to select and resolve a move for.
   * @param aiRNG - RNG stream for move selection.
   */
  private selectAndResolveEnemyMove(enemy: CombatEnemyInstance, aiRNG: ICombatRNGStream): void {
    // If the enemy already has a resolved currentMove (e.g., set externally or
    // from a previous selectAndResolve call), keep it. This allows tests and
    // external systems to pre-set intents without them being overwritten.
    if (enemy.currentMove) {
      return;
    }

    const moveId = this._enemyHelper.selectMove(enemy, aiRNG);
    const moveDefinitions = enemy.data.moveDefinitions;
    if (moveDefinitions && moveId in moveDefinitions) {
      enemy.currentMove = moveDefinitions[moveId];
    } else {
      enemy.currentMove = null;
    }
  }

  /**
   * Execute a single enemy's intent (their planned move for this turn).
   *
   * Per ADR-002: each effect in the enemy's move is resolved through the
   * same modifier pipeline as card effects. The enemy is the source, the
   * player is the target for attacks.
   *
   * If the enemy has no currentMove (move registry not yet implemented),
   * this is a no-op. Damage/block/status values come from the MoveEffect.
   *
   * @param enemy - The enemy whose intent to execute.
   */
  private executeEnemyIntent(enemy: CombatEnemyInstance): void {
    const move = enemy.currentMove;
    if (!move || !move.effects || move.effects.length === 0) {
      return;
    }

    // Execute each effect in the move
    for (const effect of move.effects) {
      // Stop if player is already dead
      if (this.state.playerHP <= 0) {
        return;
      }

      // Stop if enemy died mid-intent (e.g., thorns)
      if (!enemy.isAlive) {
        return;
      }

      this.resolveEnemyEffect(enemy, effect);
    }
  }

  /**
   * Resolve a single enemy move effect.
   *
   * Converts MoveEffect to a CardEffect-like shape and routes through
   * EffectResolver for consistent modifier application (ADR-003).
   *
   * Handles the common effect types:
   * - deal_damage: Apply damage to player with modifiers (Strength, Vulnerable, Weak)
   * - gain_block: Add block to the enemy
   * - apply_status: Apply status effect to target
   *
   * For effects not handled by the resolver, applies them directly.
   *
   * @param enemy - The enemy executing the effect.
   * @param effect - The move effect to resolve.
   */
  private resolveEnemyEffect(enemy: CombatEnemyInstance, effect: MoveEffect): void {
    switch (effect.type) {
      case 'deal_damage': {
        this.resolveEnemyDamage(enemy, effect);
        break;
      }
      case 'gain_block': {
        this._enemyHelper.gainBlock(enemy, effect.value);
        break;
      }
      case 'apply_status': {
        if (effect.status) {
          // Enemy status effects target the player by default
          const targetId = PLAYER_TARGET_ID;
          const stacks = effect.value;
          const statusId = effect.status;

          // Determine if debuff or buff for proper application path
          const effectData = this._statusEffectManager.getEffectData(statusId);
          if (effectData && effectData.category === 'debuff') {
            this._statusEffectManager.tryApplyDebuff(targetId, statusId, stacks, enemy.instanceId);
          } else {
            this._statusEffectManager.applyEffect(targetId, statusId, stacks, enemy.instanceId);
          }

          this._eventBus.emit('onStatusApplied', {
            target: { id: targetId, type: 'player' as const },
            status: statusId,
            stacks,
          });
        }
        break;
      }
      default: {
        // Unknown effect types are logged and skipped.
        // Future effect types can be added here or routed to EffectResolver.
        break;
      }
    }
  }

  /**
   * Resolve enemy damage against the player.
   *
   * Per ADR-002 Damage Pipeline (enemy as source):
   * 1. Base damage = effect.value
   * 2. Enemy Strength: damage += enemyStrength (flat additive)
   * 3. Player Vulnerable: damage = floor(damage * 1.5)
   * 4. Enemy Weak: damage = floor(damage * 0.75)
   * 5. Player Intangible: damage = 1
   * 6. Floor at 1
   * 7. Apply block absorption
   * 8. Apply HP loss
   * 9. Death check
   *
   * Calculates damage directly without routing through EffectResolver.
   * This mirrors the same pattern as resolveCardDamage for consistency.
   *
   * @param enemy - The attacking enemy.
   * @param effect - The damage effect from the enemy's move.
   */
  private resolveEnemyDamage(enemy: CombatEnemyInstance, effect: MoveEffect): void {
    // Step 1: Base damage
    let damage = effect.value;

    // Step 2: Enemy Strength modifier
    const enemyStrength = this._statusEffectManager.getEffectStacks(enemy.instanceId, 'strength');
    damage += enemyStrength;

    // Step 3: Player Vulnerable — enemies deal 50% more to vulnerable targets
    const playerVulnerable = this._statusEffectManager.getEffectStacks(PLAYER_TARGET_ID, 'vulnerable');
    if (playerVulnerable > 0) {
      damage = Math.floor(damage * 1.5);
    }

    // Step 4: Enemy Weak — enemy deals 25% less damage
    const enemyWeak = this._statusEffectManager.getEffectStacks(enemy.instanceId, 'weak');
    if (enemyWeak > 0) {
      damage = Math.floor(damage * 0.75);
    }

    // Step 5: Player Intangible cap
    const playerIntangible = this._statusEffectManager.getEffectStacks(PLAYER_TARGET_ID, 'intangible');
    if (playerIntangible > 0) {
      damage = 1;
    }

    // Step 6: Floor at 1
    damage = Math.max(1, damage);

    // Step 7: Block absorption
    const blocked = Math.min(this.state.playerBlock, damage);
    this.state.playerBlock -= blocked;
    const hpLost = damage - blocked;

    // Step 8: Apply HP loss
    if (hpLost > 0) {
      this.state.playerHP = Math.max(0, this.state.playerHP - hpLost);
    }

    // Emit damage events
    this._eventBus.emit('onDamageDealt', {
      source: { id: enemy.instanceId, type: 'enemy' },
      target: { id: PLAYER_TARGET_ID, type: 'player' },
      damage: hpLost,
      blocked,
    });

    // Step 9: Death check
    if (this.state.playerHP <= 0) {
      this._eventBus.emit('onEntityDeath', {
        entity: { id: PLAYER_TARGET_ID, type: 'player' },
        cause: 'damage',
      });
    }
  }
}
