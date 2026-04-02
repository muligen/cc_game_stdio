// PROTOTYPE - NOT FOR PRODUCTION
// Question: Does the core card combat loop feel right?
// Date: 2026-04-02

import Phaser from 'phaser';
import { CombatScene } from './combat-scene';

const config: Phaser.Types.Core.GameConfig = {
  type: Phaser.AUTO,
  width: 1280,
  height: 720,
  parent: document.body,
  backgroundColor: '#1a1a2e',
  scene: [CombatScene],
  scale: {
    mode: Phaser.Scale.FIT,
    autoCenter: Phaser.Scale.CENTER_BOTH,
  },
};

const game = new Phaser.Game(config);
