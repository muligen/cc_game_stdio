/**
 * game-registry-plugin.ts — Singleton Phaser plugin for read-only game content data.
 *
 * Implements: ADR-001 Decision 3 (Data-Driven Design)
 * Implements: design/gdd/data-config.md (Registry, Query API, Validation)
 *
 * The registry is the single source of truth for all loaded content.
 * It is initialized once at game startup (BootScene) and provides
 * read-only query methods. No system writes back to the registry.
 *
 * Key rules:
 * - All gameplay values come from JSON config files loaded here
 * - Query methods return typed data or null if not found
 * - Validation logs warnings for missing fields but does not prevent loading
 * - No hardcoded card names, enemy names, or relic names in game code
 */

import Phaser from 'phaser';
import type {
  CardData,
  EnemyData,
  StatusEffectData,
  RelicData,
  PotionData,
  CharacterData,
  MapConfig,
  RewardConfig,
  ShopConfig,
  UIConfig,
  AscensionData,
  EventData,
} from '../types';
import { Logger } from '../utils/logger';

const LOG = new Logger('GameRegistryPlugin');

/** Registry state machine. Per design/gdd/data-config.md States and Transitions. */
export enum RegistryState {
  UNLOADED = 'UNLOADED',
  LOADING = 'LOADING',
  READY = 'READY',
  ERROR = 'ERROR',
}

/**
 * GameRegistryPlugin — Phaser global plugin that holds all read-only game content.
 *
 * Installed during BootScene after JSON files are loaded.
 * Provides typed query methods for cards, enemies, relics, potions, etc.
 */
export class GameRegistryPlugin extends Phaser.Plugins.BasePlugin {
  private state: RegistryState = RegistryState.UNLOADED;

  // --- Typed data maps (keyed by entity ID) ---
  private cards: Map<string, CardData> = new Map();
  private enemies: Map<string, EnemyData> = new Map();
  private statusEffects: Map<string, StatusEffectData> = new Map();
  private relics: Map<string, RelicData> = new Map();
  private potions: Map<string, PotionData> = new Map();
  private characters: Map<string, CharacterData> = new Map();
  private events: Map<string, EventData> = new Map();
  private ascensionModifiers: Map<string, AscensionData> = new Map();

  // --- Config objects (single instances, not arrays) ---
  private mapConfig: MapConfig | null = null;
  private rewardConfig: RewardConfig | null = null;
  private shopConfig: ShopConfig | null = null;
  private uiConfig: UIConfig | null = null;

  constructor(pluginManager: Phaser.Plugins.PluginManager) {
    super(pluginManager);
  }

  /**
   * Install the registry with data loaded by BootScene's Phaser loader.
   * Called from BootScene.create() after all JSON files are loaded.
   */
  install(scene: Phaser.Scene): void {
    this.state = RegistryState.LOADING;
    LOG.info('Installing GameRegistryPlugin...');

    try {
      // Load data from Phaser's cache (populated by scene.load.json in BootScene)
      this.loadCardData(scene);
      this.loadEnemyData(scene);
      this.loadStatusEffectData(scene);
      this.loadRelicData(scene);
      this.loadPotionData(scene);
      this.loadCharacterData(scene);
      this.loadEventData(scene);
      this.loadAscensionData(scene);
      this.loadMapConfig(scene);
      this.loadRewardConfig(scene);
      this.loadShopConfig(scene);
      this.loadUIConfig(scene);

      this.state = RegistryState.READY;
      LOG.info(`GameRegistryPlugin ready. Cards: ${this.cards.size}, Enemies: ${this.enemies.size}, Relics: ${this.relics.size}`);
    } catch (error: unknown) {
      this.state = RegistryState.ERROR;
      LOG.error(`Failed to load registry data: ${String(error)}`);
    }
  }

  // ---------------------------------------------------------------
  // STATE QUERY
  // ---------------------------------------------------------------

  /** Get the current registry state. */
  getState(): RegistryState {
    return this.state;
  }

  /** Check if the registry is ready for queries. */
  isReady(): boolean {
    return this.state === RegistryState.READY;
  }

  // ---------------------------------------------------------------
  // CARD QUERIES
  // design/gdd/card.md — CardData schema
  // design/gdd/data-config.md — Registry query methods
  // ---------------------------------------------------------------

  /** Get a card by its unique ID. Returns undefined if not found. */
  getCard(id: string): CardData | undefined {
    return this.cards.get(id);
  }

  /** Get all cards. */
  getAllCards(): CardData[] {
    return Array.from(this.cards.values());
  }

  /** Get cards belonging to a specific character, plus universal cards (character === null). */
  getCardsByCharacter(characterId: string): CardData[] {
    return this.filterCards((card) => card.character === characterId || card.character === null);
  }

  /** Get cards filtered by rarity tier. */
  getCardsByRarity(rarity: string): CardData[] {
    return this.filterCards((card) => card.rarity === rarity);
  }

  /** Get the card pool for a specific character and rarity (excludes starter/special). */
  getCardPool(characterId: string, rarity: string): CardData[] {
    return this.filterCards(
      (card) =>
        (card.character === characterId || card.character === null) &&
        card.rarity === rarity &&
        card.rarity !== 'starter' &&
        card.rarity !== 'special',
    );
  }

  // ---------------------------------------------------------------
  // ENEMY QUERIES
  // design/gdd/enemy-ai.md — EnemyData schema
  // ---------------------------------------------------------------

  /** Get an enemy by its unique ID. */
  getEnemy(id: string): EnemyData | undefined {
    return this.enemies.get(id);
  }

  /** Get all enemies. */
  getAllEnemies(): EnemyData[] {
    return Array.from(this.enemies.values());
  }

  /** Get enemies that appear in a specific act. */
  getEnemiesByAct(act: number): EnemyData[] {
    return this.filterEnemies((enemy) => enemy.act === act);
  }

  /** Get boss enemies for a specific act. */
  getBossesByAct(act: number): EnemyData[] {
    return this.filterEnemies((enemy) => enemy.type === 'boss' && enemy.act === act);
  }

  // ---------------------------------------------------------------
  // STATUS EFFECT QUERIES
  // design/gdd/status-effect.md — StatusEffectData schema
  // ---------------------------------------------------------------

  /** Get a status effect by its unique ID. */
  getStatusEffect(id: string): StatusEffectData | undefined {
    return this.statusEffects.get(id);
  }

  /** Get all status effects. */
  getAllStatusEffects(): StatusEffectData[] {
    return Array.from(this.statusEffects.values());
  }

  // ---------------------------------------------------------------
  // RELIC QUERIES
  // design/gdd/relic.md — RelicData schema
  // ---------------------------------------------------------------

  /** Get a relic by its unique ID. */
  getRelic(id: string): RelicData | undefined {
    return this.relics.get(id);
  }

  /** Get all relics. */
  getAllRelics(): RelicData[] {
    return Array.from(this.relics.values());
  }

  /** Get relics filtered by tier. */
  getRelicsByTier(tier: string): RelicData[] {
    return this.filterRelics((relic) => relic.tier === tier);
  }

  // ---------------------------------------------------------------
  // POTION QUERIES
  // design/gdd/potion.md — PotionData schema
  // ---------------------------------------------------------------

  /** Get a potion by its unique ID. */
  getPotion(id: string): PotionData | undefined {
    return this.potions.get(id);
  }

  /** Get all potions. */
  getAllPotions(): PotionData[] {
    return Array.from(this.potions.values());
  }

  /** Get potions filtered by rarity. */
  getPotionsByRarity(rarity: string): PotionData[] {
    return this.filterPotions((potion) => potion.rarity === rarity);
  }

  // ---------------------------------------------------------------
  // CHARACTER QUERIES
  // design/gdd/character.md — CharacterData schema
  // ---------------------------------------------------------------

  /** Get a character by its unique ID. */
  getCharacter(id: string): CharacterData | undefined {
    return this.characters.get(id);
  }

  /** Get all characters. */
  getAllCharacters(): CharacterData[] {
    return Array.from(this.characters.values());
  }

  // ---------------------------------------------------------------
  // EVENT QUERIES
  // ---------------------------------------------------------------

  /** Get an event by its unique ID. */
  getEvent(id: string): EventData | undefined {
    return this.events.get(id);
  }

  /** Get events filtered by act. */
  getEventsByAct(act: number): EventData[] {
    return this.filterEvents((event) => event.act === act);
  }

  // ---------------------------------------------------------------
  // ASCENSION QUERIES
  // ---------------------------------------------------------------

  /** Get ascension modifiers for a specific level. */
  getAscensionModifiers(level: number): AscensionData[] {
    return this.filterAscension((data) => data.level === level);
  }

  // ---------------------------------------------------------------
  // CONFIG QUERIES
  // ---------------------------------------------------------------

  /** Get map generation configuration. */
  getMapConfig(): MapConfig | null {
    return this.mapConfig;
  }

  /** Get reward generation configuration. */
  getRewardConfig(): RewardConfig | null {
    return this.rewardConfig;
  }

  /** Get shop configuration. */
  getShopConfig(): ShopConfig | null {
    return this.shopConfig;
  }

  /** Get UI layout configuration. */
  getUIConfig(): UIConfig | null {
    return this.uiConfig;
  }

  // ---------------------------------------------------------------
  // PRIVATE DATA LOADERS
  // Each loader reads from Phaser's JSON cache and populates typed maps.
  // Validation follows design/gdd/data-config.md Section 4 rules.
  // ---------------------------------------------------------------

  private loadCardData(scene: Phaser.Scene): void {
    const raw = scene.cache.json.get('cards');
    if (!raw) {
      LOG.warn('cards.json not found in cache. Card registry empty.');
      return;
    }
    const items: CardData[] = Array.isArray(raw) ? raw : [];
    for (const item of items) {
      if (!item.id) {
        LOG.warn('Card missing required field: id. Skipping.');
        continue;
      }
      if (this.cards.has(item.id)) {
        LOG.warn(`Duplicate card ID: ${item.id}. Overwriting previous entry.`);
      }
      this.cards.set(item.id, item as CardData);
    }
    LOG.info(`Loaded ${this.cards.size} cards.`);
  }

  private loadEnemyData(scene: Phaser.Scene): void {
    const raw = scene.cache.json.get('enemies');
    if (!raw) {
      LOG.warn('enemies.json not found in cache. Enemy registry empty.');
      return;
    }
    const items: EnemyData[] = Array.isArray(raw) ? raw : [];
    for (const item of items) {
      if (!item.id) {
        LOG.warn('Enemy missing required field: id. Skipping.');
        continue;
      }
      if (this.enemies.has(item.id)) {
        LOG.warn(`Duplicate enemy ID: ${item.id}. Overwriting previous entry.`);
      }
      this.enemies.set(item.id, item as EnemyData);
    }
    LOG.info(`Loaded ${this.enemies.size} enemies.`);
  }

  private loadStatusEffectData(scene: Phaser.Scene): void {
    const raw = scene.cache.json.get('statusEffects');
    if (!raw) {
      LOG.warn('status-effects.json not found in cache. Status effect registry empty.');
      return;
    }
    const items: StatusEffectData[] = Array.isArray(raw) ? raw : [];
    for (const item of items) {
      if (!item.id) {
        LOG.warn('Status effect missing required field: id. Skipping.');
        continue;
      }
      if (this.statusEffects.has(item.id)) {
        LOG.warn(`Duplicate status effect ID: ${item.id}. Overwriting previous entry.`);
      }
      this.statusEffects.set(item.id, item as StatusEffectData);
    }
    LOG.info(`Loaded ${this.statusEffects.size} status effects.`);
  }

  private loadRelicData(scene: Phaser.Scene): void {
    const raw = scene.cache.json.get('relics');
    if (!raw) {
      LOG.warn('relics.json not found in cache. Relic registry empty.');
      return;
    }
    const items: RelicData[] = Array.isArray(raw) ? raw : [];
    for (const item of items) {
      if (!item.id) {
        LOG.warn('Relic missing required field: id. Skipping.');
        continue;
      }
      if (this.relics.has(item.id)) {
        LOG.warn(`Duplicate relic ID: ${item.id}. Overwriting previous entry.`);
      }
      this.relics.set(item.id, item as RelicData);
    }
    LOG.info(`Loaded ${this.relics.size} relics.`);
  }

  private loadPotionData(scene: Phaser.Scene): void {
    const raw = scene.cache.json.get('potions');
    if (!raw) {
      LOG.warn('potions.json not found in cache. Potion registry empty.');
      return;
    }
    const items: PotionData[] = Array.isArray(raw) ? raw : [];
    for (const item of items) {
      if (!item.id) {
        LOG.warn('Potion missing required field: id. Skipping.');
        continue;
      }
      if (this.potions.has(item.id)) {
        LOG.warn(`Duplicate potion ID: ${item.id}. Overwriting previous entry.`);
      }
      this.potions.set(item.id, item as PotionData);
    }
    LOG.info(`Loaded ${this.potions.size} potions.`);
  }

  private loadCharacterData(scene: Phaser.Scene): void {
    const raw = scene.cache.json.get('characters');
    if (!raw) {
      LOG.warn('characters.json not found in cache. Character registry empty.');
      return;
    }
    const items: CharacterData[] = Array.isArray(raw) ? raw : [];
    for (const item of items) {
      if (!item.id) {
        LOG.warn('Character missing required field: id. Skipping.');
        continue;
      }
      if (this.characters.has(item.id)) {
        LOG.warn(`Duplicate character ID: ${item.id}. Overwriting previous entry.`);
      }
      this.characters.set(item.id, item as CharacterData);
    }
    LOG.info(`Loaded ${this.characters.size} characters.`);
  }

  private loadEventData(scene: Phaser.Scene): void {
    const raw = scene.cache.json.get('events');
    if (!raw) {
      LOG.warn('events.json not found in cache. Event registry empty.');
      return;
    }
    const items: EventData[] = Array.isArray(raw) ? raw : [];
    for (const item of items) {
      if (!item.id) {
        LOG.warn('Event missing required field: id. Skipping.');
        continue;
      }
      if (this.events.has(item.id)) {
        LOG.warn(`Duplicate event ID: ${item.id}. Overwriting previous entry.`);
      }
      this.events.set(item.id, item as EventData);
    }
    LOG.info(`Loaded ${this.events.size} events.`);
  }

  private loadAscensionData(scene: Phaser.Scene): void {
    const raw = scene.cache.json.get('ascension');
    if (!raw) {
      LOG.warn('ascension.json not found in cache. Ascension registry empty.');
      return;
    }
    const items: AscensionData[] = Array.isArray(raw) ? raw : [];
    for (const item of items) {
      if (!item.id) {
        LOG.warn('Ascension modifier missing required field: id. Skipping.');
        continue;
      }
      if (this.ascensionModifiers.has(item.id)) {
        LOG.warn(`Duplicate ascension ID: ${item.id}. Overwriting previous entry.`);
      }
      this.ascensionModifiers.set(item.id, item as AscensionData);
    }
    LOG.info(`Loaded ${this.ascensionModifiers.size} ascension modifiers.`);
  }

  private loadMapConfig(scene: Phaser.Scene): void {
    const raw = scene.cache.json.get('mapConfig');
    if (raw) {
      this.mapConfig = raw as MapConfig;
      LOG.info('Map config loaded.');
    } else {
      LOG.warn('map-config.json not found in cache.');
    }
  }

  private loadRewardConfig(scene: Phaser.Scene): void {
    const raw = scene.cache.json.get('rewardConfig');
    if (raw) {
      this.rewardConfig = raw as RewardConfig;
      LOG.info('Reward config loaded.');
    } else {
      LOG.warn('reward-config.json not found in cache.');
    }
  }

  private loadShopConfig(scene: Phaser.Scene): void {
    const raw = scene.cache.json.get('shopConfig');
    if (raw) {
      this.shopConfig = raw as ShopConfig;
      LOG.info('Shop config loaded.');
    } else {
      LOG.warn('shop-config.json not found in cache.');
    }
  }

  private loadUIConfig(scene: Phaser.Scene): void {
    const raw = scene.cache.json.get('uiConfig');
    if (raw) {
      this.uiConfig = raw as UIConfig;
      LOG.info('UI config loaded.');
    } else {
      LOG.warn('ui-config.json not found in cache.');
    }
  }

  // ---------------------------------------------------------------
  // PRIVATE FILTER HELPERS
  // Avoids code duplication in query methods.
  // ---------------------------------------------------------------

  private filterCards(predicate: (card: CardData) => boolean): CardData[] {
    const result: CardData[] = [];
    for (const card of this.cards.values()) {
      if (predicate(card)) {
        result.push(card);
      }
    }
    return result;
  }

  private filterEnemies(predicate: (enemy: EnemyData) => boolean): EnemyData[] {
    const result: EnemyData[] = [];
    for (const enemy of this.enemies.values()) {
      if (predicate(enemy)) {
        result.push(enemy);
      }
    }
    return result;
  }

  private filterRelics(predicate: (relic: RelicData) => boolean): RelicData[] {
    const result: RelicData[] = [];
    for (const relic of this.relics.values()) {
      if (predicate(relic)) {
        result.push(relic);
      }
    }
    return result;
  }

  private filterPotions(predicate: (potion: PotionData) => boolean): PotionData[] {
    const result: PotionData[] = [];
    for (const potion of this.potions.values()) {
      if (predicate(potion)) {
        result.push(potion);
      }
    }
    return result;
  }

  private filterEvents(predicate: (event: EventData) => boolean): EventData[] {
    const result: EventData[] = [];
    for (const event of this.events.values()) {
      if (predicate(event)) {
        result.push(event);
      }
    }
    return result;
  }

  private filterAscension(predicate: (data: AscensionData) => boolean): AscensionData[] {
    const result: AscensionData[] = [];
    for (const data of this.ascensionModifiers.values()) {
      if (predicate(data)) {
        result.push(data);
      }
    }
    return result;
  }
}
