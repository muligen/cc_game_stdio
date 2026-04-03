/**
 * combat-input.ts -- Pure TypeScript input state machine for card play flow.
 *
 * Manages card selection, targeting, and play flow during combat.
 * This is logic-only: no Phaser imports, no rendering, no DOM.
 * The scene layer instantiates this controller and feeds raw input events
 * (hover, click, cancel) into it, then reads the resulting InputState
 * to drive UI feedback and card resolution.
 *
 * Implements: design/gdd/combat-input.md (Card Play Input State Machine)
 * Architecture: ADR-001 (state management), ADR-004 (event-driven input)
 *
 * Key design decisions:
 * - Immutable state snapshots: every action returns a new InputState
 * - Terminal state: combat_over blocks all transitions permanently
 * - Silent rejection: actions in wrong phase are ignored (no error thrown)
 * - Error messages stored in state for UI display (not thrown)
 * - All validation logic lives here; UI only provides raw input and card info
 */

// ---------------------------------------------------------------------------
// Input Phase Enum
// ---------------------------------------------------------------------------

/** Input states for the combat card play flow. */
export type InputPhase =
  | 'idle'           // Nothing selected, waiting for player input
  | 'card_hovered'   // Player hovering a card (not yet committed)
  | 'card_selected'  // Card lifted, waiting for target (if needs target) or immediate play
  | 'resolving'      // Card effect being resolved, input blocked
  | 'enemy_turn'     // Input disabled during enemy turn
  | 'combat_over';   // Input permanently disabled

// ---------------------------------------------------------------------------
// State Interfaces
// ---------------------------------------------------------------------------

/** Complete input state snapshot. */
export interface InputState {
  /** Current phase of the input state machine. */
  phase: InputPhase;
  /** Index of the card currently selected (lifted) in hand, or null. */
  selectedCardIndex: number | null;
  /** Index of the card currently being hovered, or null. */
  hoveredCardIndex: number | null;
  /** Index of the enemy targeted for card play, or null. */
  targetedEnemyIndex: number | null;
  /** Human-readable error message for the last failed action, or null. */
  errorMessage: string | null;
}

/** Card info required for input validation at selection time. */
export interface CardInputInfo {
  /** Unique instance ID of the card in hand. */
  instanceId: string;
  /** Energy cost to play this card. */
  cost: number;
  /** Player's current energy available. */
  currentEnergy: number;
  /** Whether this card requires a single enemy target. */
  needsTarget: boolean;
  /** Whether this card can be played (energy check + phase check). */
  isPlayable: boolean;
}

// ---------------------------------------------------------------------------
// Initial State Factory
// ---------------------------------------------------------------------------

/** Create the default initial input state. */
function createInitialState(): InputState {
  return {
    phase: 'idle',
    selectedCardIndex: null,
    hoveredCardIndex: null,
    targetedEnemyIndex: null,
    errorMessage: null,
  };
}

// ---------------------------------------------------------------------------
// CombatInputController
// ---------------------------------------------------------------------------

/**
 * CombatInputController -- pure state machine for combat card play input.
 *
 * Transition rules:
 *   idle          + hoverCard(n)       -> card_hovered
 *   card_hovered  + hoverCard(null)    -> idle
 *   card_hovered  + selectCard(playable) -> card_selected
 *   card_hovered  + selectCard(!playable) -> idle + errorMessage
 *   idle          + selectCard(playable) -> card_selected
 *   card_selected + clickEnemy(valid)  -> resolving
 *   card_selected + cancelSelection    -> idle
 *   card_selected + selectCard(!needsTarget, playable) -> resolving
 *   resolving     + endResolving       -> idle
 *   idle          + startEnemyTurn     -> enemy_turn
 *   enemy_turn    + startPlayerTurn    -> idle
 *   any           + combatOver         -> combat_over
 *   combat_over   + *                  -> combat_over (terminal)
 *
 * Actions in wrong phases are silently ignored unless they produce
 * a meaningful error message (e.g., insufficient energy).
 */
export class CombatInputController {
  private state: InputState;

  constructor() {
    this.state = createInitialState();
  }

  // ---------------------------------------------------------------------------
  // State Queries
  // ---------------------------------------------------------------------------

  /** Get a readonly snapshot of the current input state. */
  getState(): Readonly<InputState> {
    return this.state;
  }

  /** Get the current input phase. */
  getPhase(): InputPhase {
    return this.state.phase;
  }

  /** Whether the player can select a card (idle or card_hovered phase). */
  canSelectCard(): boolean {
    return this.state.phase === 'idle' || this.state.phase === 'card_hovered';
  }

  /** Whether the player can click an enemy (card_selected phase with a targeting card). */
  canClickEnemy(): boolean {
    return this.state.phase === 'card_selected';
  }

  /** Whether the player can end their turn (idle or card_hovered phase). */
  canEndTurn(): boolean {
    return this.state.phase === 'idle' || this.state.phase === 'card_hovered';
  }

  // ---------------------------------------------------------------------------
  // Input Actions
  // ---------------------------------------------------------------------------

  /**
   * Player hovers over a card.
   * Only effective in idle or card_hovered phases.
   *
   * @param index - Card index in hand, or null when hover leaves all cards.
   * @returns Updated input state.
   */
  hoverCard(index: number | null): InputState {
    if (this.state.phase === 'combat_over') {
      return this.state;
    }

    if (this.state.phase === 'resolving' || this.state.phase === 'enemy_turn') {
      return this.state;
    }

    if (this.state.phase === 'card_selected') {
      // While a card is selected, hover changes are allowed for visual feedback
      // but phase does not change.
      this.state = {
        ...this.state,
        hoveredCardIndex: index,
      };
      return this.state;
    }

    if (index === null) {
      // Hovering nothing returns to idle from card_hovered
      this.state = {
        ...this.state,
        phase: 'idle',
        hoveredCardIndex: null,
      };
      return this.state;
    }

    // Hovering a card transitions to card_hovered (from idle or card_hovered)
    this.state = {
      ...this.state,
      phase: 'card_hovered',
      hoveredCardIndex: index,
    };
    return this.state;
  }

  /**
   * Player clicks a card in hand. Validates and transitions to selected/targeting.
   * Only effective in idle or card_hovered phases.
   *
   * @param index - Card index in hand.
   * @param cardInfo - Card metadata for validation.
   * @returns Updated input state.
   */
  selectCard(index: number, cardInfo: CardInputInfo): InputState {
    // Terminal state: no transitions out
    if (this.state.phase === 'combat_over') {
      return this.state;
    }

    // Wrong phase: silently ignored
    if (this.state.phase !== 'idle' && this.state.phase !== 'card_hovered') {
      return this.state;
    }

    // Card not playable
    if (!cardInfo.isPlayable) {
      // Distinguish energy error from generic unplayable
      if (cardInfo.cost > cardInfo.currentEnergy) {
        this.state = {
          ...this.state,
          phase: 'idle',
          selectedCardIndex: null,
          hoveredCardIndex: index,
          targetedEnemyIndex: null,
          errorMessage: `Not enough energy (need ${cardInfo.cost}, have ${cardInfo.currentEnergy})`,
        };
      } else {
        this.state = {
          ...this.state,
          phase: 'idle',
          selectedCardIndex: null,
          hoveredCardIndex: index,
          targetedEnemyIndex: null,
          errorMessage: 'Cannot play this card right now',
        };
      }
      return this.state;
    }

    // Card is playable but does not need a target -- resolve immediately
    if (!cardInfo.needsTarget) {
      this.state = {
        ...this.state,
        phase: 'resolving',
        selectedCardIndex: index,
        hoveredCardIndex: index,
        targetedEnemyIndex: null,
        errorMessage: null,
      };
      return this.state;
    }

    // Card needs a target -- transition to card_selected
    this.state = {
      ...this.state,
      phase: 'card_selected',
      selectedCardIndex: index,
      hoveredCardIndex: index,
      targetedEnemyIndex: null,
      errorMessage: null,
    };
    return this.state;
  }

  /**
   * Player clicks an enemy (for targeting).
   * Only valid in card_selected phase with a needsTarget card.
   *
   * @param index - Enemy index in the enemy array.
   * @param enemiesAlive - Number of enemies currently alive.
   * @returns Updated input state.
   */
  clickEnemy(index: number, enemiesAlive: number): InputState {
    // Terminal state: no transitions out
    if (this.state.phase === 'combat_over') {
      return this.state;
    }

    // Wrong phase: silently ignored
    if (this.state.phase !== 'card_selected') {
      return this.state;
    }

    // Validate target
    if (enemiesAlive <= 0 || index < 0 || index >= enemiesAlive) {
      this.state = {
        ...this.state,
        errorMessage: 'Invalid target',
      };
      return this.state;
    }

    // Valid target -- transition to resolving
    this.state = {
      ...this.state,
      phase: 'resolving',
      targetedEnemyIndex: index,
      errorMessage: null,
    };
    return this.state;
  }

  /**
   * Player clicks empty area or presses ESC -- cancels current selection.
   * Effective in card_selected and card_hovered phases.
   *
   * @returns Updated input state.
   */
  cancelSelection(): InputState {
    if (this.state.phase === 'combat_over') {
      return this.state;
    }

    if (this.state.phase === 'card_selected') {
      this.state = {
        ...this.state,
        phase: 'idle',
        selectedCardIndex: null,
        hoveredCardIndex: null,
        targetedEnemyIndex: null,
        errorMessage: null,
      };
      return this.state;
    }

    // In other phases, no effect
    return this.state;
  }

  /**
   * Card resolution starts -- blocks further input.
   * Should be called after selectCard or clickEnemy triggers a resolve.
   * Note: selectCard/clickEnemy already transition to resolving when appropriate.
   * This method exists for external systems that need to explicitly start resolution.
   *
   * @returns Updated input state.
   */
  startResolving(): InputState {
    if (this.state.phase === 'combat_over') {
      return this.state;
    }

    if (this.state.phase === 'card_selected' || this.state.phase === 'idle') {
      this.state = {
        ...this.state,
        phase: 'resolving',
        errorMessage: null,
      };
      return this.state;
    }

    return this.state;
  }

  /**
   * Card resolution complete -- returns to idle.
   *
   * @returns Updated input state.
   */
  endResolving(): InputState {
    if (this.state.phase === 'combat_over') {
      return this.state;
    }

    if (this.state.phase === 'resolving') {
      this.state = {
        ...this.state,
        phase: 'idle',
        selectedCardIndex: null,
        hoveredCardIndex: null,
        targetedEnemyIndex: null,
        errorMessage: null,
      };
      return this.state;
    }

    return this.state;
  }

  /**
   * Enemy turn begins -- disables all card input.
   *
   * @returns Updated input state.
   */
  startEnemyTurn(): InputState {
    if (this.state.phase === 'combat_over') {
      return this.state;
    }

    this.state = {
      ...this.state,
      phase: 'enemy_turn',
      selectedCardIndex: null,
      hoveredCardIndex: null,
      targetedEnemyIndex: null,
      errorMessage: null,
    };
    return this.state;
  }

  /**
   * Enemy turn ends (player turn starts) -- re-enables input.
   *
   * @returns Updated input state.
   */
  startPlayerTurn(): InputState {
    if (this.state.phase === 'combat_over') {
      return this.state;
    }

    if (this.state.phase === 'enemy_turn') {
      this.state = {
        ...this.state,
        phase: 'idle',
        selectedCardIndex: null,
        hoveredCardIndex: null,
        targetedEnemyIndex: null,
        errorMessage: null,
      };
      return this.state;
    }

    return this.state;
  }

  /**
   * Combat ends -- permanently disables input.
   * This is a terminal transition: once combat_over, no actions change state.
   *
   * @returns Updated input state.
   */
  combatOver(): InputState {
    this.state = {
      phase: 'combat_over',
      selectedCardIndex: null,
      hoveredCardIndex: null,
      targetedEnemyIndex: null,
      errorMessage: null,
    };
    return this.state;
  }

  /**
   * Reset to initial state (for new combat).
   *
   * @returns Updated input state.
   */
  reset(): InputState {
    this.state = createInitialState();
    return this.state;
  }
}
