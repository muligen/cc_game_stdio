/**
 * game-config.ts — Central game configuration constants.
 *
 * All gameplay values here are structural defaults for the engine configuration.
 * Tunable gameplay values live in JSON data files (design/gdd/data-config.md).
 *
 * Design doc references:
 * - design/gdd/combat-ui.md (1920x1080 reference layout)
 * - design/gdd/combat.md (handSize, maxHandSize)
 * - design/gdd/energy.md (baseEnergy)
 * - docs/architecture/adr-001-core-architecture.md (plugin keys, scene keys)
 */

// --- Resolution ---
/** Game width in pixels. Reference: Combat UI GDD layout at 1920x1080. */
export const GAME_WIDTH = 1920;

/** Game height in pixels. Reference: Combat UI GDD layout at 1920x1080. */
export const GAME_HEIGHT = 1080;

// --- Performance ---
/** Target frames per second. 60fps for smooth card animations. */
export const GAME_FPS = 60;

// --- Plugin Keys ---
/** Plugin identifier keys used to install and retrieve Phaser plugins. */
export const PLUGIN_KEYS = {
  GAME_REGISTRY: 'GameRegistryPlugin',
  STATE_MANAGER: 'StateManagerPlugin',
} as const;

/** Plugin identifier type. */
export type PluginKey = (typeof PLUGIN_KEYS)[keyof typeof PLUGIN_KEYS];

// --- Scene Keys ---
/** Scene identifier keys for Phaser's scene manager. */
export const SCENE_KEYS = {
  BOOT: 'BootScene',
  MAIN_MENU: 'MainMenuScene',
  CHARACTER_SELECT: 'CharacterSelectScene',
  MAP: 'MapScene',
  COMBAT: 'CombatScene',
  REWARD: 'RewardScene',
  SHOP: 'ShopScene',
  REST_SITE: 'RestSiteScene',
  EVENT: 'EventScene',
  BOSS_TREASURE: 'BossTreasureScene',
  DEATH: 'DeathScene',
  VICTORY: 'VictoryScene',
} as const;

/** Scene key type. */
export type SceneKey = (typeof SCENE_KEYS)[keyof typeof SCENE_KEYS];

// --- Data File Paths ---
/** Paths to JSON data files loaded during BootScene. */
export const DATA_PATHS = {
  CARDS: 'assets/data/cards.json',
  ENEMIES: 'assets/data/enemies.json',
  RELICS: 'assets/data/relics.json',
  POTIONS: 'assets/data/potions.json',
  EVENTS: 'assets/data/events.json',
  CHARACTERS: 'assets/data/characters.json',
  ASCENSION: 'assets/data/ascension.json',
  STATUS_EFFECTS: 'assets/data/status-effects.json',
  REWARD_CONFIG: 'assets/data/reward-config.json',
  MAP_CONFIG: 'assets/data/map-config.json',
  SHOP_CONFIG: 'assets/data/shop-config.json',
  UI_CONFIG: 'assets/data/ui-config.json',
} as const;

/** Data path type. */
export type DataPath = (typeof DATA_PATHS)[keyof typeof DATA_PATHS];

// --- Gameplay Defaults ---
/**
 * These values serve as fallbacks when JSON data is not yet available.
 * They are NOT the source of truth — JSON config files are.
 * Design doc: design/gdd/card.md (handSize, maxHandSize)
 */
export const DEFAULT_HAND_SIZE = 5;
export const DEFAULT_MAX_HAND_SIZE = 10;
export const DEFAULT_BASE_ENERGY = 3;
export const DEFAULT_STARTING_GOLD = 0;
export const DEFAULT_MIN_DECK_SIZE = 1;
export const DEFAULT_MAX_POTION_SLOTS = 3;
export const DEFAULT_FLOORS_PER_ACT = 15;
