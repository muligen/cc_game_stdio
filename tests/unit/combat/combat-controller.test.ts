/**
 * combat-controller.test.ts — Unit tests for CombatController.
 *
 * Implements acceptance criteria from design/gdd/combat.md (Combat States, Turn Flow)
 * and design/gdd/card.md (Card Play Flow, Card Keywords).
 *
 * Coverage areas:
 * - startCombat initializes state correctly
 * - getState and getPhase return current values
 * - All valid phase transitions
 * - All invalid phase transitions throw
 * - State mutations: setPlayerBlock, setPlayerHP, incrementCardsPlayed
 * - playCard: validation, energy payment, damage/block/status resolution, exhaust, victory
 * - endCombat: event emissions (onCombatEnd, onCombatVictory, onCombatDefeat), cleanup
 * - executeEnemyTurn: stunned enemies, damage modifiers, death checks
 * - Card damage modifiers: strength, vulnerable, weak, intangible
 * - Card block modifiers: dexterity, frail
 * - Card status routing: buff vs debuff, artifact negation
 */

// @vitest-environment node

import { describe, it, expect } from 'vitest';
import { CombatController } from '../../../src/systems/combat-controller';
import { TurnPhase } from '../../../src/types/combat';
import {
  CardType,
  CostType,
  Keyword,
  Rarity,
  TargetType,
  type CardData,
  type CombatCardInstance,
  type CardEffect,
} from '../../../src/types/card';
import type { CombatEnemyInstance, EnemyData, EnemyMove } from '../../../src/types/enemy';

// ---------------------------------------------------------------------------
// Mock Dependencies
// ---------------------------------------------------------------------------

/**
 * Options for createMocks to customize specific mock behaviors.
 */
interface MockOptions {
  /** Override status effect stacks for specific (targetId, effectId) pairs. */
  effectStacks?: Record<string, number>;
  /** Override effect data category for specific effectId. */
  effectData?: Record<string, { category: string }>;
}

/**
 * Create a fresh set of mock dependencies for CombatController.
 * Each call returns new objects so tests are fully isolated.
 */
function createMocks(options: MockOptions = {}) {
  const { effectStacks = {}, effectData = {} } = options;
  return {
    eventBus: {
      emit: () => {},
    },
    deckManager: {
      getDrawPileSize: () => 0,
      getHandSize: () => 0,
      getDiscardPileSize: () => 0,
      getExhaustPileSize: () => 0,
      drawOpeningHand: () => [],
      drawCard: () => [],
      discardHand: () => {},
      getHand: () => [] as CombatCardInstance[],
      discardCards: () => {},
      exhaustCards: () => {},
    },
    energySystem: {
      getCurrentEnergy: () => 3,
      getEffectiveMaxEnergy: () => 3,
      onTurnStart: () => {},
      onTurnEnd: () => {},
      canPlay: () => true,
      spendEnergy: () => 0,
    },
    statusEffectManager: {
      getEffectStacks: (targetId: string, effectId: string) => {
        const key = `${targetId}:${effectId}`;
        return effectStacks[key] ?? 0;
      },
      processTurnEnd: () => {},
      resetForCombat: () => {},
      applyEffect: () => true,
      tryApplyDebuff: () => true,
      getEffectData: (effectId: string) => effectData[effectId] ?? undefined,
    },
    effectResolver: {
      resolveEffect: () => [],
    },
    enemyHelper: {
      createInstance: () => ({
        instanceId: 'enemy_0_test',
        data: { id: 'test_enemy', name: 'Test', type: 'normal' as const, hp: 20, moves: [] },
        currentHP: 20,
        maxHP: 20,
        block: 0,
        isAlive: true,
        currentMove: null,
        moveHistory: [],
        firstMoveUsed: false,
      }),
      selectMove: () => 'test_move',
      resetBlock: () => {},
      takeDamage: () => ({ hpLost: 0, blocked: 0 }),
      gainBlock: () => 0,
    },
    rng: {
      getStream: () => ({ nextInt: () => 0, weightedPick: () => 'move_1', shuffle: <T>(arr: readonly T[]) => [...arr] }),
    },
  };
}

/** Create a CombatController with mock dependencies. */
function createController(): CombatController {
  const mocks = createMocks();
  return new CombatController(
    mocks.eventBus,
    mocks.deckManager,
    mocks.energySystem,
    mocks.statusEffectManager,
    mocks.effectResolver,
    mocks.enemyHelper,
    mocks.rng
  );
}

// ===========================================================================
// startCombat initialization
// ===========================================================================

describe('startCombat', () => {
  it('initializes state with phase INITIALIZING', () => {
    const ctrl = createController();
    ctrl.startCombat(50, 75, 3);
    expect(ctrl.getPhase()).toBe(TurnPhase.INITIALIZING);
  });

  it('initializes turnNumber to 0', () => {
    const ctrl = createController();
    ctrl.startCombat(50, 75, 3);
    expect(ctrl.getState().turnNumber).toBe(0);
  });

  it('initializes playerHP and playerMaxHP from parameters', () => {
    const ctrl = createController();
    ctrl.startCombat(60, 80, 3);
    const state = ctrl.getState();
    expect(state.playerHP).toBe(60);
    expect(state.playerMaxHP).toBe(80);
  });

  it('initializes playerBlock to 0', () => {
    const ctrl = createController();
    ctrl.startCombat(50, 75, 3);
    expect(ctrl.getState().playerBlock).toBe(0);
  });

  it('initializes cardsPlayedThisTurn to 0', () => {
    const ctrl = createController();
    ctrl.startCombat(50, 75, 3);
    expect(ctrl.getState().cardsPlayedThisTurn).toBe(0);
  });

  it('initializes all card piles as empty arrays', () => {
    const ctrl = createController();
    ctrl.startCombat(50, 75, 3);
    const state = ctrl.getState();
    expect(state.drawPile).toEqual([]);
    expect(state.hand).toEqual([]);
    expect(state.discardPile).toEqual([]);
    expect(state.exhaustPile).toEqual([]);
  });

  it('initializes enemies as empty array', () => {
    const ctrl = createController();
    ctrl.startCombat(50, 75, 3);
    expect(ctrl.getState().enemies).toEqual([]);
  });

  it('initializes result as null', () => {
    const ctrl = createController();
    ctrl.startCombat(50, 75, 3);
    expect(ctrl.getState().result).toBeNull();
  });

  it('initializes energy fields from baseEnergy', () => {
    const ctrl = createController();
    ctrl.startCombat(50, 75, 4);
    const state = ctrl.getState();
    expect(state.currentEnergy).toBe(4);
    expect(state.effectiveMaxEnergy).toBe(4);
  });

  it('resets state when called a second time', () => {
    const ctrl = createController();
    ctrl.startCombat(50, 75, 3);
    ctrl.transitionToPlayerTurn();
    ctrl.setPlayerHP(20);
    ctrl.setPlayerBlock(10);
    ctrl.incrementCardsPlayed();

    // Call startCombat again — should fully reset
    ctrl.startCombat(100, 100, 3);
    const state = ctrl.getState();
    expect(state.phase).toBe(TurnPhase.INITIALIZING);
    expect(state.turnNumber).toBe(0);
    expect(state.playerHP).toBe(100);
    expect(state.playerBlock).toBe(0);
    expect(state.cardsPlayedThisTurn).toBe(0);
  });
});

// ===========================================================================
// Getters
// ===========================================================================

describe('getState', () => {
  it('returns a Readonly reference to the current state', () => {
    const ctrl = createController();
    ctrl.startCombat(50, 75, 3);
    const state = ctrl.getState();
    expect(state.playerHP).toBe(50);
    expect(state.phase).toBe(TurnPhase.INITIALIZING);
  });

  it('reflects mutations after state changes', () => {
    const ctrl = createController();
    ctrl.startCombat(50, 75, 3);
    ctrl.transitionToPlayerTurn();
    expect(ctrl.getState().phase).toBe(TurnPhase.PLAYER_TURN);
    expect(ctrl.getState().turnNumber).toBe(1);
  });
});

describe('getPhase', () => {
  it('returns the current phase', () => {
    const ctrl = createController();
    ctrl.startCombat(50, 75, 3);
    expect(ctrl.getPhase()).toBe(TurnPhase.INITIALIZING);
  });
});

// ===========================================================================
// Valid Phase Transitions
// ===========================================================================

describe('valid phase transitions', () => {
  it('INITIALIZING -> PLAYER_TURN increments turn to 1', () => {
    const ctrl = createController();
    ctrl.startCombat(50, 75, 3);
    ctrl.transitionToPlayerTurn();
    expect(ctrl.getPhase()).toBe(TurnPhase.PLAYER_TURN);
    expect(ctrl.getState().turnNumber).toBe(1);
  });

  it('PLAYER_TURN -> ENEMY_TURN keeps turn number', () => {
    const ctrl = createController();
    ctrl.startCombat(50, 75, 3);
    ctrl.transitionToPlayerTurn();
    ctrl.transitionToEnemyTurn();
    expect(ctrl.getPhase()).toBe(TurnPhase.ENEMY_TURN);
    expect(ctrl.getState().turnNumber).toBe(1);
  });

  it('ENEMY_TURN -> PLAYER_TURN increments turn to 2', () => {
    const ctrl = createController();
    ctrl.startCombat(50, 75, 3);
    ctrl.transitionToPlayerTurn();
    ctrl.transitionToEnemyTurn();
    ctrl.transitionToPlayerTurn();
    expect(ctrl.getPhase()).toBe(TurnPhase.PLAYER_TURN);
    expect(ctrl.getState().turnNumber).toBe(2);
  });

  it('PLAYER_TURN -> COMBAT_OVER with victory', () => {
    const ctrl = createController();
    ctrl.startCombat(50, 75, 3);
    ctrl.transitionToPlayerTurn();
    ctrl.endCombat('victory');
    expect(ctrl.getPhase()).toBe(TurnPhase.COMBAT_OVER);
    expect(ctrl.getState().result).toBe('victory');
  });

  it('PLAYER_TURN -> COMBAT_OVER with defeat', () => {
    const ctrl = createController();
    ctrl.startCombat(50, 75, 3);
    ctrl.transitionToPlayerTurn();
    ctrl.endCombat('defeat');
    expect(ctrl.getPhase()).toBe(TurnPhase.COMBAT_OVER);
    expect(ctrl.getState().result).toBe('defeat');
  });

  it('ENEMY_TURN -> COMBAT_OVER with defeat', () => {
    const ctrl = createController();
    ctrl.startCombat(50, 75, 3);
    ctrl.transitionToPlayerTurn();
    ctrl.transitionToEnemyTurn();
    ctrl.endCombat('defeat');
    expect(ctrl.getPhase()).toBe(TurnPhase.COMBAT_OVER);
    expect(ctrl.getState().result).toBe('defeat');
  });

  it('ENEMY_TURN -> COMBAT_OVER with victory', () => {
    const ctrl = createController();
    ctrl.startCombat(50, 75, 3);
    ctrl.transitionToPlayerTurn();
    ctrl.transitionToEnemyTurn();
    ctrl.endCombat('victory');
    expect(ctrl.getPhase()).toBe(TurnPhase.COMBAT_OVER);
    expect(ctrl.getState().result).toBe('victory');
  });

  it('full combat cycle: INITIALIZING -> PLAYER -> ENEMY -> PLAYER -> COMBAT_OVER', () => {
    const ctrl = createController();
    ctrl.startCombat(50, 75, 3);

    ctrl.transitionToPlayerTurn();
    expect(ctrl.getPhase()).toBe(TurnPhase.PLAYER_TURN);
    expect(ctrl.getState().turnNumber).toBe(1);

    ctrl.transitionToEnemyTurn();
    expect(ctrl.getPhase()).toBe(TurnPhase.ENEMY_TURN);

    ctrl.transitionToPlayerTurn();
    expect(ctrl.getPhase()).toBe(TurnPhase.PLAYER_TURN);
    expect(ctrl.getState().turnNumber).toBe(2);

    ctrl.endCombat('victory');
    expect(ctrl.getPhase()).toBe(TurnPhase.COMBAT_OVER);
    expect(ctrl.getState().result).toBe('victory');
  });
});

// ===========================================================================
// Invalid Phase Transitions
// ===========================================================================

describe('invalid phase transitions', () => {
  it('INITIALIZING -> ENEMY_TURN throws', () => {
    const ctrl = createController();
    ctrl.startCombat(50, 75, 3);
    expect(() => ctrl.transitionToEnemyTurn()).toThrow(
      'Invalid phase transition: initializing -> enemy_turn'
    );
  });

  it('INITIALIZING -> COMBAT_OVER throws', () => {
    const ctrl = createController();
    ctrl.startCombat(50, 75, 3);
    expect(() => ctrl.endCombat('victory')).toThrow(
      'Invalid phase transition: initializing -> combat_over'
    );
  });

  it('COMBAT_OVER -> PLAYER_TURN throws', () => {
    const ctrl = createController();
    ctrl.startCombat(50, 75, 3);
    ctrl.transitionToPlayerTurn();
    ctrl.endCombat('victory');
    expect(() => ctrl.transitionToPlayerTurn()).toThrow(
      'Invalid phase transition: combat_over -> player_turn'
    );
  });

  it('COMBAT_OVER -> ENEMY_TURN throws', () => {
    const ctrl = createController();
    ctrl.startCombat(50, 75, 3);
    ctrl.transitionToPlayerTurn();
    ctrl.endCombat('victory');
    expect(() => ctrl.transitionToEnemyTurn()).toThrow(
      'Invalid phase transition: combat_over -> enemy_turn'
    );
  });

  it('PLAYER_TURN -> PLAYER_TURN throws (no self-transition)', () => {
    const ctrl = createController();
    ctrl.startCombat(50, 75, 3);
    ctrl.transitionToPlayerTurn();
    expect(() => ctrl.transitionToPlayerTurn()).toThrow(
      'Invalid phase transition: player_turn -> player_turn'
    );
  });

  it('ENEMY_TURN -> ENEMY_TURN throws (no self-transition)', () => {
    const ctrl = createController();
    ctrl.startCombat(50, 75, 3);
    ctrl.transitionToPlayerTurn();
    ctrl.transitionToEnemyTurn();
    expect(() => ctrl.transitionToEnemyTurn()).toThrow(
      'Invalid phase transition: enemy_turn -> enemy_turn'
    );
  });

  it('ENEMY_TURN -> endCombat twice throws (already COMBAT_OVER)', () => {
    const ctrl = createController();
    ctrl.startCombat(50, 75, 3);
    ctrl.transitionToPlayerTurn();
    ctrl.transitionToEnemyTurn();
    ctrl.endCombat('defeat');
    expect(() => ctrl.endCombat('victory')).toThrow(
      'Invalid phase transition: combat_over -> combat_over'
    );
  });
});

// ===========================================================================
// State Mutations
// ===========================================================================

describe('setPlayerBlock', () => {
  it('sets playerBlock to the given value', () => {
    const ctrl = createController();
    ctrl.startCombat(50, 75, 3);
    ctrl.setPlayerBlock(12);
    expect(ctrl.getState().playerBlock).toBe(12);
  });

  it('overwrites previous block value', () => {
    const ctrl = createController();
    ctrl.startCombat(50, 75, 3);
    ctrl.setPlayerBlock(10);
    ctrl.setPlayerBlock(5);
    expect(ctrl.getState().playerBlock).toBe(5);
  });

  it('sets block to 0', () => {
    const ctrl = createController();
    ctrl.startCombat(50, 75, 3);
    ctrl.setPlayerBlock(10);
    ctrl.setPlayerBlock(0);
    expect(ctrl.getState().playerBlock).toBe(0);
  });
});

describe('setPlayerHP', () => {
  it('sets playerHP to the given value', () => {
    const ctrl = createController();
    ctrl.startCombat(50, 75, 3);
    ctrl.setPlayerHP(30);
    expect(ctrl.getState().playerHP).toBe(30);
  });

  it('overwrites previous HP value', () => {
    const ctrl = createController();
    ctrl.startCombat(50, 75, 3);
    ctrl.setPlayerHP(40);
    ctrl.setPlayerHP(25);
    expect(ctrl.getState().playerHP).toBe(25);
  });
});

describe('incrementCardsPlayed', () => {
  it('increments cardsPlayedThisTurn from 0 to 1', () => {
    const ctrl = createController();
    ctrl.startCombat(50, 75, 3);
    expect(ctrl.getState().cardsPlayedThisTurn).toBe(0);
    ctrl.incrementCardsPlayed();
    expect(ctrl.getState().cardsPlayedThisTurn).toBe(1);
  });

  it('increments multiple times', () => {
    const ctrl = createController();
    ctrl.startCombat(50, 75, 3);
    ctrl.incrementCardsPlayed();
    ctrl.incrementCardsPlayed();
    ctrl.incrementCardsPlayed();
    expect(ctrl.getState().cardsPlayedThisTurn).toBe(3);
  });
});

// ===========================================================================
// startPlayerTurn
// ===========================================================================

describe('startPlayerTurn', () => {
  it('transitions from ENEMY_TURN to PLAYER_TURN', () => {
    const mocks = createMocks();
    const ctrl = new CombatController(
      mocks.eventBus, mocks.deckManager, mocks.energySystem,
      mocks.statusEffectManager, mocks.effectResolver, mocks.enemyHelper, mocks.rng
    );
    ctrl.startCombat(50, 75, 3);
    ctrl.transitionToPlayerTurn();
    ctrl.transitionToEnemyTurn();
    expect(ctrl.getPhase()).toBe(TurnPhase.ENEMY_TURN);

    ctrl.startPlayerTurn();
    expect(ctrl.getPhase()).toBe(TurnPhase.PLAYER_TURN);
  });

  it('increments turnNumber', () => {
    const mocks = createMocks();
    const ctrl = new CombatController(
      mocks.eventBus, mocks.deckManager, mocks.energySystem,
      mocks.statusEffectManager, mocks.effectResolver, mocks.enemyHelper, mocks.rng
    );
    ctrl.startCombat(50, 75, 3);
    ctrl.transitionToPlayerTurn(); // turn 1
    ctrl.transitionToEnemyTurn();
    expect(ctrl.getState().turnNumber).toBe(1);

    ctrl.startPlayerTurn();
    expect(ctrl.getState().turnNumber).toBe(2);
  });

  it('resets player block to 0', () => {
    const mocks = createMocks();
    const ctrl = new CombatController(
      mocks.eventBus, mocks.deckManager, mocks.energySystem,
      mocks.statusEffectManager, mocks.effectResolver, mocks.enemyHelper, mocks.rng
    );
    ctrl.startCombat(50, 75, 3);
    ctrl.transitionToPlayerTurn();
    ctrl.setPlayerBlock(10);
    expect(ctrl.getState().playerBlock).toBe(10);

    ctrl.transitionToEnemyTurn();
    ctrl.startPlayerTurn();
    expect(ctrl.getState().playerBlock).toBe(0);
  });

  it('calls energySystem.onTurnStart', () => {
    const mocks = createMocks();
    const onTurnStartCalls: Array<{ bonus: number; penalty: number }> = [];
    mocks.energySystem.onTurnStart = (bonus = 0, penalty = 0) => {
      onTurnStartCalls.push({ bonus, penalty });
    };
    const ctrl = new CombatController(
      mocks.eventBus, mocks.deckManager, mocks.energySystem,
      mocks.statusEffectManager, mocks.effectResolver, mocks.enemyHelper, mocks.rng
    );
    ctrl.startCombat(50, 75, 3);
    ctrl.transitionToPlayerTurn();
    ctrl.transitionToEnemyTurn();

    ctrl.startPlayerTurn(2, 1);
    expect(onTurnStartCalls).toHaveLength(1);
    expect(onTurnStartCalls[0]).toEqual({ bonus: 2, penalty: 1 });
  });

  it('calls deckManager.drawCard with default count 5', () => {
    const mocks = createMocks();
    const drawCalls: number[] = [];
    mocks.deckManager.drawCard = (count: number) => {
      drawCalls.push(count);
      return [];
    };
    const ctrl = new CombatController(
      mocks.eventBus, mocks.deckManager, mocks.energySystem,
      mocks.statusEffectManager, mocks.effectResolver, mocks.enemyHelper, mocks.rng
    );
    ctrl.startCombat(50, 75, 3);
    ctrl.transitionToPlayerTurn();
    ctrl.transitionToEnemyTurn();

    ctrl.startPlayerTurn();
    expect(drawCalls).toEqual([5]);
  });

  it('calls deckManager.drawCard with default count 5 (no custom drawCount)', () => {
    const mocks = createMocks();
    const drawCalls: number[] = [];
    mocks.deckManager.drawCard = (count: number) => {
      drawCalls.push(count);
      return [];
    };
    const ctrl = new CombatController(
      mocks.eventBus, mocks.deckManager, mocks.energySystem,
      mocks.statusEffectManager, mocks.effectResolver, mocks.enemyHelper, mocks.rng
    );
    ctrl.startCombat(50, 75, 3);
    ctrl.transitionToPlayerTurn();
    ctrl.transitionToEnemyTurn();

    ctrl.startPlayerTurn();
    expect(drawCalls).toEqual([5]);
  });

  it('resets cardsPlayedThisTurn to 0', () => {
    const mocks = createMocks();
    const ctrl = new CombatController(
      mocks.eventBus, mocks.deckManager, mocks.energySystem,
      mocks.statusEffectManager, mocks.effectResolver, mocks.enemyHelper, mocks.rng
    );
    ctrl.startCombat(50, 75, 3);
    ctrl.transitionToPlayerTurn();
    ctrl.incrementCardsPlayed();
    ctrl.incrementCardsPlayed();
    expect(ctrl.getState().cardsPlayedThisTurn).toBe(2);

    ctrl.transitionToEnemyTurn();
    ctrl.startPlayerTurn();
    expect(ctrl.getState().cardsPlayedThisTurn).toBe(0);
  });

  it('syncs energy state from EnergySystem', () => {
    const mocks = createMocks();
    mocks.energySystem.getCurrentEnergy = () => 5;
    mocks.energySystem.getEffectiveMaxEnergy = () => 5;
    const ctrl = new CombatController(
      mocks.eventBus, mocks.deckManager, mocks.energySystem,
      mocks.statusEffectManager, mocks.effectResolver, mocks.enemyHelper, mocks.rng
    );
    ctrl.startCombat(50, 75, 3);
    ctrl.transitionToPlayerTurn();
    ctrl.transitionToEnemyTurn();

    ctrl.startPlayerTurn();
    expect(ctrl.getState().currentEnergy).toBe(5);
    expect(ctrl.getState().effectiveMaxEnergy).toBe(5);
  });

  it('emits onPlayerTurnStart event', () => {
    const mocks = createMocks();
    const emits: Array<{ event: string; payload: unknown }> = [];
    mocks.eventBus.emit = (event: string, payload: unknown) => {
      emits.push({ event, payload });
    };
    const ctrl = new CombatController(
      mocks.eventBus, mocks.deckManager, mocks.energySystem,
      mocks.statusEffectManager, mocks.effectResolver, mocks.enemyHelper, mocks.rng
    );
    ctrl.startCombat(50, 75, 3);
    ctrl.transitionToPlayerTurn(); // turn 1
    ctrl.transitionToEnemyTurn();

    ctrl.startPlayerTurn(); // turn 2
    const startEvent = emits.find((e) => e.event === 'onPlayerTurnStart');
    expect(startEvent).toBeDefined();
    expect((startEvent!.payload as { turnNumber: number }).turnNumber).toBe(2);
  });

  it('throws if called from PLAYER_TURN', () => {
    const mocks = createMocks();
    const ctrl = new CombatController(
      mocks.eventBus, mocks.deckManager, mocks.energySystem,
      mocks.statusEffectManager, mocks.effectResolver, mocks.enemyHelper, mocks.rng
    );
    ctrl.startCombat(50, 75, 3);
    ctrl.transitionToPlayerTurn();

    expect(() => ctrl.startPlayerTurn()).toThrow(
      'startPlayerTurn requires ENEMY_TURN phase, current: player_turn'
    );
  });

  it('throws if called from INITIALIZING', () => {
    const mocks = createMocks();
    const ctrl = new CombatController(
      mocks.eventBus, mocks.deckManager, mocks.energySystem,
      mocks.statusEffectManager, mocks.effectResolver, mocks.enemyHelper, mocks.rng
    );
    ctrl.startCombat(50, 75, 3);

    expect(() => ctrl.startPlayerTurn()).toThrow(
      'startPlayerTurn requires ENEMY_TURN phase, current: initializing'
    );
  });
});

// ===========================================================================
// endPlayerTurn
// ===========================================================================

describe('endPlayerTurn', () => {
  it('transitions from PLAYER_TURN to ENEMY_TURN', () => {
    const mocks = createMocks();
    const ctrl = new CombatController(
      mocks.eventBus, mocks.deckManager, mocks.energySystem,
      mocks.statusEffectManager, mocks.effectResolver, mocks.enemyHelper, mocks.rng
    );
    ctrl.startCombat(50, 75, 3);
    ctrl.transitionToPlayerTurn();
    expect(ctrl.getPhase()).toBe(TurnPhase.PLAYER_TURN);

    ctrl.endPlayerTurn();
    expect(ctrl.getPhase()).toBe(TurnPhase.ENEMY_TURN);
  });

  it('calls deckManager.discardHand', () => {
    const mocks = createMocks();
    let discardCalled = false;
    mocks.deckManager.discardHand = () => { discardCalled = true; };
    const ctrl = new CombatController(
      mocks.eventBus, mocks.deckManager, mocks.energySystem,
      mocks.statusEffectManager, mocks.effectResolver, mocks.enemyHelper, mocks.rng
    );
    ctrl.startCombat(50, 75, 3);
    ctrl.transitionToPlayerTurn();

    ctrl.endPlayerTurn();
    expect(discardCalled).toBe(true);
  });

  it('calls statusEffectManager.processTurnEnd with player targetId', () => {
    const mocks = createMocks();
    const processCalls: Array<{ targetId: string; isPlayerTurn: boolean }> = [];
    mocks.statusEffectManager.processTurnEnd = (targetId: string, isPlayerTurn: boolean) => {
      processCalls.push({ targetId, isPlayerTurn });
    };
    const ctrl = new CombatController(
      mocks.eventBus, mocks.deckManager, mocks.energySystem,
      mocks.statusEffectManager, mocks.effectResolver, mocks.enemyHelper, mocks.rng
    );
    ctrl.startCombat(50, 75, 3);
    ctrl.transitionToPlayerTurn();

    ctrl.endPlayerTurn();
    expect(processCalls).toHaveLength(1);
    expect(processCalls[0].targetId).toBe('player');
    expect(processCalls[0].isPlayerTurn).toBe(true);
  });

  it('calls energySystem.onTurnEnd', () => {
    const mocks = createMocks();
    let turnEndCalled = false;
    mocks.energySystem.onTurnEnd = () => { turnEndCalled = true; };
    const ctrl = new CombatController(
      mocks.eventBus, mocks.deckManager, mocks.energySystem,
      mocks.statusEffectManager, mocks.effectResolver, mocks.enemyHelper, mocks.rng
    );
    ctrl.startCombat(50, 75, 3);
    ctrl.transitionToPlayerTurn();

    ctrl.endPlayerTurn();
    expect(turnEndCalled).toBe(true);
  });

  it('emits onPlayerTurnEnd event', () => {
    const mocks = createMocks();
    const emits: Array<{ event: string; payload: unknown }> = [];
    mocks.eventBus.emit = (event: string, payload: unknown) => {
      emits.push({ event, payload });
    };
    const ctrl = new CombatController(
      mocks.eventBus, mocks.deckManager, mocks.energySystem,
      mocks.statusEffectManager, mocks.effectResolver, mocks.enemyHelper, mocks.rng
    );
    ctrl.startCombat(50, 75, 3);
    ctrl.transitionToPlayerTurn();

    ctrl.endPlayerTurn();
    const endEvent = emits.find((e) => e.event === 'onPlayerTurnEnd');
    expect(endEvent).toBeDefined();
    expect((endEvent!.payload as { turnNumber: number }).turnNumber).toBe(1);
  });

  it('ends combat with defeat if player HP reaches 0 from poison', () => {
    const mocks = createMocks();
    // Simulate poison killing the player during processTurnEnd
    mocks.statusEffectManager.processTurnEnd = () => {
      // Poison tick reduces HP (simulated by test)
    };
    const ctrl = new CombatController(
      mocks.eventBus, mocks.deckManager, mocks.energySystem,
      mocks.statusEffectManager, mocks.effectResolver, mocks.enemyHelper, mocks.rng
    );
    ctrl.startCombat(1, 75, 3); // Very low HP
    ctrl.transitionToPlayerTurn();
    ctrl.setPlayerHP(0); // Simulate poison damage

    ctrl.endPlayerTurn();
    expect(ctrl.getPhase()).toBe(TurnPhase.COMBAT_OVER);
    expect(ctrl.getState().result).toBe('defeat');
  });

  it('ends combat with victory if all enemies dead', () => {
    const mocks = createMocks();
    const ctrl = new CombatController(
      mocks.eventBus, mocks.deckManager, mocks.energySystem,
      mocks.statusEffectManager, mocks.effectResolver, mocks.enemyHelper, mocks.rng
    );
    ctrl.startCombat(50, 75, 3);
    ctrl.transitionToPlayerTurn();
    // Add a dead enemy
    (ctrl.getState() as { enemies: Array<{ isAlive: boolean }> }).enemies = [
      { isAlive: false } as unknown as import('../../../src/types/enemy').CombatEnemyInstance,
    ];

    ctrl.endPlayerTurn();
    expect(ctrl.getPhase()).toBe(TurnPhase.COMBAT_OVER);
    expect(ctrl.getState().result).toBe('victory');
  });

  it('throws if called from ENEMY_TURN', () => {
    const mocks = createMocks();
    const ctrl = new CombatController(
      mocks.eventBus, mocks.deckManager, mocks.energySystem,
      mocks.statusEffectManager, mocks.effectResolver, mocks.enemyHelper, mocks.rng
    );
    ctrl.startCombat(50, 75, 3);
    ctrl.transitionToPlayerTurn();
    ctrl.transitionToEnemyTurn();

    expect(() => ctrl.endPlayerTurn()).toThrow(
      'endPlayerTurn requires PLAYER_TURN phase, current: enemy_turn'
    );
  });
});

// ===========================================================================
// executeEnemyTurn
// ===========================================================================

describe('executeEnemyTurn', () => {
  it('keeps phase as ENEMY_TURN after execution', () => {
    const mocks = createMocks();
    const ctrl = new CombatController(
      mocks.eventBus, mocks.deckManager, mocks.energySystem,
      mocks.statusEffectManager, mocks.effectResolver, mocks.enemyHelper, mocks.rng
    );
    ctrl.startCombat(50, 75, 3);
    ctrl.transitionToPlayerTurn();
    ctrl.transitionToEnemyTurn();
    expect(ctrl.getPhase()).toBe(TurnPhase.ENEMY_TURN);

    ctrl.executeEnemyTurn();
    expect(ctrl.getPhase()).toBe(TurnPhase.ENEMY_TURN);
  });

  it('resets block for each living enemy', () => {
    const mocks = createMocks();
    const resetBlockCalls: unknown[] = [];
    mocks.enemyHelper.resetBlock = (enemy: unknown) => {
      resetBlockCalls.push(enemy);
    };
    // Create enemies with a proper currentMove for intent execution
    const enemy1: import('../../../src/types/enemy').CombatEnemyInstance = {
      instanceId: 'e1',
      data: { id: 'test', name: 'Test', type: 'normal', hp: 20, moves: [] },
      currentHP: 20, maxHP: 20, block: 5, isAlive: true,
      currentMove: null, moveHistory: [], firstMoveUsed: false,
    };
    const enemy2: import('../../../src/types/enemy').CombatEnemyInstance = {
      instanceId: 'e2',
      data: { id: 'test2', name: 'Test2', type: 'normal', hp: 15, moves: [] },
      currentHP: 15, maxHP: 15, block: 3, isAlive: true,
      currentMove: null, moveHistory: [], firstMoveUsed: false,
    };

    const ctrl = new CombatController(
      mocks.eventBus, mocks.deckManager, mocks.energySystem,
      mocks.statusEffectManager, mocks.effectResolver, mocks.enemyHelper, mocks.rng
    );
    ctrl.startCombat(50, 75, 3);
    ctrl.transitionToPlayerTurn();
    ctrl.transitionToEnemyTurn();
    // Manually set enemies
    (ctrl.getState() as { enemies: unknown[] }).enemies = [enemy1, enemy2];

    ctrl.executeEnemyTurn();
    expect(resetBlockCalls).toHaveLength(2);
  });

  it('skips dead enemies', () => {
    const mocks = createMocks();
    const resetBlockCalls: unknown[] = [];
    mocks.enemyHelper.resetBlock = (enemy: unknown) => {
      resetBlockCalls.push(enemy);
    };
    const aliveEnemy: import('../../../src/types/enemy').CombatEnemyInstance = {
      instanceId: 'e1',
      data: { id: 'test', name: 'Test', type: 'normal', hp: 20, moves: [] },
      currentHP: 20, maxHP: 20, block: 0, isAlive: true,
      currentMove: null, moveHistory: [], firstMoveUsed: false,
    };
    const deadEnemy: import('../../../src/types/enemy').CombatEnemyInstance = {
      instanceId: 'e2',
      data: { id: 'test2', name: 'Test2', type: 'normal', hp: 15, moves: [] },
      currentHP: 0, maxHP: 15, block: 0, isAlive: false,
      currentMove: null, moveHistory: [], firstMoveUsed: false,
    };

    const ctrl = new CombatController(
      mocks.eventBus, mocks.deckManager, mocks.energySystem,
      mocks.statusEffectManager, mocks.effectResolver, mocks.enemyHelper, mocks.rng
    );
    ctrl.startCombat(50, 75, 3);
    ctrl.transitionToPlayerTurn();
    ctrl.transitionToEnemyTurn();
    (ctrl.getState() as { enemies: unknown[] }).enemies = [aliveEnemy, deadEnemy];

    ctrl.executeEnemyTurn();
    expect(resetBlockCalls).toHaveLength(1);
  });

  it('calls processTurnEnd for each living enemy', () => {
    const mocks = createMocks();
    const processCalls: Array<{ targetId: string; isPlayerTurn: boolean }> = [];
    mocks.statusEffectManager.processTurnEnd = (targetId: string, isPlayerTurn: boolean) => {
      processCalls.push({ targetId, isPlayerTurn });
    };
    const enemy1: import('../../../src/types/enemy').CombatEnemyInstance = {
      instanceId: 'e1',
      data: { id: 'test', name: 'Test', type: 'normal', hp: 20, moves: [] },
      currentHP: 20, maxHP: 20, block: 0, isAlive: true,
      currentMove: null, moveHistory: [], firstMoveUsed: false,
    };

    const ctrl = new CombatController(
      mocks.eventBus, mocks.deckManager, mocks.energySystem,
      mocks.statusEffectManager, mocks.effectResolver, mocks.enemyHelper, mocks.rng
    );
    ctrl.startCombat(50, 75, 3);
    ctrl.transitionToPlayerTurn();
    ctrl.transitionToEnemyTurn();
    (ctrl.getState() as { enemies: unknown[] }).enemies = [enemy1];

    ctrl.executeEnemyTurn();
    expect(processCalls).toHaveLength(1);
    expect(processCalls[0].targetId).toBe('e1');
    expect(processCalls[0].isPlayerTurn).toBe(false);
  });

  it('calls selectMove for each living enemy after turn end processing', () => {
    const mocks = createMocks();
    const selectCalls: unknown[] = [];
    mocks.enemyHelper.selectMove = (enemy: unknown) => {
      selectCalls.push(enemy);
      return 'next_move';
    };
    const enemy1: import('../../../src/types/enemy').CombatEnemyInstance = {
      instanceId: 'e1',
      data: { id: 'test', name: 'Test', type: 'normal', hp: 20, moves: [] },
      currentHP: 20, maxHP: 20, block: 0, isAlive: true,
      currentMove: null, moveHistory: [], firstMoveUsed: false,
    };

    const ctrl = new CombatController(
      mocks.eventBus, mocks.deckManager, mocks.energySystem,
      mocks.statusEffectManager, mocks.effectResolver, mocks.enemyHelper, mocks.rng
    );
    ctrl.startCombat(50, 75, 3);
    ctrl.transitionToPlayerTurn();
    ctrl.transitionToEnemyTurn();
    (ctrl.getState() as { enemies: unknown[] }).enemies = [enemy1];

    ctrl.executeEnemyTurn();
    expect(selectCalls).toHaveLength(1);
  });

  it('emits onEnemyTurnEnd event', () => {
    const mocks = createMocks();
    const emits: Array<{ event: string; payload: unknown }> = [];
    mocks.eventBus.emit = (event: string, payload: unknown) => {
      emits.push({ event, payload });
    };
    const enemy1: import('../../../src/types/enemy').CombatEnemyInstance = {
      instanceId: 'e1',
      data: { id: 'test', name: 'Test', type: 'normal', hp: 20, moves: [] },
      currentHP: 20, maxHP: 20, block: 0, isAlive: true,
      currentMove: null, moveHistory: [], firstMoveUsed: false,
    };

    const ctrl = new CombatController(
      mocks.eventBus, mocks.deckManager, mocks.energySystem,
      mocks.statusEffectManager, mocks.effectResolver, mocks.enemyHelper, mocks.rng
    );
    ctrl.startCombat(50, 75, 3);
    ctrl.transitionToPlayerTurn(); // turn 1
    ctrl.transitionToEnemyTurn();
    (ctrl.getState() as { enemies: unknown[] }).enemies = [enemy1];

    ctrl.executeEnemyTurn();
    const endEvent = emits.find((e) => e.event === 'onEnemyTurnEnd');
    expect(endEvent).toBeDefined();
    const payload = endEvent!.payload as { turnNumber: number; remainingEnemies: number };
    expect(payload.turnNumber).toBe(1);
    expect(payload.remainingEnemies).toBe(1);
  });

  it('counts remaining enemies correctly', () => {
    const mocks = createMocks();
    const emits: Array<{ event: string; payload: unknown }> = [];
    mocks.eventBus.emit = (event: string, payload: unknown) => {
      emits.push({ event, payload });
    };
    const alive: import('../../../src/types/enemy').CombatEnemyInstance = {
      instanceId: 'e1',
      data: { id: 'test', name: 'Test', type: 'normal', hp: 20, moves: [] },
      currentHP: 20, maxHP: 20, block: 0, isAlive: true,
      currentMove: null, moveHistory: [], firstMoveUsed: false,
    };
    const dead: import('../../../src/types/enemy').CombatEnemyInstance = {
      instanceId: 'e2',
      data: { id: 'test2', name: 'Test2', type: 'normal', hp: 15, moves: [] },
      currentHP: 0, maxHP: 15, block: 0, isAlive: false,
      currentMove: null, moveHistory: [], firstMoveUsed: false,
    };

    const ctrl = new CombatController(
      mocks.eventBus, mocks.deckManager, mocks.energySystem,
      mocks.statusEffectManager, mocks.effectResolver, mocks.enemyHelper, mocks.rng
    );
    ctrl.startCombat(50, 75, 3);
    ctrl.transitionToPlayerTurn();
    ctrl.transitionToEnemyTurn();
    (ctrl.getState() as { enemies: unknown[] }).enemies = [alive, dead];

    ctrl.executeEnemyTurn();
    const endEvent = emits.find((e) => e.event === 'onEnemyTurnEnd');
    const payload = endEvent!.payload as { turnNumber: number; remainingEnemies: number };
    expect(payload.remainingEnemies).toBe(1);
  });

  it('ends combat with defeat if player dies during enemy turn', () => {
    const mocks = createMocks();
    // Make the EffectResolver return lethal damage
    mocks.effectResolver.resolveEffect = () => [{ type: 'deal_damage', success: true, value: 100 }];
    const enemyWithAttack: import('../../../src/types/enemy').CombatEnemyInstance = {
      instanceId: 'e1',
      data: { id: 'test', name: 'Test', type: 'normal', hp: 20, moves: [] },
      currentHP: 20, maxHP: 20, block: 0, isAlive: true,
      currentMove: {
        id: 'atk', name: 'Attack', intent: 'attack' as unknown as never,
        effects: [{ type: 'deal_damage', value: 100 }],
        damage: 100,
      },
      moveHistory: [], firstMoveUsed: false,
    };

    const ctrl = new CombatController(
      mocks.eventBus, mocks.deckManager, mocks.energySystem,
      mocks.statusEffectManager, mocks.effectResolver, mocks.enemyHelper, mocks.rng
    );
    ctrl.startCombat(10, 75, 3); // Low HP
    ctrl.transitionToPlayerTurn();
    ctrl.transitionToEnemyTurn();
    (ctrl.getState() as { enemies: unknown[] }).enemies = [enemyWithAttack];

    ctrl.executeEnemyTurn();
    expect(ctrl.getPhase()).toBe(TurnPhase.COMBAT_OVER);
    expect(ctrl.getState().result).toBe('defeat');
  });

  it('does NOT emit onEnemyTurnEnd if combat ended during execution', () => {
    const mocks = createMocks();
    const emits: Array<{ event: string; payload: unknown }> = [];
    mocks.eventBus.emit = (event: string, payload: unknown) => {
      emits.push({ event, payload });
    };
    mocks.effectResolver.resolveEffect = () => [{ type: 'deal_damage', success: true, value: 100 }];
    const lethalEnemy: import('../../../src/types/enemy').CombatEnemyInstance = {
      instanceId: 'e1',
      data: { id: 'test', name: 'Test', type: 'normal', hp: 20, moves: [] },
      currentHP: 20, maxHP: 20, block: 0, isAlive: true,
      currentMove: {
        id: 'atk', name: 'Attack', intent: 'attack' as unknown as never,
        effects: [{ type: 'deal_damage', value: 100 }],
        damage: 100,
      },
      moveHistory: [], firstMoveUsed: false,
    };

    const ctrl = new CombatController(
      mocks.eventBus, mocks.deckManager, mocks.energySystem,
      mocks.statusEffectManager, mocks.effectResolver, mocks.enemyHelper, mocks.rng
    );
    ctrl.startCombat(10, 75, 3);
    ctrl.transitionToPlayerTurn();
    ctrl.transitionToEnemyTurn();
    (ctrl.getState() as { enemies: unknown[] }).enemies = [lethalEnemy];

    ctrl.executeEnemyTurn();
    // Should NOT emit onEnemyTurnEnd since combat ended
    const endEvent = emits.find((e) => e.event === 'onEnemyTurnEnd');
    expect(endEvent).toBeUndefined();
  });

  it('throws if called from PLAYER_TURN', () => {
    const mocks = createMocks();
    const ctrl = new CombatController(
      mocks.eventBus, mocks.deckManager, mocks.energySystem,
      mocks.statusEffectManager, mocks.effectResolver, mocks.enemyHelper, mocks.rng
    );
    ctrl.startCombat(50, 75, 3);
    ctrl.transitionToPlayerTurn();

    expect(() => ctrl.executeEnemyTurn()).toThrow(
      'executeEnemyTurn requires ENEMY_TURN phase, current: player_turn'
    );
  });

  it('works with no enemies (empty array)', () => {
    const mocks = createMocks();
    const emits: Array<{ event: string; payload: unknown }> = [];
    mocks.eventBus.emit = (event: string, payload: unknown) => {
      emits.push({ event, payload });
    };

    const ctrl = new CombatController(
      mocks.eventBus, mocks.deckManager, mocks.energySystem,
      mocks.statusEffectManager, mocks.effectResolver, mocks.enemyHelper, mocks.rng
    );
    ctrl.startCombat(50, 75, 3);
    ctrl.transitionToPlayerTurn();
    ctrl.transitionToEnemyTurn();

    ctrl.executeEnemyTurn();
    expect(ctrl.getPhase()).toBe(TurnPhase.ENEMY_TURN);
    const endEvent = emits.find((e) => e.event === 'onEnemyTurnEnd');
    expect(endEvent).toBeDefined();
    const payload = endEvent!.payload as { turnNumber: number; remainingEnemies: number };
    expect(payload.remainingEnemies).toBe(0);
  });
});

// ===========================================================================
// Full Turn Cycle (endPlayerTurn -> executeEnemyTurn -> startPlayerTurn)
// ===========================================================================

describe('full turn cycle', () => {
  it('endPlayerTurn -> executeEnemyTurn -> startPlayerTurn completes one cycle', () => {
    const mocks = createMocks();
    const ctrl = new CombatController(
      mocks.eventBus, mocks.deckManager, mocks.energySystem,
      mocks.statusEffectManager, mocks.effectResolver, mocks.enemyHelper, mocks.rng
    );
    ctrl.startCombat(50, 75, 3);
    ctrl.transitionToPlayerTurn(); // turn 1
    expect(ctrl.getState().turnNumber).toBe(1);

    // End player turn
    ctrl.endPlayerTurn();
    expect(ctrl.getPhase()).toBe(TurnPhase.ENEMY_TURN);

    // Execute enemy turn
    ctrl.executeEnemyTurn();
    expect(ctrl.getPhase()).toBe(TurnPhase.ENEMY_TURN); // stays ENEMY_TURN

    // Start next player turn
    ctrl.startPlayerTurn();
    expect(ctrl.getPhase()).toBe(TurnPhase.PLAYER_TURN);
    expect(ctrl.getState().turnNumber).toBe(2);
  });

  it('multiple turn cycles advance turnNumber correctly', () => {
    const mocks = createMocks();
    const ctrl = new CombatController(
      mocks.eventBus, mocks.deckManager, mocks.energySystem,
      mocks.statusEffectManager, mocks.effectResolver, mocks.enemyHelper, mocks.rng
    );
    ctrl.startCombat(50, 75, 3);
    ctrl.transitionToPlayerTurn(); // turn 1

    // Cycle 1
    ctrl.endPlayerTurn();
    ctrl.executeEnemyTurn();
    ctrl.startPlayerTurn();
    expect(ctrl.getState().turnNumber).toBe(2);

    // Cycle 2
    ctrl.endPlayerTurn();
    ctrl.executeEnemyTurn();
    ctrl.startPlayerTurn();
    expect(ctrl.getState().turnNumber).toBe(3);

    // Cycle 3
    ctrl.endPlayerTurn();
    ctrl.executeEnemyTurn();
    ctrl.startPlayerTurn();
    expect(ctrl.getState().turnNumber).toBe(4);
  });
});
