/**
 * main-menu-scene.ts — Main menu scene with combat launch flow.
 *
 * Implements: ADR-001 Decision 1 (Scene Management — MainMenuScreen)
 * Implements: ADR-001 Decision 3 (Data-Driven Design — Approach B: scene-layer Map construction)
 *
 * On create(), this scene:
 * 1. Retrieves GameRegistryPlugin from Phaser plugin manager
 * 2. Reads entity arrays from the registry (getAllCards, getAllCharacters, getAllStatusEffects)
 * 3. Builds Map<string, T> instances at the scene layer (Approach B — no registry modification)
 * 4. Constructs CharacterManager with those Maps
 * 5. Waits for player input, then creates CombatSceneData and transitions to CombatScene
 *
 * Design doc references:
 * - design/gdd/screen-flow.md (MAIN_MENU screen)
 * - design/gdd/character.md (Character Loading, Run Initialization)
 */

import Phaser from 'phaser';
import { SCENE_KEYS, PLUGIN_KEYS } from '../config/game-config';
import { GameRegistryPlugin } from '../plugins/game-registry-plugin';
import { CharacterManager } from '../systems/character-manager';
import type { CharacterData } from '../types/character';
import type { CardData } from '../types/card';
import type { StatusEffectData } from '../types/status-effect';
import { GameRNG } from '../utils/rng';
import { Logger } from '../utils/logger';

const LOG = new Logger('MainMenuScene');

/** Default character ID when no character selection screen exists yet. */
const DEFAULT_CHARACTER_ID = 'ironclad';

/**
 * MainMenuScene — displays title and starts a new run on player input.
 *
 * Constructs CharacterManager from GameRegistryPlugin data using Approach B:
 * arrays are read from the registry and Maps are built in this scene layer.
 * This keeps GameRegistryPlugin unchanged while providing Map-based access
 * to CharacterManager.
 */
export class MainMenuScene extends Phaser.Scene {
  /** Character manager built from registry data. Lazy-initialized in create(). */
  private characterManager: CharacterManager | null = null;

  constructor() {
    super({ key: SCENE_KEYS.MAIN_MENU });
  }

  create(): void {
    LOG.info('MainMenuScene created.');

    // Step 1: Retrieve GameRegistryPlugin
    const registry = this.getRegistry();

    // Step 2: Build Maps from registry arrays (Approach B)
    this.characterManager = this.buildCharacterManager(registry);

    // Step 3: Render UI
    this.renderMenu();

    // Step 4: Wire input handlers
    this.setupInputHandlers();
  }

  // ---------------------------------------------------------------------------
  // Public Accessors (for testing and external scene access)
  // ---------------------------------------------------------------------------

  /**
   * Get the CharacterManager instance. Returns null if create() has not run.
   */
  getCharacterManager(): CharacterManager | null {
    return this.characterManager;
  }

  // ---------------------------------------------------------------------------
  // Registry Integration (Approach B: scene-layer Map construction)
  // ---------------------------------------------------------------------------

  /**
   * Retrieve the GameRegistryPlugin from Phaser's plugin manager.
   *
   * The registry is installed during BootScene.create() and is ready
   * by the time MainMenuScene starts. Throws if registry is not found
   * or not in READY state.
   */
  private getRegistry(): GameRegistryPlugin {
    const plugin = this.plugins.get(PLUGIN_KEYS.GAME_REGISTRY);
    if (!plugin) {
      throw new Error(
        'MainMenuScene: GameRegistryPlugin not found. ' +
        'Ensure BootScene installs it before transitioning to MainMenuScene.'
      );
    }

    const registry = plugin as unknown as GameRegistryPlugin;

    if (!registry.isReady()) {
      throw new Error(
        'MainMenuScene: GameRegistryPlugin is not in READY state. ' +
        'Data loading may have failed during BootScene.'
      );
    }

    return registry;
  }

  /**
   * Build a CharacterManager from GameRegistryPlugin data.
   *
   * Approach B: Read arrays from the registry, construct Maps at the scene layer.
   * This avoids modifying GameRegistryPlugin while providing Map-based access
   * to CharacterManager, which requires Map<string, T> in its constructor.
   *
   * Data flow:
   *   GameRegistryPlugin.getAllCharacters() -> CharacterData[]
   *   GameRegistryPlugin.getAllCards()      -> CardData[]
   *   GameRegistryPlugin.getAllStatusEffects() -> StatusEffectData[]
   *
   * Then: new Map(arr.map(item => [item.id, item])) for characters and cards.
   *
   * @param registry - The initialized GameRegistryPlugin instance.
   * @returns CharacterManager wired with registry data.
   */
  buildCharacterManager(registry: GameRegistryPlugin): CharacterManager {
    // Read arrays from registry
    const charsArray = registry.getAllCharacters();
    const cardsArray = registry.getAllCards();
    const statusEffects = registry.getAllStatusEffects();

    LOG.info(
      `Building CharacterManager from registry: ` +
      `${charsArray.length} characters, ${cardsArray.length} cards, ` +
      `${statusEffects.length} status effects`
    );

    // Build Maps at scene layer (Approach B)
    const charMap = new Map<string, CharacterData>(charsArray.map(c => [c.id, c]));
    const cardMap = new Map<string, CardData>(cardsArray.map(c => [c.id, c]));

    // CharacterManager constructor: (characters Map, cards Map, statusEffects array)
    return new CharacterManager(charMap, cardMap, statusEffects);
  }

  // ---------------------------------------------------------------------------
  // Run Initialization
  // ---------------------------------------------------------------------------

  /**
   * Start a new combat run with the default character.
   *
   * Generates a master seed, creates CombatSceneData via CharacterManager,
   * and transitions to CombatScene.
   *
   * @param characterId - The character to play. Defaults to 'ironclad'.
   */
  startNewRun(characterId: string = DEFAULT_CHARACTER_ID): void {
    if (!this.characterManager) {
      LOG.error('Cannot start run: CharacterManager not initialized.');
      return;
    }

    // Generate a deterministic master seed for this run
    const seed = GameRNG.generateSeed();
    LOG.info(`Starting new run: character=${characterId}, seed=${seed}`);

    try {
      const combatData = this.characterManager.createCombatPayload(characterId, seed);
      LOG.info(
        `Combat payload created. Player HP: ${combatData.playerHP}/${combatData.playerMaxHP}, ` +
        `Deck: ${combatData.deck.length} cards, Enemies: ${combatData.enemies?.length ?? 0}`
      );

      // Transition to CombatScene with the payload
      this.scene.start(SCENE_KEYS.COMBAT, combatData);
    } catch (error: unknown) {
      LOG.error(`Failed to start run: ${String(error)}`);
    }
  }

  // ---------------------------------------------------------------------------
  // UI Rendering
  // ---------------------------------------------------------------------------

  /**
   * Render the main menu UI elements.
   * Placeholder visual implementation — full UI in a later sprint.
   */
  private renderMenu(): void {
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
  }

  // ---------------------------------------------------------------------------
  // Input Handling
  // ---------------------------------------------------------------------------

  /**
   * Set up keyboard and pointer input handlers to start a new run.
   */
  private setupInputHandlers(): void {
    // Input: any key to start
    this.input.keyboard?.once('keydown', () => {
      LOG.info('Key pressed. Starting new run.');
      this.startNewRun();
    });

    // Input: mouse click to start
    this.input.once('pointerdown', () => {
      LOG.info('Pointer clicked. Starting new run.');
      this.startNewRun();
    });
  }
}
