/**
 * deck-manager.ts — Manages combat card piles (draw, discard, exhaust, hand).
 *
 * Implements: design/gdd/deck.md (Drawing, Discarding, Exhaust, Shuffle)
 * Architecture: ADR-001 Decision 2 (combat-scoped state)
 *
 * Manages the four card piles during combat:
 * - Draw pile: cards waiting to be drawn (shuffled at combat start)
 * - Hand: cards available to play (max 10)
 * - Discard pile: played/discarded cards (shuffled back when draw is empty)
 * - Exhaust pile: removed from play entirely (never shuffled back)
 *
 * Key design decisions:
 * - All shuffling uses the seeded combatRNG stream for determinism.
 * - Hand limit is enforced: overflow cards go directly to discard, NOT hand.
 * - Cards are tracked by instanceId for identity-correct operations.
 * - Query methods return snapshots (copies) to prevent external mutation.
 * - The DeckManager does NOT filter by keyword (e.g., Retain); the caller
 *   handles keyword-based logic before calling discardHand().
 */

import type { CombatCardInstance } from '../types/card';
import type { RNGStream } from '../utils/rng';
import { CardHelper } from './card-helper';
import { Logger } from '../utils/logger';

const LOG = new Logger('DeckManager');

/**
 * Maximum number of cards allowed in hand at once.
 * Per GDD: overflow cards go directly to discard pile.
 */
const MAX_HAND_SIZE = 10;

/**
 * DeckManager — manages combat card piles.
 *
 * Lifecycle:
 * 1. Created at combat start with the deck (converted from master deck + CardData lookup).
 * 2. Initial draw pile is shuffled using combatRNG.
 * 3. drawCard() called at turn start and by card effects.
 * 4. discardCards() / exhaustCards() called during card play resolution.
 * 5. discardHand() called at end of player turn.
 * 6. resetForCombat() called when a new combat begins.
 */
export class DeckManager {
  /** Cards waiting to be drawn. */
  private drawPile: CombatCardInstance[];

  /** Cards currently in hand. */
  private hand: CombatCardInstance[];

  /** Cards that have been played or discarded this combat. */
  private discardPile: CombatCardInstance[];

  /** Cards exhausted (removed from play) this combat. */
  private exhaustPile: CombatCardInstance[];

  /** Seeded RNG stream for shuffle operations. */
  private combatRNG: RNGStream;

  /**
   * @param cards - The deck for this combat (converted from master deck + CardData lookup).
   * @param combatRNG - The combatRNG stream for shuffle randomization.
   */
  constructor(cards: CombatCardInstance[], combatRNG: RNGStream) {
    this.combatRNG = combatRNG;
    this.hand = [];
    this.discardPile = [];
    this.exhaustPile = [];
    // Shuffle a copy of the input cards into the draw pile.
    this.drawPile = combatRNG.shuffle([...cards]);

    LOG.info(
      `Initialized with ${cards.length} cards. Draw pile shuffled (${this.drawPile.length}).`
    );
  }

  // ---------------------------------------------------------------
  // Core: Drawing
  // ---------------------------------------------------------------

  /**
   * Draw cards from the draw pile to hand.
   *
   * Per GDD rules:
   * - If draw pile has fewer cards than requested, shuffle discard pile
   *   into draw pile first, then continue drawing.
   * - Hand limit: MAX_HAND_SIZE cards max. Overflow cards go directly
   *   to discard pile (NOT hand).
   * - Drawing 0 cards is a no-op.
   *
   * @param count - Number of cards to draw. Default: 1.
   * @returns Array of cards that entered the hand (excludes overflow).
   */
  drawCard(count: number = 1): CombatCardInstance[] {
    if (count <= 0) {
      return [];
    }

    const drawnToHand: CombatCardInstance[] = [];

    for (let i = 0; i < count; i++) {
      // If draw pile is empty, shuffle discard into draw.
      if (this.drawPile.length === 0) {
        this.shuffleDiscardIntoDraw();
      }

      // If still empty after shuffle, no more cards available.
      if (this.drawPile.length === 0) {
        LOG.debug(`drawCard: No cards available after reshuffle. Drew ${drawnToHand.length} of ${count}.`);
        break;
      }

      const card = this.drawPile.pop()!;

      if (this.hand.length < MAX_HAND_SIZE) {
        this.hand.push(card);
        drawnToHand.push(card);
      } else {
        // Overflow: card goes directly to discard pile.
        this.discardPile.push(card);
        LOG.debug(`drawCard: Hand full (${MAX_HAND_SIZE}). Card ${card.instanceId} sent to discard.`);
      }
    }

    LOG.debug(`Drew ${drawnToHand.length} cards to hand. Hand size: ${this.hand.length}`);
    return drawnToHand;
  }

  // ---------------------------------------------------------------
  // Core: Discarding
  // ---------------------------------------------------------------

  /**
   * Move cards from hand to discard pile.
   *
   * Per GDD: cards not found in hand are ignored (safety).
   *
   * @param cards - Cards to discard from hand.
   */
  discardCards(cards: CombatCardInstance[]): void {
    for (const card of cards) {
      const index = this.hand.findIndex((c) => c.instanceId === card.instanceId);
      if (index !== -1) {
        const [removed] = this.hand.splice(index, 1);
        this.discardPile.push(removed);
        LOG.debug(`discardCards: Moved ${card.instanceId} to discard.`);
      }
      // Cards not in hand are silently ignored.
    }
  }

  /**
   * Discard all cards currently in hand.
   *
   * Per GDD: used at end of player turn. The DeckManager does NOT
   * filter by keyword (e.g., Retain) — the caller handles that
   * before calling this method.
   */
  discardHand(): void {
    const count = this.hand.length;
    this.discardPile.push(...this.hand);
    this.hand.length = 0;
    LOG.debug(`discardHand: Moved ${count} cards to discard.`);
  }

  // ---------------------------------------------------------------
  // Core: Exhausting
  // ---------------------------------------------------------------

  /**
   * Move cards from hand to exhaust pile.
   *
   * Per GDD: exhausted cards are removed from play entirely. They are
   * NOT placed in the discard pile and are never shuffled back.
   *
   * @param cards - Cards to exhaust from hand.
   */
  exhaustCards(cards: CombatCardInstance[]): void {
    for (const card of cards) {
      const index = this.hand.findIndex((c) => c.instanceId === card.instanceId);
      if (index !== -1) {
        const [removed] = this.hand.splice(index, 1);
        this.exhaustPile.push(removed);
        LOG.debug(`exhaustCards: Moved ${card.instanceId} to exhaust.`);
      }
      // Cards not in hand are silently ignored.
    }
  }

  // ---------------------------------------------------------------
  // Core: Shuffling
  // ---------------------------------------------------------------

  /**
   * Shuffle the discard pile and add to bottom of draw pile.
   *
   * Per GDD: uses combatRNG.shuffle() for Fisher-Yates algorithm.
   * This ensures deterministic shuffle order for replays.
   * No-op if discard pile is empty.
   */
  shuffleDiscardIntoDraw(): void {
    if (this.discardPile.length === 0) {
      LOG.debug('shuffleDiscardIntoDraw: Discard pile empty, no-op.');
      return;
    }

    const shuffled = this.combatRNG.shuffle(this.discardPile);
    this.drawPile.push(...shuffled);
    this.discardPile.length = 0;

    LOG.info(`Shuffled discard into draw. Draw pile now: ${this.drawPile.length} cards.`);
  }

  // ---------------------------------------------------------------
  // Combat Lifecycle
  // ---------------------------------------------------------------

  /**
   * Full reset for a new combat.
   *
   * Per GDD: new deck, shuffle, clear all piles.
   *
   * @param cards - The new deck for this combat.
   */
  resetForCombat(cards: CombatCardInstance[]): void {
    this.hand = [];
    this.discardPile = [];
    this.exhaustPile = [];
    this.drawPile = this.combatRNG.shuffle([...cards]);

    LOG.info(`Reset for combat with ${cards.length} cards. Draw pile shuffled.`);
  }

  // ---------------------------------------------------------------
  // Innate Cards
  // ---------------------------------------------------------------

  /**
   * Return all cards in the deck with the "innate" keyword.
   *
   * Per GDD: innate cards are guaranteed in the opening hand.
   * Called before first draw to identify which cards need special placement.
   * Checks draw pile, hand, discard pile, and exhaust pile for completeness.
   *
   * @returns Array of innate cards from all piles.
   */
  getInnateCards(): CombatCardInstance[] {
    const allCards = [
      ...this.drawPile,
      ...this.hand,
      ...this.discardPile,
      ...this.exhaustPile,
    ];
    return allCards.filter((card) => CardHelper.isInnate(card));
  }

  // ---------------------------------------------------------------
  // Opening Hand
  // ---------------------------------------------------------------

  /**
   * Draw the opening hand for combat, guaranteeing all innate cards are included.
   *
   * Per GDD: innate cards are always in the opening hand of each combat.
   * Implementation:
   * 1. Find all innate cards currently in the draw pile.
   * 2. Move them from draw pile to hand first (guaranteed placement).
   * 3. Draw remaining cards (handSize - innateCount) via normal drawCard.
   *
   * Edge cases:
   * - More innate cards than handSize: all innate cards go to hand,
   *   potentially exceeding handSize. The innate guarantee overrides the limit.
   * - No innate cards: equivalent to a normal drawCard(handSize).
   * - Innate cards already in hand/discard/exhaust: only draw pile innate
   *   cards are moved (cards in other piles are already placed or removed).
   *
   * @param handSize - Number of cards for the opening hand (default: 5).
   * @returns Array of all cards drawn to hand (innate + normally drawn).
   */
  drawOpeningHand(handSize: number = 5): CombatCardInstance[] {
    // Find innate cards in the draw pile only.
    const innateInDraw = this.drawPile.filter((card) => CardHelper.isInnate(card));

    // Move innate cards from draw pile to hand.
    for (const card of innateInDraw) {
      const index = this.drawPile.findIndex((c) => c.instanceId === card.instanceId);
      if (index !== -1) {
        this.drawPile.splice(index, 1);
        this.hand.push(card);
      }
    }

    const innateCount = innateInDraw.length;
    const remaining = Math.max(0, handSize - innateCount);

    LOG.debug(
      `drawOpeningHand: Placed ${innateCount} innate cards. Drawing ${remaining} more.`
    );

    // Draw remaining cards normally (respects hand limit).
    const drawn = this.drawCard(remaining);

    // Return the full opening hand (innate + drawn).
    return [...innateInDraw, ...drawn];
  }

  // ---------------------------------------------------------------
  // Query Methods (return snapshots)
  // ---------------------------------------------------------------

  /**
   * Get a snapshot of the draw pile.
   * Returns a copy to prevent external mutation.
   */
  getDrawPile(): ReadonlyArray<CombatCardInstance> {
    return [...this.drawPile];
  }

  /**
   * Get a snapshot of the discard pile.
   * Returns a copy to prevent external mutation.
   */
  getDiscardPile(): ReadonlyArray<CombatCardInstance> {
    return [...this.discardPile];
  }

  /**
   * Get a snapshot of the exhaust pile.
   * Returns a copy to prevent external mutation.
   */
  getExhaustPile(): ReadonlyArray<CombatCardInstance> {
    return [...this.exhaustPile];
  }

  /**
   * Get a snapshot of the hand.
   * Returns a copy to prevent external mutation.
   */
  getHand(): ReadonlyArray<CombatCardInstance> {
    return [...this.hand];
  }

  /** Number of cards in the draw pile. */
  getDrawPileSize(): number {
    return this.drawPile.length;
  }

  /** Number of cards in the discard pile. */
  getDiscardPileSize(): number {
    return this.discardPile.length;
  }

  /** Number of cards in the exhaust pile. */
  getExhaustPileSize(): number {
    return this.exhaustPile.length;
  }

  /** Number of cards in hand. */
  getHandSize(): number {
    return this.hand.length;
  }
}
