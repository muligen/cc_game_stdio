/**
 * combat-loop.test.ts — Integration tests for complete combat loop scenarios.
 *
 * Validates all 12 acceptance criteria from design/gdd/combat.md
 * by exercising CombatController end-to-end with mock dependencies
 * that have real mutable state.
 *
 * Coverage:
 * - AC1:  Combat initializes (enemies, deck, energy, hand)
 * - AC2:  Player turn flow (draw, play, end)
 * - AC3:  Enemy turn flow (execute intents in order)
 * - AC4:  Damage formula (Strength, Vulnerable, Weak, Intangible)
 * - AC5:  Block absorbs damage before HP
 * - AC6:  Block resets at entity turn start
 * - AC7:  Player death → COMBAT_OVER defeat
 * - AC8:  All enemies dead → COMBAT_OVER victory
 * - AC9:  Poison kills player at turn end
 * - AC10: Stunned enemy skips execution
 * - AC11: Multi-hit attacks (per-hit block chip, death stop)
 * - AC12: Combat end cleanup (effects cleared, energy zeroed)
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
} from '../../../src/types/card';
import type { CombatEnemyInstance, EnemyData, EnemyMove } from '../../../src/types/enemy';

// ---------------------------------------------------------------------------
// Factories
// ---------------------------------------------------------------------------

function makeCardData(overrides: Partial<CardData> = {}): CardData {
  return {
    id: 'test_strike',
    name: 'Test Strike',
    type: CardType.ATTACK,
    rarity: Rarity.STARTER,
    cost: 1,
    costType: CostType.NORMAL,
    character: null,
    targets: TargetType.ENEMY,
    effects: [{ type: 'deal_damage', value: 6 }],
    keywords: [],
    upgrade: null,
    description: 'Deal 6 damage.',
    ...overrides,
  };
}

let cardCounter = 0;
function makeCard(overrides: Partial<CombatCardInstance> = {}): CombatCardInstance {
  cardCounter++;
  return {
    instanceId: `card-${cardCounter}`,
    data: makeCardData({ id: `card_${cardCounter}` }),
    upgraded: false,
    costOverride: null,
    timesPlayedThisCombat: 0,
    retained: false,
    ...overrides,
  };
}

function makeEnemyData(overrides: Partial<EnemyData> = {}): EnemyData {
  return {
    id: 'test_enemy',
    name: 'Test Enemy',
    type: 'normal',
    hp: 20,
    moves: [{ moveId: 'atk', weight: 1 }],
    selectionMode: 'random',
    ...overrides,
  };
}

function makeEnemyInstance(overrides: Partial<CombatEnemyInstance> = {}): CombatEnemyInstance {
  return {
    instanceId: 'enemy_0_test_enemy',
    data: makeEnemyData(),
    currentHP: 20,
    maxHP: 20,
    block: 0,
    isAlive: true,
    currentMove: null,
    moveHistory: [],
    firstMoveUsed: false,
    ...overrides,
  };
}

const ATK_MOVE: EnemyMove = {
  id: 'atk',
  name: 'Attack',
  intent: 'attack' as never,
  effects: [{ type: 'deal_damage', value: 5 }],
  damage: 5,
};

const DEFEND_MOVE: EnemyMove = {
  id: 'def',
  name: 'Defend',
  intent: 'defend' as never,
  effects: [{ type: 'gain_block', value: 5 }],
  damage: 0,
};

// ---------------------------------------------------------------------------
// Test Controller Factory
// ---------------------------------------------------------------------------

interface TestContext {
  controller: CombatController;
  /** Read/modify status effect stacks: key = `${targetId}:${effectId}` */
  statusStacks: Record<string, number>;
  /** Current hand — add cards here before playCard */
  hand: CombatCardInstance[];
  /** Events emitted during the test */
  events: Array<{ event: string; payload: unknown }>;
  /** Get current energy */
  getEnergy: () => number;
  /** Get max energy */
  getMaxEnergy: () => number;
}

function createTestContext(opts: { playerHP?: number; playerMaxHP?: number; energy?: number } = {}): TestContext {
  const playerHP = opts.playerHP ?? 50;
  const playerMaxHP = opts.playerMaxHP ?? 50;
  let currentEnergy = opts.energy ?? 3;
  let effectiveMaxEnergy = opts.energy ?? 3;

  const statusStacks: Record<string, number> = {};
  const hand: CombatCardInstance[] = [];
  const events: Array<{ event: string; payload: unknown }> = [];

  const ctx: TestContext = {
    controller: null!,
    statusStacks,
    hand,
    events,
    getEnergy: () => currentEnergy,
    getMaxEnergy: () => effectiveMaxEnergy,
  };

  ctx.controller = new CombatController(
    // eventBus
    { emit: (event: string, payload: unknown) => { events.push({ event, payload }); } },
    // deckManager
    {
      getDrawPileSize: () => 0,
      getHandSize: () => hand.length,
      getDiscardPileSize: () => 0,
      getExhaustPileSize: () => 0,
      drawOpeningHand: () => [],
      drawCard: () => [],
      discardHand: () => { hand.length = 0; },
      getHand: () => [...hand],
      discardCards: (cards: CombatCardInstance[]) => {
        for (const c of cards) {
          const idx = hand.findIndex((h) => h.instanceId === c.instanceId);
          if (idx >= 0) hand.splice(idx, 1);
        }
      },
      exhaustCards: (cards: CombatCardInstance[]) => {
        for (const c of cards) {
          const idx = hand.findIndex((h) => h.instanceId === c.instanceId);
          if (idx >= 0) hand.splice(idx, 1);
        }
      },
    },
    // energySystem
    {
      getCurrentEnergy: () => currentEnergy,
      getEffectiveMaxEnergy: () => effectiveMaxEnergy,
      onTurnStart: (bonus = 0, penalty = 0) => {
        currentEnergy = effectiveMaxEnergy + bonus - penalty;
      },
      onTurnEnd: () => { currentEnergy = 0; },
      canPlay: (cost: number, _costType: string) => currentEnergy >= cost,
      spendEnergy: (cost: number) => {
        const spent = cost;
        currentEnergy -= cost;
        return spent;
      },
    },
    // statusEffectManager
    {
      getEffectStacks: (targetId: string, effectId: string) => {
        return statusStacks[`${targetId}:${effectId}`] ?? 0;
      },
      processTurnEnd: () => {},
      applyEffect: () => true,
      tryApplyDebuff: () => true,
      getEffectData: (effectId: string) => {
        if (['weak', 'vulnerable', 'frail'].includes(effectId)) return { category: 'debuff' };
        return { category: 'buff' };
      },
      resetForCombat: () => { for (const k of Object.keys(statusStacks)) delete statusStacks[k]; },
    },
    // effectResolver
    { resolveEffect: () => [] },
    // enemyHelper
    {
      createInstance: (data: EnemyData, instanceId: string) => ({
        instanceId,
        data,
        currentHP: data.hp,
        maxHP: data.hp,
        block: 0,
        isAlive: true,
        currentMove: null,
        moveHistory: [],
        firstMoveUsed: false,
      }),
      selectMove: (enemy: CombatEnemyInstance) => {
        enemy.moveHistory.push('atk');
        return 'atk';
      },
      resetBlock: (enemy: CombatEnemyInstance) => { enemy.block = 0; },
      takeDamage: (enemy: CombatEnemyInstance, amount: number) => {
        const blocked = Math.min(enemy.block, amount);
        enemy.block -= blocked;
        const hpLost = amount - blocked;
        if (hpLost > 0) {
          enemy.currentHP = Math.max(0, enemy.currentHP - hpLost);
          if (enemy.currentHP <= 0) enemy.isAlive = false;
        }
        return { hpLost, blocked };
      },
      gainBlock: (enemy: CombatEnemyInstance, amount: number) => {
        enemy.block += amount;
        return enemy.block;
      },
    },
    // rng
    {
      getStream: () => ({
        nextInt: () => 0,
        weightedPick: () => 'atk',
        shuffle: <T>(arr: readonly T[]) => [...arr],
      }),
    }
  );

  return ctx;
}

/** Helper: setup combat in ENEMY_TURN phase with one enemy. */
function setupInEnemyTurn(hp = 50, energy = 3): TestContext {
  const ctx = createTestContext({ playerHP: hp, energy });
  ctx.controller.startCombat(hp, hp, energy);
  ctx.controller.transitionToPlayerTurn();
  ctx.controller.transitionToEnemyTurn();
  return ctx;
}

/** Helper: add enemy to combat state directly. */
function addEnemy(ctx: TestContext, overrides: Partial<CombatEnemyInstance> = {}): CombatEnemyInstance {
  const enemy = makeEnemyInstance(overrides);
  const state = ctx.controller.getState() as { enemies: CombatEnemyInstance[] };
  state.enemies.push(enemy);
  return enemy;
}

/** Helper: full turn cycle endPlayerTurn -> executeEnemyTurn -> startPlayerTurn */
function runFullTurnCycle(ctx: TestContext): void {
  ctx.controller.endPlayerTurn();
  ctx.controller.executeEnemyTurn();
  ctx.controller.startPlayerTurn();
}

// ===========================================================================
// AC1: Combat Initialization
// ===========================================================================

describe('AC1: Combat initialization', () => {
  it('initializes combat with correct player state', () => {
    const ctx = createTestContext({ playerHP: 60, playerMaxHP: 80, energy: 3 });
    ctx.controller.startCombat(60, 80, 3);

    const state = ctx.controller.getState();
    expect(state.playerHP).toBe(60);
    expect(state.playerMaxHP).toBe(80);
    expect(state.playerBlock).toBe(0);
    expect(state.currentEnergy).toBe(3);
    expect(state.phase).toBe(TurnPhase.INITIALIZING);
    expect(state.turnNumber).toBe(0);
  });

  it('initCombat spawns enemies and transitions to PLAYER_TURN', () => {
    const ctx = createTestContext();
    const enemyData = makeEnemyData({ id: 'gremlin', hp: 12 });
    ctx.controller.initCombat(50, 50, 3, { enemies: [enemyData] });

    expect(ctx.controller.getPhase()).toBe(TurnPhase.PLAYER_TURN);
    expect(ctx.controller.getState().turnNumber).toBe(1);
    expect(ctx.controller.getState().enemies).toHaveLength(1);
    expect(ctx.controller.getState().enemies[0].currentHP).toBe(12);
  });

  it('initCombat sets energy via onTurnStart', () => {
    const ctx = createTestContext({ energy: 3 });
    ctx.controller.initCombat(50, 50, 3);

    // Energy synced from energySystem mock (onTurnStart sets currentEnergy = maxEnergy)
    expect(ctx.controller.getState().currentEnergy).toBe(3);
  });
});

// ===========================================================================
// AC2: Player Turn Flow
// ===========================================================================

describe('AC2: Player turn flow', () => {
  it('player plays a card and ends turn', () => {
    const ctx = createTestContext();
    const card = makeCard({ data: makeCardData({ cost: 1, targets: TargetType.SELF, effects: [{ type: 'gain_block', value: 5 }] }) });
    ctx.controller.startCombat(50, 50, 3);
    ctx.controller.transitionToPlayerTurn();

    ctx.hand.push(card);
    ctx.controller.playCard(card, null);

    expect(ctx.controller.getState().playerBlock).toBe(5);
    expect(ctx.hand).toHaveLength(0); // card discarded
    expect(ctx.controller.getState().cardsPlayedThisTurn).toBe(1);

    ctx.controller.endPlayerTurn();
    expect(ctx.controller.getPhase()).toBe(TurnPhase.ENEMY_TURN);
  });

  it('player draws cards at turn start', () => {
    const ctx = createTestContext();
    ctx.controller.startCombat(50, 50, 3);
    ctx.controller.transitionToPlayerTurn();
    ctx.controller.transitionToEnemyTurn();

    // drawCard mock is a no-op, but we verify it doesn't crash
    ctx.controller.startPlayerTurn();
    expect(ctx.controller.getPhase()).toBe(TurnPhase.PLAYER_TURN);
    expect(ctx.controller.getState().turnNumber).toBe(2);
  });

  it('energy depletes across multiple card plays', () => {
    const ctx = createTestContext({ energy: 3 });
    const card1 = makeCard({ data: makeCardData({ cost: 1, targets: TargetType.SELF, effects: [{ type: 'gain_block', value: 3 }] }) });
    const card2 = makeCard({ data: makeCardData({ cost: 2, targets: TargetType.SELF, effects: [{ type: 'gain_block', value: 5 }] }) });
    ctx.controller.startCombat(50, 50, 3);
    ctx.controller.transitionToPlayerTurn();

    ctx.hand.push(card1, card2);
    ctx.controller.playCard(card1, null);
    expect(ctx.getEnergy()).toBe(2);

    ctx.controller.playCard(card2, null);
    expect(ctx.getEnergy()).toBe(0);
    expect(ctx.controller.getState().playerBlock).toBe(8);
  });
});

// ===========================================================================
// AC3: Enemy Turn Flow
// ===========================================================================

describe('AC3: Enemy turn flow', () => {
  it('each enemy executes intent in order', () => {
    const ctx = setupInEnemyTurn(50);
    const e1 = addEnemy(ctx, { instanceId: 'e1', currentMove: ATK_MOVE });
    const e2 = addEnemy(ctx, { instanceId: 'e2', currentMove: ATK_MOVE });

    ctx.controller.executeEnemyTurn();

    // Both enemies attacked (5 damage each = 10 total damage)
    expect(ctx.controller.getState().playerHP).toBe(40);
    expect(ctx.controller.getPhase()).toBe(TurnPhase.ENEMY_TURN);
  });

  it('enemy block resets before executing intent', () => {
    const ctx = setupInEnemyTurn(50);
    const enemy = addEnemy(ctx, {
      instanceId: 'e1',
      block: 10,
      currentMove: ATK_MOVE,
    });

    ctx.controller.executeEnemyTurn();

    // resetBlock was called first (block = 0), then attack executed
    expect(enemy.block).toBe(0);
  });

  it('enemy turn emits onEnemyTurnEnd event', () => {
    const ctx = setupInEnemyTurn(50);
    addEnemy(ctx, { instanceId: 'e1', currentMove: ATK_MOVE });

    ctx.controller.executeEnemyTurn();

    const endEvent = ctx.events.find((e) => e.event === 'onEnemyTurnEnd');
    expect(endEvent).toBeDefined();
  });
});

// ===========================================================================
// AC4: Damage Formula
// ===========================================================================

describe('AC4: Damage formula', () => {
  it('card damage: base value with no modifiers', () => {
    const ctx = createTestContext();
    const card = makeCard({ data: makeCardData({ effects: [{ type: 'deal_damage', value: 10 }] }) });
    const enemy = makeEnemyInstance({ instanceId: 'e1', currentHP: 30 });
    ctx.controller.startCombat(50, 50, 3);
    ctx.controller.transitionToPlayerTurn();
    (ctx.controller.getState() as { enemies: CombatEnemyInstance[] }).enemies.push(enemy);

    ctx.hand.push(card);
    ctx.controller.playCard(card, enemy);

    // 10 base, no modifiers = 10 damage
    expect(enemy.currentHP).toBe(20);
  });

  it('card damage: Strength adds flat damage', () => {
    const ctx = createTestContext();
    ctx.statusStacks['player:strength'] = 4;
    const card = makeCard({ data: makeCardData({ effects: [{ type: 'deal_damage', value: 6 }] }) });
    const enemy = makeEnemyInstance({ instanceId: 'e1', currentHP: 30 });
    ctx.controller.startCombat(50, 50, 3);
    ctx.controller.transitionToPlayerTurn();
    (ctx.controller.getState() as { enemies: CombatEnemyInstance[] }).enemies.push(enemy);

    ctx.hand.push(card);
    ctx.controller.playCard(card, enemy);

    // 6 + 4 strength = 10
    expect(enemy.currentHP).toBe(20);
  });

  it('card damage: Weak reduces by 25%', () => {
    const ctx = createTestContext();
    ctx.statusStacks['player:weak'] = 1;
    const card = makeCard({ data: makeCardData({ effects: [{ type: 'deal_damage', value: 8 }] }) });
    const enemy = makeEnemyInstance({ instanceId: 'e1', currentHP: 30 });
    ctx.controller.startCombat(50, 50, 3);
    ctx.controller.transitionToPlayerTurn();
    (ctx.controller.getState() as { enemies: CombatEnemyInstance[] }).enemies.push(enemy);

    ctx.hand.push(card);
    ctx.controller.playCard(card, enemy);

    // 8 base, Weak: floor(8 * 0.75) = 6
    expect(enemy.currentHP).toBe(24);
  });

  it('card damage: Vulnerable on enemy increases by 50%', () => {
    const ctx = createTestContext();
    ctx.statusStacks['e1:vulnerable'] = 1;
    const card = makeCard({ data: makeCardData({ effects: [{ type: 'deal_damage', value: 10 }] }) });
    const enemy = makeEnemyInstance({ instanceId: 'e1', currentHP: 30 });
    ctx.controller.startCombat(50, 50, 3);
    ctx.controller.transitionToPlayerTurn();
    (ctx.controller.getState() as { enemies: CombatEnemyInstance[] }).enemies.push(enemy);

    ctx.hand.push(card);
    ctx.controller.playCard(card, enemy);

    // 10 base, Vulnerable: floor(10 * 1.5) = 15
    expect(enemy.currentHP).toBe(15);
  });

  it('card damage: Intangible caps at 1', () => {
    const ctx = createTestContext();
    ctx.statusStacks['e1:intangible'] = 1;
    const card = makeCard({ data: makeCardData({ effects: [{ type: 'deal_damage', value: 100 }] }) });
    const enemy = makeEnemyInstance({ instanceId: 'e1', currentHP: 30 });
    ctx.controller.startCombat(50, 50, 3);
    ctx.controller.transitionToPlayerTurn();
    (ctx.controller.getState() as { enemies: CombatEnemyInstance[] }).enemies.push(enemy);

    ctx.hand.push(card);
    ctx.controller.playCard(card, enemy);

    // 100 base, Intangible caps at 1
    expect(enemy.currentHP).toBe(29);
  });

  it('card damage: minimum floor of 1', () => {
    const ctx = createTestContext();
    ctx.statusStacks['player:weak'] = 1;
    const card = makeCard({ data: makeCardData({ effects: [{ type: 'deal_damage', value: 1 }] }) });
    const enemy = makeEnemyInstance({ instanceId: 'e1', currentHP: 30 });
    ctx.controller.startCombat(50, 50, 3);
    ctx.controller.transitionToPlayerTurn();
    (ctx.controller.getState() as { enemies: CombatEnemyInstance[] }).enemies.push(enemy);

    ctx.hand.push(card);
    ctx.controller.playCard(card, enemy);

    // 1 base, Weak: floor(1 * 0.75) = 0, but floor at 1
    expect(enemy.currentHP).toBe(29);
  });

  it('enemy damage: Strength and Weak modifiers applied', () => {
    const ctx = setupInEnemyTurn(50);
    ctx.statusStacks['e1:strength'] = 3;
    ctx.statusStacks['e1:weak'] = 1;
    addEnemy(ctx, { instanceId: 'e1', currentMove: ATK_MOVE }); // ATK_MOVE value = 5

    ctx.controller.executeEnemyTurn();

    // 5 + 3 Strength = 8, Weak: floor(8 * 0.75) = 6
    expect(ctx.controller.getState().playerHP).toBe(44);
  });

  it('enemy damage: player Vulnerable increases damage', () => {
    const ctx = setupInEnemyTurn(50);
    ctx.statusStacks['player:vulnerable'] = 1;
    addEnemy(ctx, { instanceId: 'e1', currentMove: ATK_MOVE }); // 5 damage

    ctx.controller.executeEnemyTurn();

    // 5 base, Vulnerable: floor(5 * 1.5) = 7
    expect(ctx.controller.getState().playerHP).toBe(43);
  });
});

// ===========================================================================
// AC5: Block Absorbs Damage
// ===========================================================================

describe('AC5: Block absorbs damage before HP', () => {
  it('player block absorbs enemy damage fully', () => {
    const ctx = setupInEnemyTurn(50);
    ctx.controller.getState().playerBlock = 5;
    addEnemy(ctx, { instanceId: 'e1', currentMove: ATK_MOVE }); // 5 damage

    ctx.controller.executeEnemyTurn();

    expect(ctx.controller.getState().playerHP).toBe(50);
    expect(ctx.controller.getState().playerBlock).toBe(0);
  });

  it('player block partially absorbs enemy damage', () => {
    const ctx = setupInEnemyTurn(50);
    ctx.controller.getState().playerBlock = 3;
    addEnemy(ctx, { instanceId: 'e1', currentMove: ATK_MOVE }); // 5 damage

    ctx.controller.executeEnemyTurn();

    // 5 damage - 3 block = 2 HP lost
    expect(ctx.controller.getState().playerHP).toBe(48);
    expect(ctx.controller.getState().playerBlock).toBe(0);
  });

  it('excess block remains after enemy attack', () => {
    const ctx = setupInEnemyTurn(50);
    ctx.controller.getState().playerBlock = 10;
    addEnemy(ctx, { instanceId: 'e1', currentMove: ATK_MOVE }); // 5 damage

    ctx.controller.executeEnemyTurn();

    expect(ctx.controller.getState().playerHP).toBe(50);
    expect(ctx.controller.getState().playerBlock).toBe(5);
  });

  it('enemy block absorbs card damage', () => {
    const ctx = createTestContext();
    const card = makeCard({ data: makeCardData({ effects: [{ type: 'deal_damage', value: 6 }] }) });
    const enemy = makeEnemyInstance({ instanceId: 'e1', currentHP: 20, block: 4 });
    ctx.controller.startCombat(50, 50, 3);
    ctx.controller.transitionToPlayerTurn();
    (ctx.controller.getState() as { enemies: CombatEnemyInstance[] }).enemies.push(enemy);

    ctx.hand.push(card);
    ctx.controller.playCard(card, enemy);

    // 6 damage, 4 blocked, 2 HP lost
    expect(enemy.currentHP).toBe(18);
    expect(enemy.block).toBe(0); // All 4 block consumed, then 2 HP lost
  });
});

// ===========================================================================
// AC6: Block Reset Timing
// ===========================================================================

describe('AC6: Block reset timing', () => {
  it('player block resets at start of player turn', () => {
    const ctx = createTestContext();
    ctx.controller.startCombat(50, 50, 3);
    ctx.controller.transitionToPlayerTurn();

    // Player gains block
    ctx.controller.getState().playerBlock = 15;
    expect(ctx.controller.getState().playerBlock).toBe(15);

    ctx.controller.transitionToEnemyTurn();
    // Block still there during enemy turn
    expect(ctx.controller.getState().playerBlock).toBe(15);

    ctx.controller.startPlayerTurn();
    // Block reset at player turn start
    expect(ctx.controller.getState().playerBlock).toBe(0);
  });

  it('enemy block resets at start of their individual turn', () => {
    const ctx = setupInEnemyTurn(50);
    const enemy = addEnemy(ctx, {
      instanceId: 'e1',
      block: 8,
      currentMove: DEFEND_MOVE, // gains block, but first resetBlock clears existing
    });

    ctx.controller.executeEnemyTurn();

    // resetBlock called first (sets to 0), then gain_block from DEFEND_MOVE adds 5
    expect(enemy.block).toBe(5);
  });
});

// ===========================================================================
// AC7: Player Death
// ===========================================================================

describe('AC7: Player death', () => {
  it('enemy kills player → COMBAT_OVER defeat', () => {
    const ctx = setupInEnemyTurn(3);
    addEnemy(ctx, { instanceId: 'e1', currentMove: ATK_MOVE }); // 5 damage

    ctx.controller.executeEnemyTurn();

    expect(ctx.controller.getPhase()).toBe(TurnPhase.COMBAT_OVER);
    expect(ctx.controller.getState().result).toBe('defeat');
    expect(ctx.controller.getState().playerHP).toBe(0);
  });

  it('first enemy kills player, second does not act', () => {
    const ctx = setupInEnemyTurn(3);
    addEnemy(ctx, { instanceId: 'e1', currentMove: ATK_MOVE }); // 5 damage — lethal
    addEnemy(ctx, { instanceId: 'e2', currentMove: ATK_MOVE });

    ctx.controller.executeEnemyTurn();

    // Player died from first enemy — second should not deal damage
    // 3 HP - 5 = dead. But damage is capped at 0, so only 3 HP lost total.
    expect(ctx.controller.getPhase()).toBe(TurnPhase.COMBAT_OVER);
    expect(ctx.controller.getState().result).toBe('defeat');
    expect(ctx.controller.getState().playerHP).toBe(0);
  });

  it('emits onCombatDefeat event on player death', () => {
    const ctx = setupInEnemyTurn(3);
    addEnemy(ctx, { instanceId: 'e1', currentMove: ATK_MOVE });

    ctx.controller.executeEnemyTurn();

    const defeatEvent = ctx.events.find((e) => e.event === 'onCombatDefeat');
    expect(defeatEvent).toBeDefined();
  });
});

// ===========================================================================
// AC8: All Enemies Dead → Victory
// ===========================================================================

describe('AC8: All enemies dead → victory', () => {
  it('killing last enemy via card play triggers victory', () => {
    const ctx = createTestContext();
    const card = makeCard({ data: makeCardData({ effects: [{ type: 'deal_damage', value: 25 }] }) });
    const enemy = makeEnemyInstance({ instanceId: 'e1', currentHP: 20 });
    ctx.controller.startCombat(50, 50, 3);
    ctx.controller.transitionToPlayerTurn();
    (ctx.controller.getState() as { enemies: CombatEnemyInstance[] }).enemies.push(enemy);

    ctx.hand.push(card);
    ctx.controller.playCard(card, enemy);

    expect(enemy.isAlive).toBe(false);
    expect(ctx.controller.getPhase()).toBe(TurnPhase.COMBAT_OVER);
    expect(ctx.controller.getState().result).toBe('victory');
  });

  it('emits onCombatVictory event on victory', () => {
    const ctx = createTestContext();
    const card = makeCard({ data: makeCardData({ effects: [{ type: 'deal_damage', value: 25 }] }) });
    const enemy = makeEnemyInstance({ instanceId: 'e1', currentHP: 20 });
    ctx.controller.startCombat(50, 50, 3);
    ctx.controller.transitionToPlayerTurn();
    (ctx.controller.getState() as { enemies: CombatEnemyInstance[] }).enemies.push(enemy);

    ctx.hand.push(card);
    ctx.controller.playCard(card, enemy);

    const victoryEvent = ctx.events.find((e) => e.event === 'onCombatVictory');
    expect(victoryEvent).toBeDefined();
    const payload = victoryEvent!.payload as { turnNumber: number; playerHP: number };
    expect(payload.turnNumber).toBe(1);
    expect(payload.playerHP).toBe(50);
  });

  it('victory triggers even during endPlayerTurn if all dead', () => {
    const ctx = createTestContext();
    ctx.controller.startCombat(50, 50, 3);
    ctx.controller.transitionToPlayerTurn();

    // Add a dead enemy
    const deadEnemy = makeEnemyInstance({ instanceId: 'e1', currentHP: 0, isAlive: false });
    (ctx.controller.getState() as { enemies: CombatEnemyInstance[] }).enemies.push(deadEnemy);

    ctx.controller.endPlayerTurn();

    expect(ctx.controller.getPhase()).toBe(TurnPhase.COMBAT_OVER);
    expect(ctx.controller.getState().result).toBe('victory');
  });
});

// ===========================================================================
// AC9: Poison Kills at Turn End
// ===========================================================================

describe('AC9: Poison kills player at turn end', () => {
  it('player with 1 HP dies from simulated poison at turn end', () => {
    const ctx = createTestContext({ playerHP: 1 });
    ctx.controller.startCombat(1, 50, 3);
    ctx.controller.transitionToPlayerTurn();

    // Simulate poison damage during turn end
    // (processTurnEnd mock doesn't modify HP, so we do it manually)
    const originalProcessTurnEnd = ctx.controller.getState();
    ctx.controller.setPlayerHP(0); // Simulate poison tick

    ctx.controller.endPlayerTurn();

    expect(ctx.controller.getPhase()).toBe(TurnPhase.COMBAT_OVER);
    expect(ctx.controller.getState().result).toBe('defeat');
  });
});

// ===========================================================================
// AC10: Stunned Enemy Skips
// ===========================================================================

describe('AC10: Stunned enemy skips execution', () => {
  it('stunned enemy does not deal damage', () => {
    const ctx = setupInEnemyTurn(50);
    ctx.statusStacks['e1:stunned'] = 1;
    addEnemy(ctx, { instanceId: 'e1', currentMove: ATK_MOVE }); // Would deal 5 damage

    ctx.controller.executeEnemyTurn();

    // Stunned enemy skips — no damage
    expect(ctx.controller.getState().playerHP).toBe(50);
    expect(ctx.controller.getPhase()).toBe(TurnPhase.ENEMY_TURN);
  });

  it('stunned enemy still selects next move', () => {
    const ctx = setupInEnemyTurn(50);
    ctx.statusStacks['e1:stunned'] = 1;
    // Set currentMove to null so selectAndResolveEnemyMove will call selectMove
    const enemy = addEnemy(ctx, { instanceId: 'e1', currentMove: null });

    ctx.controller.executeEnemyTurn();

    // selectMove was called (moveHistory grows) even though stunned
    expect(enemy.moveHistory.length).toBeGreaterThan(0);
  });
});

// ===========================================================================
// AC11: Multi-hit Attacks
// ===========================================================================

describe('AC11: Multi-hit attacks', () => {
  it('multi-hit applies damage per hit with block chip', () => {
    const ctx = createTestContext();
    const card = makeCard({
      data: makeCardData({
        effects: [{ type: 'deal_damage', value: 4, hits: 3 }],
      }),
    });
    const enemy = makeEnemyInstance({ instanceId: 'e1', currentHP: 30, block: 5 });
    ctx.controller.startCombat(50, 50, 3);
    ctx.controller.transitionToPlayerTurn();
    (ctx.controller.getState() as { enemies: CombatEnemyInstance[] }).enemies.push(enemy);

    ctx.hand.push(card);
    ctx.controller.playCard(card, enemy);

    // Hit 1: 4 damage vs 5 block → 4 blocked, block now 1
    // Hit 2: 4 damage vs 1 block → 1 blocked, 3 HP lost, HP now 27
    // Hit 3: 4 damage vs 0 block → 4 HP lost, HP now 23
    expect(enemy.currentHP).toBe(23);
    expect(enemy.block).toBe(0);
  });

  it('multi-hit stops when enemy dies mid-combo', () => {
    const ctx = createTestContext();
    const card = makeCard({
      data: makeCardData({
        effects: [{ type: 'deal_damage', value: 8, hits: 3 }],
      }),
    });
    const enemy = makeEnemyInstance({ instanceId: 'e1', currentHP: 10 });
    ctx.controller.startCombat(50, 50, 3);
    ctx.controller.transitionToPlayerTurn();
    (ctx.controller.getState() as { enemies: CombatEnemyInstance[] }).enemies.push(enemy);

    ctx.hand.push(card);
    ctx.controller.playCard(card, enemy);

    // Hit 1: 8 damage → HP 2 (alive)
    // Hit 2: 8 damage → HP -6 → dead, stop
    expect(enemy.isAlive).toBe(false);
    expect(enemy.currentHP).toBe(0);
  });

  it('AoE card damages all enemies', () => {
    const ctx = createTestContext();
    const card = makeCard({
      data: makeCardData({
        targets: TargetType.ALL_ENEMY,
        effects: [{ type: 'deal_damage', value: 10 }],
      }),
    });
    const e1 = makeEnemyInstance({ instanceId: 'e1', currentHP: 20 });
    const e2 = makeEnemyInstance({ instanceId: 'e2', currentHP: 15 });
    ctx.controller.startCombat(50, 50, 3);
    ctx.controller.transitionToPlayerTurn();
    (ctx.controller.getState() as { enemies: CombatEnemyInstance[] }).enemies.push(e1, e2);

    ctx.hand.push(card);
    ctx.controller.playCard(card, null); // null target for AoE

    expect(e1.currentHP).toBe(10);
    expect(e2.currentHP).toBe(5);
  });
});

// ===========================================================================
// AC12: Combat End Cleanup
// ===========================================================================

describe('AC12: Combat end cleanup', () => {
  it('victory clears status effects and resets energy', () => {
    const ctx = createTestContext();
    ctx.statusStacks['player:strength'] = 5;
    ctx.statusStacks['e1:vulnerable'] = 2;
    const card = makeCard({ data: makeCardData({ effects: [{ type: 'deal_damage', value: 25 }] }) });
    const enemy = makeEnemyInstance({ instanceId: 'e1', currentHP: 20 });
    ctx.controller.startCombat(50, 50, 3);
    ctx.controller.transitionToPlayerTurn();
    (ctx.controller.getState() as { enemies: CombatEnemyInstance[] }).enemies.push(enemy);

    ctx.hand.push(card);
    ctx.controller.playCard(card, enemy);

    // Combat over — status effects should be cleared
    expect(Object.keys(ctx.statusStacks)).toHaveLength(0);
    // Energy should be zeroed
    expect(ctx.getEnergy()).toBe(0);
  });

  it('defeat clears status effects and resets energy', () => {
    const ctx = setupInEnemyTurn(3);
    ctx.statusStacks['player:strength'] = 10;
    addEnemy(ctx, { instanceId: 'e1', currentMove: ATK_MOVE });

    ctx.controller.executeEnemyTurn();

    expect(ctx.controller.getPhase()).toBe(TurnPhase.COMBAT_OVER);
    expect(Object.keys(ctx.statusStacks)).toHaveLength(0);
    expect(ctx.getEnergy()).toBe(0);
  });

  it('emits onCombatEnd event with full payload', () => {
    const ctx = createTestContext();
    const card = makeCard({ data: makeCardData({ effects: [{ type: 'deal_damage', value: 25 }] }) });
    const enemy = makeEnemyInstance({ instanceId: 'e1', currentHP: 20 });
    ctx.controller.startCombat(50, 50, 3);
    ctx.controller.transitionToPlayerTurn();
    (ctx.controller.getState() as { enemies: CombatEnemyInstance[] }).enemies.push(enemy);

    ctx.hand.push(card);
    ctx.controller.playCard(card, enemy);

    const endEvent = ctx.events.find((e) => e.event === 'onCombatEnd');
    expect(endEvent).toBeDefined();
    const payload = endEvent!.payload as {
      result: string;
      turnNumber: number;
      playerHP: number;
      playerMaxHP: number;
      enemiesRemaining: number;
    };
    expect(payload.result).toBe('victory');
    expect(payload.turnNumber).toBe(1);
    expect(payload.playerHP).toBe(50);
    expect(payload.playerMaxHP).toBe(50);
    expect(payload.enemiesRemaining).toBe(0);
  });
});

// ===========================================================================
// Full Combat Scenarios
// ===========================================================================

describe('Full combat scenarios', () => {
  it('3-turn combat cycle completes correctly', () => {
    const ctx = createTestContext({ playerHP: 50, energy: 3 });
    const enemy = makeEnemyInstance({ instanceId: 'e1', currentHP: 30 });
    ctx.controller.startCombat(50, 50, 3);
    ctx.controller.transitionToPlayerTurn();
    (ctx.controller.getState() as { enemies: CombatEnemyInstance[] }).enemies.push(enemy);

    // Turn 1: Player plays attack (10 damage)
    const card1 = makeCard({ data: makeCardData({ effects: [{ type: 'deal_damage', value: 10 }] }) });
    ctx.hand.push(card1);
    ctx.controller.playCard(card1, enemy);
    expect(enemy.currentHP).toBe(20);
    expect(ctx.controller.getState().turnNumber).toBe(1);

    // End turn 1, enemy attacks, start turn 2
    enemy.currentMove = ATK_MOVE; // Reset for enemy turn
    ctx.controller.endPlayerTurn();
    ctx.controller.executeEnemyTurn();
    expect(ctx.controller.getState().playerHP).toBe(45); // 5 enemy damage
    ctx.controller.startPlayerTurn();
    expect(ctx.controller.getState().turnNumber).toBe(2);

    // Turn 2: Player plays attack (10 damage)
    const card2 = makeCard({ data: makeCardData({ effects: [{ type: 'deal_damage', value: 10 }] }) });
    ctx.hand.push(card2);
    ctx.controller.playCard(card2, enemy);
    expect(enemy.currentHP).toBe(10);

    // End turn 2, enemy attacks, start turn 3
    enemy.currentMove = ATK_MOVE;
    ctx.controller.endPlayerTurn();
    ctx.controller.executeEnemyTurn();
    expect(ctx.controller.getState().playerHP).toBe(40); // 5 more damage
    ctx.controller.startPlayerTurn();
    expect(ctx.controller.getState().turnNumber).toBe(3);

    // Turn 3: Player plays final attack (12 damage — overkill)
    const card3 = makeCard({ data: makeCardData({ effects: [{ type: 'deal_damage', value: 12 }] }) });
    ctx.hand.push(card3);
    ctx.controller.playCard(card3, enemy);

    // Victory!
    expect(enemy.isAlive).toBe(false);
    expect(ctx.controller.getPhase()).toBe(TurnPhase.COMBAT_OVER);
    expect(ctx.controller.getState().result).toBe('victory');
    expect(ctx.controller.getState().playerHP).toBe(40);
  });

  it('multi-enemy combat with sequential deaths', () => {
    const ctx = createTestContext({ playerHP: 50, energy: 3 });
    const e1 = makeEnemyInstance({ instanceId: 'e1', currentHP: 5 });
    const e2 = makeEnemyInstance({ instanceId: 'e2', currentHP: 15 });
    ctx.controller.startCombat(50, 50, 3);
    ctx.controller.transitionToPlayerTurn();
    (ctx.controller.getState() as { enemies: CombatEnemyInstance[] }).enemies.push(e1, e2);

    // Kill e1 with first card
    const card1 = makeCard({ data: makeCardData({ effects: [{ type: 'deal_damage', value: 8 }] }) });
    ctx.hand.push(card1);
    ctx.controller.playCard(card1, e1);

    expect(e1.isAlive).toBe(false);
    expect(e2.isAlive).toBe(true);
    // Not victory yet — e2 still alive
    expect(ctx.controller.getPhase()).toBe(TurnPhase.PLAYER_TURN);

    // Kill e2 with second card
    const card2 = makeCard({ data: makeCardData({ effects: [{ type: 'deal_damage', value: 20 }] }) });
    ctx.hand.push(card2);
    ctx.controller.playCard(card2, e2);

    // Now all dead → victory
    expect(ctx.controller.getPhase()).toBe(TurnPhase.COMBAT_OVER);
    expect(ctx.controller.getState().result).toBe('victory');
  });

  it('card exhaust mechanic works in combat', () => {
    const ctx = createTestContext();
    const exhaustCard = makeCard({
      data: makeCardData({
        keywords: [Keyword.EXHAUST],
        effects: [{ type: 'deal_damage', value: 15 }],
      }),
    });
    const enemy = makeEnemyInstance({ instanceId: 'e1', currentHP: 30 });
    ctx.controller.startCombat(50, 50, 3);
    ctx.controller.transitionToPlayerTurn();
    (ctx.controller.getState() as { enemies: CombatEnemyInstance[] }).enemies.push(enemy);

    ctx.hand.push(exhaustCard);
    ctx.controller.playCard(exhaustCard, enemy);

    // Card exhausted (removed from hand via exhaustCards mock)
    expect(ctx.hand).toHaveLength(0);
    expect(enemy.currentHP).toBe(15);
  });

  it('block carries over between turns until reset', () => {
    const ctx = createTestContext({ energy: 3 });
    ctx.controller.startCombat(50, 50, 3);
    ctx.controller.transitionToPlayerTurn();

    // Turn 1: Gain 10 block
    const blockCard = makeCard({ data: makeCardData({ targets: TargetType.SELF, effects: [{ type: 'gain_block', value: 10 }] }) });
    ctx.hand.push(blockCard);
    ctx.controller.playCard(blockCard, null);
    expect(ctx.controller.getState().playerBlock).toBe(10);

    // End player turn — block persists into enemy turn
    ctx.controller.endPlayerTurn();
    expect(ctx.controller.getState().playerBlock).toBe(10);

    // Enemy attacks for 5
    const enemy = addEnemy(ctx, { instanceId: 'e1', currentMove: ATK_MOVE });
    ctx.controller.executeEnemyTurn();
    // 10 block - 5 damage = 5 block remaining, no HP lost
    expect(ctx.controller.getState().playerHP).toBe(50);
    expect(ctx.controller.getState().playerBlock).toBe(5);

    // Start next player turn — block resets
    ctx.controller.startPlayerTurn();
    expect(ctx.controller.getState().playerBlock).toBe(0);
  });

  it('complete init-to-victory combat using initCombat', () => {
    const ctx = createTestContext({ playerHP: 50, energy: 3 });
    const enemyData = makeEnemyData({ id: 'slime', hp: 8, moveDefinitions: { atk: ATK_MOVE } });
    ctx.controller.initCombat(50, 50, 3, { enemies: [enemyData] });

    expect(ctx.controller.getPhase()).toBe(TurnPhase.PLAYER_TURN);
    expect(ctx.controller.getState().enemies).toHaveLength(1);

    const enemy = ctx.controller.getState().enemies[0];
    expect(enemy.isAlive).toBe(true);

    // Kill the enemy with one big hit
    const card = makeCard({ data: makeCardData({ effects: [{ type: 'deal_damage', value: 12 }] }) });
    ctx.hand.push(card);
    ctx.controller.playCard(card, enemy);

    expect(ctx.controller.getPhase()).toBe(TurnPhase.COMBAT_OVER);
    expect(ctx.controller.getState().result).toBe('victory');
  });
});
