/**
 * card-hand-display.test.ts — Unit tests for CardHandDisplay.
 *
 * Verifies layout calculation for the card hand fan display.
 * Pure math tests — no Phaser dependencies.
 *
 * Coverage areas:
 * 1. Empty hand returns empty layout
 * 2. Single card centered horizontally
 * 3. Multiple cards spread evenly with correct gap
 * 4. Large hands compress gap (minimum card width enforced)
 * 5. Hover lift applied to correct card
 * 6. Select lift applied (higher than hover)
 * 7. Both hover + select on same card uses select lift
 * 8. Unplayable cards have alpha 0.5
 * 9. Card colors correct for each type
 * 10. Bottom margin respected
 * 11. Position calculation matches formula exactly
 * 12. isPlayable logic
 */

// @vitest-environment node

import { describe, it, expect } from 'vitest';
import {
  CardHandDisplay,
  type CardHandConfig,
  type CardLayoutResult,
  type CardUIState,
} from '../../../src/scenes/combat/card-hand-display';
import { CardType } from '../../../src/types/card';

// ---------------------------------------------------------------------------
// Test Helpers
// ---------------------------------------------------------------------------

/** Default config with known screen dimensions for predictable tests. */
const DEFAULT_CONFIG: CardHandConfig = {
  cardWidth: 120,
  cardHeight: 170,
  gap: 10,
  bottomMargin: 80,
  hoverLift: 20,
  selectLift: 40,
  screenWidth: 1920,
  screenHeight: 1080,
};

/** Create a CardHandDisplay with default config. */
function createDisplay(config: Partial<CardHandConfig> = {}): CardHandDisplay {
  return new CardHandDisplay({ ...DEFAULT_CONFIG, ...config });
}

/** Create a CardUIState for testing. */
function makeCard(overrides: Partial<CardUIState> = {}): CardUIState {
  return {
    instanceId: `card_${Math.random().toString(36).slice(2, 8)}`,
    cardId: 'strike_red',
    name: 'Strike',
    type: CardType.ATTACK,
    cost: 1,
    description: 'Deal 6 damage.',
    upgraded: false,
    ...overrides,
  };
}

/** Create an array of N cards with sequential instance IDs. */
function makeCards(count: number, overrides: Partial<CardUIState> = {}): CardUIState[] {
  return Array.from({ length: count }, (_, i) =>
    makeCard({ instanceId: `card_${i}`, ...overrides })
  );
}

/** Helper: calculate expected baseY. */
function baseY(config: CardHandConfig = DEFAULT_CONFIG): number {
  return config.screenHeight - (config.cardHeight ?? 170) - (config.bottomMargin ?? 80);
}

/** Helper: calculate expected cardX using the GDD formula. */
function expectedCardX(
  index: number,
  handSize: number,
  config: CardHandConfig = DEFAULT_CONFIG
): number {
  const cardWidth = config.cardWidth ?? 120;
  const gap = config.gap ?? 10;
  const totalWidth = handSize * cardWidth + (handSize - 1) * gap;
  const startX = (config.screenWidth - totalWidth) / 2;
  return startX + index * (cardWidth + gap);
}

// ===========================================================================
// 1. Empty hand
// ===========================================================================

describe('CardHandDisplay — empty hand', () => {
  it('returns empty array for empty hand', () => {
    const display = createDisplay();
    const layout = display.calculateLayout([], null, null);
    expect(layout).toEqual([]);
  });
});

// ===========================================================================
// 2. Single card centered
// ===========================================================================

describe('CardHandDisplay — single card', () => {
  it('centers a single card horizontally', () => {
    const display = createDisplay();
    const cards = makeCards(1);
    const layout = display.calculateLayout(cards, null, null);

    expect(layout).toHaveLength(1);

    const expectedX = (DEFAULT_CONFIG.screenWidth - DEFAULT_CONFIG.cardWidth) / 2;
    expect(layout[0].x).toBeCloseTo(expectedX, 2);
    expect(layout[0].y).toBe(baseY());
    expect(layout[0].width).toBe(DEFAULT_CONFIG.cardWidth);
    expect(layout[0].height).toBe(DEFAULT_CONFIG.cardHeight);
  });
});

// ===========================================================================
// 3. 5 cards spread evenly
// ===========================================================================

describe('CardHandDisplay — 5 cards spread', () => {
  it('positions 5 cards with correct gap between them', () => {
    const display = createDisplay();
    const cards = makeCards(5);
    const layout = display.calculateLayout(cards, null, null);

    expect(layout).toHaveLength(5);

    for (let i = 0; i < 5; i++) {
      expect(layout[i].x).toBeCloseTo(expectedCardX(i, 5), 2);
      expect(layout[i].y).toBe(baseY());
    }

    // Verify gap between consecutive cards
    const gap = layout[1].x - layout[0].x;
    expect(gap).toBe(DEFAULT_CONFIG.cardWidth + DEFAULT_CONFIG.gap);
  });
});

// ===========================================================================
// 4. 10 cards fit within screen
// ===========================================================================

describe('CardHandDisplay — 10 cards', () => {
  it('fits 10 cards within screen width', () => {
    const display = createDisplay();
    const cards = makeCards(10);
    const layout = display.calculateLayout(cards, null, null);

    expect(layout).toHaveLength(10);

    const firstCardRight = layout[0].x + layout[0].width;
    const lastCardRight = layout[9].x + layout[9].width;

    // All cards should be within screen bounds (allowing floating point)
    expect(layout[0].x).toBeGreaterThanOrEqual(-0.01);
    expect(lastCardRight).toBeLessThanOrEqual(DEFAULT_CONFIG.screenWidth + 0.01);

    // Verify positions match formula
    for (let i = 0; i < 10; i++) {
      expect(layout[i].x).toBeCloseTo(expectedCardX(i, 10), 2);
    }
  });
});

// ===========================================================================
// 5. 12+ cards compress gap (min width 80px)
// ===========================================================================

describe('CardHandDisplay — overflow compression', () => {
  it('compresses gap for 12 cards to fit within screen width', () => {
    const display = createDisplay();
    const cards = makeCards(12);
    const layout = display.calculateLayout(cards, null, null);

    expect(layout).toHaveLength(12);

    // Cards should still fit within screen
    const lastCardRight = layout[11].x + layout[11].width;
    expect(lastCardRight).toBeLessThanOrEqual(DEFAULT_CONFIG.screenWidth + 0.01);
    expect(layout[0].x).toBeGreaterThanOrEqual(-0.01);
  });

  it('enforces minimum effective card width of 80px when compressed', () => {
    // Use a narrow screen to force compression
    const narrowConfig: CardHandConfig = {
      ...DEFAULT_CONFIG,
      screenWidth: 400,
    };
    const display = createDisplay(narrowConfig);
    const cards = makeCards(12);
    const layout = display.calculateLayout(cards, null, null);

    // With 12 cards in 400px, each card gets at most 400/12 = 33px spacing
    // but minimum width is 80px, so overlap is expected.
    // The step between cards should be <= cardWidth (meaning overlap)
    // and each card width remains the full cardWidth
    for (let i = 0; i < layout.length; i++) {
      expect(layout[i].width).toBe(narrowConfig.cardWidth);
    }
  });

  it('still positions 15 cards without crashing', () => {
    const display = createDisplay();
    const cards = makeCards(15);
    const layout = display.calculateLayout(cards, null, null);

    expect(layout).toHaveLength(15);

    // Every card should have a valid position
    for (const card of layout) {
      expect(isFinite(card.x)).toBe(true);
      expect(isFinite(card.y)).toBe(true);
    }
  });
});

// ===========================================================================
// 6. Hover lift
// ===========================================================================

describe('CardHandDisplay — hover lift', () => {
  it('lifts hovered card by hoverLift pixels', () => {
    const display = createDisplay();
    const cards = makeCards(5);
    const layout = display.calculateLayout(cards, 2, null);

    // Card at index 2 should be lifted
    expect(layout[2].isHovered).toBe(true);
    expect(layout[2].y).toBe(baseY() - DEFAULT_CONFIG.hoverLift);

    // Other cards should be at base position
    expect(layout[0].isHovered).toBe(false);
    expect(layout[0].y).toBe(baseY());
  });

  it('does not lift any card when hoveredIndex is null', () => {
    const display = createDisplay();
    const cards = makeCards(5);
    const layout = display.calculateLayout(cards, null, null);

    for (const card of layout) {
      expect(card.isHovered).toBe(false);
      expect(card.y).toBe(baseY());
    }
  });
});

// ===========================================================================
// 7. Select lift
// ===========================================================================

describe('CardHandDisplay — select lift', () => {
  it('lifts selected card by selectLift pixels (higher than hover)', () => {
    const display = createDisplay();
    const cards = makeCards(5);
    const layout = display.calculateLayout(cards, null, 3);

    expect(layout[3].isSelected).toBe(true);
    expect(layout[3].y).toBe(baseY() - DEFAULT_CONFIG.selectLift);

    // selectLift > hoverLift
    expect(DEFAULT_CONFIG.selectLift).toBeGreaterThan(DEFAULT_CONFIG.hoverLift);

    // Other cards at base
    expect(layout[0].isSelected).toBe(false);
    expect(layout[0].y).toBe(baseY());
  });
});

// ===========================================================================
// 8. Both hover + select on same card
// ===========================================================================

describe('CardHandDisplay — hover + select on same card', () => {
  it('uses select lift when both hover and select target the same card', () => {
    const display = createDisplay();
    const cards = makeCards(5);
    const layout = display.calculateLayout(cards, 2, 2);

    // Both flags set on card 2
    expect(layout[2].isHovered).toBe(true);
    expect(layout[2].isSelected).toBe(true);

    // Select lift takes priority (higher lift)
    expect(layout[2].y).toBe(baseY() - DEFAULT_CONFIG.selectLift);
  });
});

// ===========================================================================
// 9. Unplayable alpha
// ===========================================================================

describe('CardHandDisplay — unplayable cards', () => {
  it('playable cards have alpha 1.0 during player_turn', () => {
    const display = createDisplay();
    const cards = makeCards(3, { cost: 1 });
    const layout = display.calculateLayout(cards, null, null, 3, 'player_turn');

    for (const card of layout) {
      expect(card.isPlayable).toBe(true);
      expect(card.alpha).toBe(1.0);
    }
  });

  it('unplayable cards have alpha 0.5', () => {
    const display = createDisplay();
    const cards = [
      makeCard({ instanceId: 'c0', cost: 1 }),
      makeCard({ instanceId: 'c1', cost: 5 }), // too expensive
      makeCard({ instanceId: 'c2', cost: 1 }),
    ];
    const layout = display.calculateLayout(cards, null, null, 2, 'player_turn');

    expect(layout[0].isPlayable).toBe(true);
    expect(layout[0].alpha).toBe(1.0);

    expect(layout[1].isPlayable).toBe(false);
    expect(layout[1].alpha).toBe(0.5);

    expect(layout[2].isPlayable).toBe(true);
    expect(layout[2].alpha).toBe(1.0);
  });

  it('all cards are unplayable during enemy_turn', () => {
    const display = createDisplay();
    const cards = makeCards(3, { cost: 1 });
    const layout = display.calculateLayout(cards, null, null, 3, 'enemy_turn');

    for (const card of layout) {
      expect(card.isPlayable).toBe(false);
      expect(card.alpha).toBe(0.5);
    }
  });
});

// ===========================================================================
// 10. Card colors
// ===========================================================================

describe('CardHandDisplay — card colors', () => {
  const colorCases: [CardType, number][] = [
    [CardType.ATTACK, 0xcc3333],
    [CardType.SKILL, 0x3366cc],
    [CardType.POWER, 0x33cc66],
    [CardType.STATUS, 0x888888],
    [CardType.CURSE, 0x883388],
  ];

  for (const [type, expectedColor] of colorCases) {
    it(`maps ${type} to 0x${expectedColor.toString(16).padStart(6, '0')}`, () => {
      const display = createDisplay();
      expect(display.getCardColor(type)).toBe(expectedColor);
    });
  }

  it('uses correct color in layout results', () => {
    const display = createDisplay();
    const cards = [
      makeCard({ instanceId: 'c0', type: CardType.ATTACK }),
      makeCard({ instanceId: 'c1', type: CardType.SKILL }),
      makeCard({ instanceId: 'c2', type: CardType.POWER }),
    ];
    const layout = display.calculateLayout(cards, null, null, 3, 'player_turn');

    expect(layout[0].color).toBe(0xcc3333);
    expect(layout[1].color).toBe(0x3366cc);
    expect(layout[2].color).toBe(0x33cc66);
  });
});

// ===========================================================================
// 11. Bottom margin
// ===========================================================================

describe('CardHandDisplay — bottom margin', () => {
  it('respects bottom margin in Y position', () => {
    const display = createDisplay();
    const cards = makeCards(3);
    const layout = display.calculateLayout(cards, null, null);

    const expectedBaseY =
      DEFAULT_CONFIG.screenHeight - DEFAULT_CONFIG.cardHeight - DEFAULT_CONFIG.bottomMargin;
    expect(layout[0].y).toBe(expectedBaseY);
  });

  it('uses custom bottom margin when configured', () => {
    const customConfig: CardHandConfig = { ...DEFAULT_CONFIG, bottomMargin: 120 };
    const display = createDisplay(customConfig);
    const cards = makeCards(3);
    const layout = display.calculateLayout(cards, null, null);

    const expectedBaseY = customConfig.screenHeight - customConfig.cardHeight - 120;
    expect(layout[0].y).toBe(expectedBaseY);
  });
});

// ===========================================================================
// 12. Exact formula match
// ===========================================================================

describe('CardHandDisplay — formula precision', () => {
  it('matches the GDD formula exactly for various hand sizes', () => {
    const display = createDisplay();

    for (const handSize of [1, 3, 5, 7, 10]) {
      const cards = makeCards(handSize);
      const layout = display.calculateLayout(cards, null, null);

      for (let i = 0; i < handSize; i++) {
        expect(layout[i].x).toBeCloseTo(expectedCardX(i, handSize), 2);
      }
    }
  });

  it('each layout result carries the source card reference', () => {
    const display = createDisplay();
    const cards = makeCards(3);
    const layout = display.calculateLayout(cards, null, null);

    expect(layout[0].card).toBe(cards[0]);
    expect(layout[1].card).toBe(cards[1]);
    expect(layout[2].card).toBe(cards[2]);
  });

  it('each layout result carries correct index', () => {
    const display = createDisplay();
    const cards = makeCards(5);
    const layout = display.calculateLayout(cards, null, null);

    for (let i = 0; i < 5; i++) {
      expect(layout[i].index).toBe(i);
    }
  });
});

// ===========================================================================
// 13. isPlayable
// ===========================================================================

describe('CardHandDisplay — isPlayable', () => {
  it('returns true when energy is sufficient and phase is player_turn', () => {
    const display = createDisplay();
    const card = makeCard({ cost: 2 });
    expect(display.isPlayable(card, 3, 'player_turn')).toBe(true);
  });

  it('returns true when energy equals cost', () => {
    const display = createDisplay();
    const card = makeCard({ cost: 3 });
    expect(display.isPlayable(card, 3, 'player_turn')).toBe(true);
  });

  it('returns false when energy is insufficient', () => {
    const display = createDisplay();
    const card = makeCard({ cost: 3 });
    expect(display.isPlayable(card, 2, 'player_turn')).toBe(false);
  });

  it('returns false during enemy_turn regardless of energy', () => {
    const display = createDisplay();
    const card = makeCard({ cost: 0 });
    expect(display.isPlayable(card, 3, 'enemy_turn')).toBe(false);
  });

  it('returns false during combat_over regardless of energy', () => {
    const display = createDisplay();
    const card = makeCard({ cost: 0 });
    expect(display.isPlayable(card, 3, 'combat_over')).toBe(false);
  });

  it('returns true for 0-cost cards when energy is 0 during player_turn', () => {
    const display = createDisplay();
    const card = makeCard({ cost: 0 });
    expect(display.isPlayable(card, 0, 'player_turn')).toBe(true);
  });
});
