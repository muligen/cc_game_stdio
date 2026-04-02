/**
 * combat-display-events.test.ts — Tests for combat display events emitted
 * for UI consumption.
 *
 * Validates S2-13 acceptance criteria:
 * - onDamageDealt carries source, target, rawDamage, damage (HP lost), blocked
 * - onBlockGained carries target, amount, total
 * - onHPChanged carries target, oldHP, newHP, maxHP
 * - onEnergyChanged carries oldEnergy, newEnergy, effectiveMaxEnergy
 * - onCardPlayed carries card info, target, source
 * - onStatusApplied carries target, status, stacks
 * - All events emitted at correct timing per ADR-002 pipeline
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
import type { CombatEnemyInstance, EnemyMove } from '../../../src/types/enemy';

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

interface DisplayEventsCtx {
  controller: CombatController;
  statusStacks: Record<string, number>;
  hand: CombatCardInstance[];
  events: Array<{ event: string; payload: unknown }>;
  getEnergy: () => number;
}

function createDisplayCtx(opts: { playerHP?: number; energy?: number } = {}): DisplayEventsCtx {
  const playerHP = opts.playerHP ?? 50;
  let currentEnergy = opts.energy ?? 3;
  let maxEnergy = opts.energy ?? 3;

  const statusStacks: Record<string, number> = {};
  const hand: CombatCardInstance[] = [];
  const events: Array<{ event: string; payload: unknown }> = [];

  const ctx: DisplayEventsCtx = { controller: null!, statusStacks, hand, events, getEnergy: () => currentEnergy };

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
      getEffectData: (effectId: string) => {
        if (['weak', 'vulnerable', 'frail'].includes(effectId)) return { category: 'debuff' };
        return { category: 'buff' };
      },
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

function setupPlayerTurn(ctx: DisplayEventsCtx, hp = 50, energy = 3): void {
  ctx.controller.startCombat(hp, hp, energy);
  ctx.controller.transitionToPlayerTurn();
}

// ===========================================================================
// onDamageDealt events
// ===========================================================================

describe('onDamageDealt display events', () => {
  it('card damage includes rawDamage, damage (hpLost), and blocked', () => {
    const ctx = createDisplayCtx();
    const card = makeCard({ data: makeCardData({ effects: [{ type: 'deal_damage', value: 10 }] }) });
    const enemy = makeEnemyInstance({ instanceId: 'e1', currentHP: 30, block: 3 });
    setupPlayerTurn(ctx);
    (ctx.controller.getState() as { enemies: CombatEnemyInstance[] }).enemies.push(enemy);

    ctx.hand.push(card);
    ctx.controller.playCard(card, enemy);

    const dmgEvent = ctx.events.find((e) => e.event === 'onDamageDealt')!;
    const p = dmgEvent.payload as { rawDamage: number; damage: number; blocked: number };
    // rawDamage = 10, blocked = 3, hpLost = 7
    expect(p.rawDamage).toBe(10);
    expect(p.blocked).toBe(3);
    expect(p.damage).toBe(7);
  });

  it('card damage carries source and target', () => {
    const ctx = createDisplayCtx();
    const card = makeCard({ data: makeCardData({ effects: [{ type: 'deal_damage', value: 6 }] }) });
    const enemy = makeEnemyInstance({ instanceId: 'e1' });
    setupPlayerTurn(ctx);
    (ctx.controller.getState() as { enemies: CombatEnemyInstance[] }).enemies.push(enemy);

    ctx.hand.push(card);
    ctx.controller.playCard(card, enemy);

    const dmgEvent = ctx.events.find((e) => e.event === 'onDamageDealt')!;
    const p = dmgEvent.payload as { source: { id: string }; target: { id: string } };
    expect(p.source.id).toBe('player');
    expect(p.target.id).toBe('e1');
  });

  it('multi-hit emits onDamageDealt per hit', () => {
    const ctx = createDisplayCtx();
    const card = makeCard({ data: makeCardData({ effects: [{ type: 'deal_damage', value: 4, hits: 3 }] }) });
    const enemy = makeEnemyInstance({ instanceId: 'e1', currentHP: 30, block: 5 });
    setupPlayerTurn(ctx);
    (ctx.controller.getState() as { enemies: CombatEnemyInstance[] }).enemies.push(enemy);

    ctx.hand.push(card);
    ctx.controller.playCard(card, enemy);

    const dmgEvents = ctx.events.filter((e) => e.event === 'onDamageDealt');
    expect(dmgEvents).toHaveLength(3);

    // Hit 1: rawDamage=4, blocked=4, hpLost=0
    const p1 = dmgEvents[0].payload as { rawDamage: number; damage: number; blocked: number };
    expect(p1.rawDamage).toBe(4);
    expect(p1.blocked).toBe(4);
    expect(p1.damage).toBe(0);

    // Hit 2: rawDamage=4, blocked=1, hpLost=3
    const p2 = dmgEvents[1].payload as { rawDamage: number; damage: number; blocked: number };
    expect(p2.blocked).toBe(1);
    expect(p2.damage).toBe(3);

    // Hit 3: rawDamage=4, blocked=0, hpLost=4
    const p3 = dmgEvents[2].payload as { rawDamage: number; damage: number; blocked: number };
    expect(p3.blocked).toBe(0);
    expect(p3.damage).toBe(4);
  });

  it('enemy damage includes rawDamage, damage, and blocked', () => {
    const ctx = createDisplayCtx();
    setupPlayerTurn(ctx);
    ctx.controller.getState().playerBlock = 3;
    ctx.controller.transitionToEnemyTurn();
    const enemy = makeEnemyInstance({ instanceId: 'e1', currentMove: ATK_MOVE }); // 8 damage
    (ctx.controller.getState() as { enemies: CombatEnemyInstance[] }).enemies.push(enemy);

    ctx.controller.executeEnemyTurn();

    const dmgEvent = ctx.events.find((e) => e.event === 'onDamageDealt')!;
    const p = dmgEvent.payload as { rawDamage: number; damage: number; blocked: number; source: { id: string }; target: { id: string } };
    expect(p.rawDamage).toBe(8);
    expect(p.blocked).toBe(3);
    expect(p.damage).toBe(5);
    expect(p.source.id).toBe('e1');
    expect(p.target.id).toBe('player');
  });
});

// ===========================================================================
// onBlockGained events
// ===========================================================================

describe('onBlockGained display events', () => {
  it('block card emits onBlockGained with amount and total', () => {
    const ctx = createDisplayCtx();
    const card = makeCard({ data: makeCardData({ targets: TargetType.SELF, effects: [{ type: 'gain_block', value: 7 }] }) });
    setupPlayerTurn(ctx);

    ctx.hand.push(card);
    ctx.controller.playCard(card, null);

    const blockEvent = ctx.events.find((e) => e.event === 'onBlockGained')!;
    const p = blockEvent.payload as { target: { id: string }; amount: number; total: number };
    expect(p.target.id).toBe('player');
    expect(p.amount).toBe(7);
    expect(p.total).toBe(7);
  });

  it('cumulative block events show increasing totals', () => {
    const ctx = createDisplayCtx({ energy: 6 });
    setupPlayerTurn(ctx, 50, 6);

    const card1 = makeCard({ data: makeCardData({ targets: TargetType.SELF, effects: [{ type: 'gain_block', value: 4 }] }) });
    const card2 = makeCard({ data: makeCardData({ targets: TargetType.SELF, effects: [{ type: 'gain_block', value: 6 }] }) });

    ctx.hand.push(card1, card2);
    ctx.controller.playCard(card1, null);
    ctx.controller.playCard(card2, null);

    const blockEvents = ctx.events.filter((e) => e.event === 'onBlockGained');
    expect(blockEvents).toHaveLength(2);
    expect((blockEvents[0].payload as { total: number }).total).toBe(4);
    expect((blockEvents[1].payload as { total: number }).total).toBe(10);
  });
});

// ===========================================================================
// onHPChanged events
// ===========================================================================

describe('onHPChanged display events', () => {
  it('card damage to enemy emits onHPChanged', () => {
    const ctx = createDisplayCtx();
    const card = makeCard({ data: makeCardData({ effects: [{ type: 'deal_damage', value: 10 }] }) });
    const enemy = makeEnemyInstance({ instanceId: 'e1', currentHP: 25 });
    setupPlayerTurn(ctx);
    (ctx.controller.getState() as { enemies: CombatEnemyInstance[] }).enemies.push(enemy);

    ctx.hand.push(card);
    ctx.controller.playCard(card, enemy);

    const hpEvent = ctx.events.find((e) => e.event === 'onHPChanged')!;
    const p = hpEvent.payload as { target: { id: string }; oldHP: number; newHP: number; maxHP: number };
    expect(p.target.id).toBe('e1');
    expect(p.oldHP).toBe(25);
    expect(p.newHP).toBe(15);
    expect(p.maxHP).toBe(20);
  });

  it('enemy damage to player emits onHPChanged', () => {
    const ctx = createDisplayCtx();
    setupPlayerTurn(ctx);
    ctx.controller.transitionToEnemyTurn();
    const enemy = makeEnemyInstance({ instanceId: 'e1', currentMove: ATK_MOVE }); // 8 damage
    (ctx.controller.getState() as { enemies: CombatEnemyInstance[] }).enemies.push(enemy);

    ctx.controller.executeEnemyTurn();

    const hpEvent = ctx.events.find((e) => e.event === 'onHPChanged')!;
    const p = hpEvent.payload as { target: { id: string }; oldHP: number; newHP: number; maxHP: number };
    expect(p.target.id).toBe('player');
    expect(p.oldHP).toBe(50);
    expect(p.newHP).toBe(42);
    expect(p.maxHP).toBe(50);
  });

  it('blocked damage does not emit onHPChanged', () => {
    const ctx = createDisplayCtx();
    setupPlayerTurn(ctx);
    ctx.controller.getState().playerBlock = 20; // Full block
    ctx.controller.transitionToEnemyTurn();
    const enemy = makeEnemyInstance({ instanceId: 'e1', currentMove: ATK_MOVE }); // 8 damage
    (ctx.controller.getState() as { enemies: CombatEnemyInstance[] }).enemies.push(enemy);

    ctx.controller.executeEnemyTurn();

    const hpEvents = ctx.events.filter((e) => e.event === 'onHPChanged');
    expect(hpEvents).toHaveLength(0);
  });

  it('setPlayerHP emits onHPChanged', () => {
    const ctx = createDisplayCtx();
    setupPlayerTurn(ctx);

    ctx.controller.setPlayerHP(35);

    const hpEvent = ctx.events.find((e) => e.event === 'onHPChanged')!;
    const p = hpEvent.payload as { target: { id: string }; oldHP: number; newHP: number };
    expect(p.target.id).toBe('player');
    expect(p.oldHP).toBe(50);
    expect(p.newHP).toBe(35);
  });

  it('setPlayerHP with same value does not emit', () => {
    const ctx = createDisplayCtx();
    setupPlayerTurn(ctx);

    ctx.controller.setPlayerHP(50);

    const hpEvents = ctx.events.filter((e) => e.event === 'onHPChanged');
    expect(hpEvents).toHaveLength(0);
  });

  it('multi-hit emits onHPChanged per hit that causes HP loss', () => {
    const ctx = createDisplayCtx();
    const card = makeCard({ data: makeCardData({ effects: [{ type: 'deal_damage', value: 4, hits: 3 }] }) });
    const enemy = makeEnemyInstance({ instanceId: 'e1', currentHP: 30, block: 5 });
    setupPlayerTurn(ctx);
    (ctx.controller.getState() as { enemies: CombatEnemyInstance[] }).enemies.push(enemy);

    ctx.hand.push(card);
    ctx.controller.playCard(card, enemy);

    // Hit 1: 4 vs 5 block → 0 HP lost, no onHPChanged
    // Hit 2: 4 vs 1 block → 3 HP lost
    // Hit 3: 4 vs 0 block → 4 HP lost
    const hpEvents = ctx.events.filter((e) => e.event === 'onHPChanged');
    expect(hpEvents).toHaveLength(2);

    const p2 = hpEvents[0].payload as { oldHP: number; newHP: number };
    expect(p2.oldHP).toBe(30);
    expect(p2.newHP).toBe(27);

    const p3 = hpEvents[1].payload as { oldHP: number; newHP: number };
    expect(p3.oldHP).toBe(27);
    expect(p3.newHP).toBe(23);
  });
});

// ===========================================================================
// onEnergyChanged events
// ===========================================================================

describe('onEnergyChanged display events', () => {
  it('playing a card emits onEnergyChanged with old and new values', () => {
    const ctx = createDisplayCtx({ energy: 3 });
    setupPlayerTurn(ctx, 50, 3);

    const card = makeCard({ data: makeCardData({ cost: 1, effects: [{ type: 'deal_damage', value: 6 }] }) });
    const enemy = makeEnemyInstance({ instanceId: 'e1' });
    (ctx.controller.getState() as { enemies: CombatEnemyInstance[] }).enemies.push(enemy);

    ctx.hand.push(card);
    ctx.controller.playCard(card, enemy);

    const energyEvent = ctx.events.find((e) => e.event === 'onEnergyChanged')!;
    const p = energyEvent.payload as { oldEnergy: number; newEnergy: number; effectiveMaxEnergy: number };
    expect(p.oldEnergy).toBe(3);
    expect(p.newEnergy).toBe(2);
    expect(p.effectiveMaxEnergy).toBe(3);
  });

  it('ending player turn emits onEnergyChanged (zeroed)', () => {
    const ctx = createDisplayCtx({ energy: 3 });
    setupPlayerTurn(ctx, 50, 3);

    ctx.controller.endPlayerTurn();

    const energyEvents = ctx.events.filter((e) => e.event === 'onEnergyChanged');
    // Energy goes from 3 → 0
    const zeroEvent = energyEvents.find(
      (e) => (e.payload as { newEnergy: number }).newEnergy === 0
    );
    expect(zeroEvent).toBeDefined();
    const p = zeroEvent!.payload as { oldEnergy: number; newEnergy: number };
    expect(p.oldEnergy).toBeGreaterThan(0);
  });

  it('starting player turn emits onEnergyChanged (refilled)', () => {
    const ctx = createDisplayCtx({ energy: 3 });
    ctx.controller.startCombat(50, 50, 3);
    ctx.controller.transitionToPlayerTurn();
    ctx.controller.endPlayerTurn(); // Zeros energy
    ctx.events.length = 0; // Clear events from setup

    ctx.controller.startPlayerTurn(); // Refills energy

    const energyEvents = ctx.events.filter((e) => e.event === 'onEnergyChanged');
    const refillEvent = energyEvents.find(
      (e) => (e.payload as { newEnergy: number }).newEnergy === 3
    );
    expect(refillEvent).toBeDefined();
    const p = refillEvent!.payload as { oldEnergy: number; newEnergy: number };
    expect(p.oldEnergy).toBe(0);
    expect(p.newEnergy).toBe(3);
  });
});

// ===========================================================================
// onCardPlayed events
// ===========================================================================

describe('onCardPlayed display events', () => {
  it('playing a card emits onCardPlayed with card info and target', () => {
    const ctx = createDisplayCtx();
    const card = makeCard({ data: makeCardData({ effects: [{ type: 'deal_damage', value: 6 }] }) });
    const enemy = makeEnemyInstance({ instanceId: 'e1' });
    setupPlayerTurn(ctx);
    (ctx.controller.getState() as { enemies: CombatEnemyInstance[] }).enemies.push(enemy);

    ctx.hand.push(card);
    ctx.controller.playCard(card, enemy);

    const playedEvent = ctx.events.find((e) => e.event === 'onCardPlayed')!;
    const p = playedEvent.payload as {
      card: { instanceId: string; cardId: string; upgraded: boolean };
      target: { id: string; type: string };
      source: string;
    };
    expect(p.card.instanceId).toBe(card.instanceId);
    expect(p.card.cardId).toBe(card.data.id);
    expect(p.card.upgraded).toBe(false);
    expect(p.target.id).toBe('e1');
    expect(p.target.type).toBe('enemy');
    expect(p.source).toBe('player');
  });

  it('self-target card emits onCardPlayed with null target', () => {
    const ctx = createDisplayCtx();
    const card = makeCard({ data: makeCardData({ targets: TargetType.SELF, effects: [{ type: 'gain_block', value: 5 }] }) });
    setupPlayerTurn(ctx);

    ctx.hand.push(card);
    ctx.controller.playCard(card, null);

    const playedEvent = ctx.events.find((e) => e.event === 'onCardPlayed')!;
    const p = playedEvent.payload as { target: unknown };
    expect(p.target).toBeNull();
  });
});

// ===========================================================================
// onStatusApplied events
// ===========================================================================

describe('onStatusApplied display events', () => {
  it('card applying status to enemy emits onStatusApplied', () => {
    const ctx = createDisplayCtx();
    const card = makeCard({
      data: makeCardData({
        targets: TargetType.ENEMY,
        effects: [{ type: 'apply_status', value: 2, status: 'vulnerable' }],
      }),
    });
    const enemy = makeEnemyInstance({ instanceId: 'e1' });
    setupPlayerTurn(ctx);
    (ctx.controller.getState() as { enemies: CombatEnemyInstance[] }).enemies.push(enemy);

    ctx.hand.push(card);
    ctx.controller.playCard(card, enemy);

    const statusEvent = ctx.events.find((e) => e.event === 'onStatusApplied')!;
    const p = statusEvent.payload as { target: { id: string }; status: string; stacks: number };
    expect(p.target.id).toBe('e1');
    expect(p.status).toBe('vulnerable');
    expect(p.stacks).toBe(2);
  });

  it('card applying status to self emits onStatusApplied', () => {
    const ctx = createDisplayCtx();
    const card = makeCard({
      data: makeCardData({
        targets: TargetType.SELF,
        effects: [{ type: 'apply_status', value: 1, status: 'strength' }],
      }),
    });
    setupPlayerTurn(ctx);

    ctx.hand.push(card);
    ctx.controller.playCard(card, null);

    const statusEvent = ctx.events.find((e) => e.event === 'onStatusApplied')!;
    const p = statusEvent.payload as { target: { id: string }; status: string };
    expect(p.target.id).toBe('player');
    expect(p.status).toBe('strength');
  });

  it('enemy applying status to player emits onStatusApplied', () => {
    const ctx = createDisplayCtx();
    setupPlayerTurn(ctx);
    ctx.controller.transitionToEnemyTurn();

    const debuffMove: EnemyMove = {
      id: 'weak_atk',
      name: 'Weak Attack',
      intent: 'debuff' as never,
      effects: [
        { type: 'deal_damage', value: 3 },
        { type: 'apply_status', value: 1, status: 'weak' },
      ],
    };
    const enemy = makeEnemyInstance({ instanceId: 'e1', currentMove: debuffMove });
    (ctx.controller.getState() as { enemies: CombatEnemyInstance[] }).enemies.push(enemy);

    ctx.controller.executeEnemyTurn();

    const statusEvents = ctx.events.filter((e) => e.event === 'onStatusApplied');
    expect(statusEvents).toHaveLength(1);
    const p = statusEvents[0].payload as { target: { id: string }; status: string; stacks: number };
    expect(p.target.id).toBe('player');
    expect(p.status).toBe('weak');
    expect(p.stacks).toBe(1);
  });
});

// ===========================================================================
// Event timing validation
// ===========================================================================

describe('Event timing per ADR-002 pipeline', () => {
  it('events fire in correct order during card play', () => {
    const ctx = createDisplayCtx();
    const card = makeCard({ data: makeCardData({ effects: [
      { type: 'deal_damage', value: 6 },
      { type: 'gain_block', value: 3 },
    ] }) });
    const enemy = makeEnemyInstance({ instanceId: 'e1' });
    setupPlayerTurn(ctx);
    (ctx.controller.getState() as { enemies: CombatEnemyInstance[] }).enemies.push(enemy);

    ctx.hand.push(card);
    ctx.controller.playCard(card, enemy);

    // Find indices of key events
    const eventNames = ctx.events.map((e) => e.event);
    const energyIdx = eventNames.indexOf('onEnergyChanged');
    const dmgIdx = eventNames.indexOf('onDamageDealt');
    const hpIdx = eventNames.indexOf('onHPChanged');
    const blockIdx = eventNames.indexOf('onBlockGained');
    const playedIdx = eventNames.indexOf('onCardPlayed');

    // Energy spent first
    expect(energyIdx).toBeLessThan(dmgIdx);
    // Damage resolved before block
    expect(dmgIdx).toBeLessThan(blockIdx);
    // HP changed after damage dealt
    expect(hpIdx).toBeGreaterThan(dmgIdx);
    // onCardPlayed is last
    expect(playedIdx).toBeGreaterThan(blockIdx);
  });

  it('enemy turn events fire in correct order', () => {
    const ctx = createDisplayCtx();
    setupPlayerTurn(ctx);
    ctx.controller.transitionToEnemyTurn();
    const enemy = makeEnemyInstance({ instanceId: 'e1', currentMove: ATK_MOVE });
    (ctx.controller.getState() as { enemies: CombatEnemyInstance[] }).enemies.push(enemy);

    ctx.controller.executeEnemyTurn();

    const eventNames = ctx.events.map((e) => e.event);
    const dmgIdx = eventNames.indexOf('onDamageDealt');
    const hpIdx = eventNames.indexOf('onHPChanged');
    const intentIdx = eventNames.indexOf('onIntentSelected');
    const turnEndIdx = eventNames.indexOf('onEnemyTurnEnd');

    // Intent selected first
    expect(intentIdx).toBeLessThan(dmgIdx);
    // Damage dealt before HP changed
    expect(dmgIdx).toBeLessThan(hpIdx);
    // Turn end last
    expect(turnEndIdx).toBeGreaterThan(dmgIdx);
  });
});
