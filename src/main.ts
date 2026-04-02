/**
 * main.ts — Phaser Game entry point.
 *
 * Implements: ADR-001 Decision 1 (Scene Management Strategy)
 * BootScene initializes plugins, then transitions to MainMenuScene.
 * All scene classes are registered here for Phaser's scene manager.
 *
 * Design doc references:
 * - docs/architecture/adr-001-core-architecture.md (Plugin Initialization Order)
 * - design/gdd/screen-flow.md (Screen Enumeration)
 */

import Phaser from 'phaser';
import { GAME_WIDTH, GAME_HEIGHT, GAME_FPS, PLUGIN_KEYS } from './config/game-config';
import { BootScene } from './scenes/boot-scene';
import { MainMenuScene } from './scenes/main-menu-scene';
import { GameRegistryPlugin } from './plugins/game-registry-plugin';
import { StateManagerPlugin } from './plugins/state-manager-plugin';

/**
 * Phaser game configuration.
 * Resolution: 1920x1080 per Combat UI GDD reference layout.
 * Physics: Arcade (lightweight, sufficient for card game).
 */
const gameConfig: Phaser.Types.Core.GameConfig = {
  type: Phaser.AUTO,
  width: GAME_WIDTH,
  height: GAME_HEIGHT,
  parent: 'game-container',
  backgroundColor: '#1a1a2e',
  scale: {
    mode: Phaser.Scale.FIT,
    autoCenter: Phaser.Scale.CENTER_BOTH,
  },
  fps: {
    target: GAME_FPS,
    forceSetTimeOut: false,
  },
  scene: [BootScene, MainMenuScene],
  plugins: {
    global: [
      {
        key: PLUGIN_KEYS.GAME_REGISTRY,
        plugin: GameRegistryPlugin,
        start: false,
        mapping: 'gameRegistry',
      },
      {
        key: PLUGIN_KEYS.STATE_MANAGER,
        plugin: StateManagerPlugin,
        start: false,
        mapping: 'stateManager',
      },
    ],
  },
};

/** Create the Phaser game instance. */
function createGame(): Phaser.Game {
  return new Phaser.Game(gameConfig);
}

// Boot the game
createGame();

export { gameConfig };
