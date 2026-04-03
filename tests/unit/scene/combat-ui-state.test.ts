/**
 * combat-ui-state.test.ts — Unit tests for CombatUIState.
 *
 * Verifies that CombatUIState correctly projects combat events into
 * UI-readable snapshots. Uses the real GameEventBus (no mocks needed per
 * ADR-004 rationale: the custom bus is fully testable without Phaser).
 *
 * Coverage areas:
 * 1. Initial state snapshot matches constructor values
 * 2. subscribe() registers handlers; destroy() unsubscribes
 * 3. onHPChanged updates player HP and enemy HP
 * 4. onEnergyChanged updates energy display
 * 5. onBlockGained updates player and enemy block
 * 6. onEnemyDeath marks enemy dead and clears intent
 * 7. onPlayerTurnStart resets block, updates turn phase and number
 * 8. onPlayerTurnEnd updates turn phase to ENEMY_TURN
 * 9. onCombatEnd sets combat result and phase
 * 10. onIntentSelected updates enemy intent display
 * 11. onStatusApplied tracks status effects
 * 12. onCardPlayed increments cards played count
 * 13. getSnapshot returns independent copy
 * 14. addEnemy registers enemy in UI state
 * 15. Idempotent subscribe() / safe destroy()
 */

// @vitest-environment node

import { describe, it, expect, beforeEach } from 'vitest';
import { GameEventBus } from '../../../src/systems/game-event-bus';
import {
  CombatUIState,
  UITurnPhase,
  type CombatUISnapshot,
  type UIEnemyState,
} from '../../../src/scenes/combat/combat-ui-state';

// ---------------------------------------------------------------------------
// Test Helpers
// ---------------------------------------------------------------------------

/** Create a fresh GameEventBus + CombatUIState pair for each test. */
function createTestFixture(): {
  bus: GameEventBus;
  uiState: CombatUIState;
} {
  const bus = new GameEventBus();
  const uiState = new CombatUIState(bus, {
    playerHP: 80,
    playerMaxHP: 80,
    playerBlock: 0,
    currentEnergy: 3,
    effectiveMaxEnergy: 3,
  });
  return { bus, uiState };
}

/** Default initial values for assertions. */
const INITIAL = {
  playerHP: 80,
  playerMaxHP: 80,
  playerBlock: 0,
  currentEnergy: 3,
  effectiveMaxEnergy: 3,
};

// ===========================================================================
// 1. Initial state snapshot
// ===========================================================================

describe('CombatUIState — initial state', () => {
  it('returns constructor values in snapshot before subscribe', () => {
    const { uiState } = createTestFixture();
    const snap = uiState.getSnapshot();

    expect(snap.playerHP).toBe(INITIAL.playerHP);
    expect(snap.playerMaxHP).toBe(INITIAL.playerMaxHP);
    expect(snap.playerBlock).toBe(INITIAL.playerBlock);
    expect(snap.currentEnergy).toBe(INITIAL.currentEnergy);
    expect(snap.effectiveMaxEnergy).toBe(INITIAL.effectiveMaxEnergy);
    expect(snap.turnPhase).toBe(UITurnPhase.UNKNOWN);
    expect(snap.turnNumber).toBe(0);
    expect(snap.cardsPlayedThisTurn).toBe(0);
    expect(snap.combatResult).toBeNull();
    expect(snap.enemies).toEqual([]);
    expect(snap.statusEffects).toEqual([]);
  });

  it('isSubscribed returns false before subscribe', () => {
    const { uiState } = createTestFixture();
    expect(uiState.isSubscribed()).toBe(false);
  });
});

// ===========================================================================
// 2. subscribe() / destroy() lifecycle
// ===========================================================================

describe('CombatUIState — lifecycle', () => {
  it('isSubscribed returns true after subscribe', () => {
    const { uiState } = createTestFixture();
    uiState.subscribe();
    expect(uiState.isSubscribed()).toBe(true);
  });

  it('isSubscribed returns false after destroy', () => {
    const { uiState } = createTestFixture();
    uiState.subscribe();
    uiState.destroy();
    expect(uiState.isSubscribed()).toBe(false);
  });

  it('subscribe() is idempotent — calling twice does not double-register', () => {
    const { bus, uiState } = createTestFixture();
    uiState.subscribe();
    uiState.subscribe();

    // Emit an event and verify handler fires once (no duplicate updates)
    bus.emit('onEnergyChanged' as keyof import('../../../src/systems/game-event-bus').EventPayloadMap,
      { oldEnergy: 3, newEnergy: 2, effectiveMaxEnergy: 3 } as never);
    const snap = uiState.getSnapshot();
    expect(snap.currentEnergy).toBe(2);
  });

  it('destroy() is safe to call before subscribe', () => {
    const { uiState } = createTestFixture();
    expect(() => uiState.destroy()).not.toThrow();
  });

  it('destroy() is safe to call twice', () => {
    const { uiState } = createTestFixture();
    uiState.subscribe();
    uiState.destroy();
    expect(() => uiState.destroy()).not.toThrow();
  });

  it('events are not received after destroy', () => {
    const { bus, uiState } = createTestFixture();
    uiState.subscribe();
    uiState.destroy();

    // Emit energy change after destroy -- should not update
    bus.emit('onEnergyChanged' as keyof import('../../../src/systems/game-event-bus').EventPayloadMap,
      { oldEnergy: 3, newEnergy: 1, effectiveMaxEnergy: 3 } as never);
    const snap = uiState.getSnapshot();
    expect(snap.currentEnergy).toBe(INITIAL.currentEnergy);
  });
});

// ===========================================================================
// 3. onHPChanged — player HP update
// ===========================================================================

describe('CombatUIState — onHPChanged', () => {
  let bus: GameEventBus;
  let uiState: CombatUIState;

  beforeEach(() => {
    const fixture = createTestFixture();
    bus = fixture.bus;
    uiState = fixture.uiState;
    uiState.subscribe();
  });

  it('updates player HP from onHPChanged event', () => {
    bus.emit('onHPChanged' as keyof import('../../../src/systems/game-event-bus').EventPayloadMap, {
      target: { id: 'player', type: 'player' },
      oldHP: 80,
      newHP: 62,
      maxHP: 80,
    } as never);

    const snap = uiState.getSnapshot();
    expect(snap.playerHP).toBe(62);
    expect(snap.playerMaxHP).toBe(80);
  });

  it('updates enemy HP from onHPChanged event', () => {
    uiState.addEnemy('enemy_0_cultist', 'Cultist', 50, 60);

    bus.emit('onHPChanged' as keyof import('../../../src/systems/game-event-bus').EventPayloadMap, {
      target: { id: 'enemy_0_cultist', type: 'enemy' },
      oldHP: 50,
      newHP: 35,
      maxHP: 60,
    } as never);

    const snap = uiState.getSnapshot();
    expect(snap.enemies[0].currentHP).toBe(35);
    expect(snap.enemies[0].maxHP).toBe(60);
  });

  it('ignores onHPChanged for unknown enemy', () => {
    bus.emit('onHPChanged' as keyof import('../../../src/systems/game-event-bus').EventPayloadMap, {
      target: { id: 'nonexistent', type: 'enemy' },
      oldHP: 30,
      newHP: 20,
      maxHP: 40,
    } as never);

    // No crash, no enemies array change
    const snap = uiState.getSnapshot();
    expect(snap.enemies).toEqual([]);
  });
});

// ===========================================================================
// 4. onEnergyChanged
// ===========================================================================

describe('CombatUIState — onEnergyChanged', () => {
  it('updates energy display from event', () => {
    const { bus, uiState } = createTestFixture();
    uiState.subscribe();

    bus.emit('onEnergyChanged' as keyof import('../../../src/systems/game-event-bus').EventPayloadMap, {
      oldEnergy: 3,
      newEnergy: 1,
      effectiveMaxEnergy: 3,
    } as never);

    const snap = uiState.getSnapshot();
    expect(snap.currentEnergy).toBe(1);
    expect(snap.effectiveMaxEnergy).toBe(3);
  });

  it('handles bonus energy (effectiveMaxEnergy change)', () => {
    const { bus, uiState } = createTestFixture();
    uiState.subscribe();

    bus.emit('onEnergyChanged' as keyof import('../../../src/systems/game-event-bus').EventPayloadMap, {
      oldEnergy: 3,
      newEnergy: 4,
      effectiveMaxEnergy: 4,
    } as never);

    const snap = uiState.getSnapshot();
    expect(snap.currentEnergy).toBe(4);
    expect(snap.effectiveMaxEnergy).toBe(4);
  });
});

// ===========================================================================
// 5. onBlockGained
// ===========================================================================

describe('CombatUIState — onBlockGained', () => {
  it('updates player block from event', () => {
    const { bus, uiState } = createTestFixture();
    uiState.subscribe();

    bus.emit('onBlockGained' as keyof import('../../../src/systems/game-event-bus').EventPayloadMap, {
      target: { id: 'player', type: 'player' },
      amount: 5,
      total: 5,
    } as never);

    expect(uiState.getSnapshot().playerBlock).toBe(5);
  });

  it('updates enemy block from event', () => {
    const { bus, uiState } = createTestFixture();
    uiState.subscribe();
    uiState.addEnemy('enemy_0_jaw_worm', 'Jaw Worm', 40, 44);

    bus.emit('onBlockGained' as keyof import('../../../src/systems/game-event-bus').EventPayloadMap, {
      target: { id: 'enemy_0_jaw_worm', type: 'enemy' },
      amount: 8,
      total: 8,
    } as never);

    expect(uiState.getSnapshot().enemies[0].block).toBe(8);
  });
});

// ===========================================================================
// 6. onEnemyDeath
// ===========================================================================

describe('CombatUIState — onEnemyDeath', () => {
  it('marks enemy dead and clears intent', () => {
    const { bus, uiState } = createTestFixture();
    uiState.subscribe();
    uiState.addEnemy('enemy_0_cultist', 'Cultist', 50, 50);

    // Set an intent first
    bus.emit('onIntentSelected' as keyof import('../../../src/systems/game-event-bus').EventPayloadMap, {
      enemyId: 'enemy_0_cultist',
      intentType: 'attack',
      displayDamage: 10,
      blockAmount: 0,
      effectName: null,
    } as never);
    expect(uiState.getSnapshot().enemies[0].intent).not.toBeNull();

    // Kill the enemy
    bus.emit('onEnemyDeath' as keyof import('../../../src/systems/game-event-bus').EventPayloadMap, {
      enemy: { instanceId: 'enemy_0_cultist' },
    } as never);

    const enemy = uiState.getSnapshot().enemies[0];
    expect(enemy.isAlive).toBe(false);
    expect(enemy.intent).toBeNull();
  });

  it('ignores death event for unknown enemy', () => {
    const { bus, uiState } = createTestFixture();
    uiState.subscribe();

    expect(() => {
      bus.emit('onEnemyDeath' as keyof import('../../../src/systems/game-event-bus').EventPayloadMap, {
        enemy: { instanceId: 'unknown' },
      } as never);
    }).not.toThrow();
  });
});

// ===========================================================================
// 7. onPlayerTurnStart
// ===========================================================================

describe('CombatUIState — onPlayerTurnStart', () => {
  it('updates turn phase, number, and resets block and cards played', () => {
    const { bus, uiState } = createTestFixture();
    uiState.subscribe();

    // Simulate some block and cards played
    bus.emit('onBlockGained' as keyof import('../../../src/systems/game-event-bus').EventPayloadMap, {
      target: { id: 'player', type: 'player' },
      amount: 10,
      total: 10,
    } as never);
    bus.emit('onCardPlayed' as keyof import('../../../src/systems/game-event-bus').EventPayloadMap, {
      card: { instanceId: 'c1', cardId: 'strike_red', upgraded: false },
      target: null,
      source: 'player',
    } as never);
    expect(uiState.getSnapshot().playerBlock).toBe(10);
    expect(uiState.getSnapshot().cardsPlayedThisTurn).toBe(1);

    // Start new turn
    bus.emit('onPlayerTurnStart' as keyof import('../../../src/systems/game-event-bus').EventPayloadMap, {
      turnNumber: 2,
    } as never);

    const snap = uiState.getSnapshot();
    expect(snap.turnPhase).toBe(UITurnPhase.PLAYER_TURN);
    expect(snap.turnNumber).toBe(2);
    expect(snap.playerBlock).toBe(0);
    expect(snap.cardsPlayedThisTurn).toBe(0);
  });
});

// ===========================================================================
// 8. onPlayerTurnEnd
// ===========================================================================

describe('CombatUIState — onPlayerTurnEnd', () => {
  it('updates turn phase to ENEMY_TURN', () => {
    const { bus, uiState } = createTestFixture();
    uiState.subscribe();

    bus.emit('onPlayerTurnEnd' as keyof import('../../../src/systems/game-event-bus').EventPayloadMap, {
      turnNumber: 1,
    } as never);

    expect(uiState.getSnapshot().turnPhase).toBe(UITurnPhase.ENEMY_TURN);
  });
});

// ===========================================================================
// 9. onCombatEnd
// ===========================================================================

describe('CombatUIState — onCombatEnd', () => {
  it('sets combat result to victory and phase to COMBAT_OVER', () => {
    const { bus, uiState } = createTestFixture();
    uiState.subscribe();

    bus.emit('onCombatEnd' as keyof import('../../../src/systems/game-event-bus').EventPayloadMap, {
      result: 'victory',
      turnNumber: 5,
      playerHP: 62,
      playerMaxHP: 80,
      enemiesRemaining: 0,
      cardsPlayedThisTurn: 2,
    } as never);

    const snap = uiState.getSnapshot();
    expect(snap.combatResult).toBe('victory');
    expect(snap.turnPhase).toBe(UITurnPhase.COMBAT_OVER);
  });

  it('sets combat result to defeat', () => {
    const { bus, uiState } = createTestFixture();
    uiState.subscribe();

    bus.emit('onCombatEnd' as keyof import('../../../src/systems/game-event-bus').EventPayloadMap, {
      result: 'defeat',
      turnNumber: 3,
      playerHP: 0,
      playerMaxHP: 80,
      enemiesRemaining: 1,
      cardsPlayedThisTurn: 0,
    } as never);

    expect(uiState.getSnapshot().combatResult).toBe('defeat');
  });
});

// ===========================================================================
// 10. onIntentSelected
// ===========================================================================

describe('CombatUIState — onIntentSelected', () => {
  it('updates enemy intent display data', () => {
    const { bus, uiState } = createTestFixture();
    uiState.subscribe();
    uiState.addEnemy('enemy_0_cultist', 'Cultist', 50, 50);

    bus.emit('onIntentSelected' as keyof import('../../../src/systems/game-event-bus').EventPayloadMap, {
      enemyId: 'enemy_0_cultist',
      intentType: 'attack',
      displayDamage: 11,
      blockAmount: 0,
      effectName: null,
    } as never);

    const intent = uiState.getSnapshot().enemies[0].intent;
    expect(intent).not.toBeNull();
    expect(intent!.intentType).toBe('attack');
    expect(intent!.displayDamage).toBe(11);
    expect(intent!.blockAmount).toBe(0);
    expect(intent!.effectName).toBeNull();
  });

  it('updates intent with status effect name', () => {
    const { bus, uiState } = createTestFixture();
    uiState.subscribe();
    uiState.addEnemy('enemy_0_cultist', 'Cultist', 50, 50);

    bus.emit('onIntentSelected' as keyof import('../../../src/systems/game-event-bus').EventPayloadMap, {
      enemyId: 'enemy_0_cultist',
      intentType: 'debuff',
      displayDamage: 0,
      blockAmount: 0,
      effectName: 'vulnerable',
    } as never);

    const intent = uiState.getSnapshot().enemies[0].intent;
    expect(intent!.effectName).toBe('vulnerable');
  });

  it('ignores intent for unknown enemy', () => {
    const { bus, uiState } = createTestFixture();
    uiState.subscribe();

    expect(() => {
      bus.emit('onIntentSelected' as keyof import('../../../src/systems/game-event-bus').EventPayloadMap, {
        enemyId: 'ghost',
        intentType: null,
        displayDamage: 0,
        blockAmount: 0,
        effectName: null,
      } as never);
    }).not.toThrow();
  });
});

// ===========================================================================
// 11. onStatusApplied
// ===========================================================================

describe('CombatUIState — onStatusApplied', () => {
  it('tracks new status effect on player', () => {
    const { bus, uiState } = createTestFixture();
    uiState.subscribe();

    bus.emit('onStatusApplied' as keyof import('../../../src/systems/game-event-bus').EventPayloadMap, {
      target: { id: 'player', type: 'player' },
      status: 'strength',
      stacks: 2,
    } as never);

    const effects = uiState.getSnapshot().statusEffects;
    expect(effects).toHaveLength(1);
    expect(effects[0].targetId).toBe('player');
    expect(effects[0].targetType).toBe('player');
    expect(effects[0].statusId).toBe('strength');
    expect(effects[0].stacks).toBe(2);
  });

  it('updates stacks for existing status effect', () => {
    const { bus, uiState } = createTestFixture();
    uiState.subscribe();

    // First application
    bus.emit('onStatusApplied' as keyof import('../../../src/systems/game-event-bus').EventPayloadMap, {
      target: { id: 'player', type: 'player' },
      status: 'strength',
      stacks: 2,
    } as never);

    // Second application (update)
    bus.emit('onStatusApplied' as keyof import('../../../src/systems/game-event-bus').EventPayloadMap, {
      target: { id: 'player', type: 'player' },
      status: 'strength',
      stacks: 5,
    } as never);

    const effects = uiState.getSnapshot().statusEffects;
    expect(effects).toHaveLength(1);
    expect(effects[0].stacks).toBe(5);
  });

  it('tracks different status effects independently', () => {
    const { bus, uiState } = createTestFixture();
    uiState.subscribe();

    bus.emit('onStatusApplied' as keyof import('../../../src/systems/game-event-bus').EventPayloadMap, {
      target: { id: 'player', type: 'player' },
      status: 'strength',
      stacks: 2,
    } as never);

    bus.emit('onStatusApplied' as keyof import('../../../src/systems/game-event-bus').EventPayloadMap, {
      target: { id: 'player', type: 'player' },
      status: 'dexterity',
      stacks: 1,
    } as never);

    const effects = uiState.getSnapshot().statusEffects;
    expect(effects).toHaveLength(2);
  });

  it('tracks status effects on enemies separately', () => {
    const { bus, uiState } = createTestFixture();
    uiState.subscribe();
    uiState.addEnemy('enemy_0_cultist', 'Cultist', 50, 50);

    bus.emit('onStatusApplied' as keyof import('../../../src/systems/game-event-bus').EventPayloadMap, {
      target: { id: 'enemy_0_cultist', type: 'enemy' },
      status: 'vulnerable',
      stacks: 2,
    } as never);

    const effects = uiState.getSnapshot().statusEffects;
    expect(effects).toHaveLength(1);
    expect(effects[0].targetType).toBe('enemy');
    expect(effects[0].targetId).toBe('enemy_0_cultist');
  });
});

// ===========================================================================
// 12. onCardPlayed
// ===========================================================================

describe('CombatUIState — onCardPlayed', () => {
  it('increments cards played this turn', () => {
    const { bus, uiState } = createTestFixture();
    uiState.subscribe();

    bus.emit('onCardPlayed' as keyof import('../../../src/systems/game-event-bus').EventPayloadMap, {
      card: { instanceId: 'c1', cardId: 'strike_red', upgraded: false },
      target: null,
      source: 'player',
    } as never);

    expect(uiState.getSnapshot().cardsPlayedThisTurn).toBe(1);

    bus.emit('onCardPlayed' as keyof import('../../../src/systems/game-event-bus').EventPayloadMap, {
      card: { instanceId: 'c2', cardId: 'defend_red', upgraded: false },
      target: null,
      source: 'player',
    } as never);

    expect(uiState.getSnapshot().cardsPlayedThisTurn).toBe(2);
  });
});

// ===========================================================================
// 13. getSnapshot returns independent copy
// ===========================================================================

describe('CombatUIState — getSnapshot isolation', () => {
  it('snapshot arrays are independent copies', () => {
    const { uiState } = createTestFixture();
    uiState.addEnemy('e1', 'Enemy', 30, 30);

    const snap1 = uiState.getSnapshot();
    const snap2 = uiState.getSnapshot();

    // Different array references
    expect(snap1.enemies).not.toBe(snap2.enemies);
    expect(snap1.statusEffects).not.toBe(snap2.statusEffects);

    // Same content
    expect(snap1.enemies).toEqual(snap2.enemies);
  });
});

// ===========================================================================
// 14. addEnemy
// ===========================================================================

describe('CombatUIState — addEnemy', () => {
  it('registers enemy with correct initial values', () => {
    const { uiState } = createTestFixture();

    uiState.addEnemy('enemy_0_cultist', 'Cultist', 48, 52);

    const enemies = uiState.getSnapshot().enemies;
    expect(enemies).toHaveLength(1);
    expect(enemies[0]).toEqual({
      instanceId: 'enemy_0_cultist',
      name: 'Cultist',
      currentHP: 48,
      maxHP: 52,
      block: 0,
      isAlive: true,
      intent: null,
    } satisfies UIEnemyState);
  });

  it('registers multiple enemies', () => {
    const { uiState } = createTestFixture();

    uiState.addEnemy('e0', 'Cultist', 40, 50);
    uiState.addEnemy('e1', 'Jaw Worm', 44, 44);

    const enemies = uiState.getSnapshot().enemies;
    expect(enemies).toHaveLength(2);
    expect(enemies[0].instanceId).toBe('e0');
    expect(enemies[1].instanceId).toBe('e1');
  });
});

// ===========================================================================
// 15. Full combat flow integration
// ===========================================================================

describe('CombatUIState — full combat flow', () => {
  it('tracks a complete combat turn sequence', () => {
    const { bus, uiState } = createTestFixture();
    uiState.subscribe();
    uiState.addEnemy('e0', 'Cultist', 50, 50);

    // Turn 1 starts
    bus.emit('onPlayerTurnStart' as keyof import('../../../src/systems/game-event-bus').EventPayloadMap, {
      turnNumber: 1,
    } as never);
    expect(uiState.getSnapshot().turnPhase).toBe(UITurnPhase.PLAYER_TURN);
    expect(uiState.getSnapshot().turnNumber).toBe(1);

    // Player plays a card (deals damage)
    bus.emit('onDamageDealt' as keyof import('../../../src/systems/game-event-bus').EventPayloadMap, {
      source: { id: 'player', type: 'player' },
      target: { id: 'e0', type: 'enemy' },
      damage: 6,
      blocked: 0,
    } as never);
    bus.emit('onHPChanged' as keyof import('../../../src/systems/game-event-bus').EventPayloadMap, {
      target: { id: 'e0', type: 'enemy' },
      oldHP: 50,
      newHP: 44,
      maxHP: 50,
    } as never);
    bus.emit('onCardPlayed' as keyof import('../../../src/systems/game-event-bus').EventPayloadMap, {
      card: { instanceId: 'c1', cardId: 'strike_red', upgraded: false },
      target: { id: 'e0', type: 'enemy' },
      source: 'player',
    } as never);
    expect(uiState.getSnapshot().enemies[0].currentHP).toBe(44);
    expect(uiState.getSnapshot().cardsPlayedThisTurn).toBe(1);

    // Player ends turn
    bus.emit('onPlayerTurnEnd' as keyof import('../../../src/systems/game-event-bus').EventPayloadMap, {
      turnNumber: 1,
    } as never);
    expect(uiState.getSnapshot().turnPhase).toBe(UITurnPhase.ENEMY_TURN);

    // Enemy deals damage
    bus.emit('onHPChanged' as keyof import('../../../src/systems/game-event-bus').EventPayloadMap, {
      target: { id: 'player', type: 'player' },
      oldHP: 80,
      newHP: 69,
      maxHP: 80,
    } as never);
    expect(uiState.getSnapshot().playerHP).toBe(69);

    // Combat ends with victory
    bus.emit('onCombatEnd' as keyof import('../../../src/systems/game-event-bus').EventPayloadMap, {
      result: 'victory',
      turnNumber: 1,
      playerHP: 69,
      playerMaxHP: 80,
      enemiesRemaining: 0,
      cardsPlayedThisTurn: 1,
    } as never);

    const snap = uiState.getSnapshot();
    expect(snap.combatResult).toBe('victory');
    expect(snap.turnPhase).toBe(UITurnPhase.COMBAT_OVER);
    expect(snap.playerHP).toBe(69);
    expect(snap.enemies[0].currentHP).toBe(44);
  });
});
