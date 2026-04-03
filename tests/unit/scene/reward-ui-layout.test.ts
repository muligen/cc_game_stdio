/**
 * reward-ui-layout.test.ts — Unit tests for RewardUILayoutCalculator.
 *
 * Verifies layout calculation for the post-combat reward screen.
 * Pure math tests — no Phaser dependencies.
 *
 * Coverage areas:
 * 1. Three cards centered with correct gap
 * 2. Single card centered
 * 3. Gold positioned correctly
 * 4. Skip button at bottom
 * 5. Hovered card lifts by 20px
 * 6. Title at top center
 * 7. Responsive to screen size
 */

// @vitest-environment node

import { describe, it, expect } from 'vitest';
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

/** Default config with known screen dimensions for predictable tests. */
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

/** Create a calculator with default config. */
function createCalculator(config: Partial<RewardUIConfig> = {}): RewardUILayoutCalculator {
  return new RewardUILayoutCalculator({ ...DEFAULT_CONFIG, ...config });
}

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

/** Calculate expected center X for a card at a given index among cardCount cards. */
function expectedCardCenterX(
  index: number,
  cardCount: number,
  config: RewardUIConfig = DEFAULT_CONFIG
): number {
  const cardWidth = config.cardWidth ?? 140;
  const cardGap = config.cardGap ?? 30;
  const screenWidth = config.screenWidth;
  const totalWidth = cardCount * cardWidth + (cardCount - 1) * cardGap;
  const startX = (screenWidth - totalWidth) / 2;
  return startX + cardWidth / 2 + index * (cardWidth + cardGap);
}

/** Calculate expected base center Y for cards. */
function expectedCardCenterY(config: RewardUIConfig = DEFAULT_CONFIG): number {
  return (config.cardTopMargin ?? 250) + (config.cardHeight ?? 200) / 2;
}

// ===========================================================================
// 1. Three cards centered with correct gap
// ===========================================================================

describe('RewardUILayoutCalculator — 3 cards centered', () => {
  it('positions 3 cards evenly centered horizontally', () => {
    const calculator = createCalculator();
    const cards = makeCards(3);
    const layout = calculator.calculate(cards, 50, null);

    expect(layout.cards).toHaveLength(3);

    for (let i = 0; i < 3; i++) {
      expect(layout.cards[i].x).toBeCloseTo(expectedCardCenterX(i, 3), 2);
      expect(layout.cards[i].y).toBeCloseTo(expectedCardCenterY(), 2);
    }
  });

  it('spaces 3 cards with correct gap between them', () => {
    const calculator = createCalculator();
    const cards = makeCards(3);
    const layout = calculator.calculate(cards, 50, null);

    // Distance between card centers = cardWidth + cardGap
    const gap = layout.cards[1].x - layout.cards[0].x;
    expect(gap).toBe(DEFAULT_CONFIG.cardWidth! + DEFAULT_CONFIG.cardGap!);
  });

  it('centers 3 cards within the screen width', () => {
    const calculator = createCalculator();
    const cards = makeCards(3);
    const layout = calculator.calculate(cards, 50, null);

    // Left edge of first card
    const leftEdge = layout.cards[0].x - layout.cards[0].width / 2;
    // Right edge of last card
    const rightEdge = layout.cards[2].x + layout.cards[2].width / 2;

    // Should be symmetric around center
    const center = DEFAULT_CONFIG.screenWidth / 2;
    const leftDist = center - leftEdge;
    const rightDist = rightEdge - center;
    expect(leftDist).toBeCloseTo(rightDist, 2);
  });
});

// ===========================================================================
// 2. Single card centered
// ===========================================================================

describe('RewardUILayoutCalculator — single card', () => {
  it('centers a single card horizontally', () => {
    const calculator = createCalculator();
    const cards = makeCards(1);
    const layout = calculator.calculate(cards, 50, null);

    expect(layout.cards).toHaveLength(1);
    expect(layout.cards[0].x).toBe(DEFAULT_CONFIG.screenWidth / 2);
  });

  it('positions single card at correct vertical position', () => {
    const calculator = createCalculator();
    const cards = makeCards(1);
    const layout = calculator.calculate(cards, 50, null);

    expect(layout.cards[0].y).toBeCloseTo(expectedCardCenterY(), 2);
  });
});

// ===========================================================================
// 3. Gold positioned correctly
// ===========================================================================

describe('RewardUILayoutCalculator — gold display', () => {
  it('positions gold at screen center horizontally', () => {
    const calculator = createCalculator();
    const layout = calculator.calculate(makeCards(3), 42, null);

    expect(layout.gold.x).toBe(DEFAULT_CONFIG.screenWidth / 2);
  });

  it('positions gold at configured Y', () => {
    const calculator = createCalculator();
    const layout = calculator.calculate(makeCards(3), 42, null);

    expect(layout.gold.y).toBe(DEFAULT_CONFIG.goldY);
  });

  it('displays gold amount in text', () => {
    const calculator = createCalculator();
    const layout = calculator.calculate(makeCards(3), 42, null);

    expect(layout.gold.amount).toBe(42);
    expect(layout.gold.text).toBe('42 Gold');
  });

  it('formats different gold amounts correctly', () => {
    const calculator = createCalculator();
    const layout = calculator.calculate(makeCards(3), 0, null);

    expect(layout.gold.amount).toBe(0);
    expect(layout.gold.text).toBe('0 Gold');
  });

  it('uses custom goldY when configured', () => {
    const calculator = createCalculator({ goldY: 200 });
    const layout = calculator.calculate(makeCards(3), 42, null);

    expect(layout.gold.y).toBe(200);
  });
});

// ===========================================================================
// 4. Skip button at bottom
// ===========================================================================

describe('RewardUILayoutCalculator — skip button', () => {
  it('positions skip button at screen center horizontally', () => {
    const calculator = createCalculator();
    const layout = calculator.calculate(makeCards(3), 50, null);

    expect(layout.skipButton.x).toBe(DEFAULT_CONFIG.screenWidth / 2);
  });

  it('positions skip button near bottom of screen', () => {
    const calculator = createCalculator();
    const layout = calculator.calculate(makeCards(3), 50, null);

    const expectedY =
      DEFAULT_CONFIG.screenHeight! -
      (DEFAULT_CONFIG.skipBottomMargin ?? 40) -
      (DEFAULT_CONFIG.skipButtonHeight ?? 50) / 2;
    expect(layout.skipButton.y).toBe(expectedY);
  });

  it('has correct skip button dimensions', () => {
    const calculator = createCalculator();
    const layout = calculator.calculate(makeCards(3), 50, null);

    expect(layout.skipButton.width).toBe(DEFAULT_CONFIG.skipButtonWidth);
    expect(layout.skipButton.height).toBe(DEFAULT_CONFIG.skipButtonHeight);
  });

  it('displays Skip label', () => {
    const calculator = createCalculator();
    const layout = calculator.calculate(makeCards(3), 50, null);

    expect(layout.skipButton.label).toBe('Skip');
  });
});

// ===========================================================================
// 5. Hovered card lifts by 20px
// ===========================================================================

describe('RewardUILayoutCalculator — hover lift', () => {
  it('lifts hovered card up by hoverLift pixels', () => {
    const calculator = createCalculator();
    const cards = makeCards(3);
    const layout = calculator.calculate(cards, 50, 1);

    const baseY = expectedCardCenterY();
    expect(layout.cards[1].isHovered).toBe(true);
    expect(layout.cards[1].y).toBeCloseTo(baseY - DEFAULT_CONFIG.hoverLift!, 2);
  });

  it('does not lift non-hovered cards', () => {
    const calculator = createCalculator();
    const cards = makeCards(3);
    const layout = calculator.calculate(cards, 50, 1);

    const baseY = expectedCardCenterY();
    expect(layout.cards[0].isHovered).toBe(false);
    expect(layout.cards[0].y).toBeCloseTo(baseY, 2);
    expect(layout.cards[2].isHovered).toBe(false);
    expect(layout.cards[2].y).toBeCloseTo(baseY, 2);
  });

  it('does not lift any card when hoveredIndex is null', () => {
    const calculator = createCalculator();
    const cards = makeCards(3);
    const layout = calculator.calculate(cards, 50, null);

    const baseY = expectedCardCenterY();
    for (const card of layout.cards) {
      expect(card.isHovered).toBe(false);
      expect(card.y).toBeCloseTo(baseY, 2);
    }
  });

  it('uses custom hover lift when configured', () => {
    const calculator = createCalculator({ hoverLift: 40 });
    const cards = makeCards(3);
    const layout = calculator.calculate(cards, 50, 0);

    const baseY = expectedCardCenterY();
    expect(layout.cards[0].y).toBeCloseTo(baseY - 40, 2);
  });
});

// ===========================================================================
// 6. Title at top center
// ===========================================================================

describe('RewardUILayoutCalculator — title', () => {
  it('positions title at screen center horizontally', () => {
    const calculator = createCalculator();
    const layout = calculator.calculate(makeCards(3), 50, null);

    expect(layout.title.x).toBe(DEFAULT_CONFIG.screenWidth / 2);
  });

  it('positions title at configured Y', () => {
    const calculator = createCalculator();
    const layout = calculator.calculate(makeCards(3), 50, null);

    expect(layout.title.y).toBe(DEFAULT_CONFIG.titleY);
  });

  it('displays default title text', () => {
    const calculator = createCalculator();
    const layout = calculator.calculate(makeCards(3), 50, null);

    expect(layout.title.text).toBe('Choose a Card');
  });

  it('uses custom title text when configured', () => {
    const calculator = createCalculator({ titleText: 'Pick One!' });
    const layout = calculator.calculate(makeCards(3), 50, null);

    expect(layout.title.text).toBe('Pick One!');
  });
});

// ===========================================================================
// 7. Responsive to screen size
// ===========================================================================

describe('RewardUILayoutCalculator — responsive', () => {
  it('adapts card positions to narrow screen', () => {
    const narrowConfig: Partial<RewardUIConfig> = {
      screenWidth: 800,
      screenHeight: 600,
    };
    const calculator = createCalculator(narrowConfig);
    const cards = makeCards(3);
    const layout = calculator.calculate(cards, 50, null);

    // Cards should fit within 800px
    const leftEdge = layout.cards[0].x - layout.cards[0].width / 2;
    const rightEdge = layout.cards[2].x + layout.cards[2].width / 2;

    expect(leftEdge).toBeGreaterThanOrEqual(-0.01);
    expect(rightEdge).toBeLessThanOrEqual(800.01);

    // Should be centered within 800px
    expect(layout.cards[0].x).toBeCloseTo(expectedCardCenterX(0, 3, narrowConfig as RewardUIConfig), 2);
  });

  it('adapts gold position to different screen size', () => {
    const calculator = createCalculator({ screenWidth: 800, screenHeight: 600 });
    const layout = calculator.calculate(makeCards(3), 50, null);

    expect(layout.gold.x).toBe(400);
  });

  it('adapts skip button to different screen size', () => {
    const calculator = createCalculator({ screenWidth: 800, screenHeight: 600, skipBottomMargin: 40 });
    const layout = calculator.calculate(makeCards(3), 50, null);

    expect(layout.skipButton.x).toBe(400);
    expect(layout.skipButton.y).toBe(600 - 40 - 25); // screenHeight - margin - height/2
  });

  it('adapts title position to different screen size', () => {
    const calculator = createCalculator({ screenWidth: 800, screenHeight: 600 });
    const layout = calculator.calculate(makeCards(3), 50, null);

    expect(layout.title.x).toBe(400);
  });
});

// ===========================================================================
// 8. Card colors match CardHandDisplay palette
// ===========================================================================

describe('RewardUILayoutCalculator — card colors', () => {
  const colorCases: [CardType, number][] = [
    [CardType.ATTACK, 0xcc3333],
    [CardType.SKILL, 0x3366cc],
    [CardType.POWER, 0x33cc66],
    [CardType.STATUS, 0x888888],
    [CardType.CURSE, 0x883388],
  ];

  for (const [type, expectedColor] of colorCases) {
    it(`maps ${type} to 0x${expectedColor.toString(16).padStart(6, '0')}`, () => {
      const calculator = createCalculator();
      expect(calculator.getCardColor(type)).toBe(expectedColor);
    });
  }

  it('uses correct color in layout results', () => {
    const calculator = createCalculator();
    const cards = [
      makeCard({ id: 'c0', type: CardType.ATTACK }),
      makeCard({ id: 'c1', type: CardType.SKILL }),
      makeCard({ id: 'c2', type: CardType.POWER }),
    ];
    const layout = calculator.calculate(cards, 50, null);

    expect(layout.cards[0].color).toBe(0xcc3333);
    expect(layout.cards[1].color).toBe(0x3366cc);
    expect(layout.cards[2].color).toBe(0x33cc66);
  });
});

// ===========================================================================
// 9. Empty cards
// ===========================================================================

describe('RewardUILayoutCalculator — empty cards', () => {
  it('returns empty card array when no cards provided', () => {
    const calculator = createCalculator();
    const layout = calculator.calculate([], 50, null);

    expect(layout.cards).toEqual([]);
  });
});

// ===========================================================================
// 10. Layout result carries card references
// ===========================================================================

describe('RewardUILayoutCalculator — card references', () => {
  it('each layout result carries the source card reference', () => {
    const calculator = createCalculator();
    const cards = makeCards(3);
    const layout = calculator.calculate(cards, 50, null);

    expect(layout.cards[0].card).toBe(cards[0]);
    expect(layout.cards[1].card).toBe(cards[1]);
    expect(layout.cards[2].card).toBe(cards[2]);
  });

  it('each layout result carries correct index', () => {
    const calculator = createCalculator();
    const cards = makeCards(3);
    const layout = calculator.calculate(cards, 50, null);

    for (let i = 0; i < 3; i++) {
      expect(layout.cards[i].index).toBe(i);
    }
  });
});
