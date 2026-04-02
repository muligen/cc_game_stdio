/**
 * combat-factory.ts — Factory that creates all combat subsystem instances.
 *
 * Implements: ADR-001 Decision 2 (combat-scoped state)
 * Architecture: Factory pattern for combat subsystem assembly
 *
 * CombatFactory takes a CombatSceneData payload and produces fully-wired
 * combat subsystem instances. The scene's create() method calls
 * CombatFactory.create() and receives all systems ready for use.
 *
 * Key design decisions:
 * - Factory creates GameRNG from the seed (deterministic)
 * - Factory resolves CardData into CombatCardInstance for DeckManager
 * - Factory creates EnergySystem with baseEnergy + optional relic bonus
 * - Factory creates StatusEffectManager with statusEffectData definitions
 * - Factory creates EffectResolver with default handlers
 * - Factory creates GameEventBus for combat-scoped events
 * - Factory creates CombatController wiring all systems together
 * - startCombat() stays in the scene's create(), not here — factory
 *   only assembles objects, it does not trigger combat flow
 */

import type { CombatSceneData } from '../types/combat-scene-data';
import type { CardData, CombatCardInstance } from '../types/card';
import type { ICombatEventBus, ICombatDeckManager, ICombatEnergySystem, ICombatStatusEffectManager, ICombatEffectResolver, ICombatRNG, ICombatEnemyHelper } from './combat-controller';
import { CombatController } from './combat-controller';
import { GameRNG, type RNGStream } from '../utils/rng';
import { DeckManager } from './deck-manager';
import { EnergySystem } from './energy-system';
import { StatusEffectManager } from './status-effect-manager';
import { EffectResolver } from './effect-resolver';
import { GameEventBus } from './game-event-bus';
import { EnemyHelper } from './enemy-helper';
import { Logger } from '../utils/logger';

const LOG = new Logger('CombatFactory');

// ---------------------------------------------------------------------------
// Combat Assembled Systems
// ---------------------------------------------------------------------------

/**
 * All combat subsystems created and wired by CombatFactory.
 *
 * The scene receives this bundle and uses it to run combat.
 * Each system is fully initialized and ready for use.
 */
export interface CombatSystems {
  /** Seeded RNG for deterministic combat. */
  rng: GameRNG;
  /** Combat-scoped event bus. */
  eventBus: GameEventBus;
  /** Deck manager with shuffled draw pile. */
  deckManager: DeckManager;
  /** Energy system initialized with baseEnergy. */
  energySystem: EnergySystem;
  /** Status effect manager with loaded definitions. */
  statusEffectManager: StatusEffectManager;
  /** Effect resolver with default handlers registered. */
  effectResolver: EffectResolver;
  /** Combat controller wiring all systems together. */
  combatController: CombatController;
}

// ---------------------------------------------------------------------------
// CombatFactory
// ---------------------------------------------------------------------------

/**
 * CombatFactory — assembles all combat subsystems from CombatSceneData.
 *
 * Usage:
 *   const systems = CombatFactory.create(sceneData);
 *   systems.combatController.startCombat(sceneData.playerHP, sceneData.playerMaxHP, sceneData.baseEnergy);
 */
export class CombatFactory {
  // Private constructor — pure static factory class.
  private constructor() {
    // Not instantiable.
  }

  /**
   * Create and wire all combat subsystems from the provided scene data.
   *
   * Assembly order:
   * 1. GameRNG from seed (needed by DeckManager for shuffle)
   * 2. GameEventBus (no dependencies)
   * 3. StatusEffectManager from statusEffectData (no combat deps)
   * 4. EffectResolver with default handlers (no combat deps)
   * 5. EnergySystem from baseEnergy + relicBonus
   * 6. DeckManager from resolved card instances + combatRNG stream
   * 7. CombatController with all dependencies injected
   *
   * @param data - The combat scene initialization payload.
   * @returns Fully wired CombatSystems bundle.
   */
  static create(data: CombatSceneData): CombatSystems {
    // 1. Create seeded RNG
    const rng = new GameRNG(data.seed);
    LOG.info(`Created GameRNG with seed ${data.seed}`);

    // 2. Create combat-scoped event bus
    const eventBus = new GameEventBus();

    // 3. Create status effect manager with definitions
    const statusEffectManager = new StatusEffectManager(data.statusEffectData);
    LOG.info(`Created StatusEffectManager with ${data.statusEffectData.length} definitions`);

    // 4. Create effect resolver with default handlers
    const effectResolver = new EffectResolver();

    // 5. Create energy system
    const energySystem = new EnergySystem(data.baseEnergy, data.relicBonusEnergy ?? 0);
    LOG.info(`Created EnergySystem with baseEnergy=${data.baseEnergy}, relicBonus=${data.relicBonusEnergy ?? 0}`);

    // 6. Resolve deck: convert deck entries to CombatCardInstance
    const cardLookup = CombatFactory.buildCardLookup(data.cardData);
    const combatCards = CombatFactory.resolveDeck(data.deck, cardLookup);

    // 7. Create deck manager (shuffles draw pile internally)
    const combatRNG = rng.getStream('combatRNG');
    const deckManager = new DeckManager(combatCards, combatRNG);
    LOG.info(`Created DeckManager with ${combatCards.length} cards`);

    // 8. Create enemy helper adapter (wraps static EnemyHelper for DI)
    const enemyHelper: ICombatEnemyHelper = {
      createInstance: (data, instanceId, rngStream) =>
        EnemyHelper.createInstance(data, instanceId, rngStream as unknown as RNGStream),
      selectMove: (enemy, rngStream) =>
        EnemyHelper.selectMove(enemy, rngStream as unknown as RNGStream),
      resetBlock: (enemy) => EnemyHelper.resetBlock(enemy),
      takeDamage: (enemy, amount) => EnemyHelper.takeDamage(enemy, amount),
      gainBlock: (enemy, amount) => EnemyHelper.gainBlock(enemy, amount),
    };

    // 9. Wire combat controller with all dependencies
    const combatController = new CombatController(
      eventBus as ICombatEventBus,
      deckManager as ICombatDeckManager,
      energySystem as ICombatEnergySystem,
      statusEffectManager as ICombatStatusEffectManager,
      effectResolver as ICombatEffectResolver,
      enemyHelper,
      rng as ICombatRNG
    );

    return {
      rng,
      eventBus,
      deckManager,
      energySystem,
      statusEffectManager,
      effectResolver,
      combatController,
    };
  }

  // ---------------------------------------------------------------------------
  // Private Helpers
  // ---------------------------------------------------------------------------

  /**
   * Build a Map<string, CardData> for O(1) card lookup by ID.
   */
  private static buildCardLookup(cardData: CardData[]): Map<string, CardData> {
    const lookup = new Map<string, CardData>();
    for (const card of cardData) {
      lookup.set(card.id, card);
    }
    return lookup;
  }

  /**
   * Resolve deck entries into CombatCardInstance objects.
   *
   * Each deck entry has instanceId, cardId, and upgraded flag.
   * We look up the full CardData from the card lookup map.
   *
   * Throws if any cardId is not found in the provided cardData.
   *
   * @param deck - Array of deck entries from CombatSceneData.
   * @param cardLookup - Map of cardId -> CardData for lookup.
   * @returns Array of CombatCardInstance ready for DeckManager.
   */
  private static resolveDeck(
    deck: ReadonlyArray<{ instanceId: string; cardId: string; upgraded: boolean }>,
    cardLookup: Map<string, CardData>
  ): CombatCardInstance[] {
    const instances: CombatCardInstance[] = [];

    for (const entry of deck) {
      const data = cardLookup.get(entry.cardId);
      if (!data) {
        throw new Error(
          `CombatFactory: Card ID "${entry.cardId}" not found in cardData. ` +
          `Instance ${entry.instanceId} cannot be resolved.`
        );
      }

      instances.push({
        instanceId: entry.instanceId,
        data,
        upgraded: entry.upgraded,
        costOverride: null,
        timesPlayedThisCombat: 0,
        retained: false,
      });
    }

    return instances;
  }
}
