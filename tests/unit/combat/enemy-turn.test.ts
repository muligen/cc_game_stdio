/**
 * enemy-turn.test.ts — Unit tests for the enemy turn resolution pipeline.
 *
 * Implements acceptance criteria from design/gdd/combat.md (Enemy Turn Flow)
 * and ADR-002 (Combat Resolution Pipeline — enemy damage, block, status).
 *
 * Coverage areas:
 * - Enemy attacks player (damage resolution)
 * - Enemy gains block
 * - Enemy applies status to player
 * - Block absorption (player block consumes damage before HP loss)
 * - Strength modifier on enemy damage
 * - Weak modifier on enemy damage
 * - Vulnerable modifier on player receiving enemy damage
 * - Dead enemies skipped during execution
 * - Stunned enemy skipped (stun consumed)
 * - Player death ends combat with defeat
 * - Multi-enemy: second enemy does not act if player dies from first
 */

// @vitest-environment node

import { describe, it, expect } from 'vitest';
import { CombatController } from '../../../src/systems/combat-controller';
import { TurnPhase } from '../../../src/types/combat';
import type { CombatEnemyInstance, EnemyData, EnemyMove } from '../../../src/types/enemy';

// ---------------------------------------------------------------------------
// Mock Dependencies
// ---------------------------------------------------------------------------

/**
 * Create a fresh set of mock dependencies for CombatController.
 * Each call returns new objects so tests are fully isolated.
 *
 * Mirrors the pattern in combat-controller.test.ts but with extended
 * statusEffectManager that supports keyed return values for modifiers.
 */
function createMocks() {
  // Allow tests to configure specific return values for getEffectStacks.
  // Key format: `${targetId}:${effectId}` -> stacks number.
  const effectStacksMap = new Map<string, number>();

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
      getHand: () => [] as readonly import('../../../src/types/card').CombatCardInstance[],
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
        return effectStacksMap.get(key) ?? 0;
      },
      processTurnEnd: () => {},
      applyEffect: () => true,
      tryApplyDebuff: () => true,
      getEffectData: () => undefined as { category: string } | undefined,
      /** Test helper: set effect stacks for a target. */
      _setStacks(targetId: string, effectId: string, stacks: number) {
        effectStacksMap.set(`${targetId}:${effectId}`, stacks);
      },
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
      getStream: () => ({
        nextInt: () => 0,
        weightedPick: () => 'move_1',
        shuffle: <T>(arr: readonly T[]) => [...arr],
      }),
    },
  };
}

/** Return type of createMocks for type-safe test helpers. */
type Mocks = ReturnType<typeof createMocks>;

/** Create a CombatController with mock dependencies. */
function createController(mocks: Mocks): CombatController {
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

// ---------------------------------------------------------------------------
// Test Enemy Factories
// ---------------------------------------------------------------------------

const BASE_ENEMY_DATA: EnemyData = {
  id: 'test_enemy',
  name: 'Test Enemy',
  type: 'normal',
  hp: 30,
  moves: [],
};

/** Create a test enemy instance with default values. */
function createTestEnemy(
  overrides: Partial<CombatEnemyInstance> = {}
): CombatEnemyInstance {
  return {
    instanceId: 'e1',
    data: BASE_ENEMY_DATA,
    currentHP: 30,
    maxHP: 30,
    block: 0,
    isAlive: true,
    currentMove: null,
    moveHistory: [],
    firstMoveUsed: false,
    ...overrides,
  };
}

/** Create an EnemyMove with a single deal_damage effect. */
function createAttackMove(damage: number): EnemyMove {
  return {
    id: 'test_attack',
    name: 'Test Attack',
    intent: 'attack' as never,
    effects: [{ type: 'deal_damage', value: damage }],
    damage,
  };
}

/** Create an EnemyMove with a single gain_block effect. */
function createBlockMove(blockAmount: number): EnemyMove {
  return {
    id: 'test_block',
    name: 'Test Defend',
    intent: 'defend' as never,
    effects: [{ type: 'gain_block', value: blockAmount }],
    block: blockAmount,
  };
}

/** Create an EnemyMove with a single apply_status effect. */
function createStatusMove(statusId: string, stacks: number): EnemyMove {
  return {
    id: 'test_status',
    name: 'Test Status',
    intent: 'debuff' as never,
    effects: [{ type: 'apply_status', value: stacks, status: statusId }],
  };
}

/**
 * Setup helper: create a controller in ENEMY_TURN phase with the given
 * player HP and the given enemy instances pre-loaded into state.
 */
function setupEnemyTurn(
  mocks: Mocks,
  playerHP: number,
  enemies: CombatEnemyInstance[],
  playerMaxHP: number = 75,
  playerBlock: number = 0
): CombatController {
  const ctrl = createController(mocks);
  ctrl.startCombat(playerHP, playerMaxHP, 3);
  ctrl.transitionToPlayerTurn();
  if (playerBlock > 0) {
    ctrl.setPlayerBlock(playerBlock);
  }
  ctrl.transitionToEnemyTurn();

  // Directly set enemies in state (cast to bypass Readonly)
  (ctrl.getState() as { enemies: CombatEnemyInstance[] }).enemies = enemies;

  return ctrl;
}

// ===========================================================================
// Enemy attacks player
// ===========================================================================

describe('Enemy attacks player', () => {
  it('deals damage equal to move value with no modifiers', () => {
    const mocks = createMocks();
    const enemy = createTestEnemy({
      currentMove: createAttackMove(10),
    });

    const ctrl = setupEnemyTurn(mocks, 50, [enemy]);

    ctrl.executeEnemyTurn();

    // 10 damage, no block, no modifiers
    expect(ctrl.getState().playerHP).toBe(40);
  });

  it('emits onDamageDealt event with correct values', () => {
    const mocks = createMocks();
    const emits: Array<{ event: string; payload: unknown }> = [];
    mocks.eventBus.emit = (event: string, payload: unknown) => {
      emits.push({ event, payload });
    };
    const enemy = createTestEnemy({
      currentMove: createAttackMove(7),
    });

    const ctrl = setupEnemyTurn(mocks, 30, [enemy]);

    ctrl.executeEnemyTurn();

    const dmgEvent = emits.find((e) => e.event === 'onDamageDealt');
    expect(dmgEvent).toBeDefined();
    const p = dmgEvent!.payload as { damage: number; blocked: number };
    expect(p.damage).toBe(7);
    expect(p.blocked).toBe(0);
  });
});

// ===========================================================================
// Enemy gains block
// ===========================================================================

describe('Enemy gains block', () => {
  it('calls gainBlock with the correct amount', () => {
    const mocks = createMocks();
    const gainBlockCalls: Array<{ enemy: CombatEnemyInstance; amount: number }> = [];
    mocks.enemyHelper.gainBlock = (enemy: CombatEnemyInstance, amount: number) => {
      gainBlockCalls.push({ enemy, amount });
      enemy.block += amount;
      return enemy.block;
    };
    const enemy = createTestEnemy({
      currentMove: createBlockMove(8),
    });

    const ctrl = setupEnemyTurn(mocks, 50, [enemy]);

    ctrl.executeEnemyTurn();

    expect(gainBlockCalls).toHaveLength(1);
    expect(gainBlockCalls[0].amount).toBe(8);
    expect(gainBlockCalls[0].enemy.instanceId).toBe('e1');
  });

  it('enemy block value increases after gain_block effect', () => {
    const mocks = createMocks();
    // Use real gainBlock behavior
    mocks.enemyHelper.gainBlock = (enemy: CombatEnemyInstance, amount: number) => {
      enemy.block += amount;
      return enemy.block;
    };
    const enemy = createTestEnemy({
      block: 0,
      currentMove: createBlockMove(12),
    });

    const ctrl = setupEnemyTurn(mocks, 50, [enemy]);

    ctrl.executeEnemyTurn();

    expect(enemy.block).toBe(12);
  });
});

// ===========================================================================
// Enemy applies status to player
// ===========================================================================

describe('Enemy applies status to player', () => {
  it('calls applyEffect for a buff-type status', () => {
    const mocks = createMocks();
    const applyCalls: Array<{ targetId: string; effectId: string; stacks: number }> = [];
    mocks.statusEffectManager.applyEffect = (
      targetId: string,
      effectId: string,
      stacks: number
    ) => {
      applyCalls.push({ targetId, effectId, stacks });
      return true;
    };
    // Return category 'buff' so it takes the applyEffect path
    mocks.statusEffectManager.getEffectData = () => ({ category: 'buff' });

    const enemy = createTestEnemy({
      currentMove: createStatusMove('strength', 2),
    });

    const ctrl = setupEnemyTurn(mocks, 50, [enemy]);

    ctrl.executeEnemyTurn();

    expect(applyCalls).toHaveLength(1);
    expect(applyCalls[0].targetId).toBe('player');
    expect(applyCalls[0].effectId).toBe('strength');
    expect(applyCalls[0].stacks).toBe(2);
  });

  it('calls tryApplyDebuff for a debuff-type status', () => {
    const mocks = createMocks();
    const debuffCalls: Array<{ targetId: string; effectId: string; stacks: number }> = [];
    mocks.statusEffectManager.tryApplyDebuff = (
      targetId: string,
      effectId: string,
      stacks: number
    ) => {
      debuffCalls.push({ targetId, effectId, stacks });
      return true;
    };
    // Return category 'debuff' so it takes the tryApplyDebuff path
    mocks.statusEffectManager.getEffectData = () => ({ category: 'debuff' });

    const enemy = createTestEnemy({
      currentMove: createStatusMove('vulnerable', 1),
    });

    const ctrl = setupEnemyTurn(mocks, 50, [enemy]);

    ctrl.executeEnemyTurn();

    expect(debuffCalls).toHaveLength(1);
    expect(debuffCalls[0].targetId).toBe('player');
    expect(debuffCalls[0].effectId).toBe('vulnerable');
    expect(debuffCalls[0].stacks).toBe(1);
  });

  it('emits onStatusApplied event', () => {
    const mocks = createMocks();
    const emits: Array<{ event: string; payload: unknown }> = [];
    mocks.eventBus.emit = (event: string, payload: unknown) => {
      emits.push({ event, payload });
    };
    mocks.statusEffectManager.getEffectData = () => ({ category: 'debuff' });

    const enemy = createTestEnemy({
      currentMove: createStatusMove('weak', 2),
    });

    const ctrl = setupEnemyTurn(mocks, 50, [enemy]);

    ctrl.executeEnemyTurn();

    const statusEvent = emits.find((e) => e.event === 'onStatusApplied');
    expect(statusEvent).toBeDefined();
    const p = statusEvent!.payload as { target: { id: string }; status: string; stacks: number };
    expect(p.target.id).toBe('player');
    expect(p.status).toBe('weak');
    expect(p.stacks).toBe(2);
  });
});

// ===========================================================================
// Block absorption
// ===========================================================================

describe('Block absorption', () => {
  it('player with 5 block takes 8 damage: block consumed, 3 HP lost', () => {
    const mocks = createMocks();
    const enemy = createTestEnemy({
      currentMove: createAttackMove(8),
    });

    const ctrl = setupEnemyTurn(mocks, 50, [enemy], 75, 5);

    ctrl.executeEnemyTurn();

    // 8 damage - 5 block = 3 HP lost
    expect(ctrl.getState().playerHP).toBe(47);
    expect(ctrl.getState().playerBlock).toBe(0);
  });

  it('player with 10 block takes 6 damage: block absorbs all, 0 HP lost', () => {
    const mocks = createMocks();
    const enemy = createTestEnemy({
      currentMove: createAttackMove(6),
    });

    const ctrl = setupEnemyTurn(mocks, 50, [enemy], 75, 10);

    ctrl.executeEnemyTurn();

    // 6 damage absorbed by 10 block, 4 block remaining
    expect(ctrl.getState().playerHP).toBe(50);
    expect(ctrl.getState().playerBlock).toBe(4);
  });

  it('player with 0 block takes full damage to HP', () => {
    const mocks = createMocks();
    const enemy = createTestEnemy({
      currentMove: createAttackMove(15),
    });

    const ctrl = setupEnemyTurn(mocks, 50, [enemy]);

    ctrl.executeEnemyTurn();

    expect(ctrl.getState().playerHP).toBe(35);
    expect(ctrl.getState().playerBlock).toBe(0);
  });
});

// ===========================================================================
// Strength modifier
// ===========================================================================

describe('Strength modifier', () => {
  it('enemy with strength deals extra damage', () => {
    const mocks = createMocks();
    // Enemy 'e1' has 3 strength
    mocks.statusEffectManager._setStacks('e1', 'strength', 3);

    const enemy = createTestEnemy({
      currentMove: createAttackMove(10),
    });

    const ctrl = setupEnemyTurn(mocks, 50, [enemy]);

    ctrl.executeEnemyTurn();

    // 10 base + 3 strength = 13 damage
    expect(ctrl.getState().playerHP).toBe(37);
  });

  it('enemy with negative strength deals reduced damage (floored at 1)', () => {
    const mocks = createMocks();
    // Enemy has -5 strength
    mocks.statusEffectManager._setStacks('e1', 'strength', -5);

    const enemy = createTestEnemy({
      currentMove: createAttackMove(3),
    });

    const ctrl = setupEnemyTurn(mocks, 50, [enemy]);

    ctrl.executeEnemyTurn();

    // 3 base + (-5) strength = -2, floored at 1
    expect(ctrl.getState().playerHP).toBe(49);
  });
});

// ===========================================================================
// Weak modifier
// ===========================================================================

describe('Weak modifier', () => {
  it('enemy with weak deals 75% damage (floored)', () => {
    const mocks = createMocks();
    // Enemy 'e1' has weak
    mocks.statusEffectManager._setStacks('e1', 'weak', 1);

    const enemy = createTestEnemy({
      currentMove: createAttackMove(10),
    });

    const ctrl = setupEnemyTurn(mocks, 50, [enemy]);

    ctrl.executeEnemyTurn();

    // 10 * 0.75 = 7.5, Math.floor = 7 damage
    expect(ctrl.getState().playerHP).toBe(43);
  });

  it('enemy with weak and damage that results in 0 after floor still deals 1', () => {
    const mocks = createMocks();
    mocks.statusEffectManager._setStacks('e1', 'weak', 1);

    // 1 * 0.75 = 0.75, floor = 0, but floor at 1
    const enemy = createTestEnemy({
      currentMove: createAttackMove(1),
    });

    const ctrl = setupEnemyTurn(mocks, 50, [enemy]);

    ctrl.executeEnemyTurn();

    // 1 * 0.75 = 0, floored at 1
    expect(ctrl.getState().playerHP).toBe(49);
  });
});

// ===========================================================================
// Vulnerable modifier
// ===========================================================================

describe('Vulnerable modifier', () => {
  it('player with vulnerable takes 150% damage (floored)', () => {
    const mocks = createMocks();
    // Player has vulnerable
    mocks.statusEffectManager._setStacks('player', 'vulnerable', 1);

    const enemy = createTestEnemy({
      currentMove: createAttackMove(10),
    });

    const ctrl = setupEnemyTurn(mocks, 50, [enemy]);

    ctrl.executeEnemyTurn();

    // 10 * 1.5 = 15 damage
    expect(ctrl.getState().playerHP).toBe(35);
  });

  it('vulnerable with block absorption still multiplies correctly', () => {
    const mocks = createMocks();
    mocks.statusEffectManager._setStacks('player', 'vulnerable', 1);

    const enemy = createTestEnemy({
      currentMove: createAttackMove(10),
    });

    // Player has 5 block
    const ctrl = setupEnemyTurn(mocks, 50, [enemy], 75, 5);

    ctrl.executeEnemyTurn();

    // 10 * 1.5 = 15 damage, 5 block absorbed, 10 HP lost
    expect(ctrl.getState().playerHP).toBe(40);
    expect(ctrl.getState().playerBlock).toBe(0);
  });

  it('vulnerable with odd base damage floors correctly', () => {
    const mocks = createMocks();
    mocks.statusEffectManager._setStacks('player', 'vulnerable', 1);

    const enemy = createTestEnemy({
      currentMove: createAttackMove(7),
    });

    const ctrl = setupEnemyTurn(mocks, 50, [enemy]);

    ctrl.executeEnemyTurn();

    // 7 * 1.5 = 10.5, Math.floor = 10
    expect(ctrl.getState().playerHP).toBe(40);
  });
});

// ===========================================================================
// Dead enemies skipped
// ===========================================================================

describe('Dead enemies skipped', () => {
  it('dead enemy does not deal damage to player', () => {
    const mocks = createMocks();
    const deadEnemy = createTestEnemy({
      instanceId: 'dead_e1',
      currentHP: 0,
      isAlive: false,
      currentMove: createAttackMove(20),
    });

    const ctrl = setupEnemyTurn(mocks, 50, [deadEnemy]);

    ctrl.executeEnemyTurn();

    // No damage dealt
    expect(ctrl.getState().playerHP).toBe(50);
  });

  it('resetBlock not called for dead enemies', () => {
    const mocks = createMocks();
    const resetBlockCalls: unknown[] = [];
    mocks.enemyHelper.resetBlock = (enemy: unknown) => {
      resetBlockCalls.push(enemy);
    };

    const deadEnemy = createTestEnemy({
      instanceId: 'dead_e1',
      currentHP: 0,
      isAlive: false,
      currentMove: createAttackMove(5),
    });
    const aliveEnemy = createTestEnemy({
      instanceId: 'alive_e2',
      currentMove: createAttackMove(5),
    });

    const ctrl = setupEnemyTurn(mocks, 50, [deadEnemy, aliveEnemy]);

    ctrl.executeEnemyTurn();

    // Only the alive enemy gets resetBlock
    expect(resetBlockCalls).toHaveLength(1);
  });
});

// ===========================================================================
// Stunned enemy skipped
// ===========================================================================

describe('Stunned enemy skipped', () => {
  it('stunned enemy does not deal damage', () => {
    const mocks = createMocks();
    // Enemy has stunned stacks
    mocks.statusEffectManager._setStacks('e1', 'stunned', 1);

    const enemy = createTestEnemy({
      currentMove: createAttackMove(20),
    });

    const ctrl = setupEnemyTurn(mocks, 50, [enemy]);

    ctrl.executeEnemyTurn();

    // Stunned — no damage dealt
    expect(ctrl.getState().playerHP).toBe(50);
  });

  it('stunned enemy has processTurnEnd called to consume stun', () => {
    const mocks = createMocks();
    mocks.statusEffectManager._setStacks('e1', 'stunned', 1);

    const processCalls: Array<{ targetId: string; isPlayerTurn: boolean }> = [];
    mocks.statusEffectManager.processTurnEnd = (
      targetId: string,
      isPlayerTurn: boolean
    ) => {
      processCalls.push({ targetId, isPlayerTurn });
    };

    const enemy = createTestEnemy({
      currentMove: createAttackMove(10),
    });

    const ctrl = setupEnemyTurn(mocks, 50, [enemy]);

    ctrl.executeEnemyTurn();

    // processTurnEnd should be called for the stunned enemy (to consume stun)
    const stunProcessCall = processCalls.find(
      (c) => c.targetId === 'e1' && c.isPlayerTurn === false
    );
    expect(stunProcessCall).toBeDefined();
  });

  it('stunned enemy still gets next move selected', () => {
    const mocks = createMocks();
    mocks.statusEffectManager._setStacks('e1', 'stunned', 1);

    const selectCalls: unknown[] = [];
    mocks.enemyHelper.selectMove = (enemy: unknown) => {
      selectCalls.push(enemy);
      return 'next_move';
    };

    const enemy = createTestEnemy({
      currentMove: null, // null so selectAndResolveEnemyMove does something
    });

    const ctrl = setupEnemyTurn(mocks, 50, [enemy]);

    ctrl.executeEnemyTurn();

    // Even though stunned, selectMove should be called for next turn's intent
    expect(selectCalls.length).toBeGreaterThanOrEqual(1);
  });
});

// ===========================================================================
// Player death ends combat with defeat
// ===========================================================================

describe('Player death ends combat with defeat', () => {
  it('lethal damage transitions to COMBAT_OVER with defeat', () => {
    const mocks = createMocks();
    const enemy = createTestEnemy({
      currentMove: createAttackMove(50),
    });

    const ctrl = setupEnemyTurn(mocks, 30, [enemy]);

    ctrl.executeEnemyTurn();

    expect(ctrl.getState().phase).toBe(TurnPhase.COMBAT_OVER);
    expect(ctrl.getState().result).toBe('defeat');
    expect(ctrl.getState().playerHP).toBe(0);
  });

  it('player HP is floored at 0 on death', () => {
    const mocks = createMocks();
    const enemy = createTestEnemy({
      currentMove: createAttackMove(100),
    });

    const ctrl = setupEnemyTurn(mocks, 10, [enemy]);

    ctrl.executeEnemyTurn();

    expect(ctrl.getState().playerHP).toBe(0);
    expect(ctrl.getState().result).toBe('defeat');
  });

  it('emits onEntityDeath event when player dies', () => {
    const mocks = createMocks();
    const emits: Array<{ event: string; payload: unknown }> = [];
    mocks.eventBus.emit = (event: string, payload: unknown) => {
      emits.push({ event, payload });
    };
    const enemy = createTestEnemy({
      currentMove: createAttackMove(100),
    });

    const ctrl = setupEnemyTurn(mocks, 10, [enemy]);

    ctrl.executeEnemyTurn();

    const deathEvent = emits.find((e) => e.event === 'onEntityDeath');
    expect(deathEvent).toBeDefined();
    const p = deathEvent!.payload as { entity: { id: string; type: string }; cause: string };
    expect(p.entity.id).toBe('player');
    expect(p.cause).toBe('damage');
  });

  it('does not emit onEnemyTurnEnd when player dies', () => {
    const mocks = createMocks();
    const emits: Array<{ event: string; payload: unknown }> = [];
    mocks.eventBus.emit = (event: string, payload: unknown) => {
      emits.push({ event, payload });
    };
    const enemy = createTestEnemy({
      currentMove: createAttackMove(100),
    });

    const ctrl = setupEnemyTurn(mocks, 10, [enemy]);

    ctrl.executeEnemyTurn();

    const endEvent = emits.find((e) => e.event === 'onEnemyTurnEnd');
    expect(endEvent).toBeUndefined();
  });
});

// ===========================================================================
// Multi-enemy: second enemy does not act if player dies from first
// ===========================================================================

describe('Multi-enemy: second enemy skipped if player dies from first', () => {
  it('first enemy kills player, second enemy does not deal damage', () => {
    const mocks = createMocks();
    const gainBlockCalls: unknown[] = [];
    mocks.enemyHelper.gainBlock = (enemy: CombatEnemyInstance, amount: number) => {
      gainBlockCalls.push({ enemy, amount });
      enemy.block += amount;
      return enemy.block;
    };

    const lethalEnemy = createTestEnemy({
      instanceId: 'killer',
      currentMove: createAttackMove(50),
    });
    const survivorEnemy = createTestEnemy({
      instanceId: 'survivor',
      currentMove: createBlockMove(10),
    });

    const ctrl = setupEnemyTurn(mocks, 30, [lethalEnemy, survivorEnemy]);

    ctrl.executeEnemyTurn();

    // Player should be dead from first enemy
    expect(ctrl.getState().playerHP).toBe(0);
    expect(ctrl.getState().phase).toBe(TurnPhase.COMBAT_OVER);
    expect(ctrl.getState().result).toBe('defeat');

    // Second enemy never got to act (gainBlock never called for survivor)
    const survivorBlockCalls = gainBlockCalls.filter(
      (c) => (c as { enemy: CombatEnemyInstance }).enemy.instanceId === 'survivor'
    );
    expect(survivorBlockCalls).toHaveLength(0);
  });

  it('first enemy deals non-lethal, second enemy finishes the job', () => {
    const mocks = createMocks();
    const enemy1 = createTestEnemy({
      instanceId: 'e1',
      currentMove: createAttackMove(20),
    });
    const enemy2 = createTestEnemy({
      instanceId: 'e2',
      currentMove: createAttackMove(20),
    });

    const ctrl = setupEnemyTurn(mocks, 30, [enemy1, enemy2]);

    ctrl.executeEnemyTurn();

    // First enemy deals 20 (30 -> 10), second deals 20 (10 -> 0)
    expect(ctrl.getState().playerHP).toBe(0);
    expect(ctrl.getState().phase).toBe(TurnPhase.COMBAT_OVER);
    expect(ctrl.getState().result).toBe('defeat');
  });
});
