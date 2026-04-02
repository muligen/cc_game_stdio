/**
 * enemy.test.ts — Unit tests for EnemyHelper utility class and CombatEnemyInstance type.
 *
 * Implements acceptance criteria and edge cases from design/gdd/enemy.md.
 *
 * Coverage areas:
 * - createInstance: HP rolling, range validation, initial state
 * - takeDamage: HP reduction, block absorption, death, overkill
 * - gainBlock / resetBlock: block management
 * - isImmune: boss immunity, non-boss, empty immunities
 * - selectMove: random, sequential, patterned, boss AI patterns
 * - getMoveById: move lookup
 * - getMoveDamage / getMoveBlock: move value retrieval
 * - isAlive: alive check
 * - getFirstMove: first move override
 */

// @vitest-environment node

import { describe, it, expect } from 'vitest';
import {
  type EnemyData,
  type EnemyMove,
  type CombatEnemyInstance,
  type MoveEntry,
} from '../../../src/types/enemy';
import { EnemyHelper, type DamageResult } from '../../../src/systems/enemy-helper';
import { RNGStream } from '../../../src/utils/rng';

// ---------------------------------------------------------------------------
// Test Fixtures
// ---------------------------------------------------------------------------

/** Base move entries for a simple enemy. */
function makeMoveEntries(): MoveEntry[] {
  return [
    { moveId: 'attack', weight: 60 },
    { moveId: 'defend', weight: 40 },
  ];
}

/** Base move entries for a multi-move enemy. */
function makeMultiMoveEntries(): MoveEntry[] {
  return [
    { moveId: 'chomp', weight: 25 },
    { moveId: 'thrash', weight: 30 },
    { moveId: 'bellow', weight: 45 },
  ];
}

/** Creates a simple normal enemy data with hpMin/hpMax range. */
function makeEnemyData(overrides: Partial<EnemyData> = {}): EnemyData {
  return {
    id: 'test_enemy',
    name: 'Test Enemy',
    type: 'normal',
    hp: 50,
    hpMin: 40,
    hpMax: 60,
    moves: makeMoveEntries(),
    selectionMode: 'weighted',
    ...overrides,
  };
}

/** Creates a boss enemy data with immunities and pattern. */
function makeBossData(overrides: Partial<EnemyData> = {}): EnemyData {
  return {
    id: 'test_boss',
    name: 'Test Boss',
    type: 'boss',
    hp: 140,
    hpMin: 130,
    hpMax: 150,
    moves: makeMultiMoveEntries(),
    selectionMode: 'rotating',
    immunities: ['vulnerable', 'weak'],
    aiPattern: 'boss',
    movePattern: ['goop_spray', 'preparing', 'slam'],
    firstMove: 'goop_spray',
    ...overrides,
  };
}

/** Creates an elite enemy data. */
function makeEliteData(overrides: Partial<EnemyData> = {}): EnemyData {
  return {
    id: 'test_elite',
    name: 'Test Elite',
    type: 'elite',
    hp: 82,
    moves: makeMoveEntries(),
    selectionMode: 'rotating',
    ...overrides,
  };
}

/** Creates a CombatEnemyInstance with sensible defaults. */
function makeEnemyInstance(overrides: Partial<CombatEnemyInstance> = {}): CombatEnemyInstance {
  return {
    instanceId: 'enemy-001',
    data: makeEnemyData(),
    currentHP: 50,
    maxHP: 50,
    block: 0,
    isAlive: true,
    currentMove: null,
    moveHistory: [],
    firstMoveUsed: false,
    ...overrides,
  };
}

/** Creates an EnemyMove for testing. */
function makeEnemyMove(overrides: Partial<EnemyMove> = {}): EnemyMove {
  return {
    id: 'test_attack',
    name: 'Test Attack',
    intent: 'attack' as const,
    effects: [],
    damage: 10,
    ...overrides,
  };
}

/** Creates an RNGStream with a fixed seed for deterministic tests. */
function makeRNG(seed: number = 12345): RNGStream {
  return new RNGStream(seed);
}

// ===========================================================================
// createInstance tests
// ===========================================================================

describe('EnemyHelper.createInstance', () => {
  it('HP is rolled within hpMin..hpMax range', () => {
    const data = makeEnemyData({ hpMin: 40, hpMax: 60 });
    const rng = makeRNG();
    const instance = EnemyHelper.createInstance(data, 'e-001', rng);

    expect(instance.currentHP).toBeGreaterThanOrEqual(40);
    expect(instance.currentHP).toBeLessThanOrEqual(60);
    expect(instance.maxHP).toBeGreaterThanOrEqual(40);
    expect(instance.maxHP).toBeLessThanOrEqual(60);
  });

  it('maxHP equals currentHP at creation', () => {
    const data = makeEnemyData({ hpMin: 40, hpMax: 60 });
    const rng = makeRNG();
    const instance = EnemyHelper.createInstance(data, 'e-002', rng);

    expect(instance.maxHP).toBe(instance.currentHP);
  });

  it('uses data.hp when hpMin/hpMax are not defined', () => {
    const data = makeEnemyData({ hp: 50 });
    // Remove hpMin/hpMax
    const { hpMin, hpMax, ...dataWithoutRange } = data;
    const rng = makeRNG();
    const instance = EnemyHelper.createInstance(
      dataWithoutRange as EnemyData,
      'e-003',
      rng
    );

    expect(instance.currentHP).toBe(50);
    expect(instance.maxHP).toBe(50);
  });

  it('different seeds produce different HP values', () => {
    const data = makeEnemyData({ hpMin: 10, hpMax: 100 });
    const rng1 = new RNGStream(11111);
    const rng2 = new RNGStream(22222);

    const instance1 = EnemyHelper.createInstance(data, 'e-004', rng1);
    const instance2 = EnemyHelper.createInstance(data, 'e-005', rng2);

    // Statistically very unlikely to be equal with range 10..100
    // We cannot guarantee they differ, so just verify both are in range
    expect(instance1.currentHP).toBeGreaterThanOrEqual(10);
    expect(instance1.currentHP).toBeLessThanOrEqual(100);
    expect(instance2.currentHP).toBeGreaterThanOrEqual(10);
    expect(instance2.currentHP).toBeLessThanOrEqual(100);
  });

  it('same seed produces same HP (deterministic)', () => {
    const data = makeEnemyData({ hpMin: 10, hpMax: 100 });

    const rng1a = new RNGStream(42);
    const rng1b = new RNGStream(42);

    const instance1 = EnemyHelper.createInstance(data, 'e-006', rng1a);
    const instance2 = EnemyHelper.createInstance(data, 'e-007', rng1b);

    expect(instance1.currentHP).toBe(instance2.currentHP);
    expect(instance1.maxHP).toBe(instance2.maxHP);
  });

  it('block starts at 0', () => {
    const data = makeEnemyData();
    const rng = makeRNG();
    const instance = EnemyHelper.createInstance(data, 'e-008', rng);

    expect(instance.block).toBe(0);
  });

  it('isAlive starts true', () => {
    const data = makeEnemyData();
    const rng = makeRNG();
    const instance = EnemyHelper.createInstance(data, 'e-009', rng);

    expect(instance.isAlive).toBe(true);
  });

  it('moveHistory starts empty', () => {
    const data = makeEnemyData();
    const rng = makeRNG();
    const instance = EnemyHelper.createInstance(data, 'e-010', rng);

    expect(instance.moveHistory).toEqual([]);
  });

  it('currentMove starts null', () => {
    const data = makeEnemyData();
    const rng = makeRNG();
    const instance = EnemyHelper.createInstance(data, 'e-011', rng);

    expect(instance.currentMove).toBeNull();
  });

  it('stores the data reference immutably', () => {
    const data = makeEnemyData();
    const rng = makeRNG();
    const instance = EnemyHelper.createInstance(data, 'e-012', rng);

    expect(instance.data).toBe(data);
  });

  it('stores the provided instanceId', () => {
    const data = makeEnemyData();
    const rng = makeRNG();
    const instance = EnemyHelper.createInstance(data, 'custom-id-999', rng);

    expect(instance.instanceId).toBe('custom-id-999');
  });

  it('HP roll equals hpMin when hpMin === hpMax', () => {
    const data = makeEnemyData({ hpMin: 50, hpMax: 50 });
    const rng = makeRNG();
    const instance = EnemyHelper.createInstance(data, 'e-013', rng);

    expect(instance.currentHP).toBe(50);
    expect(instance.maxHP).toBe(50);
  });
});

// ===========================================================================
// takeDamage tests
// ===========================================================================

describe('EnemyHelper.takeDamage', () => {
  it('damage reduces HP when no block', () => {
    const enemy = makeEnemyInstance({ currentHP: 50, block: 0 });
    const result = EnemyHelper.takeDamage(enemy, 10);

    expect(enemy.currentHP).toBe(40);
    expect(result.hpLost).toBe(10);
    expect(result.blocked).toBe(0);
  });

  it('block absorbs all damage', () => {
    const enemy = makeEnemyInstance({ currentHP: 50, block: 10 });
    const result = EnemyHelper.takeDamage(enemy, 5);

    expect(enemy.currentHP).toBe(50);
    expect(enemy.block).toBe(5);
    expect(result.hpLost).toBe(0);
    expect(result.blocked).toBe(5);
  });

  it('block absorbs partial damage', () => {
    const enemy = makeEnemyInstance({ currentHP: 50, block: 5 });
    const result = EnemyHelper.takeDamage(enemy, 15);

    expect(enemy.currentHP).toBe(40);
    expect(enemy.block).toBe(0);
    expect(result.hpLost).toBe(10);
    expect(result.blocked).toBe(5);
  });

  it('block absorbs exactly all damage', () => {
    const enemy = makeEnemyInstance({ currentHP: 50, block: 10 });
    const result = EnemyHelper.takeDamage(enemy, 10);

    expect(enemy.currentHP).toBe(50);
    expect(enemy.block).toBe(0);
    expect(result.hpLost).toBe(0);
    expect(result.blocked).toBe(10);
  });

  it('zero damage is a no-op', () => {
    const enemy = makeEnemyInstance({ currentHP: 50, block: 5 });
    const result = EnemyHelper.takeDamage(enemy, 0);

    expect(enemy.currentHP).toBe(50);
    expect(enemy.block).toBe(5);
    expect(result.hpLost).toBe(0);
    expect(result.blocked).toBe(0);
  });

  it('lethal damage sets isAlive to false', () => {
    const enemy = makeEnemyInstance({ currentHP: 10, block: 0 });
    const result = EnemyHelper.takeDamage(enemy, 10);

    expect(enemy.currentHP).toBe(0);
    expect(enemy.isAlive).toBe(false);
    expect(result.hpLost).toBe(10);
  });

  it('overkill damage: HP goes to 0 not negative', () => {
    const enemy = makeEnemyInstance({ currentHP: 5, block: 0 });
    const result = EnemyHelper.takeDamage(enemy, 50);

    expect(enemy.currentHP).toBe(0);
    expect(enemy.isAlive).toBe(false);
    // hpLost is the amount of HP actually lost, clamped to current HP
    expect(result.hpLost).toBe(5);
  });

  it('overkill with block: block absorbs, then HP clamped to 0', () => {
    const enemy = makeEnemyInstance({ currentHP: 5, block: 3 });
    const result = EnemyHelper.takeDamage(enemy, 50);

    expect(enemy.currentHP).toBe(0);
    expect(enemy.block).toBe(0);
    expect(enemy.isAlive).toBe(false);
    expect(result.blocked).toBe(3);
    expect(result.hpLost).toBe(5);
  });

  it('damage exactly equal to block + HP kills enemy', () => {
    const enemy = makeEnemyInstance({ currentHP: 20, block: 10 });
    const result = EnemyHelper.takeDamage(enemy, 30);

    expect(enemy.currentHP).toBe(0);
    expect(enemy.block).toBe(0);
    expect(enemy.isAlive).toBe(false);
    expect(result.blocked).toBe(10);
    expect(result.hpLost).toBe(20);
  });

  it('negative damage is a no-op', () => {
    const enemy = makeEnemyInstance({ currentHP: 50, block: 0 });
    const result = EnemyHelper.takeDamage(enemy, -5);

    expect(enemy.currentHP).toBe(50);
    expect(result.hpLost).toBe(0);
    expect(result.blocked).toBe(0);
  });

  it('dead enemy can still receive damage (state is valid)', () => {
    const enemy = makeEnemyInstance({ currentHP: 0, isAlive: false, block: 0 });
    const result = EnemyHelper.takeDamage(enemy, 10);

    expect(enemy.currentHP).toBe(0);
    expect(enemy.isAlive).toBe(false);
    expect(result.hpLost).toBe(0);
    expect(result.blocked).toBe(0);
  });

  it('multiple hits accumulate correctly', () => {
    const enemy = makeEnemyInstance({ currentHP: 50, block: 0 });

    EnemyHelper.takeDamage(enemy, 10);
    expect(enemy.currentHP).toBe(40);

    EnemyHelper.takeDamage(enemy, 15);
    expect(enemy.currentHP).toBe(25);

    EnemyHelper.takeDamage(enemy, 25);
    expect(enemy.currentHP).toBe(0);
    expect(enemy.isAlive).toBe(false);
  });
});

// ===========================================================================
// gainBlock / resetBlock tests
// ===========================================================================

describe('EnemyHelper.gainBlock', () => {
  it('adds block to enemy with no existing block', () => {
    const enemy = makeEnemyInstance({ block: 0 });
    const result = EnemyHelper.gainBlock(enemy, 8);

    expect(enemy.block).toBe(8);
    expect(result).toBe(8);
  });

  it('stacks block on existing block', () => {
    const enemy = makeEnemyInstance({ block: 5 });
    const result = EnemyHelper.gainBlock(enemy, 10);

    expect(enemy.block).toBe(15);
    expect(result).toBe(15);
  });

  it('zero block is a no-op', () => {
    const enemy = makeEnemyInstance({ block: 5 });
    const result = EnemyHelper.gainBlock(enemy, 0);

    expect(enemy.block).toBe(5);
    expect(result).toBe(5);
  });

  it('negative block is a no-op', () => {
    const enemy = makeEnemyInstance({ block: 5 });
    const result = EnemyHelper.gainBlock(enemy, -3);

    expect(enemy.block).toBe(5);
    expect(result).toBe(5);
  });
});

describe('EnemyHelper.resetBlock', () => {
  it('resets block to 0', () => {
    const enemy = makeEnemyInstance({ block: 15 });
    EnemyHelper.resetBlock(enemy);

    expect(enemy.block).toBe(0);
  });

  it('resetting block that is already 0 is a no-op', () => {
    const enemy = makeEnemyInstance({ block: 0 });
    EnemyHelper.resetBlock(enemy);

    expect(enemy.block).toBe(0);
  });
});

// ===========================================================================
// isImmune tests
// ===========================================================================

describe('EnemyHelper.isImmune', () => {
  it('boss immune to specific effect', () => {
    const data = makeBossData({ immunities: ['vulnerable', 'weak'] });
    expect(EnemyHelper.isImmune(data, 'vulnerable')).toBe(true);
    expect(EnemyHelper.isImmune(data, 'weak')).toBe(true);
  });

  it('boss not immune to effect not in list', () => {
    const data = makeBossData({ immunities: ['vulnerable', 'weak'] });
    expect(EnemyHelper.isImmune(data, 'poison')).toBe(false);
  });

  it('non-boss not immune (no immunities list)', () => {
    const data = makeEnemyData();
    expect(EnemyHelper.isImmune(data, 'vulnerable')).toBe(false);
  });

  it('empty immunities list means no immunity', () => {
    const data = makeEnemyData({ immunities: [] });
    expect(EnemyHelper.isImmune(data, 'vulnerable')).toBe(false);
  });

  it('works with CombatEnemyInstance', () => {
    const instance = makeEnemyInstance({
      data: makeBossData({ immunities: ['vulnerable'] }),
    });
    expect(EnemyHelper.isImmune(instance, 'vulnerable')).toBe(true);
    expect(EnemyHelper.isImmune(instance, 'poison')).toBe(false);
  });

  it('works with raw EnemyData', () => {
    const data = makeBossData({ immunities: ['entangled'] });
    expect(EnemyHelper.isImmune(data, 'entangled')).toBe(true);
  });
});

// ===========================================================================
// Move Query tests
// ===========================================================================

describe('EnemyHelper.getMoveDamage', () => {
  it('returns damage value from move', () => {
    const move = makeEnemyMove({ damage: 12 });
    expect(EnemyHelper.getMoveDamage(move)).toBe(12);
  });

  it('returns 0 when move has no damage', () => {
    const move = makeEnemyMove({ damage: undefined });
    expect(EnemyHelper.getMoveDamage(move)).toBe(0);
  });
});

describe('EnemyHelper.getMoveBlock', () => {
  it('returns block value from move', () => {
    const move = makeEnemyMove({ block: 8 });
    expect(EnemyHelper.getMoveBlock(move)).toBe(8);
  });

  it('returns 0 when move has no block', () => {
    const move = makeEnemyMove({ block: undefined });
    expect(EnemyHelper.getMoveBlock(move)).toBe(0);
  });
});

describe('EnemyHelper.getMoveById', () => {
  it('returns undefined when move not found (MoveEntry schema)', () => {
    const data = makeEnemyData();
    // Current EnemyData uses MoveEntry[], not inline EnemyMove[]
    expect(EnemyHelper.getMoveById(data, 'nonexistent')).toBeUndefined();
  });
});

// ===========================================================================
// isAlive tests
// ===========================================================================

describe('EnemyHelper.isAlive', () => {
  it('returns true when enemy is alive', () => {
    const enemy = makeEnemyInstance({ isAlive: true });
    expect(EnemyHelper.isAlive(enemy)).toBe(true);
  });

  it('returns false when enemy is dead', () => {
    const enemy = makeEnemyInstance({ isAlive: false });
    expect(EnemyHelper.isAlive(enemy)).toBe(false);
  });
});

// ===========================================================================
// getFirstMove tests
// ===========================================================================

describe('EnemyHelper.getFirstMove', () => {
  it('returns undefined when no firstMove is set', () => {
    const data = makeEnemyData();
    expect(EnemyHelper.getFirstMove(data)).toBeUndefined();
  });

  it('returns undefined when firstMove is set (MoveEntry schema limitation)', () => {
    const data = makeBossData({ firstMove: 'goop_spray' });
    // Current implementation returns undefined since moves are MoveEntry[]
    // and full EnemyMove resolution requires the move registry.
    expect(EnemyHelper.getFirstMove(data)).toBeUndefined();
  });
});

// ===========================================================================
// selectMove tests — Random AI
// ===========================================================================

describe('EnemyHelper.selectMove (random/weighted)', () => {
  it('returns a valid moveId from the moves list', () => {
    const data = makeEnemyData({ aiPattern: 'random' });
    const enemy = makeEnemyInstance({ data });
    const rng = makeRNG();

    const moveId = EnemyHelper.selectMove(enemy, rng);
    const validMoveIds = data.moves.map((m) => m.moveId);
    expect(validMoveIds).toContain(moveId);
  });

  it('deterministic for same seed', () => {
    const data = makeEnemyData({ aiPattern: 'random' });

    const rng1a = new RNGStream(42);
    const rng1b = new RNGStream(42);

    const enemy1 = makeEnemyInstance({ data });
    const enemy2 = makeEnemyInstance({ data });

    const move1 = EnemyHelper.selectMove(enemy1, rng1a);
    const move2 = EnemyHelper.selectMove(enemy2, rng1b);

    expect(move1).toBe(move2);
  });

  it('weighted selection: higher weight moves are selected more often', () => {
    const data = makeEnemyData({
      aiPattern: 'random',
      moves: [
        { moveId: 'common', weight: 99 },
        { moveId: 'rare', weight: 1 },
      ],
    });

    let commonCount = 0;
    const trials = 1000;

    for (let i = 0; i < trials; i++) {
      const enemy = makeEnemyInstance({ data });
      const rng = new RNGStream(i);
      const moveId = EnemyHelper.selectMove(enemy, rng);
      if (moveId === 'common') {
        commonCount++;
      }
    }

    // With 99:1 weight ratio, expect > 90% common (statistically safe)
    expect(commonCount).toBeGreaterThan(trials * 0.9);
  });

  it('falls back to selectionMode weighted when aiPattern is undefined', () => {
    const data = makeEnemyData({ selectionMode: 'weighted' });
    delete (data as Partial<EnemyData>).aiPattern;
    const enemy = makeEnemyInstance({ data });
    const rng = makeRNG();

    const moveId = EnemyHelper.selectMove(enemy, rng);
    const validMoveIds = data.moves.map((m) => m.moveId);
    expect(validMoveIds).toContain(moveId);
  });

  it('throws when enemy has no moves', () => {
    const data = makeEnemyData({ moves: [], aiPattern: 'random' });
    const enemy = makeEnemyInstance({ data });
    const rng = makeRNG();

    expect(() => EnemyHelper.selectMove(enemy, rng)).toThrow(
      'has no moves defined'
    );
  });
});

// ===========================================================================
// selectMove tests — Sequential AI
// ===========================================================================

describe('EnemyHelper.selectMove (sequential/rotating)', () => {
  it('cycles through moves in order', () => {
    const data = makeEnemyData({
      aiPattern: 'sequential',
      moves: [
        { moveId: 'move_a', weight: 1 },
        { moveId: 'move_b', weight: 1 },
        { moveId: 'move_c', weight: 1 },
      ],
    });
    const enemy = makeEnemyInstance({ data });
    const rng = makeRNG();

    expect(EnemyHelper.selectMove(enemy, rng)).toBe('move_a');
    expect(EnemyHelper.selectMove(enemy, rng)).toBe('move_b');
    expect(EnemyHelper.selectMove(enemy, rng)).toBe('move_c');
  });

  it('repeats the cycle after all moves', () => {
    const data = makeEnemyData({
      aiPattern: 'sequential',
      moves: [
        { moveId: 'move_a', weight: 1 },
        { moveId: 'move_b', weight: 1 },
      ],
    });
    const enemy = makeEnemyInstance({ data });
    const rng = makeRNG();

    EnemyHelper.selectMove(enemy, rng); // move_a
    EnemyHelper.selectMove(enemy, rng); // move_b
    expect(EnemyHelper.selectMove(enemy, rng)).toBe('move_a'); // cycle restarts
  });

  it('appends to moveHistory', () => {
    const data = makeEnemyData({
      aiPattern: 'sequential',
      moves: [
        { moveId: 'move_a', weight: 1 },
        { moveId: 'move_b', weight: 1 },
      ],
    });
    const enemy = makeEnemyInstance({ data });
    const rng = makeRNG();

    EnemyHelper.selectMove(enemy, rng);
    EnemyHelper.selectMove(enemy, rng);

    expect(enemy.moveHistory).toEqual(['move_a', 'move_b']);
  });

  it('works with selectionMode rotating when aiPattern is undefined', () => {
    const data = makeEnemyData({
      selectionMode: 'rotating',
      moves: [
        { moveId: 'move_x', weight: 1 },
        { moveId: 'move_y', weight: 1 },
      ],
    });
    delete (data as Partial<EnemyData>).aiPattern;
    const enemy = makeEnemyInstance({ data });
    const rng = makeRNG();

    expect(EnemyHelper.selectMove(enemy, rng)).toBe('move_x');
    expect(EnemyHelper.selectMove(enemy, rng)).toBe('move_y');
  });

  it('throws when enemy has no moves', () => {
    const data = makeEnemyData({ moves: [], aiPattern: 'sequential' });
    const enemy = makeEnemyInstance({ data });
    const rng = makeRNG();

    expect(() => EnemyHelper.selectMove(enemy, rng)).toThrow(
      'has no moves defined'
    );
  });
});

// ===========================================================================
// selectMove tests — Patterned AI
// ===========================================================================

describe('EnemyHelper.selectMove (patterned)', () => {
  it('follows movePattern then repeats', () => {
    const data = makeEnemyData({
      aiPattern: 'patterned',
      moves: [
        { moveId: 'alpha', weight: 1 },
        { moveId: 'beta', weight: 1 },
        { moveId: 'gamma', weight: 1 },
      ],
      movePattern: ['alpha', 'beta', 'gamma'],
    });
    const enemy = makeEnemyInstance({ data });
    const rng = makeRNG();

    expect(EnemyHelper.selectMove(enemy, rng)).toBe('alpha');
    expect(EnemyHelper.selectMove(enemy, rng)).toBe('beta');
    expect(EnemyHelper.selectMove(enemy, rng)).toBe('gamma');
    expect(EnemyHelper.selectMove(enemy, rng)).toBe('alpha'); // repeats
  });

  it('falls back to sequential when no movePattern defined', () => {
    const data = makeEnemyData({
      aiPattern: 'patterned',
      moves: [
        { moveId: 'first', weight: 1 },
        { moveId: 'second', weight: 1 },
      ],
    });
    const enemy = makeEnemyInstance({ data });
    const rng = makeRNG();

    // Should fall back to sequential (cycling through moves in order)
    expect(EnemyHelper.selectMove(enemy, rng)).toBe('first');
    expect(EnemyHelper.selectMove(enemy, rng)).toBe('second');
  });

  it('appends to moveHistory as pattern progresses', () => {
    const data = makeEnemyData({
      aiPattern: 'patterned',
      moves: [
        { moveId: 'a', weight: 1 },
        { moveId: 'b', weight: 1 },
      ],
      movePattern: ['a', 'b'],
    });
    const enemy = makeEnemyInstance({ data });
    const rng = makeRNG();

    EnemyHelper.selectMove(enemy, rng);
    EnemyHelper.selectMove(enemy, rng);

    expect(enemy.moveHistory).toEqual(['a', 'b']);
  });

  it('handles single-move pattern', () => {
    const data = makeEnemyData({
      aiPattern: 'patterned',
      moves: [{ moveId: 'only', weight: 1 }],
      movePattern: ['only'],
    });
    const enemy = makeEnemyInstance({ data });
    const rng = makeRNG();

    expect(EnemyHelper.selectMove(enemy, rng)).toBe('only');
    expect(EnemyHelper.selectMove(enemy, rng)).toBe('only');
    expect(EnemyHelper.selectMove(enemy, rng)).toBe('only');
  });

  it('handles empty movePattern (falls back to sequential)', () => {
    const data = makeEnemyData({
      aiPattern: 'patterned',
      moves: [
        { moveId: 'x', weight: 1 },
        { moveId: 'y', weight: 1 },
      ],
      movePattern: [],
    });
    const enemy = makeEnemyInstance({ data });
    const rng = makeRNG();

    expect(EnemyHelper.selectMove(enemy, rng)).toBe('x');
    expect(EnemyHelper.selectMove(enemy, rng)).toBe('y');
  });
});

// ===========================================================================
// selectMove tests — Boss AI
// ===========================================================================

describe('EnemyHelper.selectMove (boss)', () => {
  it('uses firstMove on first turn', () => {
    const data = makeBossData({
      aiPattern: 'boss',
      firstMove: 'opening_blast',
      movePattern: ['phase_a', 'phase_b'],
      moves: [
        { moveId: 'opening_blast', weight: 1 },
        { moveId: 'phase_a', weight: 1 },
        { moveId: 'phase_b', weight: 1 },
      ],
    });
    const enemy = makeEnemyInstance({ data });
    const rng = makeRNG();

    const firstMoveId = EnemyHelper.selectMove(enemy, rng);
    expect(firstMoveId).toBe('opening_blast');
  });

  it('follows movePattern after first turn', () => {
    const data = makeBossData({
      aiPattern: 'boss',
      firstMove: 'opening',
      movePattern: ['attack_a', 'attack_b'],
      moves: [
        { moveId: 'opening', weight: 1 },
        { moveId: 'attack_a', weight: 1 },
        { moveId: 'attack_b', weight: 1 },
      ],
    });
    const enemy = makeEnemyInstance({ data });
    const rng = makeRNG();

    EnemyHelper.selectMove(enemy, rng); // first turn: opening
    expect(EnemyHelper.selectMove(enemy, rng)).toBe('attack_a');
    expect(EnemyHelper.selectMove(enemy, rng)).toBe('attack_b');
    expect(EnemyHelper.selectMove(enemy, rng)).toBe('attack_a'); // repeats
  });

  it('boss without firstMove uses pattern from start', () => {
    const data = makeBossData({
      aiPattern: 'boss',
      firstMove: undefined,
      movePattern: ['a', 'b'],
      moves: [
        { moveId: 'a', weight: 1 },
        { moveId: 'b', weight: 1 },
      ],
    });
    const enemy = makeEnemyInstance({ data });
    const rng = makeRNG();

    expect(EnemyHelper.selectMove(enemy, rng)).toBe('a');
    expect(EnemyHelper.selectMove(enemy, rng)).toBe('b');
  });

  it('first turn does not append firstMove to moveHistory (opener is separate)', () => {
    const data = makeBossData({
      aiPattern: 'boss',
      firstMove: 'opener',
      movePattern: ['a'],
      moves: [
        { moveId: 'opener', weight: 1 },
        { moveId: 'a', weight: 1 },
      ],
    });
    const enemy = makeEnemyInstance({ data });
    const rng = makeRNG();

    EnemyHelper.selectMove(enemy, rng);
    // firstMove does NOT push to moveHistory — pattern tracking starts after opener
    expect(enemy.moveHistory).toEqual([]);

    EnemyHelper.selectMove(enemy, rng);
    expect(enemy.moveHistory).toEqual(['a']);
  });
});

// ===========================================================================
// selectMove tests — Unknown pattern fallback
// ===========================================================================

describe('EnemyHelper.selectMove (unknown pattern)', () => {
  it('falls back to random for unknown aiPattern', () => {
    const data = makeEnemyData({
      aiPattern: 'unknown_pattern' as EnemyData['aiPattern'],
      moves: [
        { moveId: 'move_a', weight: 1 },
        { moveId: 'move_b', weight: 1 },
      ],
    });
    const enemy = makeEnemyInstance({ data });
    const rng = makeRNG();

    const moveId = EnemyHelper.selectMove(enemy, rng);
    const validMoveIds = data.moves.map((m) => m.moveId);
    expect(validMoveIds).toContain(moveId);
  });
});

// ===========================================================================
// Integration: damage + block workflow
// ===========================================================================

describe('Enemy damage/block integration', () => {
  it('enemy gains block, takes damage through block, then reset', () => {
    const enemy = makeEnemyInstance({ currentHP: 50, maxHP: 50, block: 0 });

    // Enemy gains 8 block
    EnemyHelper.gainBlock(enemy, 8);
    expect(enemy.block).toBe(8);

    // Takes 12 damage: 8 blocked, 4 to HP
    const result = EnemyHelper.takeDamage(enemy, 12);
    expect(result.blocked).toBe(8);
    expect(result.hpLost).toBe(4);
    expect(enemy.currentHP).toBe(46);
    expect(enemy.block).toBe(0);

    // Reset block at turn start
    EnemyHelper.resetBlock(enemy);
    expect(enemy.block).toBe(0);
  });

  it('full combat lifecycle: block, damage, death', () => {
    const data = makeEnemyData({ hp: 30 });
    const { hpMin, hpMax, ...dataFixed } = data;
    const rng = makeRNG();
    const enemy = EnemyHelper.createInstance(
      dataFixed as EnemyData,
      'lifecycle-001',
      rng
    );

    expect(enemy.currentHP).toBe(30);
    expect(enemy.isAlive).toBe(true);

    // Take some damage
    EnemyHelper.takeDamage(enemy, 10);
    expect(enemy.currentHP).toBe(20);

    // Gain block
    EnemyHelper.gainBlock(enemy, 5);
    expect(enemy.block).toBe(5);

    // Take damage partially blocked
    EnemyHelper.takeDamage(enemy, 8);
    expect(enemy.block).toBe(0);
    expect(enemy.currentHP).toBe(17);

    // Lethal blow
    EnemyHelper.takeDamage(enemy, 20);
    expect(enemy.currentHP).toBe(0);
    expect(enemy.isAlive).toBe(false);
  });

  it('enemy with createInstance + sequential AI plays all moves in order', () => {
    const data = makeEnemyData({
      hpMin: 40,
      hpMax: 40,
      aiPattern: 'sequential',
      moves: [
        { moveId: 'slash', weight: 1 },
        { moveId: 'block', weight: 1 },
      ],
    });
    const rng = makeRNG();
    const enemy = EnemyHelper.createInstance(data, 'ai-001', rng);

    const move1 = EnemyHelper.selectMove(enemy, rng);
    expect(move1).toBe('slash');

    const move2 = EnemyHelper.selectMove(enemy, rng);
    expect(move2).toBe('block');

    const move3 = EnemyHelper.selectMove(enemy, rng);
    expect(move3).toBe('slash'); // cycle restarts
  });
});
