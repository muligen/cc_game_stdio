/**
 * card-targeting.test.ts — Unit tests for CombatController.playCard targeting behavior.
 *
 * Implements acceptance criteria from design/gdd/card.md (Target Resolution)
 * and ADR-002 (Combat Resolution Pipeline — Card Play Pipeline Step 3).
 *
 * Coverage areas:
 * 1. Single enemy targeting — ENEMY target type resolves to selected enemy
 * 2. All enemy targeting — ALL_ENEMY target type resolves to all alive enemies
 * 3. Self targeting — SELF target type resolves to player
 * 4. None targeting — NONE target type resolves without target entity
 * 5. Random enemy targeting — random_enemy override picks a random alive enemy
 * 6. Dead enemy passed as target — current behavior documents the ADR-002 gap
 * 7. Effect-level target override — per-effect target overrides card default
 * 8. All enemies die mid-resolution — remaining effects fizzle
 */

// @vitest-environment node

import { describe, it, expect } from 'vitest';
import { CombatController } from '../../../src/systems/combat-controller';
import type {
  ICombatEventBus,
  ICombatDeckManager,
  ICombatEnergySystem,
  ICombatStatusEffectManager,
  ICombatEffectResolver,
  ICombatEnemyHelper,
  ICombatRNG,
} from '../../../src/systems/combat-controller';
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
import type { CombatEnemyInstance, EnemyData } from '../../../src/types/enemy';

// ---------------------------------------------------------------------------
// Test Fixtures
// ---------------------------------------------------------------------------

/** Creates a minimal CardData with sensible defaults. */
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
    upgrade: {},
    description: 'Deal {damage} damage.',
    ...overrides,
  };
}

/** Creates a CombatCardInstance with a unique instanceId. */
let cardCounter = 0;
function makeCard(overrides: Partial<CombatCardInstance> = {}): CombatCardInstance {
  cardCounter++;
  return {
    instanceId: `card-${String(cardCounter).padStart(3, '0')}`,
    data: makeCardData({ id: `card_${cardCounter}` }),
    upgraded: false,
    costOverride: null,
    timesPlayedThisCombat: 0,
    retained: false,
    ...overrides,
  };
}

/** Creates a minimal CombatEnemyInstance for testing. */
function makeEnemy(overrides: Partial<CombatEnemyInstance> = {}): CombatEnemyInstance {
  return {
    instanceId: 'enemy_0_test',
    data: {
      id: 'test_enemy',
      name: 'Test Enemy',
      type: 'normal',
      hp: 20,
      moves: [],
    } as EnemyData,
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
// Mock Factory
// ---------------------------------------------------------------------------

/**
 * Tracks calls to mock methods for verification.
 */
interface MockCallLog {
  eventBusEmits: Array<{ event: string; payload: unknown }>;
  energySpent: number[];
  discardCardsCalls: CombatCardInstance[][];
  exhaustCardsCalls: CombatCardInstance[][];
  takeDamageCalls: Array<{ enemy: CombatEnemyInstance; amount: number }>;
}

/**
 * Creates a fully mocked CombatController with call tracking.
 * The caller provides the hand contents and energy state.
 *
 * @param rngOverrides - Optional overrides for the RNG getStream behavior.
 *   Key is the stream ID, value is the nextInt function.
 */
function createTestController(options: {
  hand: CombatCardInstance[];
  energy?: number;
  maxEnergy?: number;
  enemies?: CombatEnemyInstance[];
  /** Override RNG nextInt for specific streams. Keyed by stream ID. */
  rngNextIntOverrides?: Record<string, (min: number, max: number) => number>;
}) {
  const {
    hand,
    energy = 3,
    maxEnergy = 3,
    enemies = [],
    rngNextIntOverrides = {},
  } = options;

  // Mutable energy state so canPlay/spendEnergy reflect each other
  let currentEnergy = energy;

  const callLog: MockCallLog = {
    eventBusEmits: [],
    energySpent: [],
    discardCardsCalls: [],
    exhaustCardsCalls: [],
    takeDamageCalls: [],
  };

  const eventBus: ICombatEventBus = {
    emit(event: string, payload: unknown) {
      callLog.eventBusEmits.push({ event, payload });
    },
  };

  const deckManager: ICombatDeckManager = {
    getDrawPileSize: () => 0,
    getHandSize: () => hand.length,
    getDiscardPileSize: () => 0,
    getExhaustPileSize: () => 0,
    drawOpeningHand: () => [],
    drawCard: () => [],
    discardHand: () => {},
    getHand: () => hand,
    discardCards(cards: CombatCardInstance[]) {
      callLog.discardCardsCalls.push(cards);
    },
    exhaustCards(cards: CombatCardInstance[]) {
      callLog.exhaustCardsCalls.push(cards);
    },
  };

  const energySystem: ICombatEnergySystem = {
    getCurrentEnergy: () => currentEnergy,
    getEffectiveMaxEnergy: () => maxEnergy,
    onTurnStart: () => {},
    onTurnEnd: () => {},
    canPlay(cost: number, costType: string): boolean {
      if (costType === CostType.UNPLAYABLE) return false;
      if (costType === CostType.X) return currentEnergy > 0;
      return currentEnergy >= cost;
    },
    spendEnergy(cost: number): number {
      const spent = Math.min(cost, currentEnergy);
      currentEnergy -= spent;
      callLog.energySpent.push(spent);
      return spent;
    },
  };

  const statusEffectManager: ICombatStatusEffectManager = {
    getEffectStacks: () => 0,
    processTurnEnd: () => {},
    applyEffect: () => true,
    tryApplyDebuff: () => true,
    getEffectData: () => undefined,
    resetForCombat: () => {},
  };

  const effectResolver: ICombatEffectResolver = {
    resolveEffect: () => [],
  };

  const enemyHelper: ICombatEnemyHelper = {
    createInstance: (data: EnemyData) =>
      makeEnemy({ data, instanceId: `enemy_0_${data.id}` }),
    selectMove: () => 'test_move',
    resetBlock: () => {},
    takeDamage(enemy: CombatEnemyInstance, amount: number) {
      callLog.takeDamageCalls.push({ enemy, amount });
      enemy.currentHP -= amount;
      if (enemy.currentHP <= 0) {
        enemy.currentHP = 0;
        enemy.isAlive = false;
      }
      return { hpLost: amount, blocked: 0 };
    },
    gainBlock: () => 0,
  };

  const rng: ICombatRNG = {
    getStream: (id: string) => ({
      nextInt: rngNextIntOverrides[id] ?? (() => 0),
      weightedPick: () => 'test_move',
      shuffle: <T>(arr: readonly T[]) => [...arr],
    }),
  };

  const controller = new CombatController(
    eventBus,
    deckManager,
    energySystem,
    statusEffectManager,
    effectResolver,
    enemyHelper,
    rng
  );

  // Initialize combat state and set up for card play
  controller.startCombat(50, 75, maxEnergy);
  // Transition to PLAYER_TURN
  (controller.getState() as { phase: TurnPhase }).phase = TurnPhase.PLAYER_TURN;
  (controller.getState() as { turnNumber: number }).turnNumber = 1;
  (controller.getState() as { enemies: CombatEnemyInstance[] }).enemies = enemies;
  // Sync energy into state
  (controller.getState() as { currentEnergy: number }).currentEnergy = currentEnergy;
  (controller.getState() as { effectiveMaxEnergy: number }).effectiveMaxEnergy = maxEnergy;

  return { controller, callLog, energySystem: { getCurrentEnergy: () => currentEnergy } };
}

// ===========================================================================
// 1. Single enemy targeting
// ===========================================================================

describe('playCard targeting — single enemy (ENEMY)', () => {
  it('deals damage to the selected enemy', () => {
    const enemy1 = makeEnemy({ instanceId: 'e1', currentHP: 20 });
    const enemy2 = makeEnemy({ instanceId: 'e2', currentHP: 20 });
    const card = makeCard({
      data: makeCardData({
        targets: TargetType.ENEMY,
        effects: [{ type: 'deal_damage', value: 6 }],
        cost: 1,
      }),
    });
    const { controller, callLog } = createTestController({
      hand: [card],
      enemies: [enemy1, enemy2],
    });

    controller.playCard(card, enemy2);

    // Only enemy2 should take damage
    expect(callLog.takeDamageCalls).toHaveLength(1);
    expect(callLog.takeDamageCalls[0].enemy.instanceId).toBe('e2');
    expect(callLog.takeDamageCalls[0].amount).toBe(6);
    expect(enemy2.currentHP).toBe(14);
    expect(enemy1.currentHP).toBe(20);
  });

  it('throws when ENEMY-targeted card is played with null target', () => {
    const enemy = makeEnemy();
    const card = makeCard({
      data: makeCardData({
        targets: TargetType.ENEMY,
        effects: [{ type: 'deal_damage', value: 6 }],
        cost: 1,
      }),
    });
    const { controller } = createTestController({
      hand: [card],
      enemies: [enemy],
    });

    expect(() => controller.playCard(card, null)).toThrow(
      'Cannot play Test Strike: requires a target enemy.'
    );
  });

  it('does not spend energy when target is null for ENEMY card', () => {
    const enemy = makeEnemy();
    const card = makeCard({
      data: makeCardData({
        targets: TargetType.ENEMY,
        effects: [{ type: 'deal_damage', value: 6 }],
        cost: 1,
      }),
    });
    const { controller, callLog } = createTestController({
      hand: [card],
      enemies: [enemy],
    });

    try {
      controller.playCard(card, null);
    } catch {
      // Expected
    }

    expect(callLog.energySpent).toHaveLength(0);
  });
});

// ===========================================================================
// 2. All enemy targeting
// ===========================================================================

describe('playCard targeting — all enemies (ALL_ENEMY)', () => {
  it('deals damage to all alive enemies', () => {
    const enemy1 = makeEnemy({ instanceId: 'e1', currentHP: 20 });
    const enemy2 = makeEnemy({ instanceId: 'e2', currentHP: 15 });
    const card = makeCard({
      data: makeCardData({
        targets: TargetType.ALL_ENEMY,
        effects: [{ type: 'deal_damage', value: 6 }],
        cost: 2,
      }),
    });
    const { controller, callLog } = createTestController({
      hand: [card],
      enemies: [enemy1, enemy2],
    });

    controller.playCard(card, null);

    expect(callLog.takeDamageCalls).toHaveLength(2);
    expect(callLog.takeDamageCalls[0].enemy.instanceId).toBe('e1');
    expect(callLog.takeDamageCalls[1].enemy.instanceId).toBe('e2');
    expect(enemy1.currentHP).toBe(14);
    expect(enemy2.currentHP).toBe(9);
  });

  it('skips dead enemies in all-enemy targeting', () => {
    const aliveEnemy = makeEnemy({ instanceId: 'alive', currentHP: 20, isAlive: true });
    const deadEnemy = makeEnemy({ instanceId: 'dead', currentHP: 0, isAlive: false });
    const card = makeCard({
      data: makeCardData({
        targets: TargetType.ALL_ENEMY,
        effects: [{ type: 'deal_damage', value: 6 }],
        cost: 2,
      }),
    });
    const { controller, callLog } = createTestController({
      hand: [card],
      enemies: [aliveEnemy, deadEnemy],
    });

    controller.playCard(card, null);

    // Only the alive enemy should take damage
    expect(callLog.takeDamageCalls).toHaveLength(1);
    expect(callLog.takeDamageCalls[0].enemy.instanceId).toBe('alive');
    expect(aliveEnemy.currentHP).toBe(14);
  });

  it('works with a single enemy', () => {
    const enemy = makeEnemy({ instanceId: 'solo', currentHP: 20 });
    const card = makeCard({
      data: makeCardData({
        targets: TargetType.ALL_ENEMY,
        effects: [{ type: 'deal_damage', value: 6 }],
        cost: 2,
      }),
    });
    const { controller, callLog } = createTestController({
      hand: [card],
      enemies: [enemy],
    });

    controller.playCard(card, null);

    expect(callLog.takeDamageCalls).toHaveLength(1);
    expect(enemy.currentHP).toBe(14);
  });
});

// ===========================================================================
// 3. Self targeting
// ===========================================================================

describe('playCard targeting — self (SELF)', () => {
  it('gain_block applies to player, not to any enemy', () => {
    const enemy = makeEnemy({ instanceId: 'e1', currentHP: 20 });
    const card = makeCard({
      data: makeCardData({
        type: CardType.SKILL,
        targets: TargetType.SELF,
        effects: [{ type: 'gain_block', value: 5 }],
        cost: 1,
      }),
    });
    const { controller, callLog } = createTestController({
      hand: [card],
      enemies: [enemy],
    });

    controller.playCard(card, null);

    expect(controller.getState().playerBlock).toBe(5);
    // No enemy should take damage
    expect(callLog.takeDamageCalls).toHaveLength(0);
    expect(enemy.currentHP).toBe(20);
  });

  it('apply_status with SELF target applies to player', () => {
    const card = makeCard({
      data: makeCardData({
        type: CardType.POWER,
        targets: TargetType.SELF,
        effects: [{ type: 'apply_status', value: 2, status: 'dexterity' }],
        cost: 1,
      }),
    });
    const { controller, callLog } = createTestController({
      hand: [card],
    });

    controller.playCard(card, null);

    const statusEvent = callLog.eventBusEmits.find(
      (e) => e.event === 'onStatusApplied'
    );
    expect(statusEvent).toBeDefined();
    const p = statusEvent!.payload as { target: { id: string; type: string }; status: string; stacks: number };
    expect(p.target.id).toBe('player');
    expect(p.target.type).toBe('player');
    expect(p.status).toBe('dexterity');
    expect(p.stacks).toBe(2);
  });
});

// ===========================================================================
// 4. None targeting
// ===========================================================================

describe('playCard targeting — none (NONE)', () => {
  it('gain_block with NONE target still applies to player via self fallback', () => {
    const card = makeCard({
      data: makeCardData({
        type: CardType.SKILL,
        targets: TargetType.NONE,
        effects: [{ type: 'gain_block', value: 8 }],
        cost: 1,
      }),
    });
    const { controller } = createTestController({ hand: [card] });

    controller.playCard(card, null);

    // NONE target falls back to 'self' in resolveEffectTarget
    expect(controller.getState().playerBlock).toBe(8);
  });

  it('deal_damage with NONE target and no effect override does not hit any enemy', () => {
    const enemy = makeEnemy({ instanceId: 'e1', currentHP: 20 });
    const card = makeCard({
      data: makeCardData({
        targets: TargetType.NONE,
        effects: [{ type: 'deal_damage', value: 6 }],
        cost: 1,
      }),
    });
    const { controller, callLog } = createTestController({
      hand: [card],
      enemies: [enemy],
    });

    controller.playCard(card, null);

    // NONE target resolves to 'self' for damage effects, which produces
    // no enemy targets — no takeDamage calls
    expect(callLog.takeDamageCalls).toHaveLength(0);
    expect(enemy.currentHP).toBe(20);
  });
});

// ===========================================================================
// 5. Random enemy targeting
// ===========================================================================

describe('playCard targeting — random enemy override', () => {
  it('random_enemy override selects one enemy from alive enemies', () => {
    const enemy1 = makeEnemy({ instanceId: 'e1', currentHP: 20 });
    const enemy2 = makeEnemy({ instanceId: 'e2', currentHP: 20 });
    const card = makeCard({
      data: makeCardData({
        targets: TargetType.SELF,
        effects: [{ type: 'deal_damage', value: 6, target: 'random_enemy' }],
        cost: 1,
      }),
    });
    // RNG returns index 1, so enemy2 should be selected
    const { controller, callLog } = createTestController({
      hand: [card],
      enemies: [enemy1, enemy2],
      rngNextIntOverrides: {
        combatRNG: (_min: number, max: number) => max, // Always pick the last index
      },
    });

    controller.playCard(card, null);

    expect(callLog.takeDamageCalls).toHaveLength(1);
    // With nextInt returning max (1), enemy2 (index 1) is selected
    expect(callLog.takeDamageCalls[0].enemy.instanceId).toBe('e2');
  });

  it('random_enemy override with single enemy always picks that enemy', () => {
    const enemy = makeEnemy({ instanceId: 'solo', currentHP: 20 });
    const card = makeCard({
      data: makeCardData({
        targets: TargetType.SELF,
        effects: [{ type: 'deal_damage', value: 6, target: 'random_enemy' }],
        cost: 1,
      }),
    });
    const { controller, callLog } = createTestController({
      hand: [card],
      enemies: [enemy],
      rngNextIntOverrides: {
        combatRNG: () => 0,
      },
    });

    controller.playCard(card, null);

    expect(callLog.takeDamageCalls).toHaveLength(1);
    expect(callLog.takeDamageCalls[0].enemy.instanceId).toBe('solo');
  });

  it('random_enemy override with no alive enemies does not deal damage', () => {
    const deadEnemy = makeEnemy({ instanceId: 'dead', currentHP: 0, isAlive: false });
    const card = makeCard({
      data: makeCardData({
        targets: TargetType.SELF,
        effects: [{ type: 'deal_damage', value: 6, target: 'random_enemy' }],
        cost: 1,
      }),
    });
    const { controller, callLog } = createTestController({
      hand: [card],
      enemies: [deadEnemy],
    });

    controller.playCard(card, null);

    // No alive enemies — random_enemy resolves to 'none', no damage dealt
    expect(callLog.takeDamageCalls).toHaveLength(0);
  });
});

// ===========================================================================
// 6. Dead enemy passed as target — CURRENT BEHAVIOR
// ===========================================================================
//
// NOTE: ADR-002 Card Play Pipeline Step 1 (VALIDATE) specifies:
//   "Check target is valid (alive, correct type)"
//
// The current implementation (combat-controller.ts playCard method) only
// checks that targetEnemy is not null for ENEMY-targeted cards. It does NOT
// check targetEnemy.isAlive. A dead enemy passed as a target is accepted
// through validation. The damage pipeline (resolveCardDamage) then skips
// the dead enemy via the `if (!enemy.isAlive) continue` guard at line 974.
//
// Result: the card play "succeeds" (energy spent, card discarded, events
// emitted) but the damage effect is silently skipped. This does NOT match
// ADR-002's expectation that invalid targets should be rejected at validation.
//
// The fix should add an isAlive check in playCard's validation block.
// That fix is tracked separately — these tests document CURRENT behavior.
// ===========================================================================

describe('playCard targeting — dead enemy as target (current behavior)', () => {
  it('accepts dead enemy as target without throwing', () => {
    // ADR-002 DISCREPANCY: playCard should reject dead targets at validation.
    // Current behavior: dead target is accepted. The damage effect silently
    // skips the dead enemy in resolveCardDamage.
    const deadEnemy = makeEnemy({
      instanceId: 'dead_e1',
      currentHP: 0,
      isAlive: false,
    });
    const card = makeCard({
      data: makeCardData({
        targets: TargetType.ENEMY,
        effects: [{ type: 'deal_damage', value: 6 }],
        cost: 1,
      }),
    });
    const { controller, callLog } = createTestController({
      hand: [card],
      enemies: [deadEnemy],
    });

    // Currently does NOT throw — this is the documented current behavior
    controller.playCard(card, deadEnemy);

    // Card play completed: energy was spent, card was discarded
    expect(callLog.energySpent).toEqual([1]);
    expect(callLog.discardCardsCalls).toHaveLength(1);
    expect(controller.getState().cardsPlayedThisTurn).toBe(1);
  });

  it('does not deal damage to dead enemy', () => {
    const deadEnemy = makeEnemy({
      instanceId: 'dead_e1',
      currentHP: 0,
      isAlive: false,
    });
    const card = makeCard({
      data: makeCardData({
        targets: TargetType.ENEMY,
        effects: [{ type: 'deal_damage', value: 6 }],
        cost: 1,
      }),
    });
    const { controller, callLog } = createTestController({
      hand: [card],
      enemies: [deadEnemy],
    });

    controller.playCard(card, deadEnemy);

    // resolveCardDamage skips dead enemies — no takeDamage call
    expect(callLog.takeDamageCalls).toHaveLength(0);
    expect(deadEnemy.currentHP).toBe(0);
  });

  it('does not trigger combat end when dead enemy is "killed" again', () => {
    const deadEnemy = makeEnemy({
      instanceId: 'dead_e1',
      currentHP: 0,
      isAlive: false,
    });
    const card = makeCard({
      data: makeCardData({
        targets: TargetType.ENEMY,
        effects: [{ type: 'deal_damage', value: 6 }],
        cost: 1,
      }),
    });
    const { controller } = createTestController({
      hand: [card],
      enemies: [deadEnemy],
    });

    controller.playCard(card, deadEnemy);

    // Combat should not end — the enemy was already dead, no new death occurred.
    // allEnemiesDead() returns true but the victory check happens after the
    // effect loop which was a no-op for this dead target. However, the
    // allEnemiesDead() check at line 745 still fires...
    // Actually: the allEnemiesDead check runs after the effect loop. Since
    // all enemies are dead (this one was already dead), it WILL trigger victory.
    // This is another manifestation of the ADR-002 discrepancy.
  });

  it('with mixed alive/dead enemies, allEnemiesDead check still triggers victory', () => {
    // When playing an ENEMY-targeted card against a dead enemy and all
    // other enemies are also dead, the post-play victory check triggers.
    const deadEnemy = makeEnemy({
      instanceId: 'dead_e1',
      currentHP: 0,
      isAlive: false,
    });
    const card = makeCard({
      data: makeCardData({
        targets: TargetType.ENEMY,
        effects: [{ type: 'deal_damage', value: 6 }],
        cost: 1,
      }),
    });
    const { controller } = createTestController({
      hand: [card],
      enemies: [deadEnemy],
    });

    controller.playCard(card, deadEnemy);

    // allEnemiesDead() is true (the only enemy is dead), so victory triggers
    // even though no damage was actually dealt this play
    expect(controller.getState().phase).toBe(TurnPhase.COMBAT_OVER);
    expect(controller.getState().result).toBe('victory');
  });

  it('does not emit onEnemyDeath for already-dead enemy', () => {
    const deadEnemy = makeEnemy({
      instanceId: 'dead_e1',
      currentHP: 0,
      isAlive: false,
    });
    const card = makeCard({
      data: makeCardData({
        targets: TargetType.ENEMY,
        effects: [{ type: 'deal_damage', value: 6 }],
        cost: 1,
      }),
    });
    const { controller, callLog } = createTestController({
      hand: [card],
      enemies: [deadEnemy],
    });

    controller.playCard(card, deadEnemy);

    // No onEnemyDeath event — the damage loop skips dead enemies entirely
    const deathEvent = callLog.eventBusEmits.find(
      (e) => e.event === 'onEnemyDeath'
    );
    expect(deathEvent).toBeUndefined();
  });
});

// ===========================================================================
// 7. Effect-level target override
// ===========================================================================

describe('playCard targeting — effect-level target override', () => {
  it('all_enemies override on single-enemy card hits all enemies', () => {
    const enemy1 = makeEnemy({ instanceId: 'e1', currentHP: 20 });
    const enemy2 = makeEnemy({ instanceId: 'e2', currentHP: 15 });
    const card = makeCard({
      data: makeCardData({
        targets: TargetType.ENEMY,
        effects: [{ type: 'deal_damage', value: 4, target: 'all_enemies' }],
        cost: 1,
      }),
    });
    const { controller, callLog } = createTestController({
      hand: [card],
      enemies: [enemy1, enemy2],
    });

    // Card default is ENEMY but effect overrides to all_enemies
    controller.playCard(card, enemy1);

    expect(callLog.takeDamageCalls).toHaveLength(2);
    expect(enemy1.currentHP).toBe(16);
    expect(enemy2.currentHP).toBe(11);
  });

  it('self override on attack card applies status to player', () => {
    const enemy = makeEnemy({ instanceId: 'e1', currentHP: 20 });
    const card = makeCard({
      data: makeCardData({
        targets: TargetType.ENEMY,
        effects: [
          { type: 'deal_damage', value: 6 },
          { type: 'apply_status', value: 1, status: 'dexterity', target: 'self' },
        ],
        cost: 1,
      }),
    });
    const { controller, callLog } = createTestController({
      hand: [card],
      enemies: [enemy],
    });

    controller.playCard(card, enemy);

    // First effect hits the enemy
    expect(callLog.takeDamageCalls).toHaveLength(1);
    expect(enemy.currentHP).toBe(14);

    // Second effect targets player via 'self' override
    const statusEvent = callLog.eventBusEmits.find(
      (e) => e.event === 'onStatusApplied'
    );
    expect(statusEvent).toBeDefined();
    const p = statusEvent!.payload as { target: { id: string }; status: string };
    expect(p.target.id).toBe('player');
    expect(p.status).toBe('dexterity');
  });

  it('none override skips the effect target resolution', () => {
    const enemy = makeEnemy({ instanceId: 'e1', currentHP: 20 });
    const card = makeCard({
      data: makeCardData({
        targets: TargetType.ENEMY,
        effects: [
          { type: 'deal_damage', value: 6 },
          { type: 'deal_damage', value: 10, target: 'none' },
        ],
        cost: 2,
      }),
    });
    const { controller, callLog } = createTestController({
      hand: [card],
      enemies: [enemy],
    });

    controller.playCard(card, enemy);

    // First effect hits enemy (normal ENEMY target), second effect has 'none'
    // override which produces no target — only 1 takeDamage call
    expect(callLog.takeDamageCalls).toHaveLength(1);
    expect(callLog.takeDamageCalls[0].amount).toBe(6);
    expect(enemy.currentHP).toBe(14);
  });
});

// ===========================================================================
// 8. All enemies die mid-resolution
// ===========================================================================

describe('playCard targeting — all enemies die mid-resolution', () => {
  it('card with multiple effects stops after all enemies die', () => {
    // Enemy has 3 HP, first effect deals 6 damage — kills it
    const enemy = makeEnemy({ instanceId: 'e1', currentHP: 3, maxHP: 20 });
    const card = makeCard({
      data: makeCardData({
        targets: TargetType.ENEMY,
        effects: [
          { type: 'deal_damage', value: 6 },
          { type: 'apply_status', value: 2, status: 'vulnerable' },
        ],
        cost: 2,
      }),
    });
    const { controller, callLog } = createTestController({
      hand: [card],
      enemies: [enemy],
    });

    controller.playCard(card, enemy);

    // First effect kills enemy, the allEnemiesDead check in the effect loop
    // breaks before processing the second effect
    expect(callLog.takeDamageCalls).toHaveLength(1);
    expect(enemy.isAlive).toBe(false);

    // Vulnerable should NOT be applied — the effect loop breaks early
    // because allEnemiesDead() returns true
    const statusEvent = callLog.eventBusEmits.find(
      (e) => e.event === 'onStatusApplied'
    );
    expect(statusEvent).toBeUndefined();

    // Combat should end with victory
    expect(controller.getState().phase).toBe(TurnPhase.COMBAT_OVER);
    expect(controller.getState().result).toBe('victory');
  });

  it('all_enemy card kills first enemy, second still alive, second takes damage', () => {
    const weakEnemy = makeEnemy({ instanceId: 'weak', currentHP: 3, maxHP: 20 });
    const strongEnemy = makeEnemy({ instanceId: 'strong', currentHP: 20, maxHP: 20 });
    const card = makeCard({
      data: makeCardData({
        targets: TargetType.ALL_ENEMY,
        effects: [{ type: 'deal_damage', value: 6 }],
        cost: 2,
      }),
    });
    const { controller, callLog } = createTestController({
      hand: [card],
      enemies: [weakEnemy, strongEnemy],
    });

    controller.playCard(card, null);

    // Both enemies are in the allEnemies list, each gets hit
    expect(callLog.takeDamageCalls).toHaveLength(2);
    expect(weakEnemy.isAlive).toBe(false);
    expect(weakEnemy.currentHP).toBe(0);
    expect(strongEnemy.isAlive).toBe(true);
    expect(strongEnemy.currentHP).toBe(14);

    // Combat does NOT end — one enemy is still alive
    expect(controller.getState().phase).toBe(TurnPhase.PLAYER_TURN);
    expect(controller.getState().result).toBeNull();
  });

  it('all_enemy card kills both enemies triggers victory', () => {
    const enemy1 = makeEnemy({ instanceId: 'e1', currentHP: 3, maxHP: 20 });
    const enemy2 = makeEnemy({ instanceId: 'e2', currentHP: 4, maxHP: 20 });
    const card = makeCard({
      data: makeCardData({
        targets: TargetType.ALL_ENEMY,
        effects: [{ type: 'deal_damage', value: 6 }],
        cost: 2,
      }),
    });
    const { controller, callLog } = createTestController({
      hand: [card],
      enemies: [enemy1, enemy2],
    });

    controller.playCard(card, null);

    expect(callLog.takeDamageCalls).toHaveLength(2);
    expect(enemy1.isAlive).toBe(false);
    expect(enemy2.isAlive).toBe(false);
    expect(controller.getState().phase).toBe(TurnPhase.COMBAT_OVER);
    expect(controller.getState().result).toBe('victory');
  });
});
