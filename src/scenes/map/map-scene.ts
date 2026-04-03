/**
 * map-scene.ts -- Thin Phaser Scene shell for the minimal map screen.
 *
 * Implements: design/gdd/map-ui.md (Minimal Map Spec, S3-14)
 * Architecture: ADR-001 (scene delegates to MapState + MapLayoutCalculator)
 *
 * The scene is a thin shell: all logic lives in MapState, all layout math
 * in MapLayoutCalculator. The scene only creates Phaser GameObjects from
 * layout results, forwards clicks to MapState, and triggers scene transitions.
 *
 * Demo flow:
 *   1. create() initializes MapState with 3 combat nodes
 *   2. Player clicks a node -> handleNodeClick() -> transitions to CombatScene
 *   3. After combat + reward, the flow controller calls onCombatComplete()
 *   4. onCombatComplete() marks node completed, unlocks next, rerenders
 *   5. When all nodes are done, onMapComplete() callback fires
 *
 * Key design decisions:
 * - Callbacks injected via setCallbacks() (no scene coupling)
 * - CharacterManager received via Phaser registry for combat payload creation
 * - Placeholder art: circles + text for nodes, lines connecting them
 * - HP/Gold display at bottom using Phaser registry data
 */

import Phaser from 'phaser';
import { SCENE_KEYS, PLUGIN_KEYS } from '../../config/game-config';
import { GameRegistryPlugin } from '../../plugins/game-registry-plugin';
import { CharacterManager } from '../../systems/character-manager';
import type { CharacterData } from '../../types/character';
import type { CardData } from '../../types/card';
import type { CombatSceneData } from '../../types/combat-scene-data';
import { GameRNG } from '../../utils/rng';
import { Logger } from '../../utils/logger';
import { MapState } from './map-state';
import { MapLayoutCalculator, type MapNodeLayout } from './map-layout';
import type { MapNodeState } from './map-node';

const LOG = new Logger('MapScene');

/** Default character ID for the demo. */
const DEFAULT_CHARACTER_ID = 'ironclad';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * Callbacks for MapScene to communicate with the scene flow controller.
 * Injected via setCallbacks() before the scene starts or in create().
 */
export interface MapSceneCallbacks {
  /** Called when the player selects a combat node. */
  onStartCombat: (payload: CombatSceneData) => void;
  /** Called when all nodes are completed. */
  onMapComplete: () => void;
}

// ---------------------------------------------------------------------------
// MapScene
// ---------------------------------------------------------------------------

/**
 * MapScene -- thin Phaser Scene for the minimal map screen.
 *
 * Displays 3 combat nodes in a vertical line. Player clicks a node
 * to enter combat. After combat + reward, the flow controller calls
 * onCombatComplete() to advance the map state.
 *
 * Usage (from scene flow controller):
 *   this.scene.start('MapScene');
 *   // After combat + reward:
 *   const mapScene = this.scene.get('MapScene') as MapScene;
 *   mapScene.onCombatComplete();
 */
export class MapScene extends Phaser.Scene {
  /** Map state manager (pure logic). */
  private mapState!: MapState;
  /** Layout calculator (pure math). */
  private layoutCalc!: MapLayoutCalculator;
  /** Callbacks for scene transitions. */
  private callbacks?: MapSceneCallbacks;
  /** Character manager for creating combat payloads. */
  private characterManager: CharacterManager | null = null;
  /** Phaser containers for each node (for re-rendering). */
  private nodeContainers: Phaser.GameObjects.Container[] = [];
  /** Connection line graphics between nodes. */
  private connectionLines: Phaser.GameObjects.Graphics | null = null;
  /** Node layout cache for hit testing. */
  private nodeLayouts: MapNodeLayout[] = [];

  constructor() {
    super({ key: SCENE_KEYS.MAP });
  }

  // ---------------------------------------------------------------------------
  // Public API (for scene flow controller and tests)
  // ---------------------------------------------------------------------------

  /**
   * Set callbacks for scene transitions.
   *
   * @param callbacks - Object with onStartCombat and onMapComplete callbacks.
   */
  setCallbacks(callbacks: MapSceneCallbacks): void {
    this.callbacks = callbacks;
  }

  /**
   * Get the MapState instance (for testing and external access).
   *
   * @returns The MapState managing this map's progression.
   */
  getMapState(): MapState {
    return this.mapState;
  }

  /**
   * Get the CharacterManager instance.
   *
   * @returns The CharacterManager, or null if not initialized.
   */
  getCharacterManager(): CharacterManager | null {
    return this.characterManager;
  }

  /**
   * Called after combat + reward to advance the map state.
   *
   * Marks the current node as completed, unlocks the next floor,
   * and either fires onMapComplete or rerenders the map.
   */
  onCombatComplete(): void {
    LOG.info('onCombatComplete() -- advancing map state.');
    this.mapState.completeCurrentNode();

    if (this.mapState.isMapComplete()) {
      LOG.info('Map complete! All nodes finished.');
      // Notify callback (for testing)
      if (this.callbacks) {
        this.callbacks.onMapComplete();
      }
      // Show victory message and return to main menu
      this.showMapCompleteMessage();
    } else {
      this.rerender();
    }
  }

  // ---------------------------------------------------------------------------
  // Phaser Lifecycle
  // ---------------------------------------------------------------------------

  /**
   * Called when the scene starts. Initializes map state, layout, and rendering.
   */
  create(): void {
    LOG.info('MapScene create() -- initializing minimal demo map.');

    // Step 1: Build CharacterManager from registry
    this.characterManager = this.buildCharacterManager();

    // Step 2: Create map state with 3 combat nodes (demo configuration)
    this.mapState = new MapState([
      { type: 'combat' },
      { type: 'combat' },
      { type: 'combat' },
    ]);

    // Step 3: Create layout calculator
    this.layoutCalc = new MapLayoutCalculator({
      screenWidth: this.cameras.main.width,
      screenHeight: this.cameras.main.height,
    });

    // Step 4: Restore saved map progress (if returning from combat+reward)
    const savedNodes = this.registry.get('mapNodes') as
      | { id: string; floor: number; type: string; state: MapNodeState }[]
      | undefined;
    if (savedNodes) {
      this.mapState.restoreState(savedNodes);
      this.registry.remove('mapNodes');
      // Combat was won while we were away — complete the current node
      // and unlock the next floor
      this.mapState.completeCurrentNode();
      LOG.info(`Restored map state: ${savedNodes.filter(n => n.state === 'completed').length} nodes completed.`);
    }

    // Step 5: Render
    this.rerender();
  }

  // ---------------------------------------------------------------------------
  // Registry Integration
  // ---------------------------------------------------------------------------

  /**
   * Build a CharacterManager from GameRegistryPlugin data.
   * Follows the same Approach B pattern as MainMenuScene.
   */
  private buildCharacterManager(): CharacterManager | null {
    const plugin = this.plugins.get(PLUGIN_KEYS.GAME_REGISTRY);
    if (!plugin) {
      LOG.warn('GameRegistryPlugin not found. Combat launch will be unavailable.');
      return null;
    }

    const registry = plugin as unknown as GameRegistryPlugin;
    if (!registry.isReady()) {
      LOG.warn('GameRegistryPlugin not ready. Combat launch will be unavailable.');
      return null;
    }

    const charsArray = registry.getAllCharacters();
    const cardsArray = registry.getAllCards();
    const statusEffects = registry.getAllStatusEffects();

    const charMap = new Map<string, CharacterData>(charsArray.map((c) => [c.id, c]));
    const cardMap = new Map<string, CardData>(cardsArray.map((c) => [c.id, c]));

    return new CharacterManager(charMap, cardMap, statusEffects);
  }

  // ---------------------------------------------------------------------------
  // Rendering
  // ---------------------------------------------------------------------------

  /**
   * Clear and re-render the entire map display.
   */
  private rerender(): void {
    this.clearDisplay();
    this.nodeLayouts = this.layoutCalc.calculateLayout(this.mapState.getNodes());
    this.renderConnections();
    this.renderNodes();
    this.renderStatusBar();
  }

  /**
   * Remove all existing map display objects.
   */
  private clearDisplay(): void {
    for (const container of this.nodeContainers) {
      container.destroy();
    }
    this.nodeContainers = [];
    this.nodeLayouts = [];

    if (this.connectionLines) {
      this.connectionLines.destroy();
      this.connectionLines = null;
    }
  }

  /**
   * Render connection lines between consecutive nodes.
   */
  private renderConnections(): void {
    if (this.nodeLayouts.length < 2) return;

    const graphics = this.add.graphics();

    for (let i = 0; i < this.nodeLayouts.length - 1; i++) {
      const current = this.nodeLayouts[i];
      const next = this.nodeLayouts[i + 1];

      // Determine line alpha based on node states
      const alpha = Math.min(current.alpha, next.alpha);

      graphics.lineStyle(3, 0x888888, alpha);
      graphics.beginPath();
      graphics.moveTo(current.x, current.y + current.radius);
      graphics.lineTo(next.x, next.y - next.radius);
      graphics.strokePath();
    }

    this.connectionLines = graphics;
  }

  /**
   * Render all map nodes as interactive circles with labels.
   */
  private renderNodes(): void {
    for (const layout of this.nodeLayouts) {
      const container = this.createNodeContainer(layout);
      this.nodeContainers.push(container);
    }
  }

  /**
   * Create a single node container with circle, text, and interactivity.
   */
  private createNodeContainer(layout: MapNodeLayout): Phaser.GameObjects.Container {
    const { x, y, radius, color, borderColor, alpha, label, state, nodeId } = layout;

    // Circle background
    const circle = this.add.circle(0, 0, radius, color)
      .setStrokeStyle(3, borderColor);

    // Label text
    const text = this.add.text(0, 0, label, {
      fontSize: '14px',
      color: '#ffffff',
      fontStyle: 'bold',
    }).setOrigin(0.5, 0.5);

    // Floor number below
    const floorText = this.add.text(0, radius + 12, `F${layout.nodeId.split('_')[1]}`, {
      fontSize: '11px',
      color: '#aaaaaa',
    }).setOrigin(0.5, 0.5);

    const container = this.add.container(x, y, [circle, text, floorText]);
    container.setSize(radius * 2, radius * 2);
    container.setAlpha(alpha);

    // Pulse animation for current node
    if (state === 'current') {
      this.tweens.add({
        targets: circle,
        scaleX: 1.15,
        scaleY: 1.15,
        duration: 600,
        ease: 'Sine.easeInOut',
        yoyo: true,
        repeat: -1,
      });
    }

    // Interactivity for available nodes
    if (state === 'available') {
      container.setInteractive({ useHandCursor: true });

      container.on('pointerover', () => {
        circle.setStrokeStyle(4, 0xffff88);
        container.setAlpha(1.0);
      });

      container.on('pointerout', () => {
        circle.setStrokeStyle(3, borderColor);
        container.setAlpha(alpha);
      });

      container.on('pointerdown', () => {
        this.handleNodeClick(nodeId);
      });
    }

    // Checkmark for completed nodes
    if (state === 'completed') {
      const check = this.add.text(radius * 0.4, -radius * 0.4, 'V', {
        fontSize: '16px',
        color: '#44bb44',
        fontStyle: 'bold',
      }).setOrigin(0.5, 0.5);
      container.add(check);
    }

    return container;
  }

  /**
   * Render status bar at the bottom (HP and Gold).
   */
  private renderStatusBar(): void {
    const { width, height } = this.cameras.main;

    // Get player state from registry (if available)
    const playerHP: number = (this.registry.get('playerHP') as number) ?? 80;
    const playerMaxHP: number = (this.registry.get('playerMaxHP') as number) ?? 80;
    const playerGold: number = (this.registry.get('playerGold') as number) ?? 0;

    // HP display
    this.add.text(width / 2 - 150, height - 50, `HP: ${playerHP}/${playerMaxHP}`, {
      fontSize: '20px',
      color: '#ff4444',
    }).setOrigin(0.5);

    // Gold display
    this.add.text(width / 2 + 150, height - 50, `Gold: ${playerGold}`, {
      fontSize: '20px',
      color: '#ffdd44',
    }).setOrigin(0.5);

    // Map title
    this.add.text(width / 2, 30, 'Map', {
      fontSize: '28px',
      color: '#e0e0e0',
      fontStyle: 'bold',
    }).setOrigin(0.5);
  }

  // ---------------------------------------------------------------------------
  // Interaction Handlers
  // ---------------------------------------------------------------------------

  /**
   * Handle a node click -- select the node and start combat.
   *
   * Transitions directly to CombatScene using run state from Phaser registry.
   * Falls back to callback if no registry state available (for testing).
   */
  private handleNodeClick(nodeId: string): void {
    if (!this.mapState.canSelectNode(nodeId)) {
      LOG.info(`Cannot select node ${nodeId}.`);
      return;
    }

    const node = this.mapState.selectNode(nodeId);
    if (!node) {
      LOG.error(`selectNode returned null for ${nodeId} despite canSelectNode being true.`);
      return;
    }

    LOG.info(`Selected node ${nodeId} (floor ${node.floor}, type ${node.type}).`);

    // Create combat payload and transition
    const payload = this.createCombatPayload();
    if (payload) {
      // Save map state to registry before leaving (to restore after reward)
      this.registry.set('mapNodes', this.mapState.getNodes().map(n => ({
        id: n.id,
        floor: n.floor,
        type: n.type,
        state: n.state,
      })));

      // Notify via callback first (for testing)
      if (this.callbacks) {
        this.callbacks.onStartCombat(payload);
      }
      // Transition to CombatScene directly
      this.scene.start(SCENE_KEYS.COMBAT, payload);
    } else {
      LOG.error('Failed to create combat payload. Cannot start combat.');
    }
  }

  /**
   * Create a CombatSceneData payload using current run state from Phaser registry.
   *
   * Uses registry data (HP, deck, gold) to build a payload that reflects
   * the player's current state (e.g., reduced HP from previous combats,
   * new cards added from rewards).
   *
   * @returns CombatSceneData, or null if CharacterManager is unavailable.
   */
  private createCombatPayload(): CombatSceneData | null {
    if (!this.characterManager) {
      return null;
    }

    const characterId = (this.registry.get('characterId') as string) ?? DEFAULT_CHARACTER_ID;
    const seed = GameRNG.generateSeed();

    // Get base payload from CharacterManager
    const payload = this.characterManager.createCombatPayload(characterId, seed);

    // Override with current run state from registry
    const currentHP = this.registry.get('playerHP') as number | undefined;
    const currentDeck = this.registry.get('playerDeck') as { instanceId: string; cardId: string; upgraded: boolean }[] | undefined;

    if (currentHP !== undefined) {
      payload.playerHP = currentHP;
    }

    if (currentDeck && currentDeck.length > 0) {
      payload.deck = currentDeck;

      // CRITICAL FIX: Rebuild cardData to include ALL cards in the deck,
      // not just starter cards. Reward scenes may have added new cards
      // whose CardData is missing from the starter-only cardData.
      const plugin = this.plugins.get(PLUGIN_KEYS.GAME_REGISTRY);
      if (plugin) {
        const registry = plugin as unknown as GameRegistryPlugin;
        if (registry.isReady()) {
          const allCards = registry.getAllCards();
          const cardMap = new Map<string, CardData>(allCards.map(c => [c.id, c]));
          const seen = new Set<string>();
          const uniqueCardData: CardData[] = [];
          for (const entry of currentDeck) {
            const card = cardMap.get(entry.cardId);
            if (card && !seen.has(card.id)) {
              seen.add(card.id);
              uniqueCardData.push(card);
            }
          }
          payload.cardData = uniqueCardData;
        }
      }
    }

    return payload;
  }

  /**
   * Show a map complete message and transition back to MainMenuScene.
   */
  private showMapCompleteMessage(): void {
    const { width, height } = this.cameras.main;

    // Overlay
    const overlay = this.add.rectangle(width / 2, height / 2, width, height, 0x000000, 0.7);

    // Victory text
    const text = this.add.text(width / 2, height / 2 - 30, 'Act Complete!', {
      fontSize: '48px',
      color: '#44ff44',
      fontStyle: 'bold',
    }).setOrigin(0.5, 0.5);

    const gold = (this.registry.get('playerGold') as number) ?? 0;
    const goldText = this.add.text(width / 2, height / 2 + 30, `Gold earned: ${gold}`, {
      fontSize: '24px',
      color: '#ffdd44',
    }).setOrigin(0.5, 0.5);

    // Click to return to main menu
    this.input.once('pointerdown', () => {
      overlay.destroy();
      text.destroy();
      goldText.destroy();
      this.scene.start(SCENE_KEYS.MAIN_MENU);
    });
  }
}
