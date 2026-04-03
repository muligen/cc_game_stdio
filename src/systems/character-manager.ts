/**
 * character-manager.ts — Manages character loading and combat payload creation.
 *
 * Implements: design/gdd/character.md (Character Loading, Run Initialization)
 * Architecture: ADR-001 Decision 3 (data-driven design)
 *
 * CharacterManager is responsible for:
 * - Loading character data from the registry into a CharacterInstance
 * - Resolving starter deck card IDs into CombatCardInstance objects
 * - Constructing CombatSceneData payloads for combat initialization
 *
 * Key design decisions:
 * - Constructor injection: receives maps from GameRegistry, no singleton access
 * - instanceId format: {characterId}_{cardId}_{index} for unique identification
 * - Default values: gold=0, potionSlots from data or fallback to 3
 * - createCombatPayload includes a demo Cultist enemy until Map system exists
 * - No Phaser imports — pure TypeScript, fully testable
 */

import type { CharacterData, CharacterInstance } from '../types/character';
import type { CardData, CombatCardInstance } from '../types/card';
import type { StatusEffectData } from '../types/status-effect';
import type { CombatSceneData } from '../types/combat-scene-data';
import type { EnemyData } from '../types/enemy';
import { IntentType } from '../types/enemy';
import { Logger } from '../utils/logger';

const LOG = new Logger('CharacterManager');

/** Default potion slot count when character data omits maxPotionSlots. */
const DEFAULT_POTION_SLOTS = 3;

/**
 * CharacterManager — loads characters and creates combat payloads.
 *
 * Usage:
 *   const manager = new CharacterManager(characters, cards, statusEffectData);
 *   const instance = manager.loadCharacter('ironclad');
 *   const payload = manager.createCombatPayload('ironclad', seed);
 */
export class CharacterManager {
  /** Character data map from GameRegistry. */
  private readonly characters: Map<string, CharacterData>;

  /** Card data map from GameRegistry. */
  private readonly cards: Map<string, CardData>;

  /** Status effect definitions from GameRegistry. */
  private readonly statusEffectData: StatusEffectData[];

  /**
   * @param characters - Map of character ID -> CharacterData.
   * @param cards - Map of card ID -> CardData.
   * @param statusEffectData - Array of all status effect definitions.
   */
  constructor(
    characters: Map<string, CharacterData>,
    cards: Map<string, CardData>,
    statusEffectData: StatusEffectData[],
  ) {
    this.characters = characters;
    this.cards = cards;
    this.statusEffectData = statusEffectData;
  }

  // ---------------------------------------------------------------------------
  // Character Loading
  // ---------------------------------------------------------------------------

  /**
   * Load a character by ID, resolving the starter deck into CombatCardInstances.
   *
   * Each card in starterDeck gets a unique instanceId in the format:
   *   {characterId}_{cardId}_{index}
   * For example: ironclad_strike_red_0, ironclad_strike_red_1, ironclad_bash_0
   *
   * @param characterId - The character ID to load (e.g., "ironclad").
   * @returns CharacterInstance with resolved deck, HP, gold, and potion slots.
   * @throws Error if characterId is not found in the character map.
   * @throws Error if any starter deck card ID is not found in the card map.
   */
  loadCharacter(characterId: string): CharacterInstance {
    const characterData = this.characters.get(characterId);
    if (!characterData) {
      throw new Error(
        `CharacterManager: Character "${characterId}" not found. ` +
        `Available: ${[...this.characters.keys()].join(', ')}`,
      );
    }

    const deck = this.resolveStarterDeck(characterId, characterData.starterDeck);

    LOG.info(
      `Loaded character "${characterId}" with ${deck.length} cards, ` +
      `HP ${characterData.hp}/${characterData.maxHp}`,
    );

    return {
      data: characterData,
      currentHP: characterData.hp,
      maxHP: characterData.maxHp,
      deck,
      gold: 0,
      potionSlots: characterData.maxPotionSlots ?? DEFAULT_POTION_SLOTS,
    };
  }

  // ---------------------------------------------------------------------------
  // Combat Payload Construction
  // ---------------------------------------------------------------------------

  /**
   * Create a full CombatSceneData payload for combat initialization.
   *
   * Internally calls loadCharacter to resolve the character's deck,
   * then constructs the CombatSceneData with all required fields.
   *
   * For demo purposes (until the Map system exists), this hardcodes
   * a Cultist enemy encounter.
   *
   * @param characterId - The character ID to load.
   * @param seed - Master seed for deterministic RNG.
   * @returns CombatSceneData ready for CombatFactory.create().
   * @throws Error if characterId is not found.
   */
  createCombatPayload(characterId: string, seed: number): CombatSceneData {
    const instance = this.loadCharacter(characterId);

    // Build deck entries in { instanceId, cardId, upgraded } format
    const deck = instance.deck.map((card) => ({
      instanceId: card.instanceId,
      cardId: card.data.id,
      upgraded: card.upgraded,
    }));

    // Collect all unique card definitions from the deck
    const cardData = this.collectUniqueCardData(instance.deck);

    // Demo enemy encounter — hardcoded Cultist until Map system provides encounters
    const enemies = this.getDemoEnemyEncounter();

    LOG.info(
      `Created combat payload for "${characterId}" with seed ${seed}, ` +
      `${deck.length} deck cards, ${enemies.length} enemy(ies)`,
    );

    return {
      playerHP: instance.currentHP,
      playerMaxHP: instance.maxHP,
      baseEnergy: instance.data.energy,
      deck,
      cardData,
      statusEffectData: this.statusEffectData,
      seed,
      enemies,
    };
  }

  // ---------------------------------------------------------------------------
  // Private Helpers
  // ---------------------------------------------------------------------------

  /**
   * Resolve starter deck card IDs into CombatCardInstance objects.
   *
   * Generates unique instanceIds using the format:
   *   {characterId}_{cardId}_{index}
   * where index is a per-cardId counter for deduplication.
   *
   * @param characterId - The character ID (used in instanceId prefix).
   * @param starterDeck - Array of card IDs from CharacterData.starterDeck.
   * @returns Array of CombatCardInstance with resolved CardData.
   * @throws Error if any cardId is not found in the cards map.
   */
  private resolveStarterDeck(
    characterId: string,
    starterDeck: string[],
  ): CombatCardInstance[] {
    // Track per-cardId index for unique instanceId generation
    const cardIndexCounters = new Map<string, number>();
    const instances: CombatCardInstance[] = [];

    for (const cardId of starterDeck) {
      const cardData = this.cards.get(cardId);
      if (!cardData) {
        throw new Error(
          `CharacterManager: Card "${cardId}" not found for character ` +
          `"${characterId}" starter deck. Available: ${[...this.cards.keys()].join(', ')}`,
        );
      }

      // Get and increment the counter for this cardId
      const index = cardIndexCounters.get(cardId) ?? 0;
      cardIndexCounters.set(cardId, index + 1);

      const instanceId = `${characterId}_${cardId}_${index}`;

      instances.push({
        instanceId,
        data: cardData,
        upgraded: false,
        costOverride: null,
        timesPlayedThisCombat: 0,
        retained: false,
      });
    }

    return instances;
  }

  /**
   * Collect unique CardData objects from the deck for the cardData field.
   *
   * CombatSceneData.cardData requires all card definitions used in the deck.
   * This deduplicates by card ID so each definition appears once.
   *
   * @param deck - The resolved combat card instances.
   * @returns Array of unique CardData objects.
   */
  private collectUniqueCardData(deck: CombatCardInstance[]): CardData[] {
    const seen = new Set<string>();
    const unique: CardData[] = [];

    for (const card of deck) {
      if (!seen.has(card.data.id)) {
        seen.add(card.data.id);
        unique.push(card.data);
      }
    }

    return unique;
  }

  /**
   * Return a demo enemy encounter for testing purposes.
   *
   * Returns a minimal Cultist definition. This is a placeholder until
   * the Map system provides encounter definitions.
   *
   * @returns Array with one Cultist EnemyData.
   */
  private getDemoEnemyEncounter(): EnemyData[] {
    return [
      {
        id: 'cultist',
        name: 'Cultist',
        type: 'normal',
        hp: 50,
        act: 1,
        selectionMode: 'rotating',
        moves: [
          { moveId: 'incantation', weight: 1, maxConsecutive: 1 },
          { moveId: 'dark_strike', weight: 1 },
        ],
        firstMove: 'incantation',
        moveDefinitions: {
          incantation: {
            id: 'incantation',
            name: 'Incantation',
            intent: IntentType.BUFF,
            damage: 0,
            effects: [{ type: 'apply_status' as const, value: 6, status: 'vulnerable', duration: 3 }],
            target: 'player' as const,
          },
          dark_strike: {
            id: 'dark_strike',
            name: 'Dark Strike',
            intent: IntentType.ATTACK,
            damage: 6,
            effects: [{ type: 'deal_damage' as const, value: 6 }],
            target: 'player' as const,
            hits: 1,
          },
        },
      },
    ];
  }
}
