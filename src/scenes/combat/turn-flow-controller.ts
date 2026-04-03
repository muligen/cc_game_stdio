/**
 * turn-flow-controller.ts -- Coordinator bridging input and combat logic.
 *
 * Bridges CombatInputController (input state machine) and CombatController
 * (combat backend) to drive the turn cycle. This is the "brain" that processes
 * player actions (card selection, targeting, end turn) and orchestrates turn
 * transitions between player and enemy phases.
 *
 * Implements: Sprint 3 Task S3-08 (Turn Flow UI Controller)
 * Architecture: ADR-001 (state management), ADR-002 (turn flow)
 *
 * Key design decisions:
 * - Pure TypeScript, no Phaser imports
 * - All combat logic delegated to CombatController; this class only coordinates
 * - Input state transitions delegated to CombatInputController
 * - Combat-over checks after every significant action (card play, enemy turn)
 * - Error messages propagated from input validation, not invented here
 * - Event emissions for UI feedback delegated to downstream systems
 * - Pending card stored internally during targeting flow
 */

// ---------------------------------------------------------------------------
// Dependency Interfaces
// ---------------------------------------------------------------------------

/** Combat controller dependencies (subset used by TurnFlowController). */
export interface TurnFlowCombatDeps {
  getPhase(): string;
  getState(): {
    cardsPlayedThisTurn: number;
    playerHP: number;
    playerBlock: number;
    enemies: Array<{ isAlive: boolean; currentMove: unknown }>;
    turnNumber: number;
    result: string | null;
  };
  playCard(card: unknown, targetEnemy: unknown): void;
  endPlayerTurn(): void;
  executeEnemyTurn(): void;
  startPlayerTurn(): void;
}

/** Input controller dependencies (subset used by TurnFlowController). */
export interface TurnFlowInputDeps {
  getPhase(): string;
  selectCard(index: number, cardInfo: unknown): { phase: string; errorMessage: string | null };
  clickEnemy(index: number, enemiesAlive: number): { phase: string; errorMessage: string | null };
  cancelSelection(): { phase: string };
  startResolving(): { phase: string };
  endResolving(): { phase: string };
  startEnemyTurn(): { phase: string };
  startPlayerTurn(): { phase: string };
  combatOver(): { phase: string };
  canEndTurn(): boolean;
}

/** Event bus dependencies for emitting UI feedback events. */
export interface TurnFlowEventBusDeps {
  emit(event: string, payload: unknown): void;
}

/** Aggregated dependencies for TurnFlowController. */
export interface TurnFlowDeps {
  combatController: TurnFlowCombatDeps;
  inputController: TurnFlowInputDeps;
  eventBus: TurnFlowEventBusDeps;
}

// ---------------------------------------------------------------------------
// Request / Response Types
// ---------------------------------------------------------------------------

/** Card play request data from the UI layer. */
export interface CardPlayRequest {
  /** Index of the card in the player's hand. */
  cardIndex: number;
  /** Unique instance ID of the card. */
  cardInstanceId: string;
  /** Energy cost of the card. */
  cardCost: number;
  /** Player's current energy. */
  currentEnergy: number;
  /** Whether this card requires a target enemy. */
  needsTarget: boolean;
  /** Whether this card can be played (energy + phase checks pass). */
  isPlayable: boolean;
  /** The actual card instance for passing to CombatController.playCard. */
  card: unknown;
}

/** Enemy target information from the UI layer. */
export interface EnemyTargetInfo {
  /** Index of the enemy in the enemy array. */
  enemyIndex: number;
  /** Total number of alive enemies. */
  totalAlive: number;
  /** The actual enemy instance for passing to CombatController.playCard. */
  enemy: unknown;
}

// ---------------------------------------------------------------------------
// TurnFlowController
// ---------------------------------------------------------------------------

/**
 * TurnFlowController -- coordinates turn flow between input and combat logic.
 *
 * Responsibilities:
 * 1. Validate player actions (select card, target enemy, end turn) via input controller
 * 2. Execute combat actions (play card, end turn, enemy turn) via combat controller
 * 3. Transition input state in sync with combat state
 * 4. Check for combat-over conditions after each significant action
 *
 * Lifecycle:
 * 1. Constructed with TurnFlowDeps (combat, input, event bus)
 * 2. Player turn: trySelectCard -> tryTargetEnemy -> tryEndTurn
 * 3. Enemy turn: executeEnemyTurn (called by scene after tryEndTurn or directly)
 * 4. Next player turn: executePlayerTurnStart
 * 5. Combat ends: isCombatOver returns true, getResult returns 'victory'|'defeat'
 */
export class TurnFlowController {
  private readonly deps: TurnFlowDeps;

  /** Pending card awaiting target selection (set by trySelectCard, consumed by tryTargetEnemy). */
  private pendingCard: unknown | null;

  /**
   * @param deps - Aggregated dependencies for combat, input, and event bus.
   */
  constructor(deps: TurnFlowDeps) {
    this.deps = deps;
    this.pendingCard = null;
  }

  // ---------------------------------------------------------------------------
  // Player Actions
  // ---------------------------------------------------------------------------

  /**
   * Player tries to play a card. Handles the full flow:
   * validate -> select -> target -> resolve.
   *
   * Flow:
   * - If card is not playable -> return error
   * - If combat is over -> ignored (return error)
   * - If card is playable and doesn't need target -> immediately resolve
   *   (input: selectCard -> resolving -> endResolving; combat: playCard)
   * - If card needs target -> enter targeting mode, store pending card
   *   (input: selectCard -> card_selected; wait for tryTargetEnemy)
   *
   * @param request - Card play request with card info and validation data.
   * @returns Result indicating success/failure and whether target selection is needed.
   */
  trySelectCard(request: CardPlayRequest): { success: boolean; error?: string; needsTarget: boolean } {
    // Guard: combat is over
    if (this.isCombatOver()) {
      return { success: false, error: 'Combat is over', needsTarget: false };
    }

    // Guard: card is not playable
    if (!request.isPlayable) {
      // Forward to input controller to get proper error message
      const inputResult = this.deps.inputController.selectCard(request.cardIndex, {
        instanceId: request.cardInstanceId,
        cost: request.cardCost,
        currentEnergy: request.currentEnergy,
        needsTarget: request.needsTarget,
        isPlayable: request.isPlayable,
      });
      return {
        success: false,
        error: inputResult.errorMessage ?? 'Card is not playable',
        needsTarget: false,
      };
    }

    // Card is playable -- forward to input controller
    const inputResult = this.deps.inputController.selectCard(request.cardIndex, {
      instanceId: request.cardInstanceId,
      cost: request.cardCost,
      currentEnergy: request.currentEnergy,
      needsTarget: request.needsTarget,
      isPlayable: request.isPlayable,
    });

    if (inputResult.errorMessage) {
      // Input controller rejected the selection (e.g., wrong phase)
      return {
        success: false,
        error: inputResult.errorMessage,
        needsTarget: false,
      };
    }

    // Card doesn't need a target -> immediately resolve
    if (!request.needsTarget) {
      this.deps.inputController.startResolving();
      this.deps.combatController.playCard(request.card, null);

      // Check if combat ended from this card play
      if (this.isCombatOver()) {
        this.deps.inputController.combatOver();
        return { success: true, needsTarget: false };
      }

      this.deps.inputController.endResolving();
      return { success: true, needsTarget: false };
    }

    // Card needs a target -> store pending card and wait for tryTargetEnemy
    this.pendingCard = request.card;
    return { success: true, needsTarget: true };
  }

  /**
   * Player selects an enemy target for the currently selected card.
   *
   * Only valid when the input controller is in 'card_selected' phase.
   * On success, calls playCard on the combat controller with the stored
   * pending card and the selected enemy, then transitions input through
   * resolving -> idle.
   *
   * @param info - Enemy target information from the UI layer.
   * @returns Result indicating success/failure with optional error message.
   */
  tryTargetEnemy(info: EnemyTargetInfo): { success: boolean; error?: string } {
    // Guard: combat is over
    if (this.isCombatOver()) {
      return { success: false, error: 'Combat is over' };
    }

    // Guard: not in targeting mode
    const currentPhase = this.deps.inputController.getPhase();
    if (currentPhase !== 'card_selected') {
      return { success: false, error: 'Not in targeting mode' };
    }

    // Forward to input controller for validation
    const inputResult = this.deps.inputController.clickEnemy(
      info.enemyIndex,
      info.totalAlive
    );

    if (inputResult.errorMessage) {
      return { success: false, error: inputResult.errorMessage };
    }

    // Input accepted the target -- input is now in 'resolving' phase.
    // Play the card via combat controller with the stored pending card.
    const card = this.pendingCard;
    this.pendingCard = null;

    this.deps.combatController.playCard(card, info.enemy);

    // Check if combat ended from this card play
    if (this.isCombatOver()) {
      this.deps.inputController.combatOver();
      return { success: true };
    }

    this.deps.inputController.endResolving();
    return { success: true };
  }

  /**
   * Player cancels current card selection.
   * Returns input to idle state and clears pending card.
   */
  cancelCardSelection(): void {
    if (this.isCombatOver()) {
      return;
    }
    this.pendingCard = null;
    this.deps.inputController.cancelSelection();
  }

  /**
   * Player clicks End Turn. Validates and executes the turn transition.
   *
   * Validates:
   * - Input is in a valid state for ending turn (idle or card_hovered)
   * - Combat phase is PLAYER_TURN
   *
   * On success:
   * - Calls endPlayerTurn on combat controller
   * - Calls executeEnemyTurn on combat controller
   * - Updates input state through enemy_turn phase
   * - Checks for combat end after each step
   *
   * @returns Result indicating success/failure with optional error message.
   */
  tryEndTurn(): { success: boolean; error?: string } {
    // Guard: combat is over
    if (this.isCombatOver()) {
      return { success: false, error: 'Combat is over' };
    }

    // Guard: not a valid phase for ending turn from input side
    if (!this.deps.inputController.canEndTurn()) {
      return { success: false, error: 'Cannot end turn right now' };
    }

    // Guard: combat must be in PLAYER_TURN phase
    if (this.deps.combatController.getPhase() !== 'player_turn') {
      return { success: false, error: 'Not player turn phase' };
    }

    // Clear any pending card state
    this.pendingCard = null;

    // Execute turn transition
    // 1. End player turn on combat controller
    this.deps.combatController.endPlayerTurn();

    // 2. Check if combat ended from turn-end effects (e.g., poison kill)
    if (this.isCombatOver()) {
      this.deps.inputController.combatOver();
      return { success: true };
    }

    // 3. Transition input to enemy turn
    this.deps.inputController.startEnemyTurn();

    // 4. Execute enemy turn
    this.deps.combatController.executeEnemyTurn();

    // 5. Check if combat ended from enemy actions
    if (this.isCombatOver()) {
      this.deps.inputController.combatOver();
      return { success: true };
    }

    return { success: true };
  }

  // ---------------------------------------------------------------------------
  // Combat Flow
  // ---------------------------------------------------------------------------

  /**
   * Execute the enemy turn sequence.
   *
   * Delegates to CombatController.executeEnemyTurn().
   * After execution, checks if combat is over.
   * If not over, the caller triggers startPlayerTurn.
   *
   * This method is called directly when the scene manages turn flow
   * (e.g., with animations between player and enemy turns).
   */
  executeEnemyTurn(): void {
    if (this.isCombatOver()) {
      return;
    }

    this.deps.combatController.executeEnemyTurn();

    // Check for combat end after enemy actions
    if (this.isCombatOver()) {
      this.deps.inputController.combatOver();
    }
  }

  /**
   * Start next player turn.
   * Transitions input back to idle and calls startPlayerTurn on combat controller.
   */
  executePlayerTurnStart(): void {
    if (this.isCombatOver()) {
      return;
    }

    this.deps.combatController.startPlayerTurn();
    this.deps.inputController.startPlayerTurn();
  }

  // ---------------------------------------------------------------------------
  // Queries
  // ---------------------------------------------------------------------------

  /**
   * Is the combat over?
   * Checks the combat controller's phase for COMBAT_OVER.
   */
  isCombatOver(): boolean {
    return this.deps.combatController.getPhase() === 'combat_over';
  }

  /**
   * Get combat result.
   * Returns 'victory', 'defeat', or null if combat is still ongoing.
   */
  getResult(): string | null {
    return this.deps.combatController.getState().result;
  }
}
