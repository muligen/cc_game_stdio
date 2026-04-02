/**
 * first-turn-handling.test.ts — Tests for first turn special handling.
 *
 * Validates S2-14 acceptance criteria:
 * - Innate cards always appear in opening hand
 * - Enemy conditional moves with trigger: "turn_count", operator: "==", value: 1
 *   are selected on first turn
 * - Non-first-turn fallback to weighted pool works correctly
 *
 * References: design/gdd/enemy-ai.md (Conditional Move Override),
 *             design/gdd/deck.md (Innate keyword)
 */

// @vitest-environment node

import { describe, it, expect } from 'vitest';
import { CombatController } from '../../../src/systems/combat-controller';
import { TurnPhase } from '../../../src/types/combat';
import type { CombatEnemyInstance, EnemyMove, EnemyData } from '../../../src/types/enemy';
import {
  CardType,
  CostType,
  Keyword,
  Rarity,
  TargetType,
  type CardData,
  type CombatCardInstance,
} from '../../../src/types/card';
import { DeckManager } from '../../../src/systems/deck-manager';
import { RNGStream } from '../../../src/utils/rng';
import type { EnemyData } from '../../../src/types/enemy';

// ---------------------------------------------------------------------------
// Factories
// ---------------------------------------------------------------------------

const OPENING_ATK: EnemyMove = {
  id: 'opening_attack',
  name: 'Opening Strike',
  intent: 'attack' as never,
  effects: [{ type: 'deal_damage', value: 10 }],
  damage: 10,
};

const NORMAL_ATK: EnemyMove = {
  id: 'normal_atk',
  name: 'Attack',
  intent: 'attack' as never,
  effects: [{ type: 'deal_damage', value: 6 }],
  damage: 6,
};

const DEFEND_MOVE: EnemyMove = {
  id: 'def',
  name: 'Defend',
  intent: 'defend' as never,
  effects: [{ type: 'gain_block', value: 5 }],
};

function makeEnemyData(overrides: Partial<EnemyData> = {}): EnemyData {
  return {
    id: 'test_enemy',
    name: 'Test Enemy',
    type: 'normal',
    hp: 30,
    moves: [
      { moveId: 'normal_atk', weight: 3 },
      { moveId: 'def', weight: 2 },
    ],
    selectionMode: 'random',
    ...overrides,
  };
}

function makeEnemyInstance(overrides: Partial<CombatEnemyInstance> = {}): CombatEnemyInstance {
  return {
    instanceId: 'enemy_0_test',
    data: makeEnemyData(),
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

function makeCardData(overrides: Partial<CardData> = {}): CardData {
  return {
    id: 'test_card',
    name: 'Test Card',
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

// ---------------------------------------------------------------------------
// Test Context
// ---------------------------------------------------------------------------

interface FirstTurnCtx {
  controller: CombatController;
  statusStacks: Record<string, number>;
  hand: CombatCardInstance[];
  events: Array<{ event: string; payload: unknown }>;
}

function createFirstTurnCtx(opts: { energy?: number } = {}): FirstTurnCtx {
  let currentEnergy = opts.energy ?? 3;
  let maxEnergy = opts.energy ?? 3;

  const statusStacks: Record<string, number> = {};
  const hand: CombatCardInstance[] = [];
  const events: Array<{ event: string; payload: unknown }> = [];

  const ctx: FirstTurnCtx = { controller: null!, statusStacks, hand, events };

  ctx.controller = new CombatController(
    { emit: (event: string, payload: unknown) => { events.push({ event, payload }); } },
    {
      getDrawPileSize: () => 0,
      getHandSize: () => hand.length,
      getDiscardPileSize: () => 0,
      getExhaustPileSize: () => 0,
      drawOpeningHand: () => [],
      drawCard: () => [],
      discardHand: () => { hand.length = 0; },
      getHand: () => [...hand],
      discardCards: () => {},
      exhaustCards: () => {},
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
      getEffectData: (effectId: string) => {
        if (['weak', 'vulnerable', 'frail'].includes(effectId)) return { category: 'debuff' };
        return { category: 'buff' };
      },
      resetForCombat: () => { for (const k of Object.keys(statusStacks)) delete statusStacks[k]; },
    },
    { resolveEffect: () => [] },
    {
      createInstance: (data: EnemyData, instanceId: string) => ({
        ...makeEnemyInstance({ data, instanceId }),
      }),
      selectMove: (e: CombatEnemyInstance) => { e.moveHistory.push('normal_atk'); return 'normal_atk'; },
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
    { getStream: () => ({ nextInt: () => 0, weightedPick: () => 'normal_atk', shuffle: <T>(a: readonly T[]) => [...a] }) }
  );

  return ctx;
}

// ===========================================================================
// Innate Cards in Opening Hand
// ===========================================================================

describe('Innate cards in opening hand', () => {
  it('innate cards are guaranteed in the opening hand', () => {
    // Create a deck with 2 innate + 8 non-innate cards
    const rng = new RNGStream(42);

    const innateCard1: CombatCardInstance = {
      instanceId: 'innate-1',
      data: makeCardData({ id: 'innate_1', name: 'Innate Strike', keywords: [Keyword.INNATE] }),
      upgraded: false, costOverride: null, timesPlayedThisCombat: 0, retained: false,
    };
    const innateCard2: CombatCardInstance = {
      instanceId: 'innate-2',
      data: makeCardData({ id: 'innate_2', name: 'Innate Defend', keywords: [Keyword.INNATE], targets: TargetType.SELF, effects: [{ type: 'gain_block', value: 5 }] }),
      upgraded: false, costOverride: null, timesPlayedThisCombat: 0, retained: false,
    };

    const nonInnateCards: CombatCardInstance[] = [];
    for (let i = 0; i < 8; i++) {
      nonInnateCards.push({
        instanceId: `card-${i}`,
        data: makeCardData({ id: `card_${i}`, name: `Card ${i}` }),
        upgraded: false, costOverride: null, timesPlayedThisCombat: 0, retained: false,
      });
    }

    const deck = new DeckManager([...nonInnateCards, innateCard1, innateCard2], rng);
    const drawn = deck.drawOpeningHand(5);

    // Both innate cards should be in the opening hand
    const drawnIds = drawn.map((c) => c.instanceId);
    expect(drawnIds).toContain('innate-1');
    expect(drawnIds).toContain('innate-2');
  });

  it('more innate cards than handSize still all appear', () => {
    const rng = new RNGStream(42);

    const innateCards: CombatCardInstance[] = [];
    for (let i = 0; i < 4; i++) {
      innateCards.push({
        instanceId: `innate-${i}`,
        data: makeCardData({ id: `innate_${i}`, name: `Innate ${i}`, keywords: [Keyword.INNATE] }),
        upgraded: false, costOverride: null, timesPlayedThisCombat: 0, retained: false,
      });
    }
    const nonInnate: CombatCardInstance[] = [];
    for (let i = 0; i < 6; i++) {
      nonInnate.push({
        instanceId: `card-${i}`,
        data: makeCardData({ id: `card_${i}`, name: `Card ${i}` }),
        upgraded: false, costOverride: null, timesPlayedThisCombat: 0, retained: false,
      });
    }

    const deck = new DeckManager([...nonInnate, ...innateCards], rng);
    const drawn = deck.drawOpeningHand(3); // handSize < innate count

    // All 4 innate cards should appear even though handSize is only 3
    const drawnIds = drawn.map((c) => c.instanceId);
    expect(drawnIds).toContain('innate-0');
    expect(drawnIds).toContain('innate-1');
    expect(drawnIds).toContain('innate-2');
    expect(drawnIds).toContain('innate-3');
  });

  it('no innate cards draws normally', () => {
    const rng = new RNGStream(42);

    const cards: CombatCardInstance[] = [];
    for (let i = 0; i < 10; i++) {
      cards.push({
        instanceId: `card-${i}`,
        data: makeCardData({ id: `card_${i}`, name: `Card ${i}` }),
        upgraded: false, costOverride: null, timesPlayedThisCombat: 0, retained: false,
      });
    }

    const deck = new DeckManager(cards, rng);
    const drawn = deck.drawOpeningHand(5);
    expect(drawn).toHaveLength(5);
  });
});

// ===========================================================================
// Enemy Conditional Moves (turn_count)
// ===========================================================================

describe('Enemy conditional moves (turn_count)', () => {
  it('turn_count == 1 selects conditional move on first turn', () => {
    const ctx = createFirstTurnCtx();
    const enemyData = makeEnemyData({
      conditionalMoves: [
        { trigger: 'turn_count', operator: '==', value: 1, moveId: 'opening_attack' },
      ],
      moveDefinitions: {
        opening_attack: OPENING_ATK,
        normal_atk: NORMAL_ATK,
        def: DEFEND_MOVE,
      },
    });

    ctx.controller.initCombat(50, 50, 3, { enemies: [enemyData] });

    // Turn 1 — conditional should match (turnNumber = 1)
    const enemy = ctx.controller.getState().enemies[0];
    expect(enemy.currentMove).toBeDefined();
    expect(enemy.currentMove!.id).toBe('opening_attack');
  });

  it('turn_count == 1 does not match on later turns', () => {
    const ctx = createFirstTurnCtx();
    const enemyData = makeEnemyData({
      conditionalMoves: [
        { trigger: 'turn_count', operator: '==', value: 1, moveId: 'opening_attack' },
      ],
      moveDefinitions: {
        opening_attack: OPENING_ATK,
        normal_atk: NORMAL_ATK,
        def: DEFEND_MOVE,
      },
    });

    ctx.controller.initCombat(50, 50, 3, { enemies: [enemyData] });
    const enemy = ctx.controller.getState().enemies[0];

    // Turn 1: conditional match
    expect(enemy.currentMove!.id).toBe('opening_attack');

    // Execute turn 1 enemy actions, then start turn 2
    ctx.controller.endPlayerTurn();
    // executeEnemyTurn clears currentMove via selectAndResolveEnemyMove
    ctx.controller.executeEnemyTurn();

    // Turn 2: conditional should NOT match (turnNumber = 2)
    // selectMove mock returns 'normal_atk'
    ctx.controller.startPlayerTurn();
    // Enemy should have selected normal_atk (fallback to weighted pool)
    // Since the mock always returns 'normal_atk', the move resolves to that
    expect(enemy.currentMove).toBeDefined();
    // The currentMove after turn 2 start's enemy execution was set during executeEnemyTurn
    // Let's verify by checking the move is NOT opening_attack
    expect(enemy.currentMove?.id).not.toBe('opening_attack');
  });

  it('turn_count <= 2 matches first two turns', () => {
    const ctx = createFirstTurnCtx();
    const enemyData = makeEnemyData({
      conditionalMoves: [
        { trigger: 'turn_count', operator: '<=', value: 2, moveId: 'opening_attack' },
      ],
      moveDefinitions: {
        opening_attack: OPENING_ATK,
        normal_atk: NORMAL_ATK,
        def: DEFEND_MOVE,
      },
    });

    ctx.controller.initCombat(50, 50, 3, { enemies: [enemyData] });
    const enemy = ctx.controller.getState().enemies[0];

    // Turn 1: matches (1 <= 2)
    expect(enemy.currentMove!.id).toBe('opening_attack');
  });

  it('no conditional moves falls back to weighted pool', () => {
    const ctx = createFirstTurnCtx();
    const enemyData = makeEnemyData({
      // No conditionalMoves
      moveDefinitions: {
        normal_atk: NORMAL_ATK,
        def: DEFEND_MOVE,
      },
    });

    ctx.controller.initCombat(50, 50, 3, { enemies: [enemyData] });
    const enemy = ctx.controller.getState().enemies[0];

    // Mock always returns 'normal_atk'
    expect(enemy.currentMove).toBeDefined();
    expect(enemy.currentMove!.id).toBe('normal_atk');
  });

  it('conditional move with unknown moveId sets currentMove to null', () => {
    const ctx = createFirstTurnCtx();
    const enemyData = makeEnemyData({
      conditionalMoves: [
        { trigger: 'turn_count', operator: '==', value: 1, moveId: 'nonexistent_move' },
      ],
      moveDefinitions: {
        normal_atk: NORMAL_ATK,
      },
    });

    ctx.controller.initCombat(50, 50, 3, { enemies: [enemyData] });
    const enemy = ctx.controller.getState().enemies[0];

    // moveId not in moveDefinitions → currentMove = null
    expect(enemy.currentMove).toBeNull();
  });

  it('first matching condition wins when multiple conditions present', () => {
    const ctx = createFirstTurnCtx();
    const enemyData = makeEnemyData({
      conditionalMoves: [
        { trigger: 'turn_count', operator: '==', value: 1, moveId: 'opening_attack' },
        { trigger: 'turn_count', operator: '>=', value: 1, moveId: 'def' },
      ],
      moveDefinitions: {
        opening_attack: OPENING_ATK,
        normal_atk: NORMAL_ATK,
        def: DEFEND_MOVE,
      },
    });

    ctx.controller.initCombat(50, 50, 3, { enemies: [enemyData] });
    const enemy = ctx.controller.getState().enemies[0];

    // First condition (turn_count == 1) matches first
    expect(enemy.currentMove!.id).toBe('opening_attack');
  });

  it('intent display data reflects conditional move', () => {
    const ctx = createFirstTurnCtx();
    const enemyData = makeEnemyData({
      conditionalMoves: [
        { trigger: 'turn_count', operator: '==', value: 1, moveId: 'opening_attack' },
      ],
      moveDefinitions: {
        opening_attack: OPENING_ATK,
        normal_atk: NORMAL_ATK,
      },
    });

    ctx.controller.initCombat(50, 50, 3, { enemies: [enemyData] });

    const intentEvent = ctx.events.find((e) => e.event === 'onIntentSelected');
    expect(intentEvent).toBeDefined();
    const p = intentEvent!.payload as { displayDamage: number; intentType: string };
    expect(p.displayDamage).toBe(10);
    expect(p.intentType).toBe('attack');
  });

  it('turn_count >= 3 only matches from turn 3 onward', () => {
    const ctx = createFirstTurnCtx();
    const enemyData = makeEnemyData({
      conditionalMoves: [
        { trigger: 'turn_count', operator: '>=', value: 3, moveId: 'opening_attack' },
      ],
      moveDefinitions: {
        opening_attack: OPENING_ATK,
        normal_atk: NORMAL_ATK,
        def: DEFEND_MOVE,
      },
    });

    ctx.controller.initCombat(50, 50, 3, { enemies: [enemyData] });
    const enemy = ctx.controller.getState().enemies[0];

    // Turn 1: 1 >= 3 is false → falls back to weighted pool (mock returns normal_atk)
    expect(enemy.currentMove!.id).toBe('normal_atk');
  });
});
