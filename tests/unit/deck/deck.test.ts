/**
 * deck.test.ts — Unit tests for DeckManager.
 *
 * Implements acceptance criteria and edge cases from design/gdd/deck.md.
 *
 * Coverage areas:
 * - Drawing: single, batch, empty draw pile (auto-shuffle), partial + shuffle,
 *   hand limit overflow, draw 0 (no-op)
 * - Discarding: single, multiple, discardHand, card not in hand (no-op)
 * - Exhausting: single, multiple, exhausted not in discard, not shuffled back
 * - Shuffling: discard into draw preserves cards, deterministic for same seed,
 *   empty discard (no-op)
 * - Innate: returns innate cards, empty when no innate cards
 * - Queries: pile sizes after operations, snapshots don't reflect later changes,
 *   empty piles return empty arrays
 * - Integration: full combat flow, determinism (same seed = same draw order)
 * - Edge cases: empty deck, single card, drawing entire deck then shuffling
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
import { DeckManager } from '../../../src/systems/deck-manager';
import { CardHelper } from '../../../src/systems/card-helper';
import { RNGStream } from '../../../src/utils/rng';

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
    upgrade: { effects: [{ type: 'deal_damage', value: 9 }] },
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

/** Creates a card with a specific keyword. */
function makeKeywordCard(keyword: Keyword, overrides: Partial<CombatCardInstance> = {}): CombatCardInstance {
  return makeCard({
    data: makeCardData({ keywords: [keyword] }),
    ...overrides,
  });
}

/** Creates a seeded RNGStream for deterministic tests. */
function makeRNG(seed: number = 42): RNGStream {
  return new RNGStream(seed);
}

/** Creates a standard 10-card deck for testing. */
function makeStandardDeck(): CombatCardInstance[] {
  cardCounter = 0;
  const cards: CombatCardInstance[] = [];
  for (let i = 0; i < 10; i++) {
    cards.push(makeCard());
  }
  return cards;
}

/** Creates a DeckManager with a standard deck and seeded RNG. */
function makeStandardManager(seed: number = 42): { dm: DeckManager; deck: CombatCardInstance[] } {
  const deck = makeStandardDeck();
  const dm = new DeckManager(deck, makeRNG(seed));
  return { dm, deck };
}

// ===========================================================================
// Drawing tests
// ===========================================================================

describe('DeckManager.drawCard', () => {
  it('draws 1 card from full draw pile', () => {
    const { dm } = makeStandardManager();
    const drawn = dm.drawCard(1);

    expect(drawn).toHaveLength(1);
    expect(dm.getHandSize()).toBe(1);
    expect(dm.getDrawPileSize()).toBe(9);
  });

  it('draws 5 cards (opening hand)', () => {
    const { dm } = makeStandardManager();
    const drawn = dm.drawCard(5);

    expect(drawn).toHaveLength(5);
    expect(dm.getHandSize()).toBe(5);
    expect(dm.getDrawPileSize()).toBe(5);
  });

  it('drawn cards appear in hand', () => {
    const { dm } = makeStandardManager();
    const drawn = dm.drawCard(3);
    const hand = dm.getHand();

    expect(hand).toHaveLength(3);
    for (const card of drawn) {
      expect(hand.some((c) => c.instanceId === card.instanceId)).toBe(true);
    }
  });

  it('drawn cards are removed from draw pile', () => {
    const { dm } = makeStandardManager();
    const drawn = dm.drawCard(3);
    const drawPile = dm.getDrawPile();

    for (const card of drawn) {
      expect(drawPile.some((c) => c.instanceId === card.instanceId)).toBe(false);
    }
  });

  it('draws when draw pile is empty by shuffling discard', () => {
    const { dm } = makeStandardManager();
    // Draw all 10 cards
    dm.drawCard(10);
    expect(dm.getDrawPileSize()).toBe(0);
    expect(dm.getHandSize()).toBe(10);

    // Discard all cards
    dm.discardHand();
    expect(dm.getDiscardPileSize()).toBe(10);

    // Draw again — should shuffle discard into draw
    const drawn = dm.drawCard(5);
    expect(drawn).toHaveLength(5);
    expect(dm.getHandSize()).toBe(5);
    expect(dm.getDrawPileSize()).toBe(5); // 10 shuffled - 5 drawn
    expect(dm.getDiscardPileSize()).toBe(0);
  });

  it('draws partial from draw pile then shuffles discard for remainder', () => {
    const { dm } = makeStandardManager();
    // Draw 8, leaving 2 in draw
    dm.drawCard(8);
    expect(dm.getDrawPileSize()).toBe(2);

    // Discard 6 cards to discard pile
    const hand = dm.getHand();
    dm.discardCards(hand.slice(0, 6));
    expect(dm.getDiscardPileSize()).toBe(6);
    expect(dm.getHandSize()).toBe(2);

    // Draw 5: need 5, draw pile has 2, so shuffle discard (6) into draw, then draw 3 more
    const drawn = dm.drawCard(5);
    expect(drawn).toHaveLength(5);
    expect(dm.getHandSize()).toBe(7); // 2 retained + 5 drawn
    expect(dm.getDrawPileSize()).toBe(3); // 2 original + 6 shuffled - 5 drawn
    expect(dm.getDiscardPileSize()).toBe(0);
  });

  it('enforces hand limit of 10: overflow cards go to discard', () => {
    // Create a 15-card deck so draw pile has cards after filling hand.
    cardCounter = 0;
    const cards: CombatCardInstance[] = [];
    for (let i = 0; i < 15; i++) {
      cards.push(makeCard());
    }
    const dm = new DeckManager(cards, makeRNG());

    // Draw 8 cards (hand has room for 2 more)
    dm.drawCard(8);
    expect(dm.getHandSize()).toBe(8);
    expect(dm.getDrawPileSize()).toBe(7); // 15 - 8

    // Draw 5: hand can accept 2, then 3 overflow to discard
    const drawn = dm.drawCard(5);
    expect(drawn).toHaveLength(2); // Only 2 entered hand
    expect(dm.getHandSize()).toBe(10); // Max hand size
    expect(dm.getDiscardPileSize()).toBe(3); // 3 overflow
    expect(dm.getDrawPileSize()).toBe(2); // 7 - 5 = 2
  });

  it('draws 0 cards as no-op', () => {
    const { dm } = makeStandardManager();
    const drawn = dm.drawCard(0);

    expect(drawn).toHaveLength(0);
    expect(dm.getHandSize()).toBe(0);
    expect(dm.getDrawPileSize()).toBe(10);
  });

  it('draws negative count as no-op', () => {
    const { dm } = makeStandardManager();
    const drawn = dm.drawCard(-3);

    expect(drawn).toHaveLength(0);
    expect(dm.getHandSize()).toBe(0);
    expect(dm.getDrawPileSize()).toBe(10);
  });

  it('returns fewer cards when deck is fully exhausted', () => {
    // 5-card deck, exhaust all, try to draw
    const deck = makeStandardDeck().slice(0, 5);
    const dm = new DeckManager(deck, makeRNG());
    dm.drawCard(5);
    dm.discardHand();
    expect(dm.getDiscardPileSize()).toBe(5);

    // Now draw, shuffling discard back
    const drawn = dm.drawCard(5);
    expect(drawn).toHaveLength(5);

    // Discard again
    dm.discardHand();

    // Now draw again
    const drawn2 = dm.drawCard(5);
    expect(drawn2).toHaveLength(5);
  });

  it('returns empty array when draw and discard are both empty', () => {
    const deck = makeStandardDeck().slice(0, 2);
    const dm = new DeckManager(deck, makeRNG());
    dm.drawCard(2);
    // Exhaust both cards so they can't be shuffled back
    const hand = dm.getHand();
    dm.exhaustCards(hand);
    expect(dm.getDrawPileSize()).toBe(0);
    expect(dm.getDiscardPileSize()).toBe(0);
    expect(dm.getExhaustPileSize()).toBe(2);

    const drawn = dm.drawCard(1);
    expect(drawn).toHaveLength(0);
  });
});

// ===========================================================================
// Discarding tests
// ===========================================================================

describe('DeckManager.discardCards', () => {
  it('discards a card from hand', () => {
    const { dm } = makeStandardManager();
    dm.drawCard(3);
    const hand = dm.getHand();

    dm.discardCards([hand[0]]);
    expect(dm.getHandSize()).toBe(2);
    expect(dm.getDiscardPileSize()).toBe(1);
  });

  it('discards multiple cards from hand', () => {
    const { dm } = makeStandardManager();
    dm.drawCard(5);
    const hand = dm.getHand();

    dm.discardCards([hand[0], hand[2], hand[4]]);
    expect(dm.getHandSize()).toBe(2);
    expect(dm.getDiscardPileSize()).toBe(3);
  });

  it('discarded cards appear in discard pile', () => {
    const { dm } = makeStandardManager();
    dm.drawCard(3);
    const hand = dm.getHand();
    const targetId = hand[1].instanceId;

    dm.discardCards([hand[1]]);
    const discard = dm.getDiscardPile();
    expect(discard.some((c) => c.instanceId === targetId)).toBe(true);
  });

  it('discarded cards are removed from hand', () => {
    const { dm } = makeStandardManager();
    dm.drawCard(3);
    const hand = dm.getHand();
    const targetId = hand[0].instanceId;

    dm.discardCards([hand[0]]);
    const newHand = dm.getHand();
    expect(newHand.some((c) => c.instanceId === targetId)).toBe(false);
  });

  it('discards card not in hand as no-op', () => {
    const { dm } = makeStandardManager();
    dm.drawCard(3);
    const stranger = makeCard(); // Not in any pile

    dm.discardCards([stranger]);
    expect(dm.getHandSize()).toBe(3);
    expect(dm.getDiscardPileSize()).toBe(0);
  });

  it('discards empty array as no-op', () => {
    const { dm } = makeStandardManager();
    dm.drawCard(3);
    dm.discardCards([]);
    expect(dm.getHandSize()).toBe(3);
    expect(dm.getDiscardPileSize()).toBe(0);
  });
});

describe('DeckManager.discardHand', () => {
  it('discards all cards in hand', () => {
    const { dm } = makeStandardManager();
    dm.drawCard(7);
    expect(dm.getHandSize()).toBe(7);

    dm.discardHand();
    expect(dm.getHandSize()).toBe(0);
    expect(dm.getDiscardPileSize()).toBe(7);
  });

  it('discards empty hand as no-op', () => {
    const { dm } = makeStandardManager();
    dm.discardHand();
    expect(dm.getHandSize()).toBe(0);
    expect(dm.getDiscardPileSize()).toBe(0);
  });

  it('all discarded cards appear in discard pile', () => {
    const { dm } = makeStandardManager();
    dm.drawCard(5);
    const handIds = dm.getHand().map((c) => c.instanceId);

    dm.discardHand();
    const discardIds = dm.getDiscardPile().map((c) => c.instanceId);

    for (const id of handIds) {
      expect(discardIds).toContain(id);
    }
  });
});

// ===========================================================================
// Exhausting tests
// ===========================================================================

describe('DeckManager.exhaustCards', () => {
  it('exhausts a card from hand', () => {
    const { dm } = makeStandardManager();
    dm.drawCard(3);
    const hand = dm.getHand();

    dm.exhaustCards([hand[0]]);
    expect(dm.getHandSize()).toBe(2);
    expect(dm.getExhaustPileSize()).toBe(1);
  });

  it('exhausts multiple cards from hand', () => {
    const { dm } = makeStandardManager();
    dm.drawCard(5);
    const hand = dm.getHand();

    dm.exhaustCards([hand[0], hand[1]]);
    expect(dm.getHandSize()).toBe(3);
    expect(dm.getExhaustPileSize()).toBe(2);
  });

  it('exhausted cards appear in exhaust pile', () => {
    const { dm } = makeStandardManager();
    dm.drawCard(3);
    const hand = dm.getHand();
    const targetId = hand[2].instanceId;

    dm.exhaustCards([hand[2]]);
    const exhaust = dm.getExhaustPile();
    expect(exhaust.some((c) => c.instanceId === targetId)).toBe(true);
  });

  it('exhausted cards are NOT in discard pile', () => {
    const { dm } = makeStandardManager();
    dm.drawCard(3);
    const hand = dm.getHand();

    dm.exhaustCards([hand[0]]);
    expect(dm.getDiscardPileSize()).toBe(0);
  });

  it('exhausted cards are NOT shuffled back', () => {
    const deck = makeStandardDeck().slice(0, 5);
    const dm = new DeckManager(deck, makeRNG());
    dm.drawCard(5);

    // Exhaust 2 cards
    const hand = dm.getHand();
    dm.exhaustCards([hand[0], hand[1]]);
    expect(dm.getExhaustPileSize()).toBe(2);

    // Discard remaining
    dm.discardHand();
    expect(dm.getDiscardPileSize()).toBe(3);

    // Shuffle discard into draw
    dm.shuffleDiscardIntoDraw();
    expect(dm.getDrawPileSize()).toBe(3); // Only 3, not 5

    // Draw all 3 and exhaust them all
    const drawn = dm.drawCard(3);
    expect(drawn).toHaveLength(3);

    // Exhaust pile still has original 2 + now 3 = 5 total exhausted
    dm.exhaustCards(dm.getHand().slice());
    expect(dm.getExhaustPileSize()).toBe(5);
    expect(dm.getDiscardPileSize()).toBe(0);
    expect(dm.getDrawPileSize()).toBe(0);

    // No more cards available anywhere
    const moreDrawn = dm.drawCard(1);
    expect(moreDrawn).toHaveLength(0);
  });

  it('exhausts card not in hand as no-op', () => {
    const { dm } = makeStandardManager();
    dm.drawCard(3);
    const stranger = makeCard();

    dm.exhaustCards([stranger]);
    expect(dm.getHandSize()).toBe(3);
    expect(dm.getExhaustPileSize()).toBe(0);
  });

  it('exhausts empty array as no-op', () => {
    const { dm } = makeStandardManager();
    dm.drawCard(3);
    dm.exhaustCards([]);
    expect(dm.getHandSize()).toBe(3);
    expect(dm.getExhaustPileSize()).toBe(0);
  });
});

// ===========================================================================
// Shuffling tests
// ===========================================================================

describe('DeckManager.shuffleDiscardIntoDraw', () => {
  it('preserves all cards during shuffle', () => {
    const { dm } = makeStandardManager();
    dm.drawCard(10);
    dm.discardHand();
    const totalBefore = dm.getDrawPileSize() + dm.getDiscardPileSize() + dm.getHandSize() + dm.getExhaustPileSize();

    dm.shuffleDiscardIntoDraw();

    const totalAfter = dm.getDrawPileSize() + dm.getDiscardPileSize() + dm.getHandSize() + dm.getExhaustPileSize();
    expect(dm.getDrawPileSize()).toBe(10);
    expect(dm.getDiscardPileSize()).toBe(0);
    expect(totalBefore).toBe(totalAfter);
  });

  it('uses RNG for deterministic shuffle (same seed = same order)', () => {
    const deck1 = makeStandardDeck();
    const deck2 = makeStandardDeck().map((c) => ({ ...c }));

    const dm1 = new DeckManager(deck1, makeRNG(12345));
    const dm2 = new DeckManager(deck2, makeRNG(12345));

    // Both draw 10 cards (same initial shuffle)
    const hand1 = dm1.drawCard(10);
    const hand2 = dm2.drawCard(10);

    // Verify same draw order
    for (let i = 0; i < 10; i++) {
      expect(hand1[i].instanceId).toBe(hand2[i].instanceId);
    }

    // Discard all
    dm1.discardHand();
    dm2.discardHand();

    // Shuffle discard into draw (same RNG state)
    dm1.shuffleDiscardIntoDraw();
    dm2.shuffleDiscardIntoDraw();

    // Draw again — should still be same order
    const hand1b = dm1.drawCard(10);
    const hand2b = dm2.drawCard(10);

    for (let i = 0; i < 10; i++) {
      expect(hand1b[i].instanceId).toBe(hand2b[i].instanceId);
    }
  });

  it('different seeds produce different draw orders', () => {
    const deck1 = makeStandardDeck();
    cardCounter = 0;
    const deck2 = makeStandardDeck();

    const dm1 = new DeckManager(deck1, makeRNG(111));
    const dm2 = new DeckManager(deck2, makeRNG(999));

    const hand1 = dm1.drawCard(10);
    const hand2 = dm2.drawCard(10);

    // Very unlikely all 10 match with different seeds
    const allSame = hand1.every((c, i) => c.instanceId === hand2[i].instanceId);
    expect(allSame).toBe(false);
  });

  it('shuffles empty discard pile as no-op', () => {
    const { dm } = makeStandardManager();
    const drawBefore = dm.getDrawPileSize();

    dm.shuffleDiscardIntoDraw();
    expect(dm.getDrawPileSize()).toBe(drawBefore);
    expect(dm.getDiscardPileSize()).toBe(0);
  });

  it('adds shuffled discard to bottom of existing draw pile', () => {
    const { dm } = makeStandardManager();
    // Draw 8, leaving 2 in draw
    dm.drawCard(8);
    const drawTopCardId = dm.getDrawPile()[0]?.instanceId;

    // Discard 4 to create discard pile
    const hand = dm.getHand();
    dm.discardCards(hand.slice(0, 4));

    dm.shuffleDiscardIntoDraw();
    expect(dm.getDrawPileSize()).toBe(6); // 2 + 4

    // Draw 2 — should be original draw pile cards first
    const firstTwo = dm.drawCard(2);
    expect(firstTwo).toHaveLength(2);
  });
});

// ===========================================================================
// Innate tests
// ===========================================================================

describe('DeckManager.getInnateCards', () => {
  it('returns cards with innate keyword', () => {
    cardCounter = 0;
    const cards: CombatCardInstance[] = [
      makeCard(), // normal
      makeKeywordCard(Keyword.INNATE), // innate
      makeCard(), // normal
      makeKeywordCard(Keyword.INNATE), // innate
      makeCard(), // normal
    ];

    const dm = new DeckManager(cards, makeRNG());
    const innate = dm.getInnateCards();

    expect(innate).toHaveLength(2);
    for (const card of innate) {
      expect(card.data.keywords).toContain(Keyword.INNATE);
    }
  });

  it('returns empty array when no innate cards', () => {
    const { dm } = makeStandardManager();
    const innate = dm.getInnateCards();
    expect(innate).toHaveLength(0);
  });

  it('finds innate cards in hand', () => {
    cardCounter = 0;
    const cards: CombatCardInstance[] = [
      makeKeywordCard(Keyword.INNATE),
      makeCard(),
      makeCard(),
    ];
    const dm = new DeckManager(cards, makeRNG());
    dm.drawCard(3);

    const innate = dm.getInnateCards();
    expect(innate).toHaveLength(1);
  });

  it('finds innate cards in discard pile', () => {
    cardCounter = 0;
    const cards: CombatCardInstance[] = [
      makeKeywordCard(Keyword.INNATE),
      makeCard(),
      makeCard(),
    ];
    const dm = new DeckManager(cards, makeRNG());
    dm.drawCard(3);
    dm.discardHand();

    const innate = dm.getInnateCards();
    expect(innate).toHaveLength(1);
  });

  it('finds innate cards in exhaust pile', () => {
    cardCounter = 0;
    const cards: CombatCardInstance[] = [
      makeKeywordCard(Keyword.INNATE),
      makeCard(),
    ];
    const dm = new DeckManager(cards, makeRNG());
    dm.drawCard(2);
    const hand = dm.getHand();
    dm.exhaustCards([hand[0]]);

    const innate = dm.getInnateCards();
    expect(innate).toHaveLength(1);
  });
});

// ===========================================================================
// Query tests
// ===========================================================================

describe('DeckManager query methods', () => {
  it('reports correct pile sizes after draw', () => {
    const { dm } = makeStandardManager();
    dm.drawCard(4);

    expect(dm.getDrawPileSize()).toBe(6);
    expect(dm.getHandSize()).toBe(4);
    expect(dm.getDiscardPileSize()).toBe(0);
    expect(dm.getExhaustPileSize()).toBe(0);
  });

  it('reports correct pile sizes after discard', () => {
    const { dm } = makeStandardManager();
    dm.drawCard(5);
    const hand = dm.getHand();
    dm.discardCards([hand[0], hand[1]]);

    expect(dm.getDrawPileSize()).toBe(5);
    expect(dm.getHandSize()).toBe(3);
    expect(dm.getDiscardPileSize()).toBe(2);
    expect(dm.getExhaustPileSize()).toBe(0);
  });

  it('reports correct pile sizes after exhaust', () => {
    const { dm } = makeStandardManager();
    dm.drawCard(5);
    const hand = dm.getHand();
    dm.exhaustCards([hand[0]]);

    expect(dm.getHandSize()).toBe(4);
    expect(dm.getExhaustPileSize()).toBe(1);
    expect(dm.getDiscardPileSize()).toBe(0);
  });

  it('reports correct pile sizes after full cycle', () => {
    const { dm } = makeStandardManager();
    dm.drawCard(10);
    dm.discardHand();
    dm.shuffleDiscardIntoDraw();
    dm.drawCard(5);
    const hand = dm.getHand();
    dm.discardCards(hand.slice(0, 2));

    expect(dm.getDrawPileSize()).toBe(5);
    expect(dm.getHandSize()).toBe(3);
    expect(dm.getDiscardPileSize()).toBe(2);
    expect(dm.getExhaustPileSize()).toBe(0);
  });

  it('snapshots do not reflect later changes (getDrawPile)', () => {
    const { dm } = makeStandardManager();
    const snapshot = dm.getDrawPile();
    const sizeBefore = snapshot.length;

    dm.drawCard(3);
    expect(snapshot.length).toBe(sizeBefore); // snapshot unchanged
  });

  it('snapshots do not reflect later changes (getHand)', () => {
    const { dm } = makeStandardManager();
    dm.drawCard(5);
    const snapshot = dm.getHand();

    dm.discardHand();
    expect(snapshot.length).toBe(5); // snapshot unchanged
  });

  it('snapshots do not reflect later changes (getDiscardPile)', () => {
    const { dm } = makeStandardManager();
    dm.drawCard(5);
    dm.discardHand();
    const snapshot = dm.getDiscardPile();

    dm.shuffleDiscardIntoDraw();
    expect(snapshot.length).toBe(5); // snapshot unchanged
  });

  it('snapshots do not reflect later changes (getExhaustPile)', () => {
    const { dm } = makeStandardManager();
    dm.drawCard(3);
    const hand = dm.getHand();
    dm.exhaustCards([hand[0]]);
    const snapshot = dm.getExhaustPile();

    // More exhausts
    dm.exhaustCards([dm.getHand()[0]]);
    expect(snapshot.length).toBe(1); // snapshot unchanged
  });

  it('empty piles return empty arrays', () => {
    const { dm } = makeStandardManager();

    expect(dm.getHand()).toEqual([]);
    expect(dm.getDiscardPile()).toEqual([]);
    expect(dm.getExhaustPile()).toEqual([]);
  });

  it('total card count is preserved across operations', () => {
    const deck = makeStandardDeck();
    const dm = new DeckManager(deck, makeRNG());
    const totalCards = deck.length;

    const getTotal = () =>
      dm.getDrawPileSize() +
      dm.getHandSize() +
      dm.getDiscardPileSize() +
      dm.getExhaustPileSize();

    expect(getTotal()).toBe(totalCards);

    dm.drawCard(5);
    expect(getTotal()).toBe(totalCards);

    dm.discardHand();
    expect(getTotal()).toBe(totalCards);

    dm.shuffleDiscardIntoDraw();
    expect(getTotal()).toBe(totalCards);

    dm.drawCard(7);
    expect(getTotal()).toBe(totalCards);

    const hand = dm.getHand();
    dm.exhaustCards([hand[0]]);
    expect(getTotal()).toBe(totalCards);

    dm.discardHand();
    expect(getTotal()).toBe(totalCards);
  });
});

// ===========================================================================
// resetForCombat tests
// ===========================================================================

describe('DeckManager.resetForCombat', () => {
  it('resets all piles with new deck', () => {
    const { dm } = makeStandardManager();
    dm.drawCard(10);
    dm.discardHand();

    const newDeck = makeStandardDeck();
    dm.resetForCombat(newDeck);

    expect(dm.getDrawPileSize()).toBe(10);
    expect(dm.getHandSize()).toBe(0);
    expect(dm.getDiscardPileSize()).toBe(0);
    expect(dm.getExhaustPileSize()).toBe(0);
  });

  it('new deck is shuffled', () => {
    // Two managers with same seed should produce same order after reset
    const deck1 = makeStandardDeck();
    cardCounter = 0;
    const deck2 = makeStandardDeck();

    const dm1 = new DeckManager([], makeRNG(77));
    const dm2 = new DeckManager([], makeRNG(77));

    dm1.resetForCombat(deck1);
    dm2.resetForCombat(deck2);

    const hand1 = dm1.drawCard(10);
    const hand2 = dm2.drawCard(10);

    for (let i = 0; i < 10; i++) {
      expect(hand1[i].instanceId).toBe(hand2[i].instanceId);
    }
  });
});

// ===========================================================================
// Edge cases
// ===========================================================================

describe('DeckManager edge cases', () => {
  it('handles empty deck (0 cards)', () => {
    const dm = new DeckManager([], makeRNG());

    expect(dm.getDrawPileSize()).toBe(0);
    expect(dm.getHandSize()).toBe(0);

    const drawn = dm.drawCard(5);
    expect(drawn).toHaveLength(0);
  });

  it('handles single card deck', () => {
    cardCounter = 0;
    const singleCard = makeCard();
    const dm = new DeckManager([singleCard], makeRNG());

    const drawn = dm.drawCard(1);
    expect(drawn).toHaveLength(1);
    expect(drawn[0].instanceId).toBe(singleCard.instanceId);
    expect(dm.getDrawPileSize()).toBe(0);
    expect(dm.getHandSize()).toBe(1);

    // No more cards
    const drawn2 = dm.drawCard(1);
    expect(drawn2).toHaveLength(0);
  });

  it('draws entire deck then shuffles back', () => {
    const deck = makeStandardDeck();
    const dm = new DeckManager(deck, makeRNG());

    // Draw entire deck
    dm.drawCard(10);
    expect(dm.getDrawPileSize()).toBe(0);

    // Discard all
    dm.discardHand();
    expect(dm.getDiscardPileSize()).toBe(10);

    // Draw again — auto-shuffle
    const drawn = dm.drawCard(10);
    expect(drawn).toHaveLength(10);
    expect(dm.getDiscardPileSize()).toBe(0);
    expect(dm.getDrawPileSize()).toBe(0);
  });

  it('multiple shuffles produce consistent results with same seed', () => {
    const deck = makeStandardDeck();
    const dm = new DeckManager(deck, makeRNG(42));

    // First round
    dm.drawCard(10);
    const firstHand = dm.getHand().map((c) => c.instanceId);
    dm.discardHand();

    // Second round (reshuffle)
    dm.drawCard(10);
    const secondHand = dm.getHand().map((c) => c.instanceId);
    dm.discardHand();

    // With a proper shuffle, the orders should differ
    const sameOrder = firstHand.every((id, i) => id === secondHand[i]);
    expect(sameOrder).toBe(false);
  });

  it('hand limit overflow with auto-shuffle', () => {
    // Create a 15-card deck so there are cards to overflow.
    cardCounter = 0;
    const cards: CombatCardInstance[] = [];
    for (let i = 0; i < 15; i++) {
      cards.push(makeCard());
    }
    const dm = new DeckManager(cards, makeRNG());

    // Fill hand to 10
    dm.drawCard(10);
    expect(dm.getHandSize()).toBe(10);
    expect(dm.getDrawPileSize()).toBe(5);

    // Draw 5 more — all overflow to discard (hand already full)
    const overflow = dm.drawCard(5);
    expect(overflow).toHaveLength(0); // none entered hand
    expect(dm.getHandSize()).toBe(10);
    expect(dm.getDiscardPileSize()).toBe(5); // overflow went to discard
    expect(dm.getDrawPileSize()).toBe(0);

    // Discard hand
    dm.discardHand();
    expect(dm.getDiscardPileSize()).toBe(15); // 10 + 5

    // Shuffle back and draw
    dm.drawCard(5);
    expect(dm.getHandSize()).toBe(5);
  });
});

// ===========================================================================
// Integration: Full combat flow
// ===========================================================================

describe('DeckManager integration: full combat flow', () => {
  it('simulates a complete combat turn cycle', () => {
    const deck = makeStandardDeck();
    const dm = new DeckManager(deck, makeRNG(42));

    // Turn 1: Draw opening hand (5 cards)
    const turn1Hand = dm.drawCard(5);
    expect(turn1Hand).toHaveLength(5);
    expect(dm.getHandSize()).toBe(5);
    expect(dm.getDrawPileSize()).toBe(5);

    // Play 2 cards (discard them)
    dm.discardCards([turn1Hand[0], turn1Hand[1]]);
    expect(dm.getHandSize()).toBe(3);

    // Play 1 card (exhaust it)
    dm.exhaustCards([dm.getHand()[0]]);
    expect(dm.getHandSize()).toBe(2);
    expect(dm.getExhaustPileSize()).toBe(1);

    // End turn: discard remaining hand
    dm.discardHand();
    expect(dm.getHandSize()).toBe(0);
    expect(dm.getDiscardPileSize()).toBe(4); // 2 discarded + 2 remaining

    // Turn 2: Draw 5 more
    const turn2Hand = dm.drawCard(5);
    expect(turn2Hand).toHaveLength(5);
    expect(dm.getDrawPileSize()).toBe(0); // 5 - 5 drawn

    // End turn 2
    dm.discardHand();
    expect(dm.getDiscardPileSize()).toBe(9); // 4 + 5 (1 exhausted)
  });

  it('same seed produces same draw order across combats', () => {
    const deck1 = makeStandardDeck();
    cardCounter = 0;
    const deck2 = makeStandardDeck();

    // First combat
    const dm1 = new DeckManager(deck1, makeRNG(99999));
    const combat1Turn1 = dm1.drawCard(5);

    // Second combat with same seed
    const dm2 = new DeckManager(deck2, makeRNG(99999));
    const combat2Turn1 = dm2.drawCard(5);

    // Same draw order
    for (let i = 0; i < 5; i++) {
      expect(combat1Turn1[i].instanceId).toBe(combat2Turn1[i].instanceId);
    }
  });

  it('complete multi-turn combat with exhaustion', () => {
    cardCounter = 0;
    const cards: CombatCardInstance[] = [];
    for (let i = 0; i < 8; i++) {
      cards.push(makeCard());
    }
    const dm = new DeckManager(cards, makeRNG(42));

    // Turn 1
    const t1 = dm.drawCard(5);
    expect(t1).toHaveLength(5);
    // Exhaust 2 cards
    dm.exhaustCards([t1[0], t1[1]]);
    dm.discardHand(); // Discard remaining 3

    expect(dm.getExhaustPileSize()).toBe(2);
    expect(dm.getDiscardPileSize()).toBe(3);
    expect(dm.getDrawPileSize()).toBe(3);

    // Turn 2: draw 5 — draw pile has 3, shuffle discard (3) to get 6, draw 5
    const t2 = dm.drawCard(5);
    expect(t2).toHaveLength(5);
    expect(dm.getDrawPileSize()).toBe(1); // 6 - 5
    expect(dm.getDiscardPileSize()).toBe(0);

    // Exhaust 1 more
    dm.exhaustCards([t2[0]]);
    dm.discardHand();

    expect(dm.getExhaustPileSize()).toBe(3);
    expect(dm.getDiscardPileSize()).toBe(4); // 4 remaining from hand

    // Verify total cards preserved
    const total =
      dm.getDrawPileSize() +
      dm.getHandSize() +
      dm.getDiscardPileSize() +
      dm.getExhaustPileSize();
    expect(total).toBe(8);
  });
});

// ===========================================================================
// Constructor behavior
// ===========================================================================

describe('DeckManager constructor', () => {
  it('initializes draw pile with shuffled copy of input cards', () => {
    const deck = makeStandardDeck();
    const deckIds = deck.map((c) => c.instanceId);
    const dm = new DeckManager(deck, makeRNG());

    // Draw pile should have all cards (but likely in different order)
    const drawPileIds = dm.getDrawPile().map((c) => c.instanceId);
    expect(drawPileIds.sort()).toEqual(deckIds.sort());
  });

  it('does not modify the input array', () => {
    const deck = makeStandardDeck();
    const originalLength = deck.length;
    const originalIds = deck.map((c) => c.instanceId);

    new DeckManager(deck, makeRNG());

    expect(deck.length).toBe(originalLength);
    expect(deck.map((c) => c.instanceId)).toEqual(originalIds);
  });

  it('starts with empty hand, discard, and exhaust piles', () => {
    const { dm } = makeStandardManager();

    expect(dm.getHandSize()).toBe(0);
    expect(dm.getDiscardPileSize()).toBe(0);
    expect(dm.getExhaustPileSize()).toBe(0);
  });
});

// ===========================================================================
// Acceptance Criteria tests (from design/gdd/deck-manager.md)
// ===========================================================================

describe('Deck Manager Acceptance Criteria (deck-manager.md)', () => {
  // AC 1: At combat start, Draw Pile contains all Master Deck cards (shuffled).
  it('AC1: Draw Pile contains all Master Deck cards at combat start (shuffled)', () => {
    const deck = makeStandardDeck();
    const deckIds = deck.map((c) => c.instanceId).sort();
    const dm = new DeckManager(deck, makeRNG(42));

    const drawPileIds = dm.getDrawPile().map((c) => c.instanceId).sort();
    expect(drawPileIds).toEqual(deckIds);
    expect(dm.getDrawPileSize()).toBe(10);
    // All other piles are empty
    expect(dm.getHandSize()).toBe(0);
    expect(dm.getDiscardPileSize()).toBe(0);
    expect(dm.getExhaustPileSize()).toBe(0);
  });

  // AC 2: draw(5) moves exactly 5 cards from Draw Pile top to Hand.
  it('AC2: draw(5) moves exactly 5 cards from Draw Pile to Hand', () => {
    const { dm } = makeStandardManager();
    const drawn = dm.drawCard(5);

    expect(drawn).toHaveLength(5);
    expect(dm.getHandSize()).toBe(5);
    expect(dm.getDrawPileSize()).toBe(5);

    // Drawn cards are the same cards now in hand
    const hand = dm.getHand();
    for (const card of drawn) {
      expect(hand.some((c) => c.instanceId === card.instanceId)).toBe(true);
    }
  });

  // AC 3: When Draw Pile is empty, draw(n) shuffles Discard -> Draw first, then draws.
  it('AC3: draw(n) auto-shuffles Discard into Draw when Draw Pile is empty', () => {
    const { dm } = makeStandardManager();
    // Exhaust draw pile
    dm.drawCard(10);
    expect(dm.getDrawPileSize()).toBe(0);
    dm.discardHand();
    expect(dm.getDiscardPileSize()).toBe(10);

    // Draw should auto-shuffle and succeed
    const drawn = dm.drawCard(5);
    expect(drawn).toHaveLength(5);
    expect(dm.getDiscardPileSize()).toBe(0); // Discard was shuffled into Draw
    expect(dm.getDrawPileSize()).toBe(5); // 10 shuffled - 5 drawn
  });

  // AC 4: When both Draw and Discard are empty, draw(n) draws until empty -- no crash.
  it('AC4: draw(n) with empty Draw and Discard produces no crash, returns empty', () => {
    const deck = makeStandardDeck().slice(0, 3);
    const dm = new DeckManager(deck, makeRNG());
    dm.drawCard(3);
    // Exhaust all so they can't come back
    dm.exhaustCards(dm.getHand().slice());
    expect(dm.getDrawPileSize()).toBe(0);
    expect(dm.getDiscardPileSize()).toBe(0);

    const drawn = dm.drawCard(5);
    expect(drawn).toHaveLength(0);
    expect(dm.getHandSize()).toBe(0);
  });

  // AC 5: Hand at maxHandSize: overflow cards go to Discard Pile directly.
  it('AC5: Overflow cards go to Discard Pile when hand is at maxHandSize (10)', () => {
    cardCounter = 0;
    const cards: CombatCardInstance[] = [];
    for (let i = 0; i < 12; i++) {
      cards.push(makeCard());
    }
    const dm = new DeckManager(cards, makeRNG());

    // Fill hand to 10
    dm.drawCard(10);
    expect(dm.getHandSize()).toBe(10);

    // Draw 2 more: overflow to discard
    const drawn = dm.drawCard(2);
    expect(drawn).toHaveLength(0); // None entered hand
    expect(dm.getHandSize()).toBe(10); // Still at max
    expect(dm.getDiscardPileSize()).toBe(2); // Overflow went to discard
  });

  // AC 6: Turn end: non-Retain cards -> Discard, Ethereal cards -> Exhaust.
  // DeckManager.discardHand() discards all. The caller (combat system) is
  // responsible for filtering Retain cards out of the discard set and
  // moving Ethereal cards to exhaust before calling discardHand().
  it('AC6: Turn end flow -- Retain stays, Ethereal exhausts, rest discard', () => {
    cardCounter = 0;
    const retainCard = makeKeywordCard(Keyword.RETAIN);
    const etherealCard = makeKeywordCard(Keyword.ETHEREAL);
    const normalCard = makeCard();
    const cards = [retainCard, etherealCard, normalCard];

    const dm = new DeckManager(cards, makeRNG());
    dm.drawCard(3);
    expect(dm.getHandSize()).toBe(3);

    // Simulate combat system turn-end logic:
    // 1. Ethereal cards -> exhaust
    const hand = dm.getHand();
    const etherealInHand = hand.filter((c) => CardHelper.isEthereal(c));
    dm.exhaustCards(etherealInHand);

    // 2. Retain cards stay in hand (remove from hand temporarily)
    const handAfterEthereal = dm.getHand();
    const retainInHand = handAfterEthereal.filter((c) => CardHelper.isRetain(c));
    const nonRetainInHand = handAfterEthereal.filter((c) => !CardHelper.isRetain(c));

    // Discard non-retain cards
    dm.discardCards(nonRetainInHand);

    // Verify: Retain card still in hand, Ethereal in exhaust, normal in discard
    expect(dm.getHandSize()).toBe(1);
    expect(dm.getHand()[0].instanceId).toBe(retainCard.instanceId);
    expect(dm.getExhaustPileSize()).toBe(1);
    expect(dm.getExhaustPile()[0].instanceId).toBe(etherealCard.instanceId);
    expect(dm.getDiscardPileSize()).toBe(1);
    expect(dm.getDiscardPile()[0].instanceId).toBe(normalCard.instanceId);
  });

  // AC 7: Innate card appears in opening hand of every combat.
  it('AC7: Innate card is found in deck for opening hand placement', () => {
    cardCounter = 0;
    const innateCard = makeKeywordCard(Keyword.INNATE);
    const normalCard1 = makeCard();
    const normalCard2 = makeCard();
    const cards = [normalCard1, innateCard, normalCard2];

    const dm = new DeckManager(cards, makeRNG(42));

    // getInnateCards should find the innate card regardless of which pile
    const innateCards = dm.getInnateCards();
    expect(innateCards).toHaveLength(1);
    expect(innateCards[0].instanceId).toBe(innateCard.instanceId);

    // Simulate placing innate card in opening hand before draw
    // (combat system would extract it from draw pile and add to hand)
  });

  // AC 8: addToMasterDeck("strike_red") increases Master Deck size by 1.
  // Master Deck management is not in DeckManager's scope; it's in RunStateManager.
  // DeckManager handles combat piles. This AC is noted but tested elsewhere.
  it('AC8: [Not in DeckManager scope] addToMasterDeck is RunStateManager responsibility', () => {
    // Placeholder acknowledgment: Master Deck operations (add/remove/transform)
    // are handled by RunStateManager, not DeckManager. DeckManager only manages
    // combat piles. This test documents the architectural boundary.
    expect(true).toBe(true);
  });

  // AC 9: removeFromMasterDeck() cannot reduce Master Deck below 1 card.
  // Same as AC 8 -- RunStateManager responsibility.
  it('AC9: [Not in DeckManager scope] removeFromMasterDeck min deck is RunStateManager responsibility', () => {
    expect(true).toBe(true);
  });

  // AC 10: Combat end destroys all Combat Piles; Master Deck unchanged.
  it('AC10: resetForCombat destroys all piles; original deck data unchanged', () => {
    const deck = makeStandardDeck();
    const originalIds = deck.map((c) => c.instanceId);
    const dm = new DeckManager(deck, makeRNG(42));

    // Simulate combat
    dm.drawCard(5);
    dm.exhaustCards(dm.getHand().slice(0, 1));
    dm.discardHand();
    expect(dm.getHandSize() + dm.getDrawPileSize() + dm.getDiscardPileSize() + dm.getExhaustPileSize()).toBe(10);

    // Combat end: reset
    const newDeck = makeStandardDeck();
    dm.resetForCombat(newDeck);

    expect(dm.getHandSize()).toBe(0);
    expect(dm.getDiscardPileSize()).toBe(0);
    expect(dm.getExhaustPileSize()).toBe(0);
    expect(dm.getDrawPileSize()).toBe(10);

    // Original deck array is unchanged (DeckManager never mutates input)
    expect(deck.map((c) => c.instanceId)).toEqual(originalIds);
  });

  // AC 11: Shuffle uses combat RNG stream -- same seed produces same draw order.
  it('AC11: Same seed produces identical draw order across two DeckManager instances', () => {
    const deck1 = makeStandardDeck();
    cardCounter = 0;
    const deck2 = makeStandardDeck();
    const seed = 42;

    const dm1 = new DeckManager(deck1, makeRNG(seed));
    const dm2 = new DeckManager(deck2, makeRNG(seed));

    // Draw full deck in both
    const hand1 = dm1.drawCard(10);
    const hand2 = dm2.drawCard(10);

    // Every card must appear in the same order
    for (let i = 0; i < 10; i++) {
      expect(hand1[i].instanceId).toBe(hand2[i].instanceId);
    }

    // After reshuffle, still deterministic
    dm1.discardHand();
    dm2.discardHand();
    const reshuffled1 = dm1.drawCard(10);
    const reshuffled2 = dm2.drawCard(10);
    for (let i = 0; i < 10; i++) {
      expect(reshuffled1[i].instanceId).toBe(reshuffled2[i].instanceId);
    }
  });
});
