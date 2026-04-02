/**
 * main-menu-scene.ts — Placeholder main menu scene.
 *
 * Implements: ADR-001 Decision 1 (Scene Management — MainMenuScreen)
 * Displays "Press any key to start" text. Will be fully implemented
 * in a later sprint with character selection flow.
 *
 * Design doc references:
 * - design/gdd/screen-flow.md (MAIN_MENU screen)
 */

import Phaser from 'phaser';
import { SCENE_KEYS } from '../config/game-config';
import { Logger } from '../utils/logger';

const LOG = new Logger('MainMenuScene');

/**
 * Main menu scene. Displays a title and prompt.
 * Placeholder implementation — full UI in a later sprint.
 */
export class MainMenuScene extends Phaser.Scene {
  constructor() {
    super({ key: SCENE_KEYS.MAIN_MENU });
  }

  create(): void {
    LOG.info('MainMenuScene created.');

    const { width, height } = this.cameras.main;

    // Title
    this.add.text(width / 2, height / 2 - 100, 'Card Game', {
      fontSize: '64px',
      color: '#e0e0e0',
      fontStyle: 'bold',
    }).setOrigin(0.5, 0.5);

    // Prompt
    const promptText = this.add.text(width / 2, height / 2 + 50, 'Press any key to start', {
      fontSize: '24px',
      color: '#aaaaaa',
    }).setOrigin(0.5, 0.5);

    // Pulsing animation for prompt
    this.tweens.add({
      targets: promptText,
      alpha: 0.4,
      duration: 800,
      ease: 'Sine.easeInOut',
      yoyo: true,
      repeat: -1,
    });

    // Input: any key to proceed
    this.input.keyboard?.once('keydown', () => {
      LOG.info('Key pressed. Starting new run (placeholder).');
      if (promptText) {
        promptText.setText('Starting...');
        promptText.setAlpha(1);
      }
    });

    // Input: mouse click
    this.input.once('pointerdown', () => {
      LOG.info('Pointer clicked. Starting new run (placeholder).');
      if (promptText) {
        promptText.setText('Starting...');
        promptText.setAlpha(1);
      }
    });
  }
}
