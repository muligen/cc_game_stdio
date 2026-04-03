/**
 * reward-controller.test.ts — Unit tests for RewardController.
 *
 * Verifies business logic for the post-combat reward screen.
 * Pure state management tests — no Phaser dependencies.
 *
 * Coverage areas:
 * 1. Initial state has 3 cards + gold
 * 2. selectCard returns the card and marks complete
 * 3. selectCard after already selected returns null
 * 4. selectCard with invalid index returns null
 * 5. skip marks as complete with no card
 * 6. isComplete false initially, true after selection
 * 7. isComplete true after skip
 * 8. getResult returns added card + gold after selection
 * 9. getResult returns null card + gold after skip
 */

// @vitest-environment node

import { describe, it, expect } from 'vitest';
import { RewardController } from '../../../src/scenes/reward/reward-controller';
import { CardType, Rarity, CostType, TargetType } from '../../../src/types/card';
import type { CardData } from '../../../src/types/card';

// ---------------------------------------------------------------------------
// Test Helpers
// ---------------------------------------------------------------------------

/** Create a CardData for testing. */
function makeCard(overrides: Partial<CardData> = {}): CardData {
  return {
    id: `card_${Math.random().toString(36).slice(2, 8)}`,
    name: 'Strike',
    type: CardType.ATTACK,
    rarity: Rarity.COMMON,
    cost: 1,
    costType: CostType.NORMAL,
    character: null,
    targets: TargetType.ENEMY,
    effects: [],
    keywords: [],
    upgrade: {},
    description: 'Deal 6 damage.',
    ...overrides,
  };
}

/** Create an array of N cards with distinct IDs. */
function makeCards(count: number, overrides: Partial<CardData> = {}): CardData[] {
  return Array.from({ length: count }, (_, i) =>
    makeCard({ id: `card_${i}`, name: `Card ${i}`, ...overrides })
  );
}

/** Create a RewardController with default test data: 3 cards, 50 gold, no potion. */
function createController(
  cardCount: number = 3,
  goldReward: number = 50,
  potionDropped: boolean = false
): RewardController {
  return new RewardController(makeCards(cardCount), goldReward, potionDropped);
}

// ===========================================================================
// 1. Initial state has 3 cards + gold
// ===========================================================================

describe('RewardController — initial state', () => {
  it('has 3 card rewards in initial state', () => {
    const controller = createController(3);
    const state = controller.getState();

    expect(state.cardRewards).toHaveLength(3);
  });

  it('has gold reward in initial state', () => {
    const controller = createController(3, 42);
    const state = controller.getState();

    expect(state.goldReward).toBe(42);
  });

  it('has no selected card initially', () => {
    const controller = createController();
    const state = controller.getState();

    expect(state.selectedCardIndex).toBeNull();
  });

  it('is not skipped initially', () => {
    const controller = createController();
    const state = controller.getState();

    expect(state.skipped).toBe(false);
  });

  it('tracks potion dropped flag', () => {
    const controller = createController(3, 50, true);
    const state = controller.getState();

    expect(state.potionDropped).toBe(true);
  });
});

// ===========================================================================
// 2. selectCard returns the card and marks complete
// ===========================================================================

describe('RewardController — selectCard success', () => {
  it('returns the selected card', () => {
    const controller = createController();
    const selected = controller.selectCard(1);

    expect(selected).not.toBeNull();
    expect(selected!.id).toBe('card_1');
    expect(selected!.name).toBe('Card 1');
  });

  it('updates state with selected card index', () => {
    const controller = createController();
    controller.selectCard(0);

    expect(controller.getState().selectedCardIndex).toBe(0);
  });

  it('can select any valid index', () => {
    const controller = createController();

    expect(controller.selectCard(0)!.id).toBe('card_0');
    expect(controller.selectCard(1)).toBeNull(); // already complete
  });

  it('returns first card when index 0 selected', () => {
    const controller = createController();
    const selected = controller.selectCard(0);

    expect(selected).toBe(controller.getState().cardRewards[0]);
  });

  it('returns last card when last index selected', () => {
    const controller = createController();
    const selected = controller.selectCard(2);

    expect(selected).toBe(controller.getState().cardRewards[2]);
  });
});

// ===========================================================================
// 3. selectCard after already selected returns null
// ===========================================================================

describe('RewardController — selectCard after completion', () => {
  it('returns null when called after a card is already selected', () => {
    const controller = createController();
    controller.selectCard(0);

    const secondAttempt = controller.selectCard(1);
    expect(secondAttempt).toBeNull();
  });

  it('returns null when called after skip', () => {
    const controller = createController();
    controller.skip();

    const attempt = controller.selectCard(0);
    expect(attempt).toBeNull();
  });

  it('preserves original selection when called again', () => {
    const controller = createController();
    controller.selectCard(0);
    controller.selectCard(2); // should not change

    expect(controller.getState().selectedCardIndex).toBe(0);
  });
});

// ===========================================================================
// 4. selectCard with invalid index returns null
// ===========================================================================

describe('RewardController — selectCard invalid index', () => {
  it('returns null for negative index', () => {
    const controller = createController();
    const result = controller.selectCard(-1);

    expect(result).toBeNull();
    expect(controller.isComplete()).toBe(false);
  });

  it('returns null for index beyond array bounds', () => {
    const controller = createController();
    const result = controller.selectCard(3);

    expect(result).toBeNull();
    expect(controller.isComplete()).toBe(false);
  });

  it('returns null for index equal to array length', () => {
    const controller = createController();
    const result = controller.selectCard(3);

    expect(result).toBeNull();
  });

  it('returns null for very large index', () => {
    const controller = createController();
    const result = controller.selectCard(999);

    expect(result).toBeNull();
  });

  it('does not mark as complete on invalid index', () => {
    const controller = createController();
    controller.selectCard(-1);

    expect(controller.isComplete()).toBe(false);
    expect(controller.getState().selectedCardIndex).toBeNull();
  });
});

// ===========================================================================
// 5. skip marks as complete with no card
// ===========================================================================

describe('RewardController — skip', () => {
  it('marks state as skipped', () => {
    const controller = createController();
    controller.skip();

    expect(controller.getState().skipped).toBe(true);
  });

  it('does not change selectedCardIndex', () => {
    const controller = createController();
    controller.skip();

    expect(controller.getState().selectedCardIndex).toBeNull();
  });

  it('skip after skip is idempotent', () => {
    const controller = createController();
    controller.skip();
    controller.skip(); // should not crash or change state

    expect(controller.getState().skipped).toBe(true);
    expect(controller.isComplete()).toBe(true);
  });
});

// ===========================================================================
// 6. isComplete false initially, true after selection
// ===========================================================================

describe('RewardController — isComplete after selection', () => {
  it('is false initially', () => {
    const controller = createController();
    expect(controller.isComplete()).toBe(false);
  });

  it('is true after selecting a card', () => {
    const controller = createController();
    controller.selectCard(0);

    expect(controller.isComplete()).toBe(true);
  });
});

// ===========================================================================
// 7. isComplete true after skip
// ===========================================================================

describe('RewardController — isComplete after skip', () => {
  it('is true after skipping', () => {
    const controller = createController();
    controller.skip();

    expect(controller.isComplete()).toBe(true);
  });
});

// ===========================================================================
// 8. getResult returns added card + gold after selection
// ===========================================================================

describe('RewardController — getResult after selection', () => {
  it('returns the selected card', () => {
    const controller = createController(3, 42);
    controller.selectCard(1);

    const result = controller.getResult();
    expect(result.addedCard).not.toBeNull();
    expect(result.addedCard!.id).toBe('card_1');
  });

  it('returns gold gained', () => {
    const controller = createController(3, 42);
    controller.selectCard(0);

    const result = controller.getResult();
    expect(result.goldGained).toBe(42);
  });

  it('returns null addedCard before selection', () => {
    const controller = createController();
    const result = controller.getResult();

    expect(result.addedCard).toBeNull();
    expect(result.goldGained).toBe(50);
  });
});

// ===========================================================================
// 9. getResult returns null card + gold after skip
// ===========================================================================

describe('RewardController — getResult after skip', () => {
  it('returns null card after skip', () => {
    const controller = createController(3, 55);
    controller.skip();

    const result = controller.getResult();
    expect(result.addedCard).toBeNull();
  });

  it('returns gold gained after skip', () => {
    const controller = createController(3, 55);
    controller.skip();

    const result = controller.getResult();
    expect(result.goldGained).toBe(55);
  });
});

// ===========================================================================
// 10. Edge cases
// ===========================================================================

describe('RewardController — edge cases', () => {
  it('handles empty card rewards array', () => {
    const controller = new RewardController([], 30, false);

    expect(controller.getState().cardRewards).toEqual([]);
    expect(controller.isComplete()).toBe(false);

    // Can't select anything from empty array
    expect(controller.selectCard(0)).toBeNull();

    // Can still skip
    controller.skip();
    expect(controller.isComplete()).toBe(true);
    expect(controller.getResult().addedCard).toBeNull();
    expect(controller.getResult().goldGained).toBe(30);
  });

  it('handles single card reward', () => {
    const controller = new RewardController(makeCards(1), 20, false);

    expect(controller.getState().cardRewards).toHaveLength(1);
    const selected = controller.selectCard(0);
    expect(selected!.id).toBe('card_0');
    expect(controller.isComplete()).toBe(true);
  });

  it('state is read-only via getState', () => {
    const controller = createController();
    const state = controller.getState();

    // TypeScript enforces Readonly, but verify the reference stays stable
    expect(state.goldReward).toBe(50);
    expect(state.cardRewards).toHaveLength(3);
  });

  it('defensive copy of cardRewards in constructor', () => {
    const cards = makeCards(3);
    const controller = new RewardController(cards, 50, false);

    // Mutating original array should not affect controller
    cards.push(makeCard({ id: 'extra' }));
    expect(controller.getState().cardRewards).toHaveLength(3);
  });
});
