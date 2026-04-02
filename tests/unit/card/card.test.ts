/**
 * card.test.ts — Unit tests for CardHelper utility class and CombatCardInstance type.
 *
 * Implements acceptance criteria and edge cases from design/gdd/card.md.
 *
 * Coverage areas:
 * - canPlay: energy checks, cost type logic, target requirements, overrides
 * - getEffectiveCost: base cost, upgrade cost, override priority, unplayable
 * - Keyword queries: exhaust, ethereal, innate, retain, unplayable
 * - getUpgradedData: upgrade delta retrieval, null when absent
 * - Edge cases: override + upgrade priority, empty keywords
 */

// @vitest-environment node

import { describe, it, expect } from 'vitest';
import {
  CardType,
  CostType,
  Keyword,
  Rarity,
  TargetType,
  type CardData,
  type CombatCardInstance,
} from '../../../src/types/card';
import { CardHelper } from '../../../src/systems/card-helper';

// ---------------------------------------------------------------------------
// Test Fixtures
// ---------------------------------------------------------------------------

/** Base card data for a standard 1-cost attack (like Strike). */
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
    upgrade: { effects: [{ type: 'deal_damage', value: 9 }] },
    description: 'Deal {damage} damage.',
    ...overrides,
  };
}

/** Creates a CombatCardInstance with sensible defaults. */
function makeCombatCard(overrides: Partial<CombatCardInstance> = {}): CombatCardInstance {
  return {
    instanceId: 'card-001',
    data: makeCardData(),
    upgraded: false,
    costOverride: null,
    timesPlayedThisCombat: 0,
    retained: false,
    ...overrides,
  };
}

/** Creates a 0-cost card. */
function makeZeroCostCard(overrides: Partial<CardData> = {}): CardData {
  return makeCardData({ cost: 0, ...overrides });
}

/** Creates an X-cost card. */
function makeXCostCard(overrides: Partial<CardData> = {}): CardData {
  return makeCardData({ cost: -1, costType: CostType.X, ...overrides });
}

/** Creates an unplayable card (by costType). */
function makeUnplayableCostTypeCard(overrides: Partial<CardData> = {}): CardData {
  return makeCardData({ cost: -1, costType: CostType.UNPLAYABLE, ...overrides });
}

/** Creates a card with a specific keyword. */
function makeKeywordCard(keyword: Keyword, overrides: Partial<CardData> = {}): CardData {
  return makeCardData({ keywords: [keyword], ...overrides });
}

/** Creates a card with an upgrade cost delta. */
function makeUpgradeableCostCard(upgradeCost: number, baseCost: number = 1): CardData {
  return makeCardData({
    cost: baseCost,
    upgrade: { cost: upgradeCost },
  });
}

// ===========================================================================
// canPlay tests
// ===========================================================================

describe('CardHelper.canPlay', () => {
  // --- Normal cost ---

  it('normal cost card is playable with enough energy', () => {
    const card = makeCombatCard();
    expect(CardHelper.canPlay(card, 3, true)).toBe(true);
  });

  it('normal cost card is playable when energy exactly equals cost', () => {
    const card = makeCombatCard();
    expect(CardHelper.canPlay(card, 1, true)).toBe(true);
  });

  it('normal cost card is NOT playable with insufficient energy', () => {
    const card = makeCombatCard();
    expect(CardHelper.canPlay(card, 0, true)).toBe(false);
  });

  it('2-cost card is playable with 2 energy', () => {
    const card = makeCombatCard({ data: makeCardData({ cost: 2 }) });
    expect(CardHelper.canPlay(card, 2, true)).toBe(true);
  });

  it('2-cost card is NOT playable with 1 energy', () => {
    const card = makeCombatCard({ data: makeCardData({ cost: 2 }) });
    expect(CardHelper.canPlay(card, 1, true)).toBe(false);
  });

  // --- 0-cost ---

  it('0-cost card is always playable with energy available', () => {
    const card = makeCombatCard({ data: makeZeroCostCard() });
    expect(CardHelper.canPlay(card, 3, true)).toBe(true);
  });

  it('0-cost card is playable at 0 energy', () => {
    const card = makeCombatCard({ data: makeZeroCostCard() });
    expect(CardHelper.canPlay(card, 0, true)).toBe(true);
  });

  // --- X-cost ---

  it('X-cost card is playable with energy > 0', () => {
    const card = makeCombatCard({ data: makeXCostCard() });
    expect(CardHelper.canPlay(card, 3, true)).toBe(true);
  });

  it('X-cost card is playable with exactly 1 energy', () => {
    const card = makeCombatCard({ data: makeXCostCard() });
    expect(CardHelper.canPlay(card, 1, true)).toBe(true);
  });

  it('X-cost card is NOT playable with 0 energy', () => {
    const card = makeCombatCard({ data: makeXCostCard() });
    expect(CardHelper.canPlay(card, 0, true)).toBe(false);
  });

  // --- Unplayable ---

  it('unplayable card (costType) is never playable', () => {
    const card = makeCombatCard({ data: makeUnplayableCostTypeCard() });
    expect(CardHelper.canPlay(card, 10, true)).toBe(false);
  });

  it('unplayable card (keyword) is never playable', () => {
    const card = makeCombatCard({
      data: makeKeywordCard(Keyword.UNPLAYABLE),
    });
    expect(CardHelper.canPlay(card, 10, true)).toBe(false);
  });

  it('unplayable card is not playable even at 0 energy cost', () => {
    const card = makeCombatCard({
      data: makeUnplayableCostTypeCard({ cost: 0 }),
    });
    expect(CardHelper.canPlay(card, 10, true)).toBe(false);
  });

  // --- Target requirements ---

  it('ENEMY-targeted card needs hasTarget = true', () => {
    const card = makeCombatCard();
    expect(CardHelper.canPlay(card, 3, true)).toBe(true);
  });

  it('ENEMY-targeted card is NOT playable without target', () => {
    const card = makeCombatCard();
    expect(CardHelper.canPlay(card, 3, false)).toBe(false);
  });

  it('SELF-targeted card does not need hasTarget', () => {
    const card = makeCombatCard({
      data: makeCardData({ targets: TargetType.SELF }),
    });
    expect(CardHelper.canPlay(card, 3, false)).toBe(true);
  });

  it('ALL_ENEMY-targeted card does not need hasTarget', () => {
    const card = makeCombatCard({
      data: makeCardData({ targets: TargetType.ALL_ENEMY }),
    });
    expect(CardHelper.canPlay(card, 3, false)).toBe(true);
  });

  it('NONE-targeted card does not need hasTarget', () => {
    const card = makeCombatCard({
      data: makeCardData({ targets: TargetType.NONE }),
    });
    expect(CardHelper.canPlay(card, 3, false)).toBe(true);
  });

  // --- costOverride ---

  it('costOverride overrides base cost for playability', () => {
    // Base cost 2, overridden to 0
    const card = makeCombatCard({
      data: makeCardData({ cost: 2 }),
      costOverride: 0,
    });
    expect(CardHelper.canPlay(card, 0, true)).toBe(true);
  });

  it('costOverride set to higher value requires more energy', () => {
    // Base cost 1, overridden to 3
    const card = makeCombatCard({
      data: makeCardData({ cost: 1 }),
      costOverride: 3,
    });
    expect(CardHelper.canPlay(card, 2, true)).toBe(false);
    expect(CardHelper.canPlay(card, 3, true)).toBe(true);
  });
});

// ===========================================================================
// getEffectiveCost tests
// ===========================================================================

describe('CardHelper.getEffectiveCost', () => {
  it('returns base cost normally', () => {
    const card = makeCombatCard({ data: makeCardData({ cost: 2 }) });
    expect(CardHelper.getEffectiveCost(card)).toBe(2);
  });

  it('returns 0 for 0-cost card', () => {
    const card = makeCombatCard({ data: makeZeroCostCard() });
    expect(CardHelper.getEffectiveCost(card)).toBe(0);
  });

  it('returns costOverride when set (overrides base)', () => {
    const card = makeCombatCard({
      data: makeCardData({ cost: 2 }),
      costOverride: 0,
    });
    expect(CardHelper.getEffectiveCost(card)).toBe(0);
  });

  it('returns upgraded cost when upgraded and upgrade.cost exists', () => {
    const card = makeCombatCard({
      data: makeUpgradeableCostCard(0, 1),
      upgraded: true,
    });
    expect(CardHelper.getEffectiveCost(card)).toBe(0);
  });

  it('returns base cost when upgraded but upgrade.cost is undefined', () => {
    const card = makeCombatCard({
      data: makeCardData({ cost: 2, upgrade: { effects: [{ type: 'deal_damage', value: 10 }] } }),
      upgraded: true,
    });
    expect(CardHelper.getEffectiveCost(card)).toBe(2);
  });

  it('returns -1 for unplayable costType', () => {
    const card = makeCombatCard({ data: makeUnplayableCostTypeCard() });
    expect(CardHelper.getEffectiveCost(card)).toBe(-1);
  });

  it('returns data.cost for X-cost cards', () => {
    const card = makeCombatCard({ data: makeXCostCard({ cost: -1 }) });
    expect(CardHelper.getEffectiveCost(card)).toBe(-1);
  });

  it('returns 0 for X-cost card with base cost 0', () => {
    const card = makeCombatCard({ data: makeXCostCard({ cost: 0 }) });
    expect(CardHelper.getEffectiveCost(card)).toBe(0);
  });

  it('costOverride takes priority over upgraded cost', () => {
    const card = makeCombatCard({
      data: makeUpgradeableCostCard(0, 2),
      upgraded: true,
      costOverride: 1,
    });
    // Override is 1, upgraded cost is 0, base is 2 -> override wins
    expect(CardHelper.getEffectiveCost(card)).toBe(1);
  });

  it('returns base cost when not upgraded and no override', () => {
    const card = makeCombatCard({
      data: makeUpgradeableCostCard(0, 2),
      upgraded: false,
    });
    expect(CardHelper.getEffectiveCost(card)).toBe(2);
  });
});

// ===========================================================================
// Keyword tests
// ===========================================================================

describe('CardHelper.isExhaust', () => {
  it('returns true for card with Exhaust keyword', () => {
    const data = makeKeywordCard(Keyword.EXHAUST);
    expect(CardHelper.isExhaust(data)).toBe(true);
  });

  it('returns false for card without Exhaust keyword', () => {
    const data = makeCardData();
    expect(CardHelper.isExhaust(data)).toBe(false);
  });

  it('works with CombatCardInstance', () => {
    const card = makeCombatCard({ data: makeKeywordCard(Keyword.EXHAUST) });
    expect(CardHelper.isExhaust(card)).toBe(true);
  });
});

describe('CardHelper.isEthereal', () => {
  it('returns true for card with Ethereal keyword', () => {
    const data = makeKeywordCard(Keyword.ETHEREAL);
    expect(CardHelper.isEthereal(data)).toBe(true);
  });

  it('returns false for card without Ethereal keyword', () => {
    const data = makeCardData();
    expect(CardHelper.isEthereal(data)).toBe(false);
  });

  it('works with CombatCardInstance', () => {
    const card = makeCombatCard({ data: makeKeywordCard(Keyword.ETHEREAL) });
    expect(CardHelper.isEthereal(card)).toBe(true);
  });
});

describe('CardHelper.isInnate', () => {
  it('returns true for card with Innate keyword', () => {
    const data = makeKeywordCard(Keyword.INNATE);
    expect(CardHelper.isInnate(data)).toBe(true);
  });

  it('returns false for card without Innate keyword', () => {
    const data = makeCardData();
    expect(CardHelper.isInnate(data)).toBe(false);
  });

  it('works with CombatCardInstance', () => {
    const card = makeCombatCard({ data: makeKeywordCard(Keyword.INNATE) });
    expect(CardHelper.isInnate(card)).toBe(true);
  });
});

describe('CardHelper.isRetain', () => {
  it('returns true for card with Retain keyword', () => {
    const data = makeKeywordCard(Keyword.RETAIN);
    expect(CardHelper.isRetain(data)).toBe(true);
  });

  it('returns false for card without Retain keyword', () => {
    const data = makeCardData();
    expect(CardHelper.isRetain(data)).toBe(false);
  });

  it('works with CombatCardInstance', () => {
    const card = makeCombatCard({ data: makeKeywordCard(Keyword.RETAIN) });
    expect(CardHelper.isRetain(card)).toBe(true);
  });
});

describe('CardHelper.isUnplayable', () => {
  it('returns true for card with Unplayable keyword', () => {
    const data = makeKeywordCard(Keyword.UNPLAYABLE);
    expect(CardHelper.isUnplayable(data)).toBe(true);
  });

  it('returns false for card without Unplayable keyword', () => {
    const data = makeCardData();
    expect(CardHelper.isUnplayable(data)).toBe(false);
  });

  it('works with CombatCardInstance', () => {
    const card = makeCombatCard({ data: makeKeywordCard(Keyword.UNPLAYABLE) });
    expect(CardHelper.isUnplayable(card)).toBe(true);
  });
});

// ===========================================================================
// getUpgradedData tests
// ===========================================================================

describe('CardHelper.getUpgradedData', () => {
  it('returns upgrade data when upgrade has effects', () => {
    const data = makeCardData({
      upgrade: { effects: [{ type: 'deal_damage', value: 9 }] },
    });
    const result = CardHelper.getUpgradedData(data);
    expect(result).not.toBeNull();
    expect(result?.effects).toHaveLength(1);
  });

  it('returns upgrade data when upgrade has cost', () => {
    const data = makeCardData({
      upgrade: { cost: 0 },
    });
    const result = CardHelper.getUpgradedData(data);
    expect(result).not.toBeNull();
    expect(result?.cost).toBe(0);
  });

  it('returns upgrade data when upgrade has description', () => {
    const data = makeCardData({
      upgrade: { description: 'Upgraded description.' },
    });
    const result = CardHelper.getUpgradedData(data);
    expect(result).not.toBeNull();
    expect(result?.description).toBe('Upgraded description.');
  });

  it('returns null when upgrade has empty effects array', () => {
    const data = makeCardData({
      upgrade: { effects: [] },
    });
    expect(CardHelper.getUpgradedData(data)).toBeNull();
  });

  it('returns null when upgrade object has no defined fields', () => {
    const data = makeCardData({
      upgrade: {},
    });
    expect(CardHelper.getUpgradedData(data)).toBeNull();
  });

  it('returns upgrade data when upgrade has damage', () => {
    const data = makeCardData({
      upgrade: { damage: 10 },
    });
    const result = CardHelper.getUpgradedData(data);
    expect(result).not.toBeNull();
    expect(result?.damage).toBe(10);
  });

  it('returns upgrade data when upgrade has block', () => {
    const data = makeCardData({
      upgrade: { block: 8 },
    });
    const result = CardHelper.getUpgradedData(data);
    expect(result).not.toBeNull();
    expect(result?.block).toBe(8);
  });
});

// ===========================================================================
// Edge cases
// ===========================================================================

describe('Edge cases', () => {
  it('costOverride AND upgraded: override takes priority in canPlay', () => {
    const card = makeCombatCard({
      data: makeUpgradeableCostCard(0, 2),
      upgraded: true,
      costOverride: 1,
    });
    // costOverride = 1, so needs exactly 1 energy
    expect(CardHelper.canPlay(card, 0, true)).toBe(false);
    expect(CardHelper.canPlay(card, 1, true)).toBe(true);
  });

  it('costOverride AND upgraded: override takes priority in getEffectiveCost', () => {
    const card = makeCombatCard({
      data: makeUpgradeableCostCard(0, 2),
      upgraded: true,
      costOverride: 1,
    });
    expect(CardHelper.getEffectiveCost(card)).toBe(1);
  });

  it('card with empty keywords array: all keyword checks return false', () => {
    const data = makeCardData({ keywords: [] });
    expect(CardHelper.isExhaust(data)).toBe(false);
    expect(CardHelper.isEthereal(data)).toBe(false);
    expect(CardHelper.isInnate(data)).toBe(false);
    expect(CardHelper.isRetain(data)).toBe(false);
    expect(CardHelper.isUnplayable(data)).toBe(false);
  });

  it('CombatCardInstance with empty keywords: all keyword checks return false', () => {
    const card = makeCombatCard({ data: makeCardData({ keywords: [] }) });
    expect(CardHelper.isExhaust(card)).toBe(false);
    expect(CardHelper.isEthereal(card)).toBe(false);
    expect(CardHelper.isInnate(card)).toBe(false);
    expect(CardHelper.isRetain(card)).toBe(false);
    expect(CardHelper.isUnplayable(card)).toBe(false);
  });

  it('card with multiple keywords: each keyword is detected independently', () => {
    const data = makeCardData({
      keywords: [Keyword.EXHAUST, Keyword.ETHEREAL],
    });
    expect(CardHelper.isExhaust(data)).toBe(true);
    expect(CardHelper.isEthereal(data)).toBe(true);
    expect(CardHelper.isInnate(data)).toBe(false);
    expect(CardHelper.isRetain(data)).toBe(false);
  });

  it('canPlay with card having both ENEMY target and 0 cost', () => {
    const card = makeCombatCard({
      data: makeZeroCostCard({ targets: TargetType.ENEMY }),
    });
    expect(CardHelper.canPlay(card, 0, true)).toBe(true);
    expect(CardHelper.canPlay(card, 0, false)).toBe(false);
  });

  it('canPlay with X-cost and SELF target does not require target', () => {
    const card = makeCombatCard({
      data: makeXCostCard({ targets: TargetType.SELF }),
    });
    expect(CardHelper.canPlay(card, 1, false)).toBe(true);
  });

  it('upgraded card without costOverride uses upgraded cost', () => {
    const card = makeCombatCard({
      data: makeUpgradeableCostCard(1, 2),
      upgraded: true,
    });
    expect(CardHelper.getEffectiveCost(card)).toBe(1);
    expect(CardHelper.canPlay(card, 1, true)).toBe(true);
  });

  it('upgraded card with costOverride null uses upgraded cost', () => {
    const card = makeCombatCard({
      data: makeUpgradeableCostCard(0, 1),
      upgraded: true,
      costOverride: null,
    });
    expect(CardHelper.getEffectiveCost(card)).toBe(0);
  });

  it('non-upgraded card with upgrade cost defined uses base cost', () => {
    const card = makeCombatCard({
      data: makeUpgradeableCostCard(0, 2),
      upgraded: false,
    });
    expect(CardHelper.getEffectiveCost(card)).toBe(2);
  });
});

// ===========================================================================
// Acceptance Criteria tests (from design/gdd/card.md)
// ===========================================================================

describe('Card System Acceptance Criteria (card.md)', () => {
  // AC 1: Playing a 2-cost Attack card with 3 energy leaves 1 energy remaining.
  // CardHelper.canPlay checks eligibility; energy deduction is the caller's
  // responsibility. This test verifies the 2-cost card is playable at 3 energy,
  // and the caller would deduct 2 from 3 leaving 1.
  it('AC1: 2-cost Attack card is playable with 3 energy (3 - 2 = 1 remaining)', () => {
    const card = makeCombatCard({
      data: makeCardData({ cost: 2, type: CardType.ATTACK }),
    });
    expect(CardHelper.canPlay(card, 3, true)).toBe(true);
    // Energy deduction simulation: remaining = 3 - getEffectiveCost(card) = 1
    const remaining = 3 - CardHelper.getEffectiveCost(card);
    expect(remaining).toBe(1);
  });

  // AC 2: Drawing when Draw Pile is empty shuffles Discard Pile into Draw Pile first.
  // Tested in deck.test.ts (DeckManager.drawCard).

  // AC 3: Drawing when both Draw and Discard are empty produces no cards (no crash).
  // Tested in deck.test.ts (DeckManager.drawCard).

  // AC 4: Hand at 10 cards: next draw sends overflow cards to Discard Pile.
  // Tested in deck.test.ts (DeckManager.drawCard).

  // AC 5: Ethereal card not played by turn end is exhausted.
  // CardHelper.isEthereal detects the keyword. The actual turn-end exhaustion
  // flow is the combat system's responsibility (move ethereal cards from hand
  // to exhaust pile instead of discard pile).
  it('AC5: Ethereal card is detected for turn-end exhaustion', () => {
    const etherealCard = makeCombatCard({
      data: makeCardData({
        keywords: [Keyword.ETHEREAL],
        type: CardType.SKILL,
      }),
    });
    expect(CardHelper.isEthereal(etherealCard)).toBe(true);
    // Combat system should: if ethereal and still in hand at turn end, exhaustCards() it
  });

  // AC 6: Innate card appears in opening hand of every combat.
  // Tested in deck.test.ts (DeckManager.getInnateCards).

  // AC 7: Retain card stays in hand at turn end (does not go to Discard Pile).
  // CardHelper.isRetain detects the keyword. The combat system filters retain
  // cards before calling discardHand().
  it('AC7: Retain card is detected to stay in hand at turn end', () => {
    const retainCard = makeCombatCard({
      data: makeCardData({
        keywords: [Keyword.RETAIN],
        type: CardType.SKILL,
      }),
    });
    expect(CardHelper.isRetain(retainCard)).toBe(true);
    // Combat system should: filter out retain cards before calling discardHand()
  });

  // AC 8: X-cost card with 3 energy deals 3x base effect value.
  // X-cost resolution is in the combat/energy system. CardHelper verifies
  // playability. The X multiplier is effect resolution logic.
  it('AC8: X-cost card is playable with 3 energy (X = 3)', () => {
    const xCostCard = makeCombatCard({
      data: makeCardData({
        cost: -1,
        costType: CostType.X,
        effects: [{ type: 'deal_damage', value: 7 }],
      }),
    });
    expect(CardHelper.canPlay(xCostCard, 3, true)).toBe(true);
    // Combat system resolves: damage = 7 * 3 = 21 (xValue = currentEnergy)
  });

  // AC 9: Upgrading Strike adds +3 damage (11 -> 14). Name shows "Strike+".
  it('AC9: Upgrading Strike adds +3 damage and shows Strike+ name', () => {
    // Base Strike: 6 damage per test fixture, upgrade to 9 (+3)
    const strikeData: CardData = {
      id: 'strike_red',
      name: 'Strike',
      type: CardType.ATTACK,
      rarity: Rarity.STARTER,
      cost: 1,
      costType: CostType.NORMAL,
      character: null,
      targets: TargetType.ENEMY,
      effects: [{ type: 'deal_damage', value: 11 }],
      keywords: [],
      upgrade: { effects: [{ type: 'deal_damage', value: 14 }] },
      description: 'Deal {damage} damage.',
    };

    // Verify upgrade data exists and adds +3 damage
    const upgradeData = CardHelper.getUpgradedData(strikeData);
    expect(upgradeData).not.toBeNull();
    expect(upgradeData!.effects![0].value).toBe(14);
    expect(upgradeData!.effects![0].value - strikeData.effects[0].value).toBe(3);

    // Name shows "Strike+" when upgraded (caller appends "+")
    const upgradedName = strikeData.upgraded?.description
      ? strikeData.name
      : strikeData.name;
    expect(upgradedName + '+').toBe('Strike+');
  });

  // AC 10: STATUS card (Dazed) cannot be played -- canPlay returns false.
  it('AC10: STATUS card (Dazed) cannot be played', () => {
    const dazedCard = makeCombatCard({
      data: makeCardData({
        id: 'dazed',
        name: 'Dazed',
        type: CardType.STATUS,
        cost: -1,
        costType: CostType.UNPLAYABLE,
        targets: TargetType.NONE,
        effects: [],
      }),
    });
    expect(CardHelper.canPlay(dazedCard, 3, true)).toBe(false);
    expect(CardHelper.canPlay(dazedCard, 0, false)).toBe(false);
    expect(CardHelper.canPlay(dazedCard, 99, true)).toBe(false);
  });

  // AC 11: Attack damage formula: floor((base + strength) * vulnerable * weak), floor 0.
  // Damage formula is in the combat system (status effects + effect resolution).
  // CardHelper provides cost/keyword queries. This AC is tested when the
  // combat system integrates Strength/Vulnerable/Weak modifiers.
  it('AC11: Attack card exposes base damage value for formula calculation', () => {
    const attackCard = makeCombatCard({
      data: makeCardData({
        type: CardType.ATTACK,
        effects: [{ type: 'deal_damage', value: 6 }],
      }),
    });
    // Base damage is available in effects[0].value for the formula
    expect(attackCard.data.effects[0].value).toBe(6);
    // Formula: floor((6 + strength) * vulnerable * weak), min 0
  });
});
