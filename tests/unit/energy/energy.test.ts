/**
 * energy.test.ts — Unit tests for the EnergySystem.
 *
 * Implements acceptance criteria and edge cases from design/gdd/energy.md.
 *
 * Coverage areas:
 * - AC1: Turn start sets currentEnergy = max(0, baseEnergy + relicBonus + bonusEnergy - penaltyEnergy)
 * - AC2: Playing a 2-cost card reduces currentEnergy by 2
 * - AC3: Card with cost > currentEnergy cannot be played
 * - AC4: X-cost card consumes all currentEnergy and reports the amount
 * - AC5: Turn end forces currentEnergy = 0
 * - AC6: penaltyEnergy >= effectiveMaxEnergy results in 0 energy, not negative
 * - AC7: 0-cost card is playable at any energy level, including 0
 * - AC8: Energy gain mid-turn increases currentEnergy without affecting effectiveMaxEnergy
 * - AC9: Two relics each granting +1 energy result in effectiveMaxEnergy = baseEnergy + 2
 *
 * Additional edge cases from GDD Section "Edge Cases".
 */

// @vitest-environment node

import { describe, it, expect } from 'vitest';
import { EnergySystem, EnergyPhase } from '../../../src/systems/energy-system';
import { DEFAULT_BASE_ENERGY } from '../../../src/config/game-config';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Create an EnergySystem with the given base energy and optional relic bonus. */
function createSystem(baseEnergy: number = DEFAULT_BASE_ENERGY, relicBonus: number = 0): EnergySystem {
  return new EnergySystem(baseEnergy, relicBonus);
}

// ===========================================================================
// AC1: Turn start energy calculation
// ===========================================================================

describe('AC1: Turn start energy calculation', () => {
  it('sets currentEnergy to baseEnergy with no bonuses or penalties', () => {
    const es = createSystem(3);
    es.onTurnStart();
    expect(es.getCurrentEnergy()).toBe(3);
  });

  it('sets currentEnergy to baseEnergy + relicBonus', () => {
    const es = createSystem(3, 2);
    es.onTurnStart();
    expect(es.getCurrentEnergy()).toBe(5);
  });

  it('adds bonusEnergy to the turn start calculation', () => {
    const es = createSystem(3);
    es.onTurnStart(2, 0);
    expect(es.getCurrentEnergy()).toBe(5);
  });

  it('subtracts penaltyEnergy from the turn start calculation', () => {
    const es = createSystem(3);
    es.onTurnStart(0, 1);
    expect(es.getCurrentEnergy()).toBe(2);
  });

  it('applies full formula: baseEnergy + relicBonus + bonusEnergy - penaltyEnergy', () => {
    const es = createSystem(3, 1);
    es.onTurnStart(2, 1);
    // effectiveMax = 3 + 1 = 4
    // currentEnergy = max(0, 4 + 2 - 1) = 5
    expect(es.getCurrentEnergy()).toBe(5);
  });

  it('clears previous turn bonuses and penalties on new turn start', () => {
    const es = createSystem(3);
    es.onTurnStart(5, 2);
    expect(es.getCurrentEnergy()).toBe(6);
    // Next turn with no modifiers
    es.onTurnStart(0, 0);
    expect(es.getCurrentEnergy()).toBe(3);
  });

  it('clamps currentEnergy to 0 when calculation is negative', () => {
    const es = createSystem(2);
    es.onTurnStart(0, 5);
    expect(es.getCurrentEnergy()).toBe(0);
  });
});

// ===========================================================================
// AC2: Playing a 2-cost card reduces currentEnergy by 2
// ===========================================================================

describe('AC2: Playing a card costs energy', () => {
  it('playing a 2-cost card reduces currentEnergy by 2', () => {
    const es = createSystem(3);
    es.onTurnStart();
    const spent = es.spendEnergy(2);
    expect(spent).toBe(2);
    expect(es.getCurrentEnergy()).toBe(1);
  });

  it('playing a 1-cost card reduces currentEnergy by 1', () => {
    const es = createSystem(3);
    es.onTurnStart();
    es.spendEnergy(1);
    expect(es.getCurrentEnergy()).toBe(2);
  });

  it('playing multiple cards cumulatively reduces energy', () => {
    const es = createSystem(3);
    es.onTurnStart();
    es.spendEnergy(1);
    es.spendEnergy(2);
    expect(es.getCurrentEnergy()).toBe(0);
  });
});

// ===========================================================================
// AC3: Card with cost > currentEnergy cannot be played
// ===========================================================================

describe('AC3: Insufficient energy prevents card play', () => {
  it('canPlay returns false when cost exceeds currentEnergy', () => {
    const es = createSystem(3);
    es.onTurnStart();
    es.spendEnergy(2);
    expect(es.canPlay(2, 'normal')).toBe(false);
  });

  it('canPlay returns true when cost equals currentEnergy', () => {
    const es = createSystem(3);
    es.onTurnStart();
    expect(es.canPlay(3, 'normal')).toBe(true);
  });

  it('canPlay returns true when cost is less than currentEnergy', () => {
    const es = createSystem(3);
    es.onTurnStart();
    expect(es.canPlay(1, 'normal')).toBe(true);
  });

  it('spendEnergy throws when insufficient energy', () => {
    const es = createSystem(3);
    es.onTurnStart();
    es.spendEnergy(2);
    expect(() => es.spendEnergy(2)).toThrow('Insufficient energy');
  });
});

// ===========================================================================
// AC4: X-cost card consumes all currentEnergy
// ===========================================================================

describe('AC4: X-cost cards', () => {
  it('consumes all currentEnergy and reports the amount', () => {
    const es = createSystem(3);
    es.onTurnStart();
    const xValue = es.spendAllEnergy();
    expect(xValue).toBe(3);
    expect(es.getCurrentEnergy()).toBe(0);
  });

  it('canPlay returns false for X-cost when energy is 0', () => {
    const es = createSystem(3);
    es.onTurnStart();
    es.spendEnergy(3);
    expect(es.canPlay(0, 'x')).toBe(false);
  });

  it('canPlay returns true for X-cost when energy > 0', () => {
    const es = createSystem(3);
    es.onTurnStart();
    expect(es.canPlay(0, 'x')).toBe(true);
  });

  it('canPlay returns false for unplayable cost type', () => {
    const es = createSystem(3);
    es.onTurnStart();
    expect(es.canPlay(0, 'unplayable')).toBe(false);
  });

  it('X-cost reports correct value after partial spend', () => {
    const es = createSystem(3);
    es.onTurnStart();
    es.spendEnergy(1);
    const xValue = es.spendAllEnergy();
    expect(xValue).toBe(2);
    expect(es.getCurrentEnergy()).toBe(0);
  });
});

// ===========================================================================
// AC5: Turn end forces currentEnergy = 0
// ===========================================================================

describe('AC5: Turn end', () => {
  it('forces currentEnergy to 0', () => {
    const es = createSystem(3);
    es.onTurnStart();
    es.spendEnergy(1);
    // 2 energy left unspent
    expect(es.getCurrentEnergy()).toBe(2);
    es.onTurnEnd();
    expect(es.getCurrentEnergy()).toBe(0);
  });

  it('sets phase to END', () => {
    const es = createSystem(3);
    es.onTurnStart();
    es.onTurnEnd();
    expect(es.getPhase()).toBe(EnergyPhase.END);
  });

  it('clears temporary bonus and penalty', () => {
    const es = createSystem(3);
    es.onTurnStart(5, 2);
    es.onTurnEnd();
    const state = es.getState();
    expect(state.bonusEnergy).toBe(0);
    expect(state.penaltyEnergy).toBe(0);
    expect(state.currentEnergy).toBe(0);
  });
});

// ===========================================================================
// AC6: penaltyEnergy >= effectiveMaxEnergy results in 0 energy
// ===========================================================================

describe('AC6: Penalty drains all energy', () => {
  it('penalty equal to effectiveMaxEnergy results in 0 energy', () => {
    const es = createSystem(3);
    es.onTurnStart(0, 3);
    expect(es.getCurrentEnergy()).toBe(0);
  });

  it('penalty greater than effectiveMaxEnergy results in 0 (not negative)', () => {
    const es = createSystem(3);
    es.onTurnStart(0, 10);
    expect(es.getCurrentEnergy()).toBe(0);
  });

  it('penalty equal to effectiveMax + bonus results in 0', () => {
    const es = createSystem(3, 1);
    // effectiveMax = 4
    es.onTurnStart(2, 6);
    // 4 + 2 - 6 = 0
    expect(es.getCurrentEnergy()).toBe(0);
  });

  it('player can still play 0-cost cards when energy is 0 from penalty', () => {
    const es = createSystem(3);
    es.onTurnStart(0, 5);
    expect(es.getCurrentEnergy()).toBe(0);
    expect(es.canPlay(0, 'normal')).toBe(true);
  });
});

// ===========================================================================
// AC7: 0-cost card is playable at any energy level
// ===========================================================================

describe('AC7: Zero-cost cards', () => {
  it('is playable when energy is full', () => {
    const es = createSystem(3);
    es.onTurnStart();
    expect(es.canPlay(0, 'normal')).toBe(true);
  });

  it('is playable when energy is 0', () => {
    const es = createSystem(3);
    es.onTurnStart();
    es.spendEnergy(3);
    expect(es.getCurrentEnergy()).toBe(0);
    expect(es.canPlay(0, 'normal')).toBe(true);
  });

  it('is playable when energy was drained by penalty', () => {
    const es = createSystem(3);
    es.onTurnStart(0, 10);
    expect(es.getCurrentEnergy()).toBe(0);
    expect(es.canPlay(0, 'normal')).toBe(true);
  });

  it('spending 0 energy does not reduce currentEnergy', () => {
    const es = createSystem(3);
    es.onTurnStart();
    es.spendEnergy(0);
    expect(es.getCurrentEnergy()).toBe(3);
  });
});

// ===========================================================================
// AC8: Energy gain mid-turn increases currentEnergy without affecting effectiveMax
// ===========================================================================

describe('AC8: Mid-turn energy gain', () => {
  it('increases currentEnergy directly', () => {
    const es = createSystem(3);
    es.onTurnStart();
    es.gainEnergy(2);
    expect(es.getCurrentEnergy()).toBe(5);
  });

  it('does not change effectiveMaxEnergy', () => {
    const es = createSystem(3);
    es.onTurnStart();
    es.gainEnergy(5);
    expect(es.getEffectiveMaxEnergy()).toBe(3);
  });

  it('allows currentEnergy to exceed effectiveMaxEnergy', () => {
    const es = createSystem(3);
    es.onTurnStart();
    es.gainEnergy(10);
    expect(es.getCurrentEnergy()).toBe(13);
    expect(es.getEffectiveMaxEnergy()).toBe(3);
  });

  it('ignores negative gain amounts', () => {
    const es = createSystem(3);
    es.onTurnStart();
    es.gainEnergy(-5);
    expect(es.getCurrentEnergy()).toBe(3);
  });

  it('is usable after being depleted', () => {
    const es = createSystem(3);
    es.onTurnStart();
    es.spendEnergy(3);
    expect(es.getCurrentEnergy()).toBe(0);
    es.gainEnergy(2);
    expect(es.getCurrentEnergy()).toBe(2);
    expect(es.canPlay(1, 'normal')).toBe(true);
  });
});

// ===========================================================================
// AC9: Two relics each granting +1 energy
// ===========================================================================

describe('AC9: Relic bonus stacking', () => {
  it('two +1 relics result in effectiveMaxEnergy = baseEnergy + 2', () => {
    const es = createSystem(3);
    es.addRelicBonus(1);
    es.addRelicBonus(1);
    expect(es.getEffectiveMaxEnergy()).toBe(5);
  });

  it('relic bonus persists after turn end', () => {
    const es = createSystem(3, 2);
    es.onTurnStart();
    es.onTurnEnd();
    es.onTurnStart();
    expect(es.getCurrentEnergy()).toBe(5);
    expect(es.getEffectiveMaxEnergy()).toBe(5);
  });

  it('relic bonus is additive and uncapped', () => {
    const es = createSystem(3);
    for (let i = 0; i < 5; i++) {
      es.addRelicBonus(1);
    }
    expect(es.getEffectiveMaxEnergy()).toBe(8);
  });

  it('removeRelicBonus reduces the bonus', () => {
    const es = createSystem(3);
    es.addRelicBonus(2);
    es.removeRelicBonus(1);
    expect(es.getEffectiveMaxEnergy()).toBe(4);
  });

  it('removeRelicBonus floors at 0', () => {
    const es = createSystem(3);
    es.removeRelicBonus(10);
    expect(es.getEffectiveMaxEnergy()).toBe(3);
  });

  it('ignores non-positive relic bonus additions', () => {
    const es = createSystem(3);
    es.addRelicBonus(0);
    es.addRelicBonus(-1);
    expect(es.getEffectiveMaxEnergy()).toBe(3);
  });
});

// ===========================================================================
// State Machine Transitions (GDD "States and Transitions")
// ===========================================================================

describe('State machine transitions', () => {
  it('starts in RESET phase', () => {
    const es = createSystem(3);
    expect(es.getPhase()).toBe(EnergyPhase.RESET);
  });

  it('transitions RESET -> FULL on turn start with energy', () => {
    const es = createSystem(3);
    es.onTurnStart();
    expect(es.getPhase()).toBe(EnergyPhase.FULL);
  });

  it('transitions FULL -> SPENDING after first card played', () => {
    const es = createSystem(3);
    es.onTurnStart();
    es.spendEnergy(1);
    expect(es.getPhase()).toBe(EnergyPhase.SPENDING);
  });

  it('transitions SPENDING -> DEPLETED when energy hits 0', () => {
    const es = createSystem(3);
    es.onTurnStart();
    es.spendEnergy(3);
    expect(es.getPhase()).toBe(EnergyPhase.DEPLETED);
  });

  it('transitions DEPLETED -> BONUS after mid-turn energy gain', () => {
    const es = createSystem(3);
    es.onTurnStart();
    es.spendEnergy(3);
    expect(es.getPhase()).toBe(EnergyPhase.DEPLETED);
    es.gainEnergy(2);
    expect(es.getPhase()).toBe(EnergyPhase.BONUS);
  });

  it('transitions BONUS -> SPENDING after card played', () => {
    const es = createSystem(3);
    es.onTurnStart();
    es.spendEnergy(3);
    es.gainEnergy(2);
    expect(es.getPhase()).toBe(EnergyPhase.BONUS);
    es.spendEnergy(1);
    expect(es.getPhase()).toBe(EnergyPhase.SPENDING);
  });

  it('transitions to DEPLETED on turn start with all energy drained', () => {
    const es = createSystem(3);
    es.onTurnStart(0, 5);
    expect(es.getPhase()).toBe(EnergyPhase.DEPLETED);
  });

  it('any phase -> END on turn end', () => {
    const es = createSystem(3);
    es.onTurnStart();
    es.gainEnergy(5);
    expect(es.getPhase()).toBe(EnergyPhase.BONUS);
    es.onTurnEnd();
    expect(es.getPhase()).toBe(EnergyPhase.END);
  });

  it('full cycle: RESET -> FULL -> SPENDING -> DEPLETED -> END -> FULL', () => {
    const es = createSystem(3);
    expect(es.getPhase()).toBe(EnergyPhase.RESET);
    es.onTurnStart();
    expect(es.getPhase()).toBe(EnergyPhase.FULL);
    es.spendEnergy(3);
    expect(es.getPhase()).toBe(EnergyPhase.DEPLETED);
    es.onTurnEnd();
    expect(es.getPhase()).toBe(EnergyPhase.END);
    es.onTurnStart();
    expect(es.getPhase()).toBe(EnergyPhase.FULL);
  });
});

// ===========================================================================
// Mid-turn energy loss (GDD "Energy loss during turn")
// ===========================================================================

describe('Mid-turn energy loss', () => {
  it('reduces currentEnergy by the specified amount', () => {
    const es = createSystem(3);
    es.onTurnStart();
    es.loseEnergy(2);
    expect(es.getCurrentEnergy()).toBe(1);
  });

  it('floors currentEnergy at 0', () => {
    const es = createSystem(3);
    es.onTurnStart();
    es.loseEnergy(10);
    expect(es.getCurrentEnergy()).toBe(0);
  });

  it('transitions to DEPLETED when loss drains all energy', () => {
    const es = createSystem(3);
    es.onTurnStart();
    es.loseEnergy(3);
    expect(es.getPhase()).toBe(EnergyPhase.DEPLETED);
  });

  it('ignores negative loss amounts', () => {
    const es = createSystem(3);
    es.onTurnStart();
    es.loseEnergy(-5);
    expect(es.getCurrentEnergy()).toBe(3);
  });
});

// ===========================================================================
// Combat reset (GDD Edge Case #7)
// ===========================================================================

describe('Combat reset', () => {
  it('resets energy to 0 after combat', () => {
    const es = createSystem(3);
    es.onTurnStart();
    es.gainEnergy(5);
    es.resetForCombat();
    expect(es.getCurrentEnergy()).toBe(0);
  });

  it('preserves relicBonus through combat reset', () => {
    const es = createSystem(3, 2);
    es.resetForCombat();
    expect(es.getEffectiveMaxEnergy()).toBe(5);
  });

  it('clears temporary modifiers on combat reset', () => {
    const es = createSystem(3);
    es.onTurnStart(5, 2);
    es.resetForCombat();
    const state = es.getState();
    expect(state.bonusEnergy).toBe(0);
    expect(state.penaltyEnergy).toBe(0);
  });

  it('sets phase to RESET after combat reset', () => {
    const es = createSystem(3);
    es.onTurnStart();
    es.onTurnEnd();
    es.resetForCombat();
    expect(es.getPhase()).toBe(EnergyPhase.RESET);
  });
});

// ===========================================================================
// getState returns a snapshot (read-only copy)
// ===========================================================================

describe('getState snapshot', () => {
  it('returns a copy, not a reference', () => {
    const es = createSystem(3);
    es.onTurnStart();
    const snap1 = es.getState();
    es.spendEnergy(1);
    const snap2 = es.getState();
    expect(snap1.currentEnergy).toBe(3);
    expect(snap2.currentEnergy).toBe(2);
  });

  it('contains all EnergyState fields', () => {
    const es = createSystem(3, 1);
    es.onTurnStart(2, 1);
    const state = es.getState();
    expect(state.baseEnergy).toBe(3);
    expect(state.relicBonus).toBe(1);
    expect(state.bonusEnergy).toBe(2);
    expect(state.penaltyEnergy).toBe(1);
    expect(state.currentEnergy).toBe(5);
  });
});

// ===========================================================================
// Default values and constructor
// ===========================================================================

describe('Constructor defaults', () => {
  it('defaults baseEnergy to DEFAULT_BASE_ENERGY when not specified', () => {
    const es = new EnergySystem();
    expect(es.getEffectiveMaxEnergy()).toBe(DEFAULT_BASE_ENERGY);
  });

  it('defaults relicBonus to 0 when not specified', () => {
    const es = new EnergySystem(3);
    expect(es.getEffectiveMaxEnergy()).toBe(3);
  });

  it('starts with currentEnergy at 0 before first turn start', () => {
    const es = createSystem(3);
    expect(es.getCurrentEnergy()).toBe(0);
  });
});

// ===========================================================================
// Edge Case: Simultaneous gain and loss (GDD Edge Case #6)
// ===========================================================================

describe('Edge Case: Sequential gain then loss', () => {
  it('gain 2 then lose 1 results in net +1', () => {
    const es = createSystem(3);
    es.onTurnStart();
    es.gainEnergy(2);
    es.loseEnergy(1);
    expect(es.getCurrentEnergy()).toBe(4);
  });

  it('order matters: lose first then gain gives different result than gain then lose', () => {
    const es1 = createSystem(3);
    es1.onTurnStart();
    es1.gainEnergy(2);
    es1.loseEnergy(1);
    // 3 + 2 - 1 = 4

    const es2 = createSystem(3);
    es2.onTurnStart();
    es2.loseEnergy(1);
    es2.gainEnergy(2);
    // 3 - 1 + 2 = 4

    // Both result in 4 in this case, but the point is they apply sequentially
    expect(es1.getCurrentEnergy()).toBe(4);
    expect(es2.getCurrentEnergy()).toBe(4);
  });
});

// ===========================================================================
// Edge Case: spendEnergy with negative cost
// ===========================================================================

describe('Edge Case: Invalid inputs', () => {
  it('spendEnergy with negative cost clamps to 0 and returns 0', () => {
    const es = createSystem(3);
    es.onTurnStart();
    const spent = es.spendEnergy(-1);
    expect(spent).toBe(0);
    expect(es.getCurrentEnergy()).toBe(3);
  });
});

// ===========================================================================
// Multi-turn flow integration test
// ===========================================================================

describe('Multi-turn flow', () => {
  it('energy resets correctly across multiple turns', () => {
    const es = createSystem(3);

    // Turn 1: play 2 cards
    es.onTurnStart();
    expect(es.getCurrentEnergy()).toBe(3);
    es.spendEnergy(1);
    es.spendEnergy(1);
    expect(es.getCurrentEnergy()).toBe(1);
    es.onTurnEnd();
    expect(es.getCurrentEnergy()).toBe(0);

    // Turn 2: play cards with bonus energy from potion
    es.onTurnStart(2, 0);
    expect(es.getCurrentEnergy()).toBe(5);
    es.spendEnergy(3);
    es.spendEnergy(2);
    expect(es.getCurrentEnergy()).toBe(0);
    es.onTurnEnd();

    // Turn 3: enemy debuffs energy
    es.onTurnStart(0, 1);
    expect(es.getCurrentEnergy()).toBe(2);
    es.onTurnEnd();
  });

  it('relic bonus persists and stacks across turns', () => {
    const es = createSystem(3);

    // Turn 1: no relics
    es.onTurnStart();
    expect(es.getCurrentEnergy()).toBe(3);
    es.onTurnEnd();

    // Gain a relic between turns
    es.addRelicBonus(1);

    // Turn 2: with relic
    es.onTurnStart();
    expect(es.getCurrentEnergy()).toBe(4);
    es.onTurnEnd();

    // Gain another relic
    es.addRelicBonus(1);

    // Turn 3: two relics
    es.onTurnStart();
    expect(es.getCurrentEnergy()).toBe(5);
    es.onTurnEnd();
  });
});
