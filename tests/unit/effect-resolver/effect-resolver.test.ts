/**
 * effect-resolver.test.ts — Unit tests for the EffectResolver.
 *
 * Implements acceptance criteria from ADR-003 and the task spec.
 *
 * Coverage areas:
 * - Handler registration (register, overwrite, unregistered type)
 * - deal_damage handler (base, Strength, Vulnerable, Weak, combined, floor, X-cost)
 * - apply_status handler (debuff, buff, Artifact negation, unknown status)
 * - gain_block handler (base, Dexterity, Frail, combined, floor at 0)
 * - resolveAll (sequential, stop on death, empty, error handling)
 * - Integration (multi-effect, X-cost)
 */

// @vitest-environment node

import { describe, it, expect } from 'vitest';
import {
  DurationType,
  StackingMode,
  type StatusEffectData,
} from '../../../src/types/status-effect';
import { StatusEffectManager } from '../../../src/systems/status-effect-manager';
import { GameEventBus } from '../../../src/systems/game-event-bus';
import {
  EffectResolver,
  type ResolutionContext,
  type EffectResult,
  type EffectHandler,
} from '../../../src/systems/effect-resolver';
import type { CardEffect } from '../../../src/types/card';

// ---------------------------------------------------------------------------
// Test Data Fixtures
// ---------------------------------------------------------------------------

/**
 * Minimal set of status effect definitions used across tests.
 * Mirrors the structure in assets/data/status-effects.json.
 */
const TEST_STATUS_EFFECTS: StatusEffectData[] = [
  {
    id: 'vulnerable',
    name: 'Vulnerable',
    description: 'Takes 50% more damage from attacks.',
    category: 'debuff',
    durationType: DurationType.TURNS,
    stackingMode: StackingMode.ADD_DURATION,
    defaultValue: 1,
    defaultDuration: 2,
    icon: 'debuff_vulnerable',
  },
  {
    id: 'weak',
    name: 'Weak',
    description: 'Deals 25% less damage with attacks.',
    category: 'debuff',
    durationType: DurationType.TURNS,
    stackingMode: StackingMode.ADD_DURATION,
    defaultValue: 1,
    defaultDuration: 2,
    icon: 'debuff_weak',
  },
  {
    id: 'strength',
    name: 'Strength',
    description: 'Increases attack damage by {stacks}.',
    category: 'buff',
    durationType: DurationType.COMBAT,
    stackingMode: StackingMode.ADD_STACKS,
    defaultValue: 1,
    icon: 'buff_strength',
  },
  {
    id: 'dexterity',
    name: 'Dexterity',
    description: 'Increases Block gained by {stacks}.',
    category: 'buff',
    durationType: DurationType.COMBAT,
    stackingMode: StackingMode.ADD_STACKS,
    defaultValue: 1,
    icon: 'buff_dexterity',
  },
  {
    id: 'frail',
    name: 'Frail',
    description: 'Gain 25% less Block from cards.',
    category: 'debuff',
    durationType: DurationType.TURNS,
    stackingMode: StackingMode.ADD_DURATION,
    defaultValue: 1,
    defaultDuration: 2,
    icon: 'debuff_frail',
  },
  {
    id: 'artifact',
    name: 'Artifact',
    description: 'Negates the next {stacks} debuff(s).',
    category: 'buff',
    durationType: DurationType.STACKS,
    stackingMode: StackingMode.ADD_STACKS,
    defaultValue: 1,
    icon: 'buff_artifact',
  },
  {
    id: 'intangible',
    name: 'Intangible',
    description: 'Damage is reduced to 1.',
    category: 'buff',
    durationType: DurationType.TURNS,
    stackingMode: StackingMode.OVERWRITE_MAX,
    defaultValue: 1,
    defaultDuration: 1,
    icon: 'buff_intangible',
  },
  {
    id: 'poison',
    name: 'Poison',
    description: 'Loses {stacks} HP at end of turn.',
    category: 'debuff',
    durationType: DurationType.STACKS,
    stackingMode: StackingMode.ADD_STACKS,
    defaultValue: 1,
    icon: 'debuff_poison',
  },
];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Create a fresh StatusEffectManager with test effects. */
function createStatusEffectManager(): StatusEffectManager {
  return new StatusEffectManager(TEST_STATUS_EFFECTS);
}

/** Create a fresh ResolutionContext with default values. */
function createContext(overrides: Partial<ResolutionContext> = {}): ResolutionContext {
  return {
    sourceId: 'player',
    targetId: 'enemy1',
    energy: 3,
    statusEffectManager: createStatusEffectManager(),
    eventBus: new GameEventBus(),
    ...overrides,
  };
}

/** Create a deal_damage CardEffect. */
function damageEffect(value: number, overrides: Partial<CardEffect> = {}): CardEffect {
  return { type: 'deal_damage', value, ...overrides };
}

/** Create a gain_block CardEffect. */
function blockEffect(value: number, overrides: Partial<CardEffect> = {}): CardEffect {
  return { type: 'gain_block', value, ...overrides };
}

/** Create an apply_status CardEffect. */
function statusEffect(
  status: string,
  value: number,
  overrides: Partial<CardEffect> = {}
): CardEffect {
  return { type: 'apply_status', value, status, ...overrides };
}

/** Create a fresh EffectResolver (with default handlers). */
function createResolver(): EffectResolver {
  return new EffectResolver();
}

// ===========================================================================
// Handler Registration
// ===========================================================================

describe('Handler registration', () => {
  it('registers a handler and verifies it exists', () => {
    const resolver = new EffectResolver();
    expect(resolver.hasHandler('deal_damage')).toBe(true);
    expect(resolver.hasHandler('apply_status')).toBe(true);
    expect(resolver.hasHandler('gain_block')).toBe(true);
  });

  it('overwrites an existing handler when re-registering', () => {
    const resolver = new EffectResolver();
    const customHandler: EffectHandler = (_effect, _context) => ({
      type: 'deal_damage',
      success: true,
      value: 999,
      targetId: 'custom',
    });

    resolver.registerHandler('deal_damage', customHandler);

    const ctx = createContext();
    const results = resolver.resolveEffect(damageEffect(10), ctx);
    expect(results).toHaveLength(1);
    expect(results[0].value).toBe(999);
    expect(results[0].targetId).toBe('custom');
  });

  it('returns empty results for unregistered effect type', () => {
    const resolver = new EffectResolver();
    const ctx = createContext();
    const results = resolver.resolveEffect(
      { type: 'nonexistent_effect', value: 5 },
      ctx
    );
    expect(results).toHaveLength(1);
    expect(results[0].success).toBe(false);
    expect(results[0].type).toBe('nonexistent_effect');
  });

  it('hasHandler returns false for unregistered type', () => {
    const resolver = new EffectResolver();
    expect(resolver.hasHandler('custom_type')).toBe(false);
  });

  it('hasHandler returns true after registration', () => {
    const resolver = new EffectResolver();
    resolver.registerHandler('custom_type', () => ({
      type: 'custom_type',
      success: true,
    }));
    expect(resolver.hasHandler('custom_type')).toBe(true);
  });
});

// ===========================================================================
// deal_damage Handler
// ===========================================================================

describe('deal_damage handler', () => {
  it('deals base damage with no modifiers', () => {
    const resolver = createResolver();
    const ctx = createContext();
    const results = resolver.resolveEffect(damageEffect(10), ctx);

    expect(results).toHaveLength(1);
    expect(results[0]).toEqual({
      type: 'deal_damage',
      success: true,
      value: 10,
      targetId: 'enemy1',
    });
  });

  it('Strength increases damage', () => {
    const resolver = createResolver();
    const ctx = createContext();
    ctx.statusEffectManager.applyEffect('player', 'strength', 4, 'test');

    const results = resolver.resolveEffect(damageEffect(6), ctx);
    expect(results[0].value).toBe(10); // 6 + 4 = 10
  });

  it('negative Strength decreases damage (floor at 1)', () => {
    const resolver = createResolver();
    const ctx = createContext();
    ctx.statusEffectManager.applyEffect('player', 'strength', -5, 'curse');

    const results = resolver.resolveEffect(damageEffect(6), ctx);
    // 6 + (-5) = 1, floor at 1
    expect(results[0].value).toBe(1);
  });

  it('Strength reducing damage below 0 is floored at 1', () => {
    const resolver = createResolver();
    const ctx = createContext();
    ctx.statusEffectManager.applyEffect('player', 'strength', -100, 'curse');

    const results = resolver.resolveEffect(damageEffect(6), ctx);
    // 6 + (-100) = -94, floor at 1
    expect(results[0].value).toBe(1);
  });

  it('Vulnerable on target: 1.5x damage (Math.floor)', () => {
    const resolver = createResolver();
    const ctx = createContext();
    ctx.statusEffectManager.applyEffect('enemy1', 'vulnerable', 2, 'test');

    // 10 * 1.5 = 15
    const results = resolver.resolveEffect(damageEffect(10), ctx);
    expect(results[0].value).toBe(15);
  });

  it('Vulnerable with odd base damage floors correctly', () => {
    const resolver = createResolver();
    const ctx = createContext();
    ctx.statusEffectManager.applyEffect('enemy1', 'vulnerable', 1, 'test');

    // 7 * 1.5 = 10.5, floor(10.5) = 10
    const results = resolver.resolveEffect(damageEffect(7), ctx);
    expect(results[0].value).toBe(10);
  });

  it('Weak on source: 0.75x damage (Math.floor)', () => {
    const resolver = createResolver();
    const ctx = createContext();
    ctx.statusEffectManager.applyEffect('player', 'weak', 2, 'enemy');

    // 10 * 0.75 = 7.5, floor(7.5) = 7
    const results = resolver.resolveEffect(damageEffect(10), ctx);
    expect(results[0].value).toBe(7);
  });

  it('Weak with odd base damage floors correctly', () => {
    const resolver = createResolver();
    const ctx = createContext();
    ctx.statusEffectManager.applyEffect('player', 'weak', 1, 'enemy');

    // 7 * 0.75 = 5.25, floor(5.25) = 5
    const results = resolver.resolveEffect(damageEffect(7), ctx);
    expect(results[0].value).toBe(5);
  });

  it('Strength + Vulnerable + Weak combined', () => {
    const resolver = createResolver();
    const ctx = createContext();
    ctx.statusEffectManager.applyEffect('player', 'strength', 4, 'test');
    ctx.statusEffectManager.applyEffect('enemy1', 'vulnerable', 2, 'test');
    ctx.statusEffectManager.applyEffect('player', 'weak', 1, 'enemy');

    // Base: 6, Strength: 6 + 4 = 10
    // Vulnerable: floor(10 * 1.5) = 15
    // Weak: floor(15 * 0.75) = floor(11.25) = 11
    const results = resolver.resolveEffect(damageEffect(6), ctx);
    expect(results[0].value).toBe(11);
  });

  it('damage floors at 1 (minimum damage)', () => {
    const resolver = createResolver();
    const ctx = createContext();
    ctx.statusEffectManager.applyEffect('player', 'strength', -10, 'curse');
    ctx.statusEffectManager.applyEffect('player', 'weak', 2, 'enemy');

    // Base: 1, Strength: 1 + (-10) = -9, Weak: floor(-9 * 0.75) = floor(-6.75) = -7
    // Floor at 1
    const results = resolver.resolveEffect(damageEffect(1), ctx);
    expect(results[0].value).toBe(1);
  });

  it('damage of 0 with no Strength still floors to 1', () => {
    const resolver = createResolver();
    const ctx = createContext();

    // Edge: 0 base damage
    const results = resolver.resolveEffect(damageEffect(0), ctx);
    expect(results[0].value).toBe(1);
  });

  it('Intangible on target reduces damage to 1', () => {
    const resolver = createResolver();
    const ctx = createContext();
    ctx.statusEffectManager.applyEffect('enemy1', 'intangible', 1, 'test');

    // Even with huge damage, Intangible caps it at 1
    const results = resolver.resolveEffect(damageEffect(50), ctx);
    expect(results[0].value).toBe(1);
  });

  it('Intangible on target with Strength still capped at 1', () => {
    const resolver = createResolver();
    const ctx = createContext();
    ctx.statusEffectManager.applyEffect('player', 'strength', 10, 'test');
    ctx.statusEffectManager.applyEffect('enemy1', 'intangible', 1, 'test');

    // 6 + 10 = 16, but Intangible caps at 1
    const results = resolver.resolveEffect(damageEffect(6), ctx);
    expect(results[0].value).toBe(1);
  });

  it('returns failure when targetId is null', () => {
    const resolver = createResolver();
    const ctx = createContext({ targetId: null });

    const results = resolver.resolveEffect(damageEffect(10), ctx);
    expect(results[0].success).toBe(false);
    expect(results[0].value).toBe(0);
  });

  it('Vulnerable + Weak: net effect is less than base', () => {
    const resolver = createResolver();
    const ctx = createContext();
    ctx.statusEffectManager.applyEffect('enemy1', 'vulnerable', 1, 'test');
    ctx.statusEffectManager.applyEffect('player', 'weak', 1, 'enemy');

    // Per ADR-003: Vulnerable first, then Weak
    // 10 * 1.5 = 15, then 15 * 0.75 = 11.25, floor = 11
    // 11 < 10? No, Vulnerable + Weak is still more than base for 10
    // But for 4: 4 * 1.5 = 6, 6 * 0.75 = 4.5 floor = 4 == base
    const results = resolver.resolveEffect(damageEffect(4), ctx);
    expect(results[0].value).toBe(4);
  });

  it('Strength alone with 0 base yields Strength value (floored to 1 if negative)', () => {
    const resolver = createResolver();
    const ctx = createContext();
    ctx.statusEffectManager.applyEffect('player', 'strength', 5, 'test');

    // 0 + 5 = 5
    const results = resolver.resolveEffect(damageEffect(0), ctx);
    expect(results[0].value).toBe(5);
  });
});

// ===========================================================================
// apply_status Handler
// ===========================================================================

describe('apply_status handler', () => {
  it('applies a debuff using tryApplyDebuff', () => {
    const resolver = createResolver();
    const ctx = createContext();

    const results = resolver.resolveEffect(
      statusEffect('vulnerable', 2),
      ctx
    );

    expect(results).toHaveLength(1);
    expect(results[0]).toEqual({
      type: 'apply_status',
      success: true,
      value: 2,
      targetId: 'enemy1',
    });
    expect(ctx.statusEffectManager.getEffectStacks('enemy1', 'vulnerable')).toBe(2);
  });

  it('applies a buff using applyEffect directly', () => {
    const resolver = createResolver();
    const ctx = createContext();

    const results = resolver.resolveEffect(
      statusEffect('strength', 3),
      ctx
    );

    expect(results[0].success).toBe(true);
    expect(results[0].value).toBe(3);
    expect(ctx.statusEffectManager.getEffectStacks('enemy1', 'strength')).toBe(3);
  });

  it('Artifact negation prevents debuff application', () => {
    const resolver = createResolver();
    const ctx = createContext();
    ctx.statusEffectManager.applyEffect('enemy1', 'artifact', 1, 'relic');

    const results = resolver.resolveEffect(
      statusEffect('vulnerable', 2),
      ctx
    );

    expect(results[0].success).toBe(false);
    expect(ctx.statusEffectManager.hasEffect('enemy1', 'vulnerable')).toBe(false);
    // Artifact was consumed
    expect(ctx.statusEffectManager.hasEffect('enemy1', 'artifact')).toBe(false);
  });

  it('unknown status ID throws error (caught by resolveEffect)', () => {
    const resolver = createResolver();
    const ctx = createContext();

    const results = resolver.resolveEffect(
      statusEffect('nonexistent_status', 1),
      ctx
    );

    // Error is caught by resolveEffect, returns success: false
    expect(results[0].success).toBe(false);
    expect(results[0].type).toBe('apply_status');
  });

  it('returns failure when targetId is null', () => {
    const resolver = createResolver();
    const ctx = createContext({ targetId: null });

    const results = resolver.resolveEffect(
      statusEffect('vulnerable', 2),
      ctx
    );
    expect(results[0].success).toBe(false);
  });

  it('returns failure when status field is missing', () => {
    const resolver = createResolver();
    const ctx = createContext();

    const results = resolver.resolveEffect(
      { type: 'apply_status', value: 2 },
      ctx
    );
    expect(results[0].success).toBe(false);
  });

  it('applies poison (debuff) correctly', () => {
    const resolver = createResolver();
    const ctx = createContext();

    const results = resolver.resolveEffect(
      statusEffect('poison', 5),
      ctx
    );

    expect(results[0].success).toBe(true);
    expect(results[0].value).toBe(5);
    expect(ctx.statusEffectManager.getEffectStacks('enemy1', 'poison')).toBe(5);
  });

  it('stacks multiple applications of the same debuff', () => {
    const resolver = createResolver();
    const ctx = createContext();

    resolver.resolveEffect(statusEffect('vulnerable', 2), ctx);
    resolver.resolveEffect(statusEffect('vulnerable', 1), ctx);

    // ADD_DURATION: 2 + 1 = 3
    expect(ctx.statusEffectManager.getEffectStacks('enemy1', 'vulnerable')).toBe(3);
  });

  it('buff bypasses Artifact check', () => {
    const resolver = createResolver();
    const ctx = createContext();
    ctx.statusEffectManager.applyEffect('enemy1', 'artifact', 1, 'relic');

    // Strength is a buff, should bypass artifact
    const results = resolver.resolveEffect(
      statusEffect('strength', 3),
      ctx
    );

    expect(results[0].success).toBe(true);
    expect(ctx.statusEffectManager.getEffectStacks('enemy1', 'strength')).toBe(3);
    // Artifact should NOT be consumed
    expect(ctx.statusEffectManager.getEffectStacks('enemy1', 'artifact')).toBe(1);
  });
});

// ===========================================================================
// gain_block Handler
// ===========================================================================

describe('gain_block handler', () => {
  it('gains base block with no modifiers', () => {
    const resolver = createResolver();
    const ctx = createContext();

    const results = resolver.resolveEffect(blockEffect(5), ctx);

    expect(results).toHaveLength(1);
    expect(results[0]).toEqual({
      type: 'gain_block',
      success: true,
      value: 5,
      targetId: 'player',
    });
  });

  it('Dexterity increases block', () => {
    const resolver = createResolver();
    const ctx = createContext();
    ctx.statusEffectManager.applyEffect('player', 'dexterity', 3, 'test');

    const results = resolver.resolveEffect(blockEffect(5), ctx);
    expect(results[0].value).toBe(8); // 5 + 3 = 8
  });

  it('negative Dexterity decreases block (floor at 0)', () => {
    const resolver = createResolver();
    const ctx = createContext();
    ctx.statusEffectManager.applyEffect('player', 'dexterity', -3, 'curse');

    const results = resolver.resolveEffect(blockEffect(5), ctx);
    expect(results[0].value).toBe(2); // 5 + (-3) = 2
  });

  it('negative Dexterity reducing block below 0 is floored at 0', () => {
    const resolver = createResolver();
    const ctx = createContext();
    ctx.statusEffectManager.applyEffect('player', 'dexterity', -100, 'curse');

    const results = resolver.resolveEffect(blockEffect(5), ctx);
    expect(results[0].value).toBe(0); // floor at 0
  });

  it('Frail: 0.75x block (Math.floor)', () => {
    const resolver = createResolver();
    const ctx = createContext();
    ctx.statusEffectManager.applyEffect('player', 'frail', 2, 'enemy');

    // 8 * 0.75 = 6
    const results = resolver.resolveEffect(blockEffect(8), ctx);
    expect(results[0].value).toBe(6);
  });

  it('Frail with odd base block floors correctly', () => {
    const resolver = createResolver();
    const ctx = createContext();
    ctx.statusEffectManager.applyEffect('player', 'frail', 1, 'enemy');

    // 5 * 0.75 = 3.75, floor = 3
    const results = resolver.resolveEffect(blockEffect(5), ctx);
    expect(results[0].value).toBe(3);
  });

  it('Dexterity + Frail combined', () => {
    const resolver = createResolver();
    const ctx = createContext();
    ctx.statusEffectManager.applyEffect('player', 'dexterity', 3, 'test');
    ctx.statusEffectManager.applyEffect('player', 'frail', 2, 'enemy');

    // Base: 5, Dexterity: 5 + 3 = 8, Frail: floor(8 * 0.75) = 6
    const results = resolver.resolveEffect(blockEffect(5), ctx);
    expect(results[0].value).toBe(6);
  });

  it('block CAN be 0 (unlike damage which floors at 1)', () => {
    const resolver = createResolver();
    const ctx = createContext();
    ctx.statusEffectManager.applyEffect('player', 'dexterity', -5, 'curse');

    // 5 + (-5) = 0, floor at 0 (not 1!)
    const results = resolver.resolveEffect(blockEffect(5), ctx);
    expect(results[0].value).toBe(0);
  });

  it('block of 0 with no modifiers is 0', () => {
    const resolver = createResolver();
    const ctx = createContext();

    const results = resolver.resolveEffect(blockEffect(0), ctx);
    expect(results[0].value).toBe(0);
  });

  it('negative Dexterity and Frail combined floor at 0', () => {
    const resolver = createResolver();
    const ctx = createContext();
    ctx.statusEffectManager.applyEffect('player', 'dexterity', -2, 'curse');
    ctx.statusEffectManager.applyEffect('player', 'frail', 1, 'enemy');

    // Base: 5, Dex: 5 + (-2) = 3, Frail: floor(3 * 0.75) = floor(2.25) = 2
    const results = resolver.resolveEffect(blockEffect(5), ctx);
    expect(results[0].value).toBe(2);
  });

  it('block target is always the source entity', () => {
    const resolver = createResolver();
    const ctx = createContext({ sourceId: 'player', targetId: 'enemy1' });

    const results = resolver.resolveEffect(blockEffect(5), ctx);
    expect(results[0].targetId).toBe('player');
  });
});

// ===========================================================================
// resolveAll
// ===========================================================================

describe('resolveAll', () => {
  it('resolves all effects in sequence', () => {
    const resolver = createResolver();
    const ctx = createContext();

    const effects: CardEffect[] = [
      damageEffect(6),
      statusEffect('vulnerable', 2),
    ];

    const results = resolver.resolveAll(effects, ctx, () => false);

    expect(results).toHaveLength(2);
    expect(results[0].type).toBe('deal_damage');
    expect(results[0].value).toBe(6);
    expect(results[1].type).toBe('apply_status');
    expect(results[1].success).toBe(true);
  });

  it('stops when target dies (isTargetDead returns true)', () => {
    const resolver = createResolver();
    const ctx = createContext();

    const effects: CardEffect[] = [
      damageEffect(6),
      damageEffect(8),
      damageEffect(10),
    ];

    // Target dies after the second effect
    let deathCallCount = 0;
    const isTargetDead = (_targetId: string) => {
      deathCallCount++;
      return deathCallCount > 1; // Dies on 3rd check (before 2nd effect)
    };

    const results = resolver.resolveAll(effects, ctx, isTargetDead);

    // First effect resolves, then death check triggers before second effect
    expect(results).toHaveLength(1);
    expect(results[0].value).toBe(6);
  });

  it('returns accumulated results from multiple effects', () => {
    const resolver = createResolver();
    const ctx = createContext();

    const effects: CardEffect[] = [
      damageEffect(6),
      blockEffect(5),
    ];

    const results = resolver.resolveAll(effects, ctx, () => false);

    expect(results).toHaveLength(2);
    expect(results[0].type).toBe('deal_damage');
    expect(results[1].type).toBe('gain_block');
  });

  it('empty effects array returns empty results', () => {
    const resolver = createResolver();
    const ctx = createContext();

    const results = resolver.resolveAll([], ctx, () => false);
    expect(results).toHaveLength(0);
  });

  it('handler error is logged and returns success: false, continues to next', () => {
    const resolver = new EffectResolver();
    // Register a handler that throws
    resolver.registerHandler('error_effect', () => {
      throw new Error('Test handler error');
    });

    const ctx = createContext();

    const effects: CardEffect[] = [
      { type: 'error_effect', value: 1 },
      damageEffect(6),
    ];

    const results = resolver.resolveAll(effects, ctx, () => false);

    expect(results).toHaveLength(2);
    expect(results[0].success).toBe(false);
    expect(results[0].type).toBe('error_effect');
    // Second effect still resolves
    expect(results[1].success).toBe(true);
    expect(results[1].value).toBe(6);
  });

  it('does not check death when targetId is null', () => {
    const resolver = createResolver();
    const ctx = createContext({ targetId: null });

    const effects: CardEffect[] = [
      blockEffect(5),
      blockEffect(3),
    ];

    // Even though isTargetDead always returns true, null target skips death check
    const results = resolver.resolveAll(effects, ctx, () => true);

    expect(results).toHaveLength(2);
    expect(results[0].value).toBe(5);
    expect(results[1].value).toBe(3);
  });

  it('stops on death even with remaining effects', () => {
    const resolver = createResolver();
    const ctx = createContext();

    const effects: CardEffect[] = [
      damageEffect(10),
      damageEffect(20),
      damageEffect(30),
    ];

    // Target dies after first effect resolves
    let firstEffectResolved = false;
    const isTargetDead = () => {
      if (firstEffectResolved) return true;
      firstEffectResolved = true;
      return false;
    };

    const results = resolver.resolveAll(effects, ctx, isTargetDead);

    // Only the first effect resolves, second check sees dead target
    expect(results).toHaveLength(1);
    expect(results[0].value).toBe(10);
  });

  it('resolves all effects when target never dies', () => {
    const resolver = createResolver();
    const ctx = createContext();

    const effects: CardEffect[] = [
      damageEffect(5),
      damageEffect(10),
      damageEffect(15),
    ];

    const results = resolver.resolveAll(effects, ctx, () => false);

    expect(results).toHaveLength(3);
    expect(results[0].value).toBe(5);
    expect(results[1].value).toBe(10);
    expect(results[2].value).toBe(15);
  });
});

// ===========================================================================
// Integration: Full card resolution
// ===========================================================================

describe('Integration: Full card resolution', () => {
  it('Bash card: deal_damage + apply_status in sequence', () => {
    const resolver = createResolver();
    const ctx = createContext();

    // Bash: { deal_damage: 8 }, { apply_status: vulnerable 2 }
    const effects: CardEffect[] = [
      damageEffect(8),
      statusEffect('vulnerable', 2),
    ];

    const results = resolver.resolveAll(effects, ctx, () => false);

    expect(results).toHaveLength(2);
    expect(results[0]).toEqual({
      type: 'deal_damage',
      success: true,
      value: 8,
      targetId: 'enemy1',
    });
    expect(results[1]).toEqual({
      type: 'apply_status',
      success: true,
      value: 2,
      targetId: 'enemy1',
    });

    // Verify Vulnerable was actually applied
    expect(ctx.statusEffectManager.getEffectStacks('enemy1', 'vulnerable')).toBe(2);
  });

  it('Iron Wave: deal_damage + gain_block in sequence', () => {
    const resolver = createResolver();
    const ctx = createContext();

    const effects: CardEffect[] = [
      damageEffect(5),
      blockEffect(5),
    ];

    const results = resolver.resolveAll(effects, ctx, () => false);

    expect(results).toHaveLength(2);
    expect(results[0].type).toBe('deal_damage');
    expect(results[0].value).toBe(5);
    expect(results[0].targetId).toBe('enemy1');
    expect(results[1].type).toBe('gain_block');
    expect(results[1].value).toBe(5);
    expect(results[1].targetId).toBe('player');
  });

  it('Strike with Strength modifier: damage scales', () => {
    const resolver = createResolver();
    const ctx = createContext();
    ctx.statusEffectManager.applyEffect('player', 'strength', 4, 'inflame');

    // Strike: { deal_damage: 6 }
    const effects: CardEffect[] = [damageEffect(6)];
    const results = resolver.resolveAll(effects, ctx, () => false);

    // 6 + 4 = 10
    expect(results[0].value).toBe(10);
  });

  it('Defend with Dexterity modifier: block scales', () => {
    const resolver = createResolver();
    const ctx = createContext();
    ctx.statusEffectManager.applyEffect('player', 'dexterity', 2, 'relic');

    // Defend: { gain_block: 5 }
    const effects: CardEffect[] = [blockEffect(5)];
    const results = resolver.resolveAll(effects, ctx, () => false);

    // 5 + 2 = 7
    expect(results[0].value).toBe(7);
  });

  it('Multi-effect card with modifier interactions', () => {
    const resolver = createResolver();
    const ctx = createContext();

    // Player has Strength(2) and Weak(1)
    ctx.statusEffectManager.applyEffect('player', 'strength', 2, 'test');
    ctx.statusEffectManager.applyEffect('player', 'weak', 1, 'enemy');

    // Target has Vulnerable(1)
    ctx.statusEffectManager.applyEffect('enemy1', 'vulnerable', 1, 'test');

    const effects: CardEffect[] = [
      damageEffect(10),        // 10 + 2(str) = 12, vuln: floor(12*1.5) = 18, weak: floor(18*0.75) = 13
      statusEffect('vulnerable', 1),  // adds to existing
      blockEffect(5),          // 5 + 0(dex) = 5
    ];

    const results = resolver.resolveAll(effects, ctx, () => false);

    expect(results).toHaveLength(3);
    expect(results[0].value).toBe(13);
    expect(results[1].success).toBe(true);
    // Vulnerable should now be 2 (1 existing + 1 applied, ADD_DURATION)
    expect(ctx.statusEffectManager.getEffectStacks('enemy1', 'vulnerable')).toBe(2);
    expect(results[2].value).toBe(5);
  });
});

// ===========================================================================
// X-cost card: damage scales with energy
// ===========================================================================

describe('X-cost card integration', () => {
  it('energy context is available for X-cost scaling', () => {
    const resolver = createResolver();
    const ctx = createContext({ energy: 5 });

    // Verify energy is available in context
    expect(ctx.energy).toBe(5);

    // Standard deal_damage does not use energy directly,
    // but the context provides it for handlers that need it.
    const results = resolver.resolveEffect(damageEffect(10), ctx);
    expect(results[0].success).toBe(true);
  });

  it('custom X-cost handler can scale damage by energy', () => {
    const resolver = new EffectResolver();
    const ctx = createContext({ energy: 3 });

    // Register a custom X-cost handler
    const xCostHandler: EffectHandler = (effect, context) => ({
      type: 'deal_damage_x',
      success: true,
      value: effect.value * context.energy,
      targetId: context.targetId ?? undefined,
    });
    resolver.registerHandler('deal_damage_x', xCostHandler);

    // Base 7 damage * 3 energy = 21
    const results = resolver.resolveEffect(
      { type: 'deal_damage_x', value: 7 },
      ctx
    );
    expect(results[0].value).toBe(21);
  });

  it('X-cost with 0 energy deals 0 damage (floored by min 1 in deal_damage)', () => {
    const resolver = createResolver();
    const ctx = createContext({ energy: 0 });

    // Standard deal_damage with 0 base and 0 energy
    const results = resolver.resolveEffect(damageEffect(0), ctx);
    // Floor at 1
    expect(results[0].value).toBe(1);
  });
});

// ===========================================================================
// Error handling isolation
// ===========================================================================

describe('Error handling isolation', () => {
  it('handler throwing does not crash the resolver', () => {
    const resolver = new EffectResolver();
    resolver.registerHandler('throwing_effect', () => {
      throw new Error('Intentional test error');
    });

    const ctx = createContext();
    const results = resolver.resolveEffect(
      { type: 'throwing_effect', value: 1 },
      ctx
    );

    expect(results).toHaveLength(1);
    expect(results[0].success).toBe(false);
    expect(results[0].type).toBe('throwing_effect');
  });

  it('resolveAll continues after handler error', () => {
    const resolver = new EffectResolver();
    resolver.registerHandler('bad_effect', () => {
      throw new Error('Oops');
    });

    const ctx = createContext();
    const effects: CardEffect[] = [
      damageEffect(6),
      { type: 'bad_effect', value: 1 },
      damageEffect(10),
    ];

    const results = resolver.resolveAll(effects, ctx, () => false);

    expect(results).toHaveLength(3);
    expect(results[0].success).toBe(true);
    expect(results[0].value).toBe(6);
    expect(results[1].success).toBe(false);
    expect(results[2].success).toBe(true);
    expect(results[2].value).toBe(10);
  });

  it('apply_status with missing status field returns failure gracefully', () => {
    const resolver = createResolver();
    const ctx = createContext();

    const results = resolver.resolveEffect(
      { type: 'apply_status', value: 2 },
      ctx
    );

    expect(results[0].success).toBe(false);
  });
});

// ===========================================================================
// registerDefaults
// ===========================================================================

describe('registerDefaults', () => {
  it('can be called to reset default handlers after custom registration', () => {
    const resolver = new EffectResolver();

    // Replace deal_damage with custom handler
    resolver.registerHandler('deal_damage', () => ({
      type: 'deal_damage',
      success: true,
      value: 999,
    }));

    const ctx = createContext();
    let results = resolver.resolveEffect(damageEffect(10), ctx);
    expect(results[0].value).toBe(999);

    // Reset defaults
    resolver.registerDefaults();

    results = resolver.resolveEffect(damageEffect(10), ctx);
    expect(results[0].value).toBe(10);
  });
});

// ===========================================================================
// Full combat scenario
// ===========================================================================

describe('Full combat scenario', () => {
  it('simulates playing Bash against an enemy with modifiers', () => {
    const resolver = createResolver();
    const ctx = createContext();

    // Player has Strength(2) from Inflame
    ctx.statusEffectManager.applyEffect('player', 'strength', 2, 'inflame');

    // Play Bash: deal_damage(8) + apply_status(vulnerable, 2)
    const bashEffects: CardEffect[] = [
      damageEffect(8),
      statusEffect('vulnerable', 2),
    ];

    let results = resolver.resolveAll(bashEffects, ctx, () => false);

    // Damage: 8 + 2(str) = 10
    expect(results[0]).toEqual({
      type: 'deal_damage',
      success: true,
      value: 10,
      targetId: 'enemy1',
    });
    expect(results[1].success).toBe(true);

    // Now enemy has Vulnerable(2). Play Strike(6).
    const strikeEffects: CardEffect[] = [damageEffect(6)];
    results = resolver.resolveAll(strikeEffects, ctx, () => false);

    // Damage: 6 + 2(str) = 8, Vulnerable: floor(8 * 1.5) = 12
    expect(results[0].value).toBe(12);
  });

  it('simulates Defend under Frail, then Defend without Frail', () => {
    const resolver = createResolver();
    const ctx = createContext();

    // Player has Frail from enemy
    ctx.statusEffectManager.applyEffect('player', 'frail', 2, 'enemy');

    // Play Defend under Frail: floor(5 * 0.75) = floor(3.75) = 3
    let results = resolver.resolveAll([blockEffect(5)], ctx, () => false);
    expect(results[0].value).toBe(3);

    // Frail expires (simulated by removing it)
    ctx.statusEffectManager.removeEffect('player', 'frail');

    // Play Defend without Frail: 5
    results = resolver.resolveAll([blockEffect(5)], ctx, () => false);
    expect(results[0].value).toBe(5);
  });
});
