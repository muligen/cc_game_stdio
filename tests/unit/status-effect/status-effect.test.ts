/**
 * status-effect.test.ts — Unit tests for the StatusEffectManager.
 *
 * Implements acceptance criteria and edge cases from design/gdd/status-effect.md.
 *
 * Coverage areas:
 * - AC1: Vulnerable(2) + Vulnerable(1) -> Vulnerable(3 turns)
 * - AC2: Poison(3) at turn end: deals 3 damage, becomes Poison(2)
 * - AC3: Artifact(1) negates next debuff, Artifact removed afterward
 * - AC4: Strength can go negative; -2 Strength means attacks deal 2 less
 * - AC5: Frail reduces card-gained Block but NOT relic/effect Block (formula only)
 * - AC6: combat-duration effects persist across turns until combat ends
 * - AC7: turns-duration effects decrease by 1 at end of target's turn; removed at 0
 * - AC8: Boss immune to a debuff -> debuff ignored, Artifact NOT consumed
 * - AC9: Turn-end processing order: Poison -> duration decrement -> removal -> triggers
 * - AC10: Effect applied during its own trigger does not cause infinite loop
 *         (not fully testable until TriggerManager exists; test event listener re-entry)
 *
 * Additional edge cases from GDD Section "Edge Cases".
 */

// @vitest-environment node

import { describe, it, expect } from 'vitest';
import {
  DurationType,
  StackingMode,
  type StatusEffectData,
} from '../../../src/types/status-effect';
import {
  StatusEffectManager,
  type StatusEffectChangeEvent,
  type ImmunityChecker,
} from '../../../src/systems/status-effect-manager';

// ---------------------------------------------------------------------------
// Test Data Fixtures
// ---------------------------------------------------------------------------

/**
 * Minimal set of status effect definitions used across tests.
 * Mirrors the structure in assets/data/status-effects.json.
 */
const TEST_EFFECTS: StatusEffectData[] = [
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
    id: 'poison',
    name: 'Poison',
    description: 'Loses {stacks} HP at end of turn.',
    category: 'debuff',
    durationType: DurationType.STACKS,
    stackingMode: StackingMode.ADD_STACKS,
    defaultValue: 1,
    icon: 'debuff_poison',
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
    id: 'entangled',
    name: 'Entangled',
    description: 'Cannot play Attack cards this turn.',
    category: 'debuff',
    durationType: DurationType.TURNS,
    stackingMode: StackingMode.DOES_NOT_STACK,
    defaultValue: 1,
    defaultDuration: 1,
    icon: 'debuff_entangled',
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
    id: 'metallicize',
    name: 'Metallicize',
    description: 'At end of turn, gain {stacks} Block.',
    category: 'buff',
    durationType: DurationType.COMBAT,
    stackingMode: StackingMode.ADD_STACKS,
    defaultValue: 3,
    icon: 'buff_metallicize',
  },
];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Create a fresh StatusEffectManager with the standard test effects. */
function createManager(effectData: StatusEffectData[] = TEST_EFFECTS): StatusEffectManager {
  return new StatusEffectManager(effectData);
}

/** Collect all change events emitted during an operation. */
function captureChanges(
  manager: StatusEffectManager,
  action: () => void
): StatusEffectChangeEvent[] {
  const events: StatusEffectChangeEvent[] = [];
  manager.onStatusEffectChange((e) => events.push(e));
  action();
  return events;
}

// ===========================================================================
// AC1: Vulnerable(2) + Vulnerable(1) -> Vulnerable(3 turns)
// ===========================================================================

describe('AC1: Vulnerable stacking via addDuration', () => {
  it('applying Vulnerable(2) then Vulnerable(1) results in Vulnerable(3)', () => {
    const mgr = createManager();
    mgr.applyEffect('enemy1', 'vulnerable', 2, 'card_bash');
    mgr.applyEffect('enemy1', 'vulnerable', 1, 'card_bash');
    expect(mgr.getEffectStacks('enemy1', 'vulnerable')).toBe(3);
  });

  it('returns false for the second application (modified existing)', () => {
    const mgr = createManager();
    const first = mgr.applyEffect('enemy1', 'vulnerable', 2, 'test');
    const second = mgr.applyEffect('enemy1', 'vulnerable', 1, 'test');
    expect(first).toBe(true);
    expect(second).toBe(false);
  });

  it('three sequential applications add up correctly', () => {
    const mgr = createManager();
    mgr.applyEffect('enemy1', 'vulnerable', 1, 'test');
    mgr.applyEffect('enemy1', 'vulnerable', 1, 'test');
    mgr.applyEffect('enemy1', 'vulnerable', 1, 'test');
    expect(mgr.getEffectStacks('enemy1', 'vulnerable')).toBe(3);
  });
});

// ===========================================================================
// AC2: Poison(3) at turn end: deals 3 damage, becomes Poison(2)
// ===========================================================================

describe('AC2: Poison tick behavior', () => {
  it('Poison(3) is not decremented by processTurnEnd (STACKS duration)', () => {
    const mgr = createManager();
    mgr.applyEffect('enemy1', 'poison', 3, 'test');
    // processTurnEnd does NOT decrement STACKS effects
    mgr.processTurnEnd('enemy1', false);
    expect(mgr.getEffectStacks('enemy1', 'poison')).toBe(3);
  });

  it('Poison is decremented by modifyEffect (external caller simulates tick)', () => {
    const mgr = createManager();
    mgr.applyEffect('enemy1', 'poison', 3, 'test');
    // Combat system simulates: damage = stacks, then decrement
    const newStacks = mgr.modifyEffect('enemy1', 'poison', -1);
    expect(newStacks).toBe(2);
    expect(mgr.getEffectStacks('enemy1', 'poison')).toBe(2);
  });

  it('Poison(1) tick reduces to 0 and removes the effect', () => {
    const mgr = createManager();
    mgr.applyEffect('enemy1', 'poison', 1, 'test');
    mgr.modifyEffect('enemy1', 'poison', -1);
    expect(mgr.getEffectStacks('enemy1', 'poison')).toBe(0);
    expect(mgr.hasEffect('enemy1', 'poison')).toBe(false);
  });
});

// ===========================================================================
// AC3: Artifact(1) negates next debuff, Artifact removed afterward
// ===========================================================================

describe('AC3: Artifact negation', () => {
  it('Artifact(1) negates Vulnerable application', () => {
    const mgr = createManager();
    mgr.applyEffect('player', 'artifact', 1, 'relic');
    const result = mgr.tryApplyDebuff('player', 'vulnerable', 2, 'enemy');
    expect(result).toBe(false);
    expect(mgr.hasEffect('player', 'vulnerable')).toBe(false);
  });

  it('Artifact is consumed (reduced to 0 and removed) after negation', () => {
    const mgr = createManager();
    mgr.applyEffect('player', 'artifact', 1, 'relic');
    mgr.tryApplyDebuff('player', 'vulnerable', 2, 'enemy');
    expect(mgr.hasEffect('player', 'artifact')).toBe(false);
    expect(mgr.getEffectStacks('player', 'artifact')).toBe(0);
  });

  it('Artifact(2) negates first debuff, remains at 1 stack', () => {
    const mgr = createManager();
    mgr.applyEffect('player', 'artifact', 2, 'relic');
    mgr.tryApplyDebuff('player', 'vulnerable', 2, 'enemy');
    expect(mgr.getEffectStacks('player', 'artifact')).toBe(1);
    expect(mgr.hasEffect('player', 'vulnerable')).toBe(false);
  });

  it('Artifact(2) negates two debuffs, then third applies normally', () => {
    const mgr = createManager();
    mgr.applyEffect('player', 'artifact', 2, 'relic');

    const r1 = mgr.tryApplyDebuff('player', 'vulnerable', 2, 'enemy');
    expect(r1).toBe(false);
    expect(mgr.getEffectStacks('player', 'artifact')).toBe(1);

    const r2 = mgr.tryApplyDebuff('player', 'weak', 1, 'enemy');
    expect(r2).toBe(false);
    expect(mgr.hasEffect('player', 'artifact')).toBe(false);

    const r3 = mgr.tryApplyDebuff('player', 'frail', 2, 'enemy');
    expect(r3).toBe(true);
    expect(mgr.hasEffect('player', 'frail')).toBe(true);
  });

  it('tryApplyDebuff with a buff bypasses Artifact check', () => {
    const mgr = createManager();
    mgr.applyEffect('player', 'artifact', 1, 'relic');
    const result = mgr.tryApplyDebuff('player', 'strength', 2, 'potion');
    expect(result).toBe(true);
    expect(mgr.getEffectStacks('player', 'strength')).toBe(2);
    // Artifact should NOT be consumed
    expect(mgr.getEffectStacks('player', 'artifact')).toBe(1);
  });

  it('tryApplyDebuff with no Artifact applies normally', () => {
    const mgr = createManager();
    const result = mgr.tryApplyDebuff('enemy1', 'vulnerable', 2, 'card');
    expect(result).toBe(true);
    expect(mgr.getEffectStacks('enemy1', 'vulnerable')).toBe(2);
  });
});

// ===========================================================================
// AC4: Strength can go negative
// ===========================================================================

describe('AC4: Negative Strength', () => {
  it('Strength can be set to a negative value via modifyEffect', () => {
    const mgr = createManager();
    mgr.applyEffect('player', 'strength', 2, 'test');
    mgr.modifyEffect('player', 'strength', -4);
    expect(mgr.getEffectStacks('player', 'strength')).toBe(-2);
  });

  it('Strength can be directly applied as negative', () => {
    const mgr = createManager();
    mgr.applyEffect('enemy1', 'strength', -3, 'relic');
    expect(mgr.getEffectStacks('enemy1', 'strength')).toBe(-3);
  });

  it('negative Strength adds to existing positive Strength', () => {
    const mgr = createManager();
    mgr.applyEffect('player', 'strength', 5, 'potion');
    mgr.applyEffect('player', 'strength', -3, 'enemy_skill');
    // add_stacks: 5 + (-3) = 2
    expect(mgr.getEffectStacks('player', 'strength')).toBe(2);
  });

  it('Strength at 0 is removed (add_stacks stacks can reach 0)', () => {
    const mgr = createManager();
    mgr.applyEffect('player', 'strength', 2, 'test');
    mgr.modifyEffect('player', 'strength', -2);
    expect(mgr.hasEffect('player', 'strength')).toBe(false);
    expect(mgr.getEffectStacks('player', 'strength')).toBe(0);
  });
});

// ===========================================================================
// AC5: Frail modifier (formula test — manager provides data, combat system applies)
// ===========================================================================

describe('AC5: Frail status effect data', () => {
  it('Frail is a debuff with turns duration', () => {
    const mgr = createManager();
    mgr.applyEffect('player', 'frail', 2, 'enemy');
    const data = mgr.getEffectData('frail');
    expect(data?.category).toBe('debuff');
    expect(data?.durationType).toBe(DurationType.TURNS);
    expect(mgr.hasEffect('player', 'frail')).toBe(true);
  });

  it('Frail is decremented at turn end and removed at 0', () => {
    const mgr = createManager();
    mgr.applyEffect('player', 'frail', 2, 'enemy');
    mgr.processTurnEnd('player', true);
    expect(mgr.getEffectStacks('player', 'frail')).toBe(1);
    mgr.processTurnEnd('player', true);
    expect(mgr.hasEffect('player', 'frail')).toBe(false);
  });
});

// ===========================================================================
// AC6: combat-duration effects persist across turns until combat ends
// ===========================================================================

describe('AC6: Combat-duration persistence', () => {
  it('Strength persists across processTurnEnd calls', () => {
    const mgr = createManager();
    mgr.applyEffect('player', 'strength', 3, 'potion');
    mgr.processTurnEnd('player', true);
    mgr.processTurnEnd('player', true);
    expect(mgr.getEffectStacks('player', 'strength')).toBe(3);
  });

  it('Dexterity persists across processTurnEnd calls', () => {
    const mgr = createManager();
    mgr.applyEffect('player', 'dexterity', 2, 'relic');
    mgr.processTurnEnd('player', true);
    expect(mgr.getEffectStacks('player', 'dexterity')).toBe(2);
  });

  it('Combat-duration effects are cleared by resetForCombat', () => {
    const mgr = createManager();
    mgr.applyEffect('player', 'strength', 5, 'test');
    mgr.applyEffect('player', 'dexterity', 3, 'test');
    mgr.resetForCombat();
    expect(mgr.hasEffect('player', 'strength')).toBe(false);
    expect(mgr.hasEffect('player', 'dexterity')).toBe(false);
  });

  it('Metallicize persists across turns', () => {
    const mgr = createManager();
    mgr.applyEffect('player', 'metallicize', 3, 'power_card');
    mgr.processTurnEnd('player', true);
    expect(mgr.getEffectStacks('player', 'metallicize')).toBe(3);
  });
});

// ===========================================================================
// AC7: turns-duration effects decrease by 1 at end of target's turn; removed at 0
// ===========================================================================

describe('AC7: Turns-duration decrement', () => {
  it('Vulnerable(2) decrements to 1 at turn end', () => {
    const mgr = createManager();
    mgr.applyEffect('enemy1', 'vulnerable', 2, 'card');
    mgr.processTurnEnd('enemy1', false);
    expect(mgr.getEffectStacks('enemy1', 'vulnerable')).toBe(1);
  });

  it('Vulnerable(1) decrements to 0 and is removed at turn end', () => {
    const mgr = createManager();
    mgr.applyEffect('enemy1', 'vulnerable', 1, 'card');
    mgr.processTurnEnd('enemy1', false);
    expect(mgr.hasEffect('enemy1', 'vulnerable')).toBe(false);
  });

  it('Weak(2) decrements to 0 over two turns', () => {
    const mgr = createManager();
    mgr.applyEffect('player', 'weak', 2, 'enemy');
    mgr.processTurnEnd('player', true);
    expect(mgr.getEffectStacks('player', 'weak')).toBe(1);
    mgr.processTurnEnd('player', true);
    expect(mgr.hasEffect('player', 'weak')).toBe(false);
  });

  it('Multiple turns-duration effects all decrement in one call', () => {
    const mgr = createManager();
    mgr.applyEffect('enemy1', 'vulnerable', 2, 'card');
    mgr.applyEffect('enemy1', 'weak', 3, 'card');
    mgr.applyEffect('enemy1', 'frail', 1, 'card');
    mgr.processTurnEnd('enemy1', false);

    expect(mgr.getEffectStacks('enemy1', 'vulnerable')).toBe(1);
    expect(mgr.getEffectStacks('enemy1', 'weak')).toBe(2);
    // Frail(1) expired
    expect(mgr.hasEffect('enemy1', 'frail')).toBe(false);
  });
});

// ===========================================================================
// AC8: Boss immunity
// ===========================================================================

describe('AC8: Boss immunity', () => {
  it('Immune debuff is not applied', () => {
    const mgr = createManager();
    mgr.setImmunityChecker((_targetId, effectId) => effectId === 'vulnerable');
    const result = mgr.tryApplyDebuff('boss', 'vulnerable', 2, 'card');
    expect(result).toBe(false);
    expect(mgr.hasEffect('boss', 'vulnerable')).toBe(false);
  });

  it('Immune debuff does NOT consume Artifact', () => {
    const mgr = createManager();
    mgr.applyEffect('boss', 'artifact', 1, 'relic');
    mgr.setImmunityChecker((_targetId, effectId) => effectId === 'vulnerable');

    mgr.tryApplyDebuff('boss', 'vulnerable', 2, 'card');
    // Artifact should still be at 1 (not consumed)
    expect(mgr.getEffectStacks('boss', 'artifact')).toBe(1);
  });

  it('Non-immune debuff applies normally even with immunity checker', () => {
    const mgr = createManager();
    mgr.setImmunityChecker((_targetId, effectId) => effectId === 'vulnerable');
    const result = mgr.tryApplyDebuff('boss', 'weak', 2, 'card');
    expect(result).toBe(true);
    expect(mgr.getEffectStacks('boss', 'weak')).toBe(2);
  });

  it('Immune entity without immunity checker applies normally', () => {
    const mgr = createManager();
    // No immunity checker set
    const result = mgr.tryApplyDebuff('boss', 'vulnerable', 2, 'card');
    expect(result).toBe(true);
    expect(mgr.getEffectStacks('boss', 'vulnerable')).toBe(2);
  });
});

// ===========================================================================
// AC9: Turn-end processing order
// ===========================================================================

describe('AC9: Turn-end processing order', () => {
  it('Poison and Vulnerable both present; only Vulnerable decremented by processTurnEnd', () => {
    const mgr = createManager();
    mgr.applyEffect('enemy1', 'poison', 3, 'card');
    mgr.applyEffect('enemy1', 'vulnerable', 2, 'card');

    // processTurnEnd should decrement Vulnerable (TURNS) but NOT Poison (STACKS)
    mgr.processTurnEnd('enemy1', false);

    expect(mgr.getEffectStacks('enemy1', 'poison')).toBe(3);
    expect(mgr.getEffectStacks('enemy1', 'vulnerable')).toBe(1);
  });

  it('Combat-duration effects are NOT affected by processTurnEnd', () => {
    const mgr = createManager();
    mgr.applyEffect('player', 'strength', 4, 'potion');
    mgr.applyEffect('player', 'metallicize', 3, 'power');
    mgr.applyEffect('player', 'vulnerable', 2, 'enemy');

    mgr.processTurnEnd('player', true);

    // Combat-duration unchanged
    expect(mgr.getEffectStacks('player', 'strength')).toBe(4);
    expect(mgr.getEffectStacks('player', 'metallicize')).toBe(3);
    // Turns-duration decremented
    expect(mgr.getEffectStacks('player', 'vulnerable')).toBe(1);
  });
});

// ===========================================================================
// AC10: Effect applied during own trigger does not cause infinite loop
// (Simplified test: re-entrant applyEffect during change listener)
// ===========================================================================

describe('AC10: Re-entrant effect application', () => {
  it('applying an effect inside a change listener does not infinite loop', () => {
    const mgr = createManager();
    let callCount = 0;

    mgr.onStatusEffectChange((_event) => {
      callCount++;
      // Simulate: on gaining Vulnerable, also gain Weak(1)
      // Guard: only apply weak if it doesn't already exist (prevent re-trigger spiral)
      if (!mgr.hasEffect('player', 'weak')) {
        mgr.applyEffect('player', 'weak', 1, 'trigger');
      }
    });

    mgr.applyEffect('player', 'vulnerable', 2, 'card');

    // Both effects should exist without infinite recursion
    expect(mgr.getEffectStacks('player', 'vulnerable')).toBe(2);
    expect(mgr.getEffectStacks('player', 'weak')).toBe(1);
    // Listener was called for vulnerable + weak (weak's apply triggers listener
    // but the guard prevents further weak applications)
    expect(callCount).toBeGreaterThanOrEqual(2);
  });
});

// ===========================================================================
// Stacking Mode: overwriteMax
// ===========================================================================

describe('Stacking mode: overwriteMax (Intangible)', () => {
  it('Intangible(1) then Intangible(2) takes max = 2', () => {
    const mgr = createManager();
    mgr.applyEffect('player', 'intangible', 1, 'card');
    mgr.applyEffect('player', 'intangible', 2, 'card');
    expect(mgr.getEffectStacks('player', 'intangible')).toBe(2);
  });

  it('Intangible(2) then Intangible(1) takes max = 2', () => {
    const mgr = createManager();
    mgr.applyEffect('player', 'intangible', 2, 'card');
    mgr.applyEffect('player', 'intangible', 1, 'card');
    expect(mgr.getEffectStacks('player', 'intangible')).toBe(2);
  });

  it('Intangible(1) then Intangible(1) takes max = 1', () => {
    const mgr = createManager();
    mgr.applyEffect('player', 'intangible', 1, 'card');
    mgr.applyEffect('player', 'intangible', 1, 'card');
    expect(mgr.getEffectStacks('player', 'intangible')).toBe(1);
  });
});

// ===========================================================================
// Stacking Mode: doesNotStack
// ===========================================================================

describe('Stacking mode: doesNotStack (Entangled)', () => {
  it('first application succeeds', () => {
    const mgr = createManager();
    mgr.applyEffect('player', 'entangled', 1, 'enemy');
    expect(mgr.hasEffect('player', 'entangled')).toBe(true);
    expect(mgr.getEffectStacks('player', 'entangled')).toBe(1);
  });

  it('second application is ignored', () => {
    const mgr = createManager();
    mgr.applyEffect('player', 'entangled', 1, 'enemy');
    mgr.applyEffect('player', 'entangled', 1, 'enemy');
    expect(mgr.getEffectStacks('player', 'entangled')).toBe(1);
  });
});

// ===========================================================================
// Edge Case #1: Same effect applied twice in one action
// ===========================================================================

describe('Edge Case #1: Sequential same-effect applications', () => {
  it('Vulnerable(2) then Vulnerable(1) -> Vulnerable(3) via addDuration', () => {
    const mgr = createManager();
    mgr.applyEffect('enemy1', 'vulnerable', 2, 'card_a');
    mgr.applyEffect('enemy1', 'vulnerable', 1, 'card_b');
    expect(mgr.getEffectStacks('enemy1', 'vulnerable')).toBe(3);
  });
});

// ===========================================================================
// Edge Case #2: Negative stacks (Strength/Dexterity)
// ===========================================================================

describe('Edge Case #2: Negative stacks', () => {
  it('Dexterity can go negative', () => {
    const mgr = createManager();
    mgr.applyEffect('player', 'dexterity', -5, 'curse');
    expect(mgr.getEffectStacks('player', 'dexterity')).toBe(-5);
  });

  it('Negative Dexterity can be offset by positive application', () => {
    const mgr = createManager();
    mgr.applyEffect('player', 'dexterity', -3, 'curse');
    mgr.applyEffect('player', 'dexterity', 5, 'potion');
    expect(mgr.getEffectStacks('player', 'dexterity')).toBe(2);
  });
});

// ===========================================================================
// Edge Case #3: Poison reaches 0
// ===========================================================================

describe('Edge Case #3: Poison reaches 0', () => {
  it('Poison(1) decremented to 0 is removed', () => {
    const mgr = createManager();
    mgr.applyEffect('enemy1', 'poison', 1, 'card');
    mgr.modifyEffect('enemy1', 'poison', -1);
    expect(mgr.hasEffect('enemy1', 'poison')).toBe(false);
  });

  it('Next Poison application starts fresh', () => {
    const mgr = createManager();
    mgr.applyEffect('enemy1', 'poison', 1, 'card');
    mgr.modifyEffect('enemy1', 'poison', -1);
    expect(mgr.hasEffect('enemy1', 'poison')).toBe(false);

    mgr.applyEffect('enemy1', 'poison', 5, 'card');
    expect(mgr.getEffectStacks('enemy1', 'poison')).toBe(5);
  });
});

// ===========================================================================
// Edge Case #5: Frail only affects card Block (formula verification via data)
// ===========================================================================

describe('Edge Case #5: Frail is a debuff affecting card block', () => {
  it('Frail exists as a turns-duration debuff', () => {
    const mgr = createManager();
    const data = mgr.getEffectData('frail');
    expect(data?.category).toBe('debuff');
    expect(data?.durationType).toBe(DurationType.TURNS);
  });
});

// ===========================================================================
// Edge Case #6: Multiple debuffs vs Artifact(1)
// ===========================================================================

describe('Edge Case #6: Sequential debuffs vs Artifact', () => {
  it('Artifact(1) negates first debuff, remaining apply', () => {
    const mgr = createManager();
    mgr.applyEffect('player', 'artifact', 1, 'relic');

    const r1 = mgr.tryApplyDebuff('player', 'vulnerable', 2, 'enemy');
    expect(r1).toBe(false);
    expect(mgr.hasEffect('player', 'artifact')).toBe(false);

    const r2 = mgr.tryApplyDebuff('player', 'weak', 1, 'enemy');
    expect(r2).toBe(true);
    expect(mgr.getEffectStacks('player', 'weak')).toBe(1);

    const r3 = mgr.tryApplyDebuff('player', 'frail', 2, 'enemy');
    expect(r3).toBe(true);
    expect(mgr.getEffectStacks('player', 'frail')).toBe(2);
  });
});

// ===========================================================================
// Edge Case #7: Effect on dead entity (clearAllEffects)
// ===========================================================================

describe('Edge Case #7: Clearing effects on dead entity', () => {
  it('clearAllEffects removes all effects from entity', () => {
    const mgr = createManager();
    mgr.applyEffect('enemy1', 'poison', 5, 'card');
    mgr.applyEffect('enemy1', 'strength', 3, 'relic');
    mgr.applyEffect('enemy1', 'vulnerable', 2, 'card');

    mgr.clearAllEffects('enemy1');

    expect(mgr.hasEffect('enemy1', 'poison')).toBe(false);
    expect(mgr.hasEffect('enemy1', 'strength')).toBe(false);
    expect(mgr.hasEffect('enemy1', 'vulnerable')).toBe(false);
    expect(mgr.getAllEffects('enemy1')).toHaveLength(0);
  });

  it('clearAllEffects is safe on entity with no effects', () => {
    const mgr = createManager();
    expect(() => mgr.clearAllEffects('nonexistent')).not.toThrow();
  });
});

// ===========================================================================
// Edge Case #8: Combat end cleanup
// ===========================================================================

describe('Edge Case #8: Combat end cleanup', () => {
  it('resetForCombat clears all effects on all entities', () => {
    const mgr = createManager();
    mgr.applyEffect('player', 'strength', 5, 'potion');
    mgr.applyEffect('enemy1', 'poison', 3, 'card');
    mgr.applyEffect('enemy2', 'vulnerable', 2, 'card');

    mgr.resetForCombat();

    expect(mgr.hasEffect('player', 'strength')).toBe(false);
    expect(mgr.hasEffect('enemy1', 'poison')).toBe(false);
    expect(mgr.hasEffect('enemy2', 'vulnerable')).toBe(false);
  });
});

// ===========================================================================
// Query: getEffectStacks
// ===========================================================================

describe('getEffectStacks', () => {
  it('returns 0 for nonexistent entity', () => {
    const mgr = createManager();
    expect(mgr.getEffectStacks('ghost', 'strength')).toBe(0);
  });

  it('returns 0 for nonexistent effect on existing entity', () => {
    const mgr = createManager();
    mgr.applyEffect('player', 'strength', 3, 'test');
    expect(mgr.getEffectStacks('player', 'vulnerable')).toBe(0);
  });
});

// ===========================================================================
// Query: hasEffect
// ===========================================================================

describe('hasEffect', () => {
  it('returns true for active effect', () => {
    const mgr = createManager();
    mgr.applyEffect('player', 'strength', 2, 'test');
    expect(mgr.hasEffect('player', 'strength')).toBe(true);
  });

  it('returns false for nonexistent effect', () => {
    const mgr = createManager();
    expect(mgr.hasEffect('player', 'strength')).toBe(false);
  });

  it('returns false after effect expires', () => {
    const mgr = createManager();
    mgr.applyEffect('player', 'vulnerable', 1, 'enemy');
    mgr.processTurnEnd('player', true);
    expect(mgr.hasEffect('player', 'vulnerable')).toBe(false);
  });
});

// ===========================================================================
// Query: getAllEffects
// ===========================================================================

describe('getAllEffects', () => {
  it('returns read-only snapshot of all effects on entity', () => {
    const mgr = createManager();
    mgr.applyEffect('player', 'strength', 3, 'potion');
    mgr.applyEffect('player', 'dexterity', 2, 'relic');

    const effects = mgr.getAllEffects('player');
    expect(effects).toHaveLength(2);
    expect(effects[0].effectId).toBe('strength');
    expect(effects[1].effectId).toBe('dexterity');
  });

  it('returns empty array for entity with no effects', () => {
    const mgr = createManager();
    expect(mgr.getAllEffects('nobody')).toHaveLength(0);
  });

  it('snapshot does not reflect later changes', () => {
    const mgr = createManager();
    mgr.applyEffect('player', 'strength', 5, 'test');
    const snap = mgr.getAllEffects('player');
    mgr.modifyEffect('player', 'strength', -3);
    // Snapshot should still show 5
    expect(snap[0].stacks).toBe(5);
  });
});

// ===========================================================================
// removeEffects with filter
// ===========================================================================

describe('removeEffects with filter', () => {
  it('removes all debuffs when category filter is debuff', () => {
    const mgr = createManager();
    mgr.applyEffect('player', 'strength', 3, 'potion');
    mgr.applyEffect('player', 'vulnerable', 2, 'enemy');
    mgr.applyEffect('player', 'weak', 1, 'enemy');
    mgr.applyEffect('player', 'frail', 2, 'enemy');

    const removed = mgr.removeEffects('player', { category: 'debuff' });
    expect(removed).toBe(3);
    expect(mgr.hasEffect('player', 'strength')).toBe(true);
    expect(mgr.hasEffect('player', 'vulnerable')).toBe(false);
    expect(mgr.hasEffect('player', 'weak')).toBe(false);
    expect(mgr.hasEffect('player', 'frail')).toBe(false);
  });

  it('removes specific effect by effectId', () => {
    const mgr = createManager();
    mgr.applyEffect('player', 'strength', 3, 'test');
    mgr.applyEffect('player', 'dexterity', 2, 'test');

    mgr.removeEffects('player', { effectId: 'strength' });
    expect(mgr.hasEffect('player', 'strength')).toBe(false);
    expect(mgr.hasEffect('player', 'dexterity')).toBe(true);
  });

  it('removes all effects when no filter provided', () => {
    const mgr = createManager();
    mgr.applyEffect('player', 'strength', 3, 'test');
    mgr.applyEffect('player', 'vulnerable', 2, 'test');
    mgr.applyEffect('player', 'poison', 5, 'test');

    const removed = mgr.removeEffects('player');
    expect(removed).toBe(3);
    expect(mgr.getAllEffects('player')).toHaveLength(0);
  });

  it('returns 0 for entity with no effects', () => {
    const mgr = createManager();
    const removed = mgr.removeEffects('nobody', { category: 'debuff' });
    expect(removed).toBe(0);
  });
});

// ===========================================================================
// Error handling: unknown effect ID
// ===========================================================================

describe('Error handling', () => {
  it('applyEffect throws for unknown effect ID', () => {
    const mgr = createManager();
    expect(() => mgr.applyEffect('player', 'nonexistent_effect', 1, 'test')).toThrow(
      'Unknown status effect ID: "nonexistent_effect"'
    );
  });

  it('tryApplyDebuff throws for unknown effect ID', () => {
    const mgr = createManager();
    expect(() => mgr.tryApplyDebuff('player', 'nonexistent_effect', 1, 'test')).toThrow(
      'Unknown status effect ID: "nonexistent_effect"'
    );
  });
});

// ===========================================================================
// Change event notifications
// ===========================================================================

describe('Change event notifications', () => {
  it('fires event on applyEffect (new)', () => {
    const mgr = createManager();
    const events = captureChanges(mgr, () => {
      mgr.applyEffect('player', 'strength', 3, 'potion');
    });
    expect(events).toHaveLength(1);
    expect(events[0]).toEqual({
      targetId: 'player',
      effectId: 'strength',
      stacks: 3,
      source: 'potion',
    });
  });

  it('fires event on applyEffect (stacking)', () => {
    const mgr = createManager();
    mgr.applyEffect('player', 'strength', 2, 'test');
    const events = captureChanges(mgr, () => {
      mgr.applyEffect('player', 'strength', 3, 'potion');
    });
    expect(events).toHaveLength(1);
    expect(events[0].stacks).toBe(5);
  });

  it('fires event on removeEffect', () => {
    const mgr = createManager();
    mgr.applyEffect('player', 'vulnerable', 2, 'test');
    const events = captureChanges(mgr, () => {
      mgr.removeEffect('player', 'vulnerable');
    });
    expect(events).toHaveLength(1);
    expect(events[0].effectId).toBe('vulnerable');
    expect(events[0].stacks).toBe(0);
  });

  it('does not fire event when removing nonexistent effect', () => {
    const mgr = createManager();
    const events = captureChanges(mgr, () => {
      mgr.removeEffect('player', 'vulnerable');
    });
    expect(events).toHaveLength(0);
  });

  it('fires event on modifyEffect', () => {
    const mgr = createManager();
    mgr.applyEffect('player', 'strength', 5, 'test');
    const events = captureChanges(mgr, () => {
      mgr.modifyEffect('player', 'strength', -2);
    });
    expect(events).toHaveLength(1);
    expect(events[0].stacks).toBe(3);
  });
});

// ===========================================================================
// getEffectData
// ===========================================================================

describe('getEffectData', () => {
  it('returns definition for known effect', () => {
    const mgr = createManager();
    const data = mgr.getEffectData('vulnerable');
    expect(data).toBeDefined();
    expect(data?.id).toBe('vulnerable');
    expect(data?.category).toBe('debuff');
    expect(data?.durationType).toBe(DurationType.TURNS);
    expect(data?.stackingMode).toBe(StackingMode.ADD_DURATION);
  });

  it('returns undefined for unknown effect', () => {
    const mgr = createManager();
    expect(mgr.getEffectData('nonexistent')).toBeUndefined();
  });
});

// ===========================================================================
// Multi-entity isolation
// ===========================================================================

describe('Multi-entity isolation', () => {
  it('effects on one entity do not affect another', () => {
    const mgr = createManager();
    mgr.applyEffect('player', 'strength', 5, 'potion');
    mgr.applyEffect('enemy1', 'strength', 2, 'buff');
    mgr.applyEffect('enemy1', 'vulnerable', 3, 'card');

    expect(mgr.getEffectStacks('player', 'strength')).toBe(5);
    expect(mgr.getEffectStacks('player', 'vulnerable')).toBe(0);
    expect(mgr.getEffectStacks('enemy1', 'strength')).toBe(2);
    expect(mgr.getEffectStacks('enemy1', 'vulnerable')).toBe(3);
  });

  it('processTurnEnd on one entity does not affect another', () => {
    const mgr = createManager();
    mgr.applyEffect('player', 'vulnerable', 2, 'enemy');
    mgr.applyEffect('enemy1', 'vulnerable', 3, 'card');

    mgr.processTurnEnd('player', true);

    expect(mgr.getEffectStacks('player', 'vulnerable')).toBe(1);
    expect(mgr.getEffectStacks('enemy1', 'vulnerable')).toBe(3);
  });

  it('clearAllEffects on one entity does not affect another', () => {
    const mgr = createManager();
    mgr.applyEffect('player', 'strength', 5, 'test');
    mgr.applyEffect('enemy1', 'strength', 3, 'test');

    mgr.clearAllEffects('player');

    expect(mgr.hasEffect('player', 'strength')).toBe(false);
    expect(mgr.getEffectStacks('enemy1', 'strength')).toBe(3);
  });
});

// ===========================================================================
// Full combat flow integration
// ===========================================================================

describe('Full combat flow integration', () => {
  it('simulates a complete combat scenario', () => {
    const mgr = createManager();
    mgr.setImmunityChecker((targetId, effectId) => {
      // Boss is immune to Vulnerable
      return targetId === 'boss' && effectId === 'vulnerable';
    });

    // --- Turn 1: Player's turn ---
    // Player plays Bash: deals damage, applies Vulnerable(2) to enemy1
    mgr.applyEffect('enemy1', 'vulnerable', 2, 'card_bash');

    // Enemy intents: apply Weak(2) to player
    mgr.tryApplyDebuff('player', 'weak', 2, 'enemy1');

    // Player has Vulnerable(2) on enemy1, Weak(2) on self
    expect(mgr.getEffectStacks('enemy1', 'vulnerable')).toBe(2);
    expect(mgr.getEffectStacks('player', 'weak')).toBe(2);

    // End of player's turn
    mgr.processTurnEnd('player', true);
    // Weak(2) decrements to 1
    expect(mgr.getEffectStacks('player', 'weak')).toBe(1);

    // --- Turn 1: Enemy's turn ---
    // Enemy1 attacks, Vulnerable still active
    expect(mgr.getEffectStacks('enemy1', 'vulnerable')).toBe(2);

    mgr.processTurnEnd('enemy1', false);
    // Vulnerable decrements to 1
    expect(mgr.getEffectStacks('enemy1', 'vulnerable')).toBe(1);

    // --- Turn 2: Player's turn ---
    mgr.processTurnEnd('player', true);
    // Weak expires (1 -> 0, removed)
    expect(mgr.hasEffect('player', 'weak')).toBe(false);

    // --- Turn 2: Enemy's turn ---
    mgr.processTurnEnd('enemy1', false);
    // Vulnerable expires
    expect(mgr.hasEffect('enemy1', 'vulnerable')).toBe(false);

    // --- Boss fight: boss is immune to Vulnerable ---
    expect(mgr.tryApplyDebuff('boss', 'vulnerable', 2, 'card')).toBe(false);
    expect(mgr.hasEffect('boss', 'vulnerable')).toBe(false);

    // But boss can receive Weak
    expect(mgr.tryApplyDebuff('boss', 'weak', 2, 'card')).toBe(true);
    expect(mgr.getEffectStacks('boss', 'weak')).toBe(2);

    // --- Combat ends ---
    mgr.resetForCombat();
    expect(mgr.getAllEffects('player')).toHaveLength(0);
    expect(mgr.getAllEffects('enemy1')).toHaveLength(0);
    expect(mgr.getAllEffects('boss')).toHaveLength(0);
  });
});
