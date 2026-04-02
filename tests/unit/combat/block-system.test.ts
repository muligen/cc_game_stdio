/**
 * block-system.test.ts — Tests for block calculation with Dexterity/Frail modifiers
 * and block absorption in the damage pipeline.
 *
 * Validates S2-11 acceptance criteria:
 * - Block formula: floor((base + dexterity) * frailMultiplier), min 0
 * - Damage pipeline absorbs block before HP
 * - Excess block carries until reset
 * - Player block resets at player turn start
 * - Enemy block resets at individual enemy turn start
 *
 * References: design/gdd/combat.md (Block Calculation),
 *             design/gdd/status-effect.md (Dexterity, Frail)
 */

// @vitest-environment node

import { describe, it, expect } from 'vitest';
import { CombatController } from '../../../src/systems/combat-controller';
import { TurnPhase } from '../../../src/types/combat';
import {
  CardType,
  CostType,
  Rarity,
  TargetType,
  type CardData,
  type CombatCardInstance,
} from '../../../src/types/card';
import type { CombatEnemyInstance, EnemyMove } from '../../../src/types/enemy';

// ---------------------------------------------------------------------------
// Factories
// ---------------------------------------------------------------------------

function makeCardData(overrides: Partial<CardData> = {}): CardData {
  return {
    id: 'test_defend',
    name: 'Test Defend',
    type: CardType.SKILL,
    rarity: Rarity.STARTER,
    cost: 1,
    costType: CostType.NORMAL,
    character: null,
    targets: TargetType.SELF,
    effects: [{ type: 'gain_block', value: 5 }],
    keywords: [],
    upgrade: null,
    description: 'Gain 5 block.',
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

function makeEnemyInstance(overrides: Partial<CombatEnemyInstance> = {}): CombatEnemyInstance {
  return {
    instanceId: 'enemy_0_test',
    data: { id: 'test_enemy', name: 'Test', type: 'normal', hp: 20, moves: [] },
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
  effects: [{ type: 'deal_damage', value: 8 }],
  damage: 8,
};

// ---------------------------------------------------------------------------
// Test Context
// ---------------------------------------------------------------------------

interface BlockTestContext {
  controller: CombatController;
  statusStacks: Record<string, number>;
  hand: CombatCardInstance[];
}

function createBlockTestContext(opts: { playerHP?: number; energy?: number } = {}): BlockTestContext {
  const playerHP = opts.playerHP ?? 50;
  let currentEnergy = opts.energy ?? 3;
  let maxEnergy = opts.energy ?? 3;

  const statusStacks: Record<string, number> = {};
  const hand: CombatCardInstance[] = [];

  const ctx: BlockTestContext = { controller: null!, statusStacks, hand };

  ctx.controller = new CombatController(
    { emit: () => {} },
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
    {
      getCurrentEnergy: () => currentEnergy,
      getEffectiveMaxEnergy: () => maxEnergy,
      onTurnStart: (bonus = 0, penalty = 0) => { currentEnergy = maxEnergy + bonus - penalty; },
      onTurnEnd: () => { currentEnergy = 0; },
      canPlay: (cost: number) => currentEnergy >= cost,
      spendEnergy: (cost: number) => { currentEnergy -= cost; return cost; },
    },
    {
      getEffectStacks: (targetId: string, effectId: string) => statusStacks[`${targetId}:${effectId}`] ?? 0,
      processTurnEnd: () => {},
      applyEffect: () => true,
      tryApplyDebuff: () => true,
      getEffectData: () => ({ category: 'buff' }),
      resetForCombat: () => { for (const k of Object.keys(statusStacks)) delete statusStacks[k]; },
    },
    { resolveEffect: () => [] },
    {
      createInstance: () => makeEnemyInstance(),
      selectMove: (e: CombatEnemyInstance) => { e.moveHistory.push('atk'); return 'atk'; },
      resetBlock: (e: CombatEnemyInstance) => { e.block = 0; },
      takeDamage: (e: CombatEnemyInstance, amount: number) => {
        const blocked = Math.min(e.block, amount);
        e.block -= blocked;
        const hpLost = amount - blocked;
        if (hpLost > 0) {
          e.currentHP = Math.max(0, e.currentHP - hpLost);
          if (e.currentHP <= 0) e.isAlive = false;
        }
        return { hpLost, blocked };
      },
      gainBlock: (e: CombatEnemyInstance, amount: number) => { e.block += amount; return e.block; },
    },
    { getStream: () => ({ nextInt: () => 0, weightedPick: () => 'atk', shuffle: <T>(a: readonly T[]) => [...a] }) }
  );

  return ctx;
}

function setupPlayerTurn(ctx: BlockTestContext, hp = 50, energy = 3): void {
  ctx.controller.startCombat(hp, hp, energy);
  ctx.controller.transitionToPlayerTurn();
}

// ===========================================================================
// Block Formula: floor((base + dexterity) * frailMultiplier)
// ===========================================================================

describe('Block formula', () => {
  it('base block with no modifiers', () => {
    const ctx = createBlockTestContext();
    setupPlayerTurn(ctx);
    const card = makeCard({ data: makeCardData({ effects: [{ type: 'gain_block', value: 5 }] }) });

    ctx.hand.push(card);
    ctx.controller.playCard(card, null);

    expect(ctx.controller.getState().playerBlock).toBe(5);
  });

  it('positive Dexterity adds to block', () => {
    const ctx = createBlockTestContext();
    ctx.statusStacks['player:dexterity'] = 3;
    setupPlayerTurn(ctx);
    const card = makeCard({ data: makeCardData({ effects: [{ type: 'gain_block', value: 5 }] }) });

    ctx.hand.push(card);
    ctx.controller.playCard(card, null);

    // 5 + 3 = 8
    expect(ctx.controller.getState().playerBlock).toBe(8);
  });

  it('negative Dexterity reduces block', () => {
    const ctx = createBlockTestContext();
    ctx.statusStacks['player:dexterity'] = -2;
    setupPlayerTurn(ctx);
    const card = makeCard({ data: makeCardData({ effects: [{ type: 'gain_block', value: 5 }] }) });

    ctx.hand.push(card);
    ctx.controller.playCard(card, null);

    // 5 + (-2) = 3
    expect(ctx.controller.getState().playerBlock).toBe(3);
  });

  it('Frail reduces block by 25%', () => {
    const ctx = createBlockTestContext();
    ctx.statusStacks['player:frail'] = 1;
    setupPlayerTurn(ctx);
    const card = makeCard({ data: makeCardData({ effects: [{ type: 'gain_block', value: 8 }] }) });

    ctx.hand.push(card);
    ctx.controller.playCard(card, null);

    // 8 * 0.75 = 6.0 → floor = 6
    expect(ctx.controller.getState().playerBlock).toBe(6);
  });

  it('Dexterity + Frail combined', () => {
    const ctx = createBlockTestContext();
    ctx.statusStacks['player:dexterity'] = 4;
    ctx.statusStacks['player:frail'] = 1;
    setupPlayerTurn(ctx);
    const card = makeCard({ data: makeCardData({ effects: [{ type: 'gain_block', value: 6 }] }) });

    ctx.hand.push(card);
    ctx.controller.playCard(card, null);

    // (6 + 4) * 0.75 = 10 * 0.75 = 7.5 → floor = 7
    expect(ctx.controller.getState().playerBlock).toBe(7);
  });

  it('negative Dexterity + Frail floors at 0', () => {
    const ctx = createBlockTestContext();
    ctx.statusStacks['player:dexterity'] = -3;
    ctx.statusStacks['player:frail'] = 1;
    setupPlayerTurn(ctx);
    const card = makeCard({ data: makeCardData({ effects: [{ type: 'gain_block', value: 2 }] }) });

    ctx.hand.push(card);
    ctx.controller.playCard(card, null);

    // (2 + (-3)) * 0.75 = -1 * 0.75 = -0.75 → floor = -1 → max(0, -1) = 0
    expect(ctx.controller.getState().playerBlock).toBe(0);
  });

  it('zero base block with positive Dexterity', () => {
    const ctx = createBlockTestContext();
    ctx.statusStacks['player:dexterity'] = 5;
    setupPlayerTurn(ctx);
    const card = makeCard({ data: makeCardData({ effects: [{ type: 'gain_block', value: 0 }] }) });

    ctx.hand.push(card);
    ctx.controller.playCard(card, null);

    // 0 + 5 = 5
    expect(ctx.controller.getState().playerBlock).toBe(5);
  });

  it('block is additive within a turn', () => {
    const ctx = createBlockTestContext({ energy: 6 });
    setupPlayerTurn(ctx, 50, 6);

    const card1 = makeCard({ data: makeCardData({ effects: [{ type: 'gain_block', value: 4 }] }) });
    const card2 = makeCard({ data: makeCardData({ effects: [{ type: 'gain_block', value: 6 }] }) });

    ctx.hand.push(card1, card2);
    ctx.controller.playCard(card1, null);
    expect(ctx.controller.getState().playerBlock).toBe(4);

    ctx.controller.playCard(card2, null);
    expect(ctx.controller.getState().playerBlock).toBe(10); // 4 + 6
  });
});

// ===========================================================================
// Block Absorption in Damage Pipeline
// ===========================================================================

describe('Block absorption in damage pipeline', () => {
  it('block fully absorbs enemy damage', () => {
    const ctx = createBlockTestContext();
    setupPlayerTurn(ctx);
    ctx.controller.getState().playerBlock = 10;

    ctx.controller.transitionToEnemyTurn();
    const enemy = makeEnemyInstance({ instanceId: 'e1', currentMove: ATK_MOVE }); // 8 damage
    (ctx.controller.getState() as { enemies: CombatEnemyInstance[] }).enemies.push(enemy);

    ctx.controller.executeEnemyTurn();

    expect(ctx.controller.getState().playerHP).toBe(50); // No HP lost
    expect(ctx.controller.getState().playerBlock).toBe(2); // 10 - 8 = 2
  });

  it('block partially absorbs — remaining HP lost', () => {
    const ctx = createBlockTestContext();
    setupPlayerTurn(ctx);
    ctx.controller.getState().playerBlock = 3;

    ctx.controller.transitionToEnemyTurn();
    const enemy = makeEnemyInstance({ instanceId: 'e1', currentMove: ATK_MOVE }); // 8 damage
    (ctx.controller.getState() as { enemies: CombatEnemyInstance[] }).enemies.push(enemy);

    ctx.controller.executeEnemyTurn();

    // 8 damage - 3 block = 5 HP lost
    expect(ctx.controller.getState().playerHP).toBe(45);
    expect(ctx.controller.getState().playerBlock).toBe(0);
  });

  it('excess block persists after enemy attack', () => {
    const ctx = createBlockTestContext();
    setupPlayerTurn(ctx);
    ctx.controller.getState().playerBlock = 20;

    ctx.controller.transitionToEnemyTurn();
    const enemy = makeEnemyInstance({ instanceId: 'e1', currentMove: ATK_MOVE }); // 8 damage
    (ctx.controller.getState() as { enemies: CombatEnemyInstance[] }).enemies.push(enemy);

    ctx.controller.executeEnemyTurn();

    expect(ctx.controller.getState().playerHP).toBe(50);
    expect(ctx.controller.getState().playerBlock).toBe(12); // 20 - 8
  });

  it('enemy block absorbs card damage', () => {
    const ctx = createBlockTestContext();
    setupPlayerTurn(ctx);
    const card = makeCard({ data: makeCardData({ targets: TargetType.ENEMY, effects: [{ type: 'deal_damage', value: 10 }] }) });
    const enemy = makeEnemyInstance({ instanceId: 'e1', block: 6 });
    (ctx.controller.getState() as { enemies: CombatEnemyInstance[] }).enemies.push(enemy);

    ctx.hand.push(card);
    ctx.controller.playCard(card, enemy);

    // 10 damage, 6 blocked, 4 HP lost
    expect(enemy.currentHP).toBe(16);
    expect(enemy.block).toBe(0);
  });

  it('enemy block fully absorbs card damage', () => {
    const ctx = createBlockTestContext();
    setupPlayerTurn(ctx);
    const card = makeCard({ data: makeCardData({ targets: TargetType.ENEMY, effects: [{ type: 'deal_damage', value: 5 }] }) });
    const enemy = makeEnemyInstance({ instanceId: 'e1', currentHP: 20, block: 10 });
    (ctx.controller.getState() as { enemies: CombatEnemyInstance[] }).enemies.push(enemy);

    ctx.hand.push(card);
    ctx.controller.playCard(card, enemy);

    // 5 damage, 10 block — fully absorbed
    expect(enemy.currentHP).toBe(20);
    expect(enemy.block).toBe(5); // 10 - 5
  });
});

// ===========================================================================
// Block Reset Timing
// ===========================================================================

describe('Block reset timing', () => {
  it('player block resets at start of player turn', () => {
    const ctx = createBlockTestContext();
    setupPlayerTurn(ctx);

    // Player gains block
    const card = makeCard({ data: makeCardData({ effects: [{ type: 'gain_block', value: 10 }] }) });
    ctx.hand.push(card);
    ctx.controller.playCard(card, null);
    expect(ctx.controller.getState().playerBlock).toBe(10);

    // End turn, go through enemy turn, start next player turn
    ctx.controller.transitionToEnemyTurn();
    ctx.controller.startPlayerTurn();

    expect(ctx.controller.getState().playerBlock).toBe(0);
  });

  it('player block persists through enemy turn', () => {
    const ctx = createBlockTestContext();
    setupPlayerTurn(ctx);
    ctx.controller.getState().playerBlock = 15;

    ctx.controller.transitionToEnemyTurn();
    // Block is still 15 during enemy turn
    expect(ctx.controller.getState().playerBlock).toBe(15);
  });

  it('enemy block resets at start of their individual turn', () => {
    const ctx = createBlockTestContext();
    setupPlayerTurn(ctx);
    ctx.controller.transitionToEnemyTurn();

    const enemy = makeEnemyInstance({ instanceId: 'e1', block: 12, currentMove: ATK_MOVE });
    (ctx.controller.getState() as { enemies: CombatEnemyInstance[] }).enemies.push(enemy);

    ctx.controller.executeEnemyTurn();

    // resetBlock called first (block → 0), then attack executed
    // No new block gained from ATK_MOVE, so block stays 0
    expect(enemy.block).toBe(0);
  });

  it('enemy gains new block after reset', () => {
    const ctx = createBlockTestContext();
    setupPlayerTurn(ctx);
    ctx.controller.transitionToEnemyTurn();

    const DEFEND_MOVE: EnemyMove = {
      id: 'def',
      name: 'Defend',
      intent: 'defend' as never,
      effects: [{ type: 'gain_block', value: 7 }],
      damage: 0,
    };
    const enemy = makeEnemyInstance({ instanceId: 'e1', block: 5, currentMove: DEFEND_MOVE });
    (ctx.controller.getState() as { enemies: CombatEnemyInstance[] }).enemies.push(enemy);

    ctx.controller.executeEnemyTurn();

    // resetBlock clears 5, then gainBlock adds 7
    expect(enemy.block).toBe(7);
  });

  it('multiple enemies each reset block individually', () => {
    const ctx = createBlockTestContext();
    setupPlayerTurn(ctx);
    ctx.controller.transitionToEnemyTurn();

    const e1 = makeEnemyInstance({ instanceId: 'e1', block: 10, currentMove: ATK_MOVE });
    const e2 = makeEnemyInstance({ instanceId: 'e2', block: 5, currentMove: ATK_MOVE });
    (ctx.controller.getState() as { enemies: CombatEnemyInstance[] }).enemies.push(e1, e2);

    ctx.controller.executeEnemyTurn();

    expect(e1.block).toBe(0);
    expect(e2.block).toBe(0);
  });
});

// ===========================================================================
// Block + Damage Integration
// ===========================================================================

describe('Block + damage integration', () => {
  it('gain block then take damage across full turn cycle', () => {
    const ctx = createBlockTestContext({ energy: 6 });
    ctx.controller.startCombat(50, 50, 6);
    ctx.controller.transitionToPlayerTurn();

    // Play two block cards
    const card1 = makeCard({ data: makeCardData({ effects: [{ type: 'gain_block', value: 5 }] }) });
    const card2 = makeCard({ data: makeCardData({ effects: [{ type: 'gain_block', value: 8 }] }) });
    ctx.hand.push(card1, card2);

    ctx.controller.playCard(card1, null);
    ctx.controller.playCard(card2, null);
    expect(ctx.controller.getState().playerBlock).toBe(13);

    // End turn → enemy turn
    ctx.controller.endPlayerTurn();
    const enemy = makeEnemyInstance({ instanceId: 'e1', currentMove: ATK_MOVE }); // 8 damage
    (ctx.controller.getState() as { enemies: CombatEnemyInstance[] }).enemies.push(enemy);

    ctx.controller.executeEnemyTurn();
    // 13 block - 8 damage = 5 block, no HP lost
    expect(ctx.controller.getState().playerHP).toBe(50);
    expect(ctx.controller.getState().playerBlock).toBe(5);

    // Start next turn — block resets
    ctx.controller.startPlayerTurn();
    expect(ctx.controller.getState().playerBlock).toBe(0);
  });

  it('Dexterity-enhanced block absorbs more damage', () => {
    const ctx = createBlockTestContext();
    ctx.statusStacks['player:dexterity'] = 5;
    ctx.controller.startCombat(50, 50, 3);
    ctx.controller.transitionToPlayerTurn();

    // Base 5 block + 5 dexterity = 10 block
    const card = makeCard({ data: makeCardData({ effects: [{ type: 'gain_block', value: 5 }] }) });
    ctx.hand.push(card);
    ctx.controller.playCard(card, null);
    expect(ctx.controller.getState().playerBlock).toBe(10);

    ctx.controller.transitionToEnemyTurn();
    const enemy = makeEnemyInstance({ instanceId: 'e1', currentMove: ATK_MOVE }); // 8 damage
    (ctx.controller.getState() as { enemies: CombatEnemyInstance[] }).enemies.push(enemy);

    ctx.controller.executeEnemyTurn();
    // 10 block - 8 damage = 2 block
    expect(ctx.controller.getState().playerHP).toBe(50);
    expect(ctx.controller.getState().playerBlock).toBe(2);
  });

  it('Frail-reduced block provides less protection', () => {
    const ctx = createBlockTestContext();
    ctx.statusStacks['player:frail'] = 1;
    ctx.controller.startCombat(50, 50, 3);
    ctx.controller.transitionToPlayerTurn();

    // 8 * 0.75 = 6 block (instead of 8)
    const card = makeCard({ data: makeCardData({ effects: [{ type: 'gain_block', value: 8 }] }) });
    ctx.hand.push(card);
    ctx.controller.playCard(card, null);
    expect(ctx.controller.getState().playerBlock).toBe(6);

    ctx.controller.transitionToEnemyTurn();
    const enemy = makeEnemyInstance({ instanceId: 'e1', currentMove: ATK_MOVE }); // 8 damage
    (ctx.controller.getState() as { enemies: CombatEnemyInstance[] }).enemies.push(enemy);

    ctx.controller.executeEnemyTurn();
    // 6 block - 8 damage = -2, so 0 block, 2 HP lost
    expect(ctx.controller.getState().playerHP).toBe(48);
    expect(ctx.controller.getState().playerBlock).toBe(0);
  });
});
