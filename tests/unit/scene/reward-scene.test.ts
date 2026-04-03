/**
 * reward-scene.test.ts -- Integration tests for RewardScene.
 *
 * Tests the wiring between RewardController and RewardUILayoutCalculator
 * as it would be driven by the scene. No Phaser dependencies -- tests
 * exercise the controller and layout calculator directly, simulating
 * what the scene would do on user interaction.
 *
 * Coverage areas:
 * 1. Controller tracks card selection correctly
 * 2. Layout calculator produces valid layout for 3 cards
 * 3. Card hover tracking (simulated via layout recalculation)
 * 4. Card selection via RewardController.selectCard
 * 5. Skip via RewardController.skip
 * 6. Complete state prevents further selection
 * 7. Result contains correct data after selection
 * 8. Layout with different card counts (1, 2, 3)
 * 9. Cannot select when already complete (selectCard returns null)
 * 10. Gold amount from controller result
 */

// @vitest-environment node

import { describe, it, expect } from 'vitest';
import { RewardController } from '../../../src/scenes/reward/reward-controller';
import {
  RewardUILayoutCalculator,
  type RewardUIConfig,
  type RewardUILayout,
  type RewardCardLayout,
} from '../../../src/scenes/reward/reward-ui-layout';
import { CardType, Rarity, CostType, TargetType } from '../../../src/types/card';
import type { CardData } from '../../../src/types/card';

// ---------------------------------------------------------------------------
// Test Helpers
// ---------------------------------------------------------------------------

/** Default config matching a typical 1920x1080 screen. */
const DEFAULT_CONFIG: RewardUIConfig = {
  screenWidth: 1920,
  screenHeight: 1080,
  cardWidth: 140,
  cardHeight: 200,
  cardGap: 30,
  cardTopMargin: 250,
  goldY: 150,
  skipButtonWidth: 200,
  skipButtonHeight: 50,
  hoverLift: 20,
  titleText: 'Choose a Card',
  titleY: 60,
  skipBottomMargin: 40,
};

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

/** Create an array of N cards with distinct IDs and names. */
function makeCards(count: number, overrides: Partial<CardData> = {}): CardData[] {
  return Array.from({ length: count }, (_, i) =>
    makeCard({ id: `card_${i}`, name: `Card ${i}`, ...overrides })
  );
}

/** Create a RewardController with default test data. */
function createController(
  cardCount: number = 3,
  goldReward: number = 50,
  potionDropped: boolean = false,
): RewardController {
  return new RewardController(makeCards(cardCount), goldReward, potionDropped);
}

/** Create a layout calculator with default config. */
function createCalculator(config: Partial<RewardUIConfig> = {}): RewardUILayoutCalculator {
  return new RewardUILayoutCalculator({ ...DEFAULT_CONFIG, ...config });
}

/**
 * Simulate the full scene interaction flow: create controller + calculator,
 * then exercise hover/click/skip as the scene would.
 */
function simulateSceneFlow(
  cards: CardData[],
  gold: number,
  potion: boolean,
  config: Partial<RewardUIConfig> = {},
): {
  controller: RewardController;
  calculator: RewardUILayoutCalculator;
  hoveredIndex: number | null;
  layouts: RewardUILayout[];
} {
  const controller = new RewardController(cards, gold, potion);
  const calculator = createCalculator(config);
  let hoveredIndex: number | null = null;
  const layouts: RewardUILayout[] = [];

  // Initial layout
  layouts.push(calculator.calculate(cards, gold, hoveredIndex));

  return { controller, calculator, hoveredIndex, layouts };
}

// ===========================================================================
// 1. Controller tracks card selection correctly
// ===========================================================================

describe('RewardScene integration -- controller tracks selection', () => {
  it('controller tracks selected card index after selectCard', () => {
    const controller = createController();
    controller.selectCard(1);

    expect(controller.getState().selectedCardIndex).toBe(1);
    expect(controller.isComplete()).toBe(true);
  });

  it('controller returns the correct CardData on selection', () => {
    const cards = makeCards(3);
    const controller = new RewardController(cards, 50, false);

    const selected = controller.selectCard(2);
    expect(selected).toBe(cards[2]);
  });

  it('controller preserves gold reward across selection', () => {
    const controller = createController(3, 75, false);
    controller.selectCard(0);

    expect(controller.getResult().goldGained).toBe(75);
  });
});

// ===========================================================================
// 2. Layout calculator produces valid layout for 3 cards
// ===========================================================================

describe('RewardScene integration -- layout for 3 cards', () => {
  it('produces 3 card layouts with correct dimensions', () => {
    const cards = makeCards(3);
    const calculator = createCalculator();
    const layout = calculator.calculate(cards, 50, null);

    expect(layout.cards).toHaveLength(3);
    for (const card of layout.cards) {
      expect(card.width).toBe(140);
      expect(card.height).toBe(200);
    }
  });

  it('positions 3 cards symmetrically around screen center', () => {
    const cards = makeCards(3);
    const calculator = createCalculator();
    const layout = calculator.calculate(cards, 50, null);

    const center = DEFAULT_CONFIG.screenWidth / 2;
    const leftEdge = layout.cards[0].x - layout.cards[0].width / 2;
    const rightEdge = layout.cards[2].x + layout.cards[2].width / 2;
    const leftDist = center - leftEdge;
    const rightDist = rightEdge - center;

    expect(leftDist).toBeCloseTo(rightDist, 2);
  });

  it('includes gold, skip button, and title in layout', () => {
    const cards = makeCards(3);
    const calculator = createCalculator();
    const layout = calculator.calculate(cards, 50, null);

    expect(layout.gold.amount).toBe(50);
    expect(layout.skipButton.label).toBe('Skip');
    expect(layout.title.text).toBe('Choose a Card');
  });
});

// ===========================================================================
// 3. Card hover tracking (simulated)
// ===========================================================================

describe('RewardScene integration -- hover tracking', () => {
  it('hovered card lifts by hoverLift pixels in layout', () => {
    const cards = makeCards(3);
    const calculator = createCalculator();
    const layout = calculator.calculate(cards, 50, 1);

    const baseY = DEFAULT_CONFIG.cardTopMargin! + DEFAULT_CONFIG.cardHeight! / 2;
    expect(layout.cards[1].isHovered).toBe(true);
    expect(layout.cards[1].y).toBeCloseTo(baseY - DEFAULT_CONFIG.hoverLift!, 2);
  });

  it('non-hovered cards stay at base position', () => {
    const cards = makeCards(3);
    const calculator = createCalculator();
    const layout = calculator.calculate(cards, 50, 0);

    const baseY = DEFAULT_CONFIG.cardTopMargin! + DEFAULT_CONFIG.cardHeight! / 2;
    expect(layout.cards[0].isHovered).toBe(true);
    expect(layout.cards[1].isHovered).toBe(false);
    expect(layout.cards[2].isHovered).toBe(false);
    expect(layout.cards[1].y).toBeCloseTo(baseY, 2);
    expect(layout.cards[2].y).toBeCloseTo(baseY, 2);
  });

  it('null hoveredIndex produces no hover lift', () => {
    const cards = makeCards(3);
    const calculator = createCalculator();
    const layout = calculator.calculate(cards, 50, null);

    const baseY = DEFAULT_CONFIG.cardTopMargin! + DEFAULT_CONFIG.cardHeight! / 2;
    for (const card of layout.cards) {
      expect(card.isHovered).toBe(false);
      expect(card.y).toBeCloseTo(baseY, 2);
    }
  });

  it('hover index transitions from card 0 to card 2 to null', () => {
    const cards = makeCards(3);
    const calculator = createCalculator();

    // Hover card 0
    const layout0 = calculator.calculate(cards, 50, 0);
    expect(layout0.cards[0].isHovered).toBe(true);
    expect(layout0.cards[2].isHovered).toBe(false);

    // Hover card 2
    const layout2 = calculator.calculate(cards, 50, 2);
    expect(layout2.cards[0].isHovered).toBe(false);
    expect(layout2.cards[2].isHovered).toBe(true);

    // Hover none
    const layoutNone = calculator.calculate(cards, 50, null);
    expect(layoutNone.cards[0].isHovered).toBe(false);
    expect(layoutNone.cards[2].isHovered).toBe(false);
  });
});

// ===========================================================================
// 4. Card selection via RewardController.selectCard
// ===========================================================================

describe('RewardScene integration -- card selection flow', () => {
  it('selects first card and completes', () => {
    const controller = createController();
    const selected = controller.selectCard(0);

    expect(selected).not.toBeNull();
    expect(selected!.id).toBe('card_0');
    expect(controller.isComplete()).toBe(true);
  });

  it('selects middle card and completes', () => {
    const controller = createController();
    const selected = controller.selectCard(1);

    expect(selected!.id).toBe('card_1');
    expect(controller.isComplete()).toBe(true);
  });

  it('selects last card and completes', () => {
    const controller = createController();
    const selected = controller.selectCard(2);

    expect(selected!.id).toBe('card_2');
    expect(controller.isComplete()).toBe(true);
  });

  it('result contains selected card and gold', () => {
    const controller = createController(3, 42, false);
    controller.selectCard(1);

    const result = controller.getResult();
    expect(result.addedCard!.id).toBe('card_1');
    expect(result.goldGained).toBe(42);
  });
});

// ===========================================================================
// 5. Skip via RewardController.skip
// ===========================================================================

describe('RewardScene integration -- skip flow', () => {
  it('skip marks controller as complete', () => {
    const controller = createController();
    controller.skip();

    expect(controller.isComplete()).toBe(true);
    expect(controller.getState().skipped).toBe(true);
  });

  it('skip result has null card but correct gold', () => {
    const controller = createController(3, 60, false);
    controller.skip();

    const result = controller.getResult();
    expect(result.addedCard).toBeNull();
    expect(result.goldGained).toBe(60);
  });

  it('skip is idempotent', () => {
    const controller = createController();
    controller.skip();
    controller.skip();

    expect(controller.getState().skipped).toBe(true);
    expect(controller.isComplete()).toBe(true);
  });
});

// ===========================================================================
// 6. Complete state prevents further selection
// ===========================================================================

describe('RewardScene integration -- complete blocks further actions', () => {
  it('cannot select card after already selecting one', () => {
    const controller = createController();
    controller.selectCard(0);

    const secondAttempt = controller.selectCard(1);
    expect(secondAttempt).toBeNull();
    expect(controller.getState().selectedCardIndex).toBe(0);
  });

  it('cannot select card after skip', () => {
    const controller = createController();
    controller.skip();

    const attempt = controller.selectCard(0);
    expect(attempt).toBeNull();
    expect(controller.getState().selectedCardIndex).toBeNull();
  });

  it('cannot skip after selecting a card', () => {
    const controller = createController();
    controller.selectCard(0);
    controller.skip(); // should be no-op

    // State should still reflect the card selection, not skip
    expect(controller.getState().selectedCardIndex).toBe(0);
    expect(controller.getState().skipped).toBe(false);
  });
});

// ===========================================================================
// 7. Result contains correct data
// ===========================================================================

describe('RewardScene integration -- result data integrity', () => {
  it('result after card selection has correct card reference', () => {
    const cards = makeCards(3);
    const controller = new RewardController(cards, 50, false);
    controller.selectCard(1);

    const result = controller.getResult();
    expect(result.addedCard).toBe(cards[1]);
  });

  it('result gold matches constructor gold', () => {
    const controller = createController(3, 99, false);
    controller.selectCard(0);

    expect(controller.getResult().goldGained).toBe(99);
  });

  it('result after skip has null card and correct gold', () => {
    const controller = createController(3, 33, false);
    controller.skip();

    const result = controller.getResult();
    expect(result.addedCard).toBeNull();
    expect(result.goldGained).toBe(33);
  });

  it('getResult before completion returns null card', () => {
    const controller = createController(3, 50, false);
    const result = controller.getResult();

    expect(result.addedCard).toBeNull();
    expect(result.goldGained).toBe(50);
  });
});

// ===========================================================================
// 8. Layout with different card counts (1, 2, 3)
// ===========================================================================

describe('RewardScene integration -- layout for varying card counts', () => {
  it('single card centered at screen center', () => {
    const cards = makeCards(1);
    const calculator = createCalculator();
    const layout = calculator.calculate(cards, 50, null);

    expect(layout.cards).toHaveLength(1);
    expect(layout.cards[0].x).toBe(DEFAULT_CONFIG.screenWidth / 2);
    expect(layout.cards[0].y).toBeCloseTo(
      DEFAULT_CONFIG.cardTopMargin! + DEFAULT_CONFIG.cardHeight! / 2, 2,
    );
  });

  it('two cards spaced with gap', () => {
    const cards = makeCards(2);
    const calculator = createCalculator();
    const layout = calculator.calculate(cards, 50, null);

    expect(layout.cards).toHaveLength(2);

    // Distance between centers = cardWidth + cardGap
    const gap = layout.cards[1].x - layout.cards[0].x;
    expect(gap).toBe(DEFAULT_CONFIG.cardWidth! + DEFAULT_CONFIG.cardGap!);

    // Symmetric around center
    const center = DEFAULT_CONFIG.screenWidth / 2;
    const midX = (layout.cards[0].x + layout.cards[1].x) / 2;
    expect(midX).toBeCloseTo(center, 2);
  });

  it('three cards evenly distributed', () => {
    const cards = makeCards(3);
    const calculator = createCalculator();
    const layout = calculator.calculate(cards, 50, null);

    expect(layout.cards).toHaveLength(3);

    const gap01 = layout.cards[1].x - layout.cards[0].x;
    const gap12 = layout.cards[2].x - layout.cards[1].x;
    expect(gap01).toBe(gap12);
  });

  it('gold and skip always present regardless of card count', () => {
    for (const count of [1, 2, 3]) {
      const cards = makeCards(count);
      const calculator = createCalculator();
      const layout = calculator.calculate(cards, 50, null);

      expect(layout.gold.amount).toBe(50);
      expect(layout.skipButton.label).toBe('Skip');
      expect(layout.title.text).toBe('Choose a Card');
    }
  });
});

// ===========================================================================
// 9. Cannot select when already complete (selectCard returns null)
// ===========================================================================

describe('RewardScene integration -- blocked operations when complete', () => {
  it('selectCard returns null after card selection', () => {
    const controller = createController();
    controller.selectCard(0);

    expect(controller.selectCard(1)).toBeNull();
    expect(controller.selectCard(2)).toBeNull();
    expect(controller.selectCard(0)).toBeNull();
  });

  it('selectCard returns null after skip', () => {
    const controller = createController();
    controller.skip();

    expect(controller.selectCard(0)).toBeNull();
    expect(controller.selectCard(1)).toBeNull();
  });

  it('selectCard with invalid index returns null without completing', () => {
    const controller = createController();
    expect(controller.selectCard(-1)).toBeNull();
    expect(controller.isComplete()).toBe(false);

    expect(controller.selectCard(99)).toBeNull();
    expect(controller.isComplete()).toBe(false);
  });

  it('controller remains usable after invalid selection attempt', () => {
    const controller = createController();
    controller.selectCard(-1); // invalid
    expect(controller.isComplete()).toBe(false);

    // Should still be able to select a valid card
    const selected = controller.selectCard(1);
    expect(selected).not.toBeNull();
    expect(controller.isComplete()).toBe(true);
  });
});

// ===========================================================================
// 10. Gold amount from controller result
// ===========================================================================

describe('RewardScene integration -- gold amount in result', () => {
  it('gold is 0 when constructor receives 0', () => {
    const controller = createController(3, 0, false);
    controller.selectCard(0);

    expect(controller.getResult().goldGained).toBe(0);
  });

  it('gold is preserved at large values', () => {
    const controller = createController(3, 9999, false);
    controller.selectCard(0);

    expect(controller.getResult().goldGained).toBe(9999);
  });

  it('gold is preserved after skip', () => {
    const controller = createController(3, 123, false);
    controller.skip();

    expect(controller.getResult().goldGained).toBe(123);
  });

  it('gold is accessible via getState before completion', () => {
    const controller = createController(3, 77, false);
    expect(controller.getState().goldReward).toBe(77);
  });
});

// ===========================================================================
// 11. Full scene flow simulation
// ===========================================================================

describe('RewardScene integration -- full flow simulation', () => {
  it('select card flow: hover -> click -> complete', () => {
    const cards = makeCards(3);
    const gold = 42;
    const controller = new RewardController(cards, gold, false);
    const calculator = createCalculator();

    // Step 1: Initial render (no hover)
    const layout0 = calculator.calculate(cards, gold, null);
    expect(layout0.cards).toHaveLength(3);
    expect(controller.isComplete()).toBe(false);

    // Step 2: Hover card index 1
    const layout1 = calculator.calculate(cards, gold, 1);
    expect(layout1.cards[1].isHovered).toBe(true);
    expect(layout1.cards[1].y).toBeLessThan(layout1.cards[0].y);

    // Step 3: Click card index 1
    const selected = controller.selectCard(1);
    expect(selected).toBe(cards[1]);
    expect(controller.isComplete()).toBe(true);

    // Step 4: Get result
    const result = controller.getResult();
    expect(result.addedCard).toBe(cards[1]);
    expect(result.goldGained).toBe(42);
  });

  it('skip flow: hover -> unhover -> skip -> complete', () => {
    const cards = makeCards(3);
    const gold = 30;
    const controller = new RewardController(cards, gold, false);
    const calculator = createCalculator();

    // Step 1: Hover card 0
    const layoutHover = calculator.calculate(cards, gold, 0);
    expect(layoutHover.cards[0].isHovered).toBe(true);

    // Step 2: Unhover (move to skip button area)
    const layoutNoHover = calculator.calculate(cards, gold, null);
    expect(layoutNoHover.cards[0].isHovered).toBe(false);

    // Step 3: Click skip
    controller.skip();
    expect(controller.isComplete()).toBe(true);
    expect(controller.getState().skipped).toBe(true);

    // Step 4: Get result
    const result = controller.getResult();
    expect(result.addedCard).toBeNull();
    expect(result.goldGained).toBe(30);
  });

  it('complete blocks subsequent selection in full flow', () => {
    const cards = makeCards(3);
    const controller = new RewardController(cards, 50, false);

    controller.selectCard(0);
    expect(controller.isComplete()).toBe(true);

    // Attempt to select another card -- blocked
    const blocked = controller.selectCard(2);
    expect(blocked).toBeNull();

    // Original selection preserved
    expect(controller.getState().selectedCardIndex).toBe(0);
    expect(controller.getResult().addedCard!.id).toBe('card_0');
  });
});
