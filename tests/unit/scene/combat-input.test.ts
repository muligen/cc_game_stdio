/**
 * combat-input.test.ts -- Unit tests for CombatInputController.
 *
 * Verifies that the input state machine correctly handles all card selection,
 * targeting, and play flow transitions. Pure TypeScript -- no Phaser imports.
 *
 * Coverage areas:
 * 1. Initial state is idle
 * 2. hoverCard transitions (idle <-> card_hovered)
 * 3. selectCard with playable/unplayable cards
 * 4. Energy error messages
 * 5. Phase-gated actions (enemy_turn, combat_over blocks)
 * 6. clickEnemy targeting validation
 * 7. cancelSelection flow
 * 8. startResolving/endResolving cycle
 * 9. Enemy/player turn transitions
 * 10. combatOver terminal state
 * 11. reset functionality
 * 12. Full card play flows (targeted and self-target)
 * 13. Query methods (canSelectCard, canClickEnemy, canEndTurn)
 */

// @vitest-environment node

import { describe, it, expect, beforeEach } from 'vitest';
import {
  CombatInputController,
  type InputState,
  type InputPhase,
  type CardInputInfo,
} from '../../../src/scenes/combat/combat-input';

// ---------------------------------------------------------------------------
// Test Helpers
// ---------------------------------------------------------------------------

/** Create a fresh CombatInputController for each test. */
function createController(): CombatInputController {
  return new CombatInputController();
}

/** Create a playable card info with sensible defaults. */
function playableCard(overrides: Partial<CardInputInfo> = {}): CardInputInfo {
  return {
    instanceId: 'card_strike_0',
    cost: 1,
    currentEnergy: 3,
    needsTarget: true,
    isPlayable: true,
    ...overrides,
  };
}

/** Create an unplayable card info (insufficient energy). */
function unplayableEnergyCard(cost: number, currentEnergy: number): CardInputInfo {
  return {
    instanceId: 'card_expensive_0',
    cost,
    currentEnergy,
    needsTarget: true,
    isPlayable: false,
  };
}

/** Create an unplayable card info (generic unplayable). */
function unplayableCard(): CardInputInfo {
  return {
    instanceId: 'card_unplayable_0',
    cost: 1,
    currentEnergy: 3,
    needsTarget: true,
    isPlayable: false,
  };
}

/** Assert that state is in the expected phase with clean selections. */
function expectPhase(state: InputState, phase: InputPhase): void {
  expect(state.phase).toBe(phase);
}

// ===========================================================================
// 1. Initial state
// ===========================================================================

describe('CombatInputController -- initial state', () => {
  it('starts in idle phase', () => {
    const ctrl = createController();
    const state = ctrl.getState();
    expect(state.phase).toBe('idle');
  });

  it('has null selections initially', () => {
    const ctrl = createController();
    const state = ctrl.getState();
    expect(state.selectedCardIndex).toBeNull();
    expect(state.hoveredCardIndex).toBeNull();
    expect(state.targetedEnemyIndex).toBeNull();
    expect(state.errorMessage).toBeNull();
  });

  it('getPhase returns idle', () => {
    const ctrl = createController();
    expect(ctrl.getPhase()).toBe('idle');
  });
});

// ===========================================================================
// 2. hoverCard transitions
// ===========================================================================

describe('CombatInputController -- hoverCard', () => {
  it('hoverCard(n) transitions idle to card_hovered', () => {
    const ctrl = createController();
    const state = ctrl.hoverCard(2);
    expect(state.phase).toBe('card_hovered');
    expect(state.hoveredCardIndex).toBe(2);
  });

  it('hoverCard(null) returns card_hovered to idle', () => {
    const ctrl = createController();
    ctrl.hoverCard(2);
    const state = ctrl.hoverCard(null);
    expect(state.phase).toBe('idle');
    expect(state.hoveredCardIndex).toBeNull();
  });

  it('hoverCard switches between cards in card_hovered', () => {
    const ctrl = createController();
    ctrl.hoverCard(1);
    const state = ctrl.hoverCard(3);
    expect(state.phase).toBe('card_hovered');
    expect(state.hoveredCardIndex).toBe(3);
  });

  it('hoverCard is ignored during resolving', () => {
    const ctrl = createController();
    ctrl.selectCard(0, playableCard({ needsTarget: false }));
    const stateBefore = ctrl.getState();
    const stateAfter = ctrl.hoverCard(2);
    expect(stateAfter.phase).toBe('resolving');
    expect(stateAfter.hoveredCardIndex).toBe(stateBefore.hoveredCardIndex);
  });

  it('hoverCard is ignored during enemy_turn', () => {
    const ctrl = createController();
    ctrl.startEnemyTurn();
    const state = ctrl.hoverCard(1);
    expect(state.phase).toBe('enemy_turn');
  });
});

// ===========================================================================
// 3. selectCard with playable card
// ===========================================================================

describe('CombatInputController -- selectCard (playable)', () => {
  it('selectCard with playable targeting card transitions to card_selected', () => {
    const ctrl = createController();
    const state = ctrl.selectCard(0, playableCard({ needsTarget: true }));
    expect(state.phase).toBe('card_selected');
    expect(state.selectedCardIndex).toBe(0);
    expect(state.errorMessage).toBeNull();
  });

  it('selectCard from card_hovered with playable card transitions to card_selected', () => {
    const ctrl = createController();
    ctrl.hoverCard(0);
    const state = ctrl.selectCard(0, playableCard({ needsTarget: true }));
    expect(state.phase).toBe('card_selected');
    expect(state.selectedCardIndex).toBe(0);
  });

  it('selectCard with playable non-targeting card transitions to resolving', () => {
    const ctrl = createController();
    const state = ctrl.selectCard(1, playableCard({ needsTarget: false }));
    expect(state.phase).toBe('resolving');
    expect(state.selectedCardIndex).toBe(1);
    expect(state.targetedEnemyIndex).toBeNull();
  });
});

// ===========================================================================
// 4. selectCard with unplayable card
// ===========================================================================

describe('CombatInputController -- selectCard (unplayable)', () => {
  it('selectCard with unplayable card stays idle + error', () => {
    const ctrl = createController();
    const state = ctrl.selectCard(0, unplayableCard());
    expect(state.phase).toBe('idle');
    expect(state.selectedCardIndex).toBeNull();
    expect(state.errorMessage).toBe('Cannot play this card right now');
  });

  it('selectCard with insufficient energy shows energy error message', () => {
    const ctrl = createController();
    const state = ctrl.selectCard(0, unplayableEnergyCard(3, 1));
    expect(state.phase).toBe('idle');
    expect(state.errorMessage).toBe('Not enough energy (need 3, have 1)');
  });

  it('selectCard with sufficient energy but unplayable shows generic error', () => {
    const ctrl = createController();
    const card: CardInputInfo = {
      instanceId: 'card_status_0',
      cost: 0,
      currentEnergy: 3,
      needsTarget: false,
      isPlayable: false,
    };
    const state = ctrl.selectCard(0, card);
    expect(state.phase).toBe('idle');
    expect(state.errorMessage).toBe('Cannot play this card right now');
  });
});

// ===========================================================================
// 5. Phase-gated selectCard
// ===========================================================================

describe('CombatInputController -- selectCard phase gating', () => {
  it('selectCard during enemy_turn is ignored', () => {
    const ctrl = createController();
    ctrl.startEnemyTurn();
    const state = ctrl.selectCard(0, playableCard());
    expect(state.phase).toBe('enemy_turn');
    expect(state.selectedCardIndex).toBeNull();
  });

  it('selectCard during combat_over is ignored', () => {
    const ctrl = createController();
    ctrl.combatOver();
    const state = ctrl.selectCard(0, playableCard());
    expect(state.phase).toBe('combat_over');
    expect(state.selectedCardIndex).toBeNull();
  });

  it('selectCard during resolving is ignored', () => {
    const ctrl = createController();
    ctrl.selectCard(0, playableCard({ needsTarget: false }));
    const state = ctrl.selectCard(1, playableCard());
    expect(state.phase).toBe('resolving');
    expect(state.selectedCardIndex).toBe(0);
  });
});

// ===========================================================================
// 6. clickEnemy targeting
// ===========================================================================

describe('CombatInputController -- clickEnemy', () => {
  it('clickEnemy in card_selected with valid target transitions to resolving', () => {
    const ctrl = createController();
    ctrl.selectCard(0, playableCard({ needsTarget: true }));
    const state = ctrl.clickEnemy(0, 2);
    expect(state.phase).toBe('resolving');
    expect(state.targetedEnemyIndex).toBe(0);
  });

  it('clickEnemy with invalid index (out of bounds) sets error', () => {
    const ctrl = createController();
    ctrl.selectCard(0, playableCard({ needsTarget: true }));
    const state = ctrl.clickEnemy(5, 2);
    expect(state.phase).toBe('card_selected');
    expect(state.errorMessage).toBe('Invalid target');
  });

  it('clickEnemy when no enemies alive sets error', () => {
    const ctrl = createController();
    ctrl.selectCard(0, playableCard({ needsTarget: true }));
    const state = ctrl.clickEnemy(0, 0);
    expect(state.phase).toBe('card_selected');
    expect(state.errorMessage).toBe('Invalid target');
  });

  it('clickEnemy with negative index sets error', () => {
    const ctrl = createController();
    ctrl.selectCard(0, playableCard({ needsTarget: true }));
    const state = ctrl.clickEnemy(-1, 2);
    expect(state.phase).toBe('card_selected');
    expect(state.errorMessage).toBe('Invalid target');
  });

  it('clickEnemy in idle phase is silently ignored', () => {
    const ctrl = createController();
    const state = ctrl.clickEnemy(0, 2);
    expect(state.phase).toBe('idle');
    expect(state.errorMessage).toBeNull();
  });

  it('clickEnemy in resolving phase is silently ignored', () => {
    const ctrl = createController();
    ctrl.selectCard(0, playableCard({ needsTarget: false }));
    const state = ctrl.clickEnemy(0, 2);
    expect(state.phase).toBe('resolving');
    expect(state.targetedEnemyIndex).toBeNull();
  });

  it('clickEnemy selects correct enemy index', () => {
    const ctrl = createController();
    ctrl.selectCard(0, playableCard({ needsTarget: true }));
    const state = ctrl.clickEnemy(1, 3);
    expect(state.targetedEnemyIndex).toBe(1);
  });
});

// ===========================================================================
// 7. cancelSelection
// ===========================================================================

describe('CombatInputController -- cancelSelection', () => {
  it('cancelSelection from card_selected returns to idle', () => {
    const ctrl = createController();
    ctrl.selectCard(0, playableCard({ needsTarget: true }));
    const state = ctrl.cancelSelection();
    expect(state.phase).toBe('idle');
    expect(state.selectedCardIndex).toBeNull();
    expect(state.targetedEnemyIndex).toBeNull();
    expect(state.errorMessage).toBeNull();
  });

  it('cancelSelection from idle produces no change', () => {
    const ctrl = createController();
    const stateBefore = ctrl.getState();
    const state = ctrl.cancelSelection();
    expect(state.phase).toBe('idle');
    expect(state).toEqual(stateBefore);
  });

  it('cancelSelection from resolving is ignored', () => {
    const ctrl = createController();
    ctrl.selectCard(0, playableCard({ needsTarget: false }));
    const state = ctrl.cancelSelection();
    expect(state.phase).toBe('resolving');
  });

  it('cancelSelection clears error message from card_selected', () => {
    const ctrl = createController();
    ctrl.selectCard(0, playableCard({ needsTarget: true }));
    ctrl.clickEnemy(99, 2); // invalid target -> sets error
    expect(ctrl.getState().errorMessage).toBe('Invalid target');
    const state = ctrl.cancelSelection();
    expect(state.errorMessage).toBeNull();
    expect(state.phase).toBe('idle');
  });
});

// ===========================================================================
// 8. startResolving / endResolving
// ===========================================================================

describe('CombatInputController -- resolving cycle', () => {
  it('startResolving / endResolving cycle returns to idle', () => {
    const ctrl = createController();
    ctrl.selectCard(0, playableCard({ needsTarget: true }));
    ctrl.startResolving();
    expect(ctrl.getState().phase).toBe('resolving');
    const state = ctrl.endResolving();
    expect(state.phase).toBe('idle');
    expect(state.selectedCardIndex).toBeNull();
  });

  it('endResolving in idle is ignored', () => {
    const ctrl = createController();
    const state = ctrl.endResolving();
    expect(state.phase).toBe('idle');
  });

  it('endResolving clears all selections', () => {
    const ctrl = createController();
    ctrl.selectCard(2, playableCard({ needsTarget: false }));
    const state = ctrl.endResolving();
    expect(state.selectedCardIndex).toBeNull();
    expect(state.hoveredCardIndex).toBeNull();
    expect(state.targetedEnemyIndex).toBeNull();
  });
});

// ===========================================================================
// 9. Enemy / player turn transitions
// ===========================================================================

describe('CombatInputController -- turn transitions', () => {
  it('startEnemyTurn transitions to enemy_turn', () => {
    const ctrl = createController();
    const state = ctrl.startEnemyTurn();
    expect(state.phase).toBe('enemy_turn');
  });

  it('startEnemyTurn clears selections', () => {
    const ctrl = createController();
    ctrl.hoverCard(2);
    const state = ctrl.startEnemyTurn();
    expect(state.hoveredCardIndex).toBeNull();
    expect(state.selectedCardIndex).toBeNull();
  });

  it('startPlayerTurn transitions enemy_turn to idle', () => {
    const ctrl = createController();
    ctrl.startEnemyTurn();
    const state = ctrl.startPlayerTurn();
    expect(state.phase).toBe('idle');
  });

  it('startPlayerTurn in idle is ignored', () => {
    const ctrl = createController();
    const state = ctrl.startPlayerTurn();
    expect(state.phase).toBe('idle');
  });

  it('startPlayerTurn clears selections', () => {
    const ctrl = createController();
    ctrl.startEnemyTurn();
    const state = ctrl.startPlayerTurn();
    expect(state.selectedCardIndex).toBeNull();
    expect(state.hoveredCardIndex).toBeNull();
    expect(state.targetedEnemyIndex).toBeNull();
  });
});

// ===========================================================================
// 10. combatOver terminal state
// ===========================================================================

describe('CombatInputController -- combatOver', () => {
  it('combatOver transitions to combat_over from idle', () => {
    const ctrl = createController();
    const state = ctrl.combatOver();
    expect(state.phase).toBe('combat_over');
  });

  it('combatOver transitions from any state', () => {
    const phases: InputPhase[] = ['idle', 'card_hovered', 'card_selected', 'resolving', 'enemy_turn'];

    for (const startPhase of phases) {
      const ctrl = createController();
      // Drive to the desired start phase
      switch (startPhase) {
        case 'card_hovered':
          ctrl.hoverCard(0);
          break;
        case 'card_selected':
          ctrl.selectCard(0, playableCard({ needsTarget: true }));
          break;
        case 'resolving':
          ctrl.selectCard(0, playableCard({ needsTarget: false }));
          break;
        case 'enemy_turn':
          ctrl.startEnemyTurn();
          break;
      }
      const state = ctrl.combatOver();
      expect(state.phase).toBe('combat_over');
    }
  });

  it('combat_over is terminal -- no transitions out', () => {
    const ctrl = createController();
    ctrl.combatOver();

    // Try all actions -- all should stay combat_over
    expect(ctrl.hoverCard(0).phase).toBe('combat_over');
    expect(ctrl.selectCard(0, playableCard()).phase).toBe('combat_over');
    expect(ctrl.clickEnemy(0, 2).phase).toBe('combat_over');
    expect(ctrl.cancelSelection().phase).toBe('combat_over');
    expect(ctrl.startResolving().phase).toBe('combat_over');
    expect(ctrl.endResolving().phase).toBe('combat_over');
    expect(ctrl.startEnemyTurn().phase).toBe('combat_over');
    expect(ctrl.startPlayerTurn().phase).toBe('combat_over');
    expect(ctrl.combatOver().phase).toBe('combat_over');
  });

  it('combat_over clears all selections', () => {
    const ctrl = createController();
    ctrl.selectCard(0, playableCard({ needsTarget: true }));
    const state = ctrl.combatOver();
    expect(state.selectedCardIndex).toBeNull();
    expect(state.hoveredCardIndex).toBeNull();
    expect(state.targetedEnemyIndex).toBeNull();
    expect(state.errorMessage).toBeNull();
  });
});

// ===========================================================================
// 11. reset
// ===========================================================================

describe('CombatInputController -- reset', () => {
  it('reset returns to idle from combat_over', () => {
    const ctrl = createController();
    ctrl.combatOver();
    const state = ctrl.reset();
    expect(state.phase).toBe('idle');
    expect(state.selectedCardIndex).toBeNull();
    expect(state.hoveredCardIndex).toBeNull();
    expect(state.targetedEnemyIndex).toBeNull();
    expect(state.errorMessage).toBeNull();
  });

  it('reset returns to idle from card_selected', () => {
    const ctrl = createController();
    ctrl.selectCard(0, playableCard({ needsTarget: true }));
    const state = ctrl.reset();
    expect(state.phase).toBe('idle');
  });

  it('reset allows fresh interactions', () => {
    const ctrl = createController();
    ctrl.combatOver();
    ctrl.reset();
    // Should be able to interact normally after reset
    const state = ctrl.hoverCard(2);
    expect(state.phase).toBe('card_hovered');
    expect(state.hoveredCardIndex).toBe(2);
  });
});

// ===========================================================================
// 12. Full card play flows
// ===========================================================================

describe('CombatInputController -- full card play flows', () => {
  it('full flow: idle -> select targeting card -> target enemy -> resolve -> idle', () => {
    const ctrl = createController();

    // 1. Start in idle
    expect(ctrl.getPhase()).toBe('idle');

    // 2. Select a targeting card
    const selectState = ctrl.selectCard(0, playableCard({ needsTarget: true }));
    expect(selectState.phase).toBe('card_selected');
    expect(selectState.selectedCardIndex).toBe(0);

    // 3. Click enemy to target
    const targetState = ctrl.clickEnemy(1, 3);
    expect(targetState.phase).toBe('resolving');
    expect(targetState.targetedEnemyIndex).toBe(1);

    // 4. Resolve completes
    const resolveState = ctrl.endResolving();
    expect(resolveState.phase).toBe('idle');
    expect(resolveState.selectedCardIndex).toBeNull();
    expect(resolveState.targetedEnemyIndex).toBeNull();
  });

  it('full flow: idle -> select self-target card -> resolve -> idle', () => {
    const ctrl = createController();

    // Select a non-targeting card (defend, etc.)
    const selectState = ctrl.selectCard(1, playableCard({ needsTarget: false }));
    expect(selectState.phase).toBe('resolving');
    expect(selectState.selectedCardIndex).toBe(1);
    expect(selectState.targetedEnemyIndex).toBeNull();

    // Resolve completes
    const resolveState = ctrl.endResolving();
    expect(resolveState.phase).toBe('idle');
    expect(resolveState.selectedCardIndex).toBeNull();
  });

  it('full flow with hover: hover -> select -> cancel -> select -> target -> resolve', () => {
    const ctrl = createController();

    // Hover first
    ctrl.hoverCard(0);
    expect(ctrl.getPhase()).toBe('card_hovered');

    // Select targeting card
    ctrl.selectCard(0, playableCard({ needsTarget: true }));
    expect(ctrl.getPhase()).toBe('card_selected');

    // Cancel
    ctrl.cancelSelection();
    expect(ctrl.getPhase()).toBe('idle');

    // Select again
    ctrl.selectCard(2, playableCard({ needsTarget: true }));
    expect(ctrl.getPhase()).toBe('card_selected');
    expect(ctrl.getState().selectedCardIndex).toBe(2);

    // Target
    ctrl.clickEnemy(0, 1);
    expect(ctrl.getPhase()).toBe('resolving');

    // Resolve
    ctrl.endResolving();
    expect(ctrl.getPhase()).toBe('idle');
  });
});

// ===========================================================================
// 13. Query methods
// ===========================================================================

describe('CombatInputController -- query methods', () => {
  it('canSelectCard is true only in idle and card_hovered', () => {
    const ctrl = createController();
    expect(ctrl.canSelectCard()).toBe(true); // idle

    ctrl.hoverCard(0);
    expect(ctrl.canSelectCard()).toBe(true); // card_hovered

    ctrl.selectCard(0, playableCard({ needsTarget: true }));
    expect(ctrl.canSelectCard()).toBe(false); // card_selected

    ctrl.cancelSelection();
    ctrl.selectCard(0, playableCard({ needsTarget: false }));
    expect(ctrl.canSelectCard()).toBe(false); // resolving

    ctrl.endResolving();
    ctrl.startEnemyTurn();
    expect(ctrl.canSelectCard()).toBe(false); // enemy_turn

    ctrl.startPlayerTurn();
    ctrl.combatOver();
    expect(ctrl.canSelectCard()).toBe(false); // combat_over
  });

  it('canClickEnemy is true only in card_selected', () => {
    const ctrl = createController();
    expect(ctrl.canClickEnemy()).toBe(false); // idle

    ctrl.hoverCard(0);
    expect(ctrl.canClickEnemy()).toBe(false); // card_hovered

    ctrl.selectCard(0, playableCard({ needsTarget: true }));
    expect(ctrl.canClickEnemy()).toBe(true); // card_selected

    ctrl.cancelSelection();
    ctrl.selectCard(0, playableCard({ needsTarget: false }));
    expect(ctrl.canClickEnemy()).toBe(false); // resolving

    ctrl.endResolving();
    ctrl.startEnemyTurn();
    expect(ctrl.canClickEnemy()).toBe(false); // enemy_turn

    ctrl.startPlayerTurn();
    ctrl.combatOver();
    expect(ctrl.canClickEnemy()).toBe(false); // combat_over
  });

  it('canEndTurn is true only in idle and card_hovered', () => {
    const ctrl = createController();
    expect(ctrl.canEndTurn()).toBe(true); // idle

    ctrl.hoverCard(0);
    expect(ctrl.canEndTurn()).toBe(true); // card_hovered

    ctrl.selectCard(0, playableCard({ needsTarget: true }));
    expect(ctrl.canEndTurn()).toBe(false); // card_selected

    ctrl.cancelSelection();
    ctrl.selectCard(0, playableCard({ needsTarget: false }));
    expect(ctrl.canEndTurn()).toBe(false); // resolving

    ctrl.endResolving();
    ctrl.startEnemyTurn();
    expect(ctrl.canEndTurn()).toBe(false); // enemy_turn

    ctrl.startPlayerTurn();
    ctrl.combatOver();
    expect(ctrl.canEndTurn()).toBe(false); // combat_over
  });
});
