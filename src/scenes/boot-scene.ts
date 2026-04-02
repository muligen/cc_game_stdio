/**
 * boot-scene.ts — Preload scene that initializes all data and plugins.
 *
 * Implements: ADR-001 Decision 3 (Data-Driven Design) + Plugin Initialization Order
 * 1. Load all JSON data files via Phaser loader
 * 2. Install GameRegistryPlugin with loaded data
 * 3. Install StateManagerPlugin (empty RunState)
 * 4. Transition to MainMenuScene
 *
 * Design doc references:
 * - docs/architecture/adr-001-core-architecture.md (Plugin Initialization Order)
 * - design/gdd/data-config.md (Data Format, loading states)
 */

import Phaser from 'phaser';
import { DATA_PATHS, SCENE_KEYS, PLUGIN_KEYS } from '../config/game-config';
import { Logger } from '../utils/logger';

const LOG = new Logger('BootScene');

/**
 * Boot scene responsible for loading all JSON data files and initializing
 * the GameRegistryPlugin and StateManagerPlugin before any gameplay scene starts.
 */
export class BootScene extends Phaser.Scene {
  constructor() {
    super({ key: SCENE_KEYS.BOOT });
  }

  preload(): void {
    LOG.info('Loading game data files...');

    // Display loading progress
    const progressBar = this.add.graphics();
    const progressBox = this.add.graphics();
    progressBox.fillStyle(0x222222, 0.8);
    progressBox.fillRect(
      this.cameras.main.width / 2 - 160,
      this.cameras.main.height / 2 - 25,
      320,
      50,
    );

    const width = this.cameras.main.width;
    const height = this.cameras.main.height;
    const loadingText = this.add.text(width / 2, height / 2 - 50, 'Loading...', {
      fontSize: '20px',
      color: '#ffffff',
    });
    loadingText.setOrigin(0.5, 0.5);

    const percentText = this.add.text(width / 2, height / 2, '0%', {
      fontSize: '18px',
      color: '#ffffff',
    });
    percentText.setOrigin(0.5, 0.5);

    this.load.on('progress', (value: number) => {
      percentText.setText(`${Math.round(value * 100)}%`);
      progressBar.clear();
      progressBar.fillStyle(0x00ff00, 1);
      progressBar.fillRect(
        width / 2 - 150,
        height / 2 - 15,
        300 * value,
        30,
      );
    });

    this.load.on('complete', () => {
      progressBar.destroy();
      progressBox.destroy();
      loadingText.destroy();
      percentText.destroy();
    });

    // Load all JSON data files per ADR-001 Decision 3
    this.load.json('cards', DATA_PATHS.CARDS);
    this.load.json('enemies', DATA_PATHS.ENEMIES);
    this.load.json('relics', DATA_PATHS.RELICS);
    this.load.json('potions', DATA_PATHS.POTIONS);
    this.load.json('events', DATA_PATHS.EVENTS);
    this.load.json('characters', DATA_PATHS.CHARACTERS);
    this.load.json('ascension', DATA_PATHS.ASCENSION);
    this.load.json('statusEffects', DATA_PATHS.STATUS_EFFECTS);
    this.load.json('rewardConfig', DATA_PATHS.REWARD_CONFIG);
    this.load.json('mapConfig', DATA_PATHS.MAP_CONFIG);
    this.load.json('shopConfig', DATA_PATHS.SHOP_CONFIG);
    this.load.json('uiConfig', DATA_PATHS.UI_CONFIG);
  }

  create(): void {
    LOG.info('Data loaded. Initializing plugins...');

    // Step 1: Install GameRegistryPlugin with loaded data
    // Per ADR-001 Plugin Initialization Order:
    //   GameRegistryPlugin first (data ready for queries),
    //   then StateManagerPlugin (empty state, ready for new run).
    const registryPlugin = this.plugins.get(PLUGIN_KEYS.GAME_REGISTRY) as unknown as
      | { install: (scene: Phaser.Scene) => void }
      | null;

    if (registryPlugin && typeof registryPlugin.install === 'function') {
      registryPlugin.install(this);
      LOG.info('GameRegistryPlugin installed.');
    } else {
      LOG.warn('GameRegistryPlugin not found — data queries will return empty results.');
    }

    // Step 2: Install StateManagerPlugin (empty RunState)
    const statePlugin = this.plugins.get(PLUGIN_KEYS.STATE_MANAGER) as unknown as
      | { install: (scene: Phaser.Scene) => void }
      | null;

    if (statePlugin && typeof statePlugin.install === 'function') {
      statePlugin.install(this);
      LOG.info('StateManagerPlugin installed.');
    } else {
      LOG.warn('StateManagerPlugin not found — state management unavailable.');
    }

    // Step 3: Transition to MainMenuScene
    LOG.info('Boot complete. Transitioning to MainMenuScene.');
    this.scene.start(SCENE_KEYS.MAIN_MENU);
  }
}
