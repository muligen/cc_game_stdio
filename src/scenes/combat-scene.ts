/**
 * combat-scene.ts — Phaser scene for combat encounters.
 *
 * Implements: ADR-001 Decision 1 (scene plugin pattern), ADR-004 (two-bus design)
 * Architecture: CombatScene owns the combat lifecycle, delegates to CombatController.
 *
 * Lifecycle:
 * 1. Scene started with CombatSceneData via scene.start('CombatScene', data)
 * 2. create() calls CombatFactory.create() to assemble all subsystems
 * 3. create() calls combatController.startCombat() to initialize combat state
 * 4. update() drives combat logic (future: animations and input)
 * 5. shutdown() cleans up combat-scoped resources
 *
 * Design doc references:
 * - docs/architecture/adr-001-core-architecture.md (Scene Management)
 * - docs/architecture/adr-004-event-bus-pub-sub.md (Two-Bus Scope)
 * - design/gdd/combat.md (Combat States, Turn Flow)
 */

import Phaser from 'phaser';
import { SCENE_KEYS } from '../config/game-config';
import { CombatFactory, type CombatSystems } from '../systems/combat-factory';
import type { CombatSceneData } from '../types/combat-scene-data';
import type { CombatController } from '../systems/combat-controller';
import type { GameEventBus } from '../systems/game-event-bus';
import { Logger } from '../utils/logger';

const LOG = new Logger('CombatScene');

/**
 * CombatScene — Phaser scene for combat encounters.
 *
 * This scene manages the full combat lifecycle using the CombatController
 * and combat-scoped GameEventBus. No Phaser rendering logic here (logic only).
 * UI rendering will be handled by separate UI layers in future sprints.
 */
export class CombatScene extends Phaser.Scene {
  /** Combat subsystems bundle (created in create(), cleaned in shutdown()). */
  private systems: CombatSystems | null = null;

  constructor() {
    super({ key: SCENE_KEYS.COMBAT });
  }

  // ---------------------------------------------------------------------------
  // Phaser Lifecycle
  // ---------------------------------------------------------------------------

  /**
   * Initialize combat systems from scene data.
   *
   * Called by Phaser when this scene starts. The scene data must contain
   * a valid CombatSceneData payload with player info, deck, and seed.
   *
   * Per ADR-001: CombatController is a plain TS class, not a Phaser plugin.
   * Per ADR-004: combat-scoped GameEventBus is created here and destroyed
   * in shutdown().
   */
  create(data: CombatSceneData): void {
    LOG.info('CombatScene create() — assembling combat systems...');

    // Validate scene data
    if (!data || typeof data.seed !== 'number') {
      LOG.error('Invalid CombatSceneData received. Missing or invalid seed.');
      return;
    }

    // Assemble all combat subsystems via factory
    this.systems = CombatFactory.create(data);
    LOG.info('Combat systems assembled.');

    // Initialize combat state
    this.systems.combatController.startCombat(
      data.playerHP,
      data.playerMaxHP,
      data.baseEnergy,
    );
    LOG.info(
      `Combat initialized. Player HP: ${data.playerHP}/${data.playerMaxHP}, ` +
      `Energy: ${data.baseEnergy}`,
    );
  }

  /**
   * Phaser update loop.
   *
   * Currently no per-frame logic (combat is turn-based, not real-time).
   * Future: drive card animations, damage numbers, enemy intent displays.
   */
  update(_time: number, _delta: number): void {
    // Turn-based combat — no per-frame logic needed yet.
  }

  /**
   * Clean up combat resources when scene is shut down.
   *
   * Per ADR-004: combat-scoped GameEventBus must be destroyed to prevent
   * memory leaks and stale event handlers.
   */
  shutdown(): void {
    LOG.info('CombatScene shutdown() — cleaning up combat systems.');
    this.systems = null;
  }

  // ---------------------------------------------------------------------------
  // Public Accessors
  // ---------------------------------------------------------------------------

  /**
   * Get the CombatController for this combat.
   * Returns null if combat is not initialized.
   */
  getCombatController(): CombatController | null {
    return this.systems?.combatController ?? null;
  }

  /**
   * Get the combat-scoped GameEventBus.
   * Returns null if combat is not initialized.
   */
  getCombatEventBus(): GameEventBus | null {
    return this.systems?.eventBus ?? null;
  }

  /**
   * Get the full combat systems bundle.
   * Returns null if combat is not initialized.
   */
  getSystems(): CombatSystems | null {
    return this.systems;
  }
}
