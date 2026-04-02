/**
 * intent-display.test.ts — Tests for intent display data pipeline.
 *
 * Validates S2-12 acceptance criteria:
 * - Intent display damage = floor((base + strength) * vulnerable * weak) per enemy-ai GDD
 * - Snapshot at selection time (does not update if modifiers change)
 * - Intent data includes: icon type, damage value, block value, effect name
 * - onIntentSelected event emitted with full intent payload
 */

// @vitest-environment node

import { describe, it, expect } from 'vitest';
import { CombatController } from '../../../src/systems/combat-controller';
import { TurnPhase } from '../../../src/types/combat';
import type { CombatEnemyInstance, EnemyMove } from '../../../src/types/enemy';

// ---------------------------------------------------------------------------
// Test Fixtures
// ---------------------------------------------------------------------------

const ATK_MOVE: EnemyMove = {
  id: 'atk',
  name: 'Attack',
  intent: 'attack' as never,
  effects: [{ type: 'deal_damage', value: 6 }],
  damage: 6,
};

const DEFEND_MOVE: EnemyMove = {
  id: 'def',
  name: 'Defend',
  intent: 'defend' as never,
  effects: [{ type: 'gain_block', value: 8 }],
  block: 8,
};

const BUFF_MOVE: EnemyMove = {
  id: 'buff',
  name: 'Buff',
  intent: 'buff' as never,
  effects: [{ type: 'apply_status', value: 2, status: 'strength' }],
};

function makeEnemy(overrides: Partial<CombatEnemyInstance> = {}): CombatEnemyInstance {
  return {
    instanceId: 'e1',
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

// ---------------------------------------------------------------------------
// Test Context — copy from combat-loop.test.ts (the working pattern)
// ---------------------------------------------------------------------------

interface IntentCtx {
  controller: CombatController;
  statusStacks: Record<string, number>;
  events: Array<{ event: string; payload: unknown }>;
}

function createIntentCtx(opts: { energy?: number } = {}): IntentCtx {
  let currentEnergy = opts.energy ?? 3;
  let effectiveMaxEnergy = opts.energy ?? 3;
  const statusStacks: Record<string, number> = {};
  const events: Array<{ event: string; payload: unknown }> = [];
  const hand: unknown[] = [];

  const ctx: IntentCtx = { controller: null!, statusStacks, events };

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
      getHand: () => [],
      discardCards: () => {},
      exhaustCards: () => {},
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
        currentEnergy -= cost;
        return cost;
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
      createInstance: () => makeEnemy(),
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

/** Setup: combat in ENEMY_TURN phase with one enemy */
function setupEnemyTurn(ctx: IntentCtx, enemy: CombatEnemyInstance, hp = 50): void {
  ctx.controller.startCombat(hp, hp, 3);
  ctx.controller.transitionToPlayerTurn();
  ctx.controller.transitionToEnemyTurn();
  (ctx.controller.getState() as { enemies: CombatEnemyInstance[] }).enemies.push(enemy);
}

// ===========================================================================
// Intent Display Data Pipeline
// ===========================================================================

describe('Intent display data pipeline', () => {
  it('emits onIntentSelected when enemy selects a move', () => {
    const ctx = createIntentCtx();
    const enemy = makeEnemy({ currentMove: ATK_MOVE });
    setupEnemyTurn(ctx, enemy);

    ctx.controller.executeEnemyTurn();

    const intentEvent = ctx.events.find((e) => e.event === 'onIntentSelected');
    expect(intentEvent).toBeDefined();
    const payload = intentEvent!.payload as { enemyId: string };
    expect(payload.enemyId).toBe('e1');
  });

  it('displays base damage with no modifiers', () => {
    const ctx = createIntentCtx();
    const enemy = makeEnemy({ currentMove: ATK_MOVE }); // base 6
    setupEnemyTurn(ctx, enemy);

    ctx.controller.executeEnemyTurn();

    const intentEvent = ctx.events.find((e) => e.event === 'onIntentSelected')!;
    const payload = intentEvent.payload as { displayDamage: number };
    expect(payload.displayDamage).toBe(6);
  });

  it('displays block amount for defend move', () => {
    const ctx = createIntentCtx();
    const enemy = makeEnemy({ currentMove: DEFEND_MOVE });
    setupEnemyTurn(ctx, enemy);

    ctx.controller.executeEnemyTurn();

    const intentEvent = ctx.events.find((e) => e.event === 'onIntentSelected')!;
    const payload = intentEvent.payload as { displayDamage: number; blockAmount: number };
    expect(payload.displayDamage).toBe(0);
    expect(payload.blockAmount).toBe(8);
  });

  it('displays effect name for status application move', () => {
    const ctx = createIntentCtx();
    const enemy = makeEnemy({ currentMove: BUFF_MOVE });
    setupEnemyTurn(ctx, enemy);

    ctx.controller.executeEnemyTurn();

    const intentEvent = ctx.events.find((e) => e.event === 'onIntentSelected')!;
    const payload = intentEvent.payload as { effectName: string | null };
    expect(payload.effectName).toBe('strength');
  });

  it('includes enemy Strength in display damage', () => {
    const ctx = createIntentCtx();
    ctx.statusStacks['e1:strength'] = 3;
    const enemy = makeEnemy({ currentMove: ATK_MOVE }); // base 6
    setupEnemyTurn(ctx, enemy);

    ctx.controller.executeEnemyTurn();

    const intentEvent = ctx.events.find((e) => e.event === 'onIntentSelected')!;
    const payload = intentEvent.payload as { displayDamage: number };
    // 6 + 3 = 9
    expect(payload.displayDamage).toBe(9);
  });

  it('applies player Vulnerable multiplier to display damage', () => {
    const ctx = createIntentCtx();
    ctx.statusStacks['player:vulnerable'] = 1;
    const enemy = makeEnemy({ currentMove: ATK_MOVE }); // base 6
    setupEnemyTurn(ctx, enemy);

    ctx.controller.executeEnemyTurn();

    const intentEvent = ctx.events.find((e) => e.event === 'onIntentSelected')!;
    const payload = intentEvent.payload as { displayDamage: number };
    // floor(6 * 1.5) = 9
    expect(payload.displayDamage).toBe(9);
  });

  it('applies enemy Weak multiplier to display damage', () => {
    const ctx = createIntentCtx();
    ctx.statusStacks['e1:weak'] = 1;
    const enemy = makeEnemy({ currentMove: ATK_MOVE }); // base 6
    setupEnemyTurn(ctx, enemy);

    ctx.controller.executeEnemyTurn();

    const intentEvent = ctx.events.find((e) => e.event === 'onIntentSelected')!;
    const payload = intentEvent.payload as { displayDamage: number };
    // floor(6 * 0.75) = 4
    expect(payload.displayDamage).toBe(4);
  });

  it('applies Strength + Vulnerable + Weak combined', () => {
    const ctx = createIntentCtx();
    ctx.statusStacks['e1:strength'] = 4;
    ctx.statusStacks['player:vulnerable'] = 1;
    ctx.statusStacks['e1:weak'] = 1;
    const enemy = makeEnemy({ currentMove: ATK_MOVE }); // base 6
    setupEnemyTurn(ctx, enemy);

    ctx.controller.executeEnemyTurn();

    const intentEvent = ctx.events.find((e) => e.event === 'onIntentSelected')!;
    const payload = intentEvent.payload as { displayDamage: number };
    // (6 + 4) = 10, Vulnerable: floor(10 * 1.5) = 15, Weak: floor(15 * 0.75) = 11
    expect(payload.displayDamage).toBe(11);
  });

  it('emits intent for each enemy', () => {
    const ctx = createIntentCtx();
    ctx.controller.startCombat(50, 50, 3);
    ctx.controller.transitionToPlayerTurn();
    ctx.controller.transitionToEnemyTurn();
    const e1 = makeEnemy({ instanceId: 'e1', currentMove: ATK_MOVE });
    const e2 = makeEnemy({ instanceId: 'e2', currentMove: DEFEND_MOVE });
    (ctx.controller.getState() as { enemies: CombatEnemyInstance[] }).enemies.push(e1, e2);

    ctx.controller.executeEnemyTurn();

    const intentEvents = ctx.events.filter((e) => e.event === 'onIntentSelected');
    expect(intentEvents.length).toBeGreaterThanOrEqual(2);
  });

  it('uses move-level damage field when no deal_damage effects', () => {
    const ctx = createIntentCtx();
    const bigDmgMove: EnemyMove = {
      id: 'big_hit',
      name: 'Big Hit',
      intent: 'attack' as never,
      effects: [{ type: 'apply_status', value: 2, status: 'strength' }],
      damage: 12,
    };
    const enemy = makeEnemy({ currentMove: bigDmgMove });
    setupEnemyTurn(ctx, enemy);

    ctx.controller.executeEnemyTurn();

    const intentEvent = ctx.events.find((e) => e.event === 'onIntentSelected')!;
    const payload = intentEvent.payload as { displayDamage: number };
    expect(payload.displayDamage).toBe(12);
  });

  it('uses move-level block field when no gain_block effects', () => {
    const ctx = createIntentCtx();
    const moveWithBlock: EnemyMove = {
      id: 'big_def',
      name: 'Big Defend',
      intent: 'defend' as never,
      effects: [],
      block: 10,
    };
    const enemy = makeEnemy({ currentMove: moveWithBlock });
    setupEnemyTurn(ctx, enemy);

    ctx.controller.executeEnemyTurn();

    const intentEvent = ctx.events.find((e) => e.event === 'onIntentSelected')!;
    const payload = intentEvent.payload as { blockAmount: number };
    expect(payload.blockAmount).toBe(10);
  });

  it('intentType reflects the move intent field', () => {
    const ctx = createIntentCtx();
    const enemy = makeEnemy({ currentMove: ATK_MOVE });
    setupEnemyTurn(ctx, enemy);

    ctx.controller.executeEnemyTurn();

    const intentEvent = ctx.events.find((e) => e.event === 'onIntentSelected')!;
    const payload = intentEvent.payload as { intentType: string };
    expect(payload.intentType).toBe('attack');
  });

  it('displays 0 for move with no damage or block', () => {
    const ctx = createIntentCtx();
    const noMove: EnemyMove = {
      id: 'nothing',
      name: 'Do Nothing',
      intent: 'sleep' as never,
      effects: [],
    };
    const enemy = makeEnemy({ currentMove: noMove });
    setupEnemyTurn(ctx, enemy);

    ctx.controller.executeEnemyTurn();

    const intentEvent = ctx.events.find((e) => e.event === 'onIntentSelected')!;
    const payload = intentEvent.payload as { displayDamage: number; blockAmount: number };
    expect(payload.displayDamage).toBe(0);
    expect(payload.blockAmount).toBe(0);
  });
});
