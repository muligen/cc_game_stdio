/**
 * combat-scene.ts — Phaser scene for combat encounters with full rendering.
 *
 * Implements: ADR-001 Decision 1 (scene plugin pattern), ADR-004 (two-bus design)
 * Architecture: CombatScene owns the combat lifecycle, delegates to CombatController.
 *
 * Lifecycle:
 * 1. Scene started with CombatSceneData via scene.start('CombatScene', data)
 * 2. create() calls CombatFactory.create() then initCombat() to spawn enemies + draw hand
 * 3. Creates UI state, input controller, turn flow controller, layout calculators
 * 4. Renders combat UI (cards, enemies, HP, energy, end turn button)
 * 5. On victory: generates rewards and transitions to RewardScene
 * 6. On defeat: transitions back to MainMenuScene
 * 7. shutdown() cleans up combat-scoped resources
 *
 * Design doc references:
 * - docs/architecture/adr-001-core-architecture.md (Scene Management)
 * - docs/architecture/adr-004-event-bus-pub-sub.md (Two-Bus Scope)
 * - design/gdd/combat.md (Combat States, Turn Flow)
 */

import Phaser from 'phaser';
import { SCENE_KEYS, PLUGIN_KEYS } from '../config/game-config';
import { CombatFactory, type CombatSystems } from '../systems/combat-factory';
import { RewardManager } from '../systems/reward-manager';
import type { CombatSceneData } from '../types/combat-scene-data';
import type { CombatController } from '../systems/combat-controller';
import type { GameEventBus } from '../systems/game-event-bus';
import { GameRegistryPlugin } from '../plugins/game-registry-plugin';
import { CombatUIState } from './combat/combat-ui-state';
import type { CombatUISnapshot, UIEnemyState } from './combat/combat-ui-state';
import { CombatInputController } from './combat/combat-input';
import { TurnFlowController } from './combat/turn-flow-controller';
import { CardHandDisplay, type CardUIState } from './combat/card-hand-display';
import { EnemyDisplay } from './combat/enemy-display';
import { CombatHudLayout } from './combat/combat-hud-layout';
import { Logger } from '../utils/logger';
import { resolveCardDescription } from '../utils/card-description';

const LOG = new Logger('CombatScene');

// ---------------------------------------------------------------------------
// CombatScene
// ---------------------------------------------------------------------------

/**
 * CombatScene — Phaser scene for combat encounters with rendering.
 *
 * Wires together CombatController (logic), CombatUIState (read model),
 * TurnFlowController (input coordination), and layout calculators.
 * Creates Phaser GameObjects from layout results and feeds player input
 * back through the turn flow controller.
 */
export class CombatScene extends Phaser.Scene {
  /** Combat subsystems bundle (created in create(), cleaned in shutdown()). */
  private systems: CombatSystems | null = null;
  /** The scene data passed when this scene was started. */
  private sceneData: CombatSceneData | null = null;

  // UI subsystems
  private uiState: CombatUIState | null = null;
  private inputCtrl: CombatInputController | null = null;
  private turnFlow: TurnFlowController | null = null;
  private cardLayout: CardHandDisplay | null = null;
  private enemyLayout: EnemyDisplay | null = null;
  private hudLayout: CombatHudLayout | null = null;

  // Phaser display containers
  private cardContainers: Phaser.GameObjects.Container[] = [];
  private enemyContainers: Phaser.GameObjects.Container[] = [];
  private hudGroup: Phaser.GameObjects.Group | null = null;

  /** Card layout positions for manual hit-testing (avoids setInteractive lifecycle issues). */
  private cardHitAreas: { x: number; y: number; w: number; h: number; index: number }[] = [];

  /** Enemy layout positions for manual hit-testing. */
  private enemyHitAreas: { x: number; y: number; w: number; h: number; index: number }[] = [];

  /** End turn button hit area for manual hit-testing. */
  private endTurnHitArea: { x: number; y: number; w: number; h: number } | null = null;

  /** Prevents rerender during Phaser input processing (avoids hitAreaCallback crash). */
  private rerenderScheduled = false;

  constructor() {
    super({ key: SCENE_KEYS.COMBAT });
  }

  // ---------------------------------------------------------------------------
  // Phaser Lifecycle
  // ---------------------------------------------------------------------------

  create(data: CombatSceneData): void {
    LOG.info('CombatScene create() — assembling combat systems...');

    if (!data || typeof data.seed !== 'number') {
      LOG.error('Invalid CombatSceneData received.');
      return;
    }

    this.sceneData = data;

    // Assemble all combat subsystems via factory
    this.systems = CombatFactory.create(data);

    // IMPORTANT: Subscribe to events BEFORE initCombat fires them.
    // If we subscribe after, we miss onPlayerTurnStart/onCombatInit/etc.
    this.setupUISubsystemsPreCombat(data);
    this.setupEventListeners();

    // Initialize combat with enemies and opening hand.
    // This fires onCombatInit, onPlayerTurnStart, enemy intent events, etc.
    // UI state will capture them because we subscribed above.
    this.systems.combatController.initCombat(
      data.playerHP,
      data.playerMaxHP,
      data.baseEnergy,
      { enemies: data.enemies },
    );

    // Register spawned enemies in UI state (after initCombat creates them)
    this.registerEnemiesInUIState();

    LOG.info(
      `Combat initialized. HP: ${data.playerHP}/${data.playerMaxHP}, ` +
      `Energy: ${data.baseEnergy}, Enemies: ${data.enemies?.length ?? 0}`,
    );

    // Initial render
    this.rerender();

    // Scene-level pointer handlers for manual hit-testing.
    // Avoids setInteractive lifecycle issues (hitAreaCallback crash during rerender).
    this.input.on('pointermove', (pointer: Phaser.Input.Pointer) => {
      this.handlePointerMove(pointer);
    });
    this.input.on('pointerdown', (pointer: Phaser.Input.Pointer) => {
      this.handlePointerDown(pointer);
    });
  }

  shutdown(): void {
    LOG.info('CombatScene shutdown() — cleaning up.');
    if (this.uiState) {
      this.uiState.destroy();
    }
    this.systems = null;
    this.sceneData = null;
    this.uiState = null;
    this.inputCtrl = null;
    this.turnFlow = null;
  }

  // ---------------------------------------------------------------------------
  // UI Subsystem Setup (split into pre-combat and post-combat phases)
  // ---------------------------------------------------------------------------

  /**
   * Set up UI subsystems BEFORE initCombat fires events.
   * This ensures CombatUIState captures onPlayerTurnStart etc.
   */
  private setupUISubsystemsPreCombat(data: CombatSceneData): void {
    if (!this.systems) return;

    const { width, height } = this.cameras.main;

    // UI state projection — initialized with scene data (pre-combat values)
    this.uiState = new CombatUIState(this.systems.eventBus, {
      playerHP: data.playerHP,
      playerMaxHP: data.playerMaxHP,
      playerBlock: 0,
      currentEnergy: data.baseEnergy,
      effectiveMaxEnergy: data.baseEnergy,
    });

    // Subscribe BEFORE initCombat fires events
    this.uiState.subscribe();

    // Input controller
    this.inputCtrl = new CombatInputController();

    // Turn flow controller
    this.turnFlow = new TurnFlowController({
      combatController: this.systems.combatController,
      inputController: this.inputCtrl,
      eventBus: this.systems.eventBus,
    });

    // Layout calculators
    this.cardLayout = new CardHandDisplay({ screenWidth: width, screenHeight: height });
    this.enemyLayout = new EnemyDisplay({ screenWidth: width, screenHeight: height });
    this.hudLayout = new CombatHudLayout({ screenWidth: width, screenHeight: height });
  }

  /**
   * Register spawned enemies in UI state AFTER initCombat creates them.
   * initCombat spawns enemies as part of combat initialization, so we
   * can only read them after it returns.
   */
  private registerEnemiesInUIState(): void {
    if (!this.systems || !this.uiState) return;

    const combatState = this.systems.combatController.getState();
    for (const enemy of combatState.enemies) {
      // Build intent from currentMove (already set by initCombat).
      // This is needed because onIntentSelected fired before enemies were
      // registered, so the UI state missed it.
      const intent = this.buildIntentFromMove(enemy);
      this.uiState.addEnemy(enemy.instanceId, enemy.data.name, enemy.currentHP, enemy.maxHP, intent);
    }
  }

  /**
   * Build UIIntentData from an enemy's currentMove.
   * Mirrors CombatController.emitIntentDisplay() logic but without emitting events.
   */
  private buildIntentFromMove(enemy: { instanceId: string; currentMove: { intent?: string | null; damage?: number; block?: number; effects: { type: string; value: number; status?: string }[] } | null }): import('./combat/combat-ui-state').UIIntentData | null {
    const move = enemy.currentMove;
    if (!move) return null;

    let displayDamage = 0;
    let blockAmount = 0;
    let effectName: string | null = null;

    for (const effect of move.effects) {
      if (effect.type === 'deal_damage') {
        displayDamage += effect.value;
      } else if (effect.type === 'gain_block') {
        blockAmount += effect.value;
      } else if (effect.type === 'apply_status' && effect.status) {
        effectName = effect.status;
      }
    }

    if (move.damage && displayDamage === 0) displayDamage = move.damage;
    if (move.block && blockAmount === 0) blockAmount = move.block;

    return {
      intentType: move.intent ?? (displayDamage > 0 ? 'attack' : blockAmount > 0 ? 'defend' : null),
      displayDamage,
      blockAmount,
      effectName,
    };
  }

  private setupEventListeners(): void {
    if (!this.systems) return;

    // Re-render on any combat event that changes state
    const rerenderEvents = [
      'onHPChanged', 'onEnergyChanged', 'onBlockGained', 'onEnemyDeath',
      'onPlayerTurnStart', 'onPlayerTurnEnd', 'onEnemyTurnEnd',
      'onCardPlayed', 'onIntentSelected', 'onStatusApplied',
    ];

    for (const event of rerenderEvents) {
      this.systems.eventBus.on(event as never, () => {
        this.rerender();
      });
    }

    // Combat end
    this.systems.eventBus.on('onCombatEnd', (payload) => {
      const result = (payload as { result: string }).result;
      this.rerender(); // final render to show result

      this.time.delayedCall(1000, () => {
        if (result === 'victory') {
          this.handleVictory();
        } else {
          this.handleDefeat();
        }
      });
    });
  }

  // ---------------------------------------------------------------------------
  // Rendering
  // ---------------------------------------------------------------------------

  /**
   * Schedule a deferred rerender (next Phaser tick).
   * Prevents destroying interactive objects while Phaser input is processing them.
   * Call this instead of doRerender() from any event handler or callback.
   */
  private rerender(): void {
    if (this.rerenderScheduled) return;
    this.rerenderScheduled = true;
    this.time.delayedCall(0, () => {
      this.rerenderScheduled = false;
      this.doRerender();
    });
  }

  /** Actual rerender implementation — called via deferred rerender(). */
  private doRerender(): void {
    if (!this.uiState || !this.cardLayout || !this.enemyLayout || !this.hudLayout) return;

    const snapshot = this.uiState.getSnapshot();
    // Read phase directly from CombatController (not from UI state which may miss init events)
    const phase = this.systems?.combatController.getPhase() ?? 'player_turn';
    const combatResult = this.systems?.combatController.getState().result ?? null;

    // Clear previous frame
    this.clearDisplay();

    // Render HUD (HP bar, energy, end turn button)
    this.renderHUD(snapshot, phase, combatResult);

    // Render enemies
    this.renderEnemies(snapshot);

    // Render cards in hand
    this.renderCards(snapshot, phase);
  }

  private clearDisplay(): void {
    for (const c of this.cardContainers) { c.destroy(); }
    this.cardContainers = [];
    for (const c of this.enemyContainers) { c.destroy(); }
    this.enemyContainers = [];
    if (this.hudGroup) { this.hudGroup.destroy(true); }
    this.hudGroup = null;

    // Clear manual hit areas (repulated by renderCards/renderEnemies/renderHUD)
    this.cardHitAreas = [];
    this.enemyHitAreas = [];
    this.endTurnHitArea = null;
  }

  // ---------------------------------------------------------------------------
  // HUD Rendering
  // ---------------------------------------------------------------------------

  private renderHUD(snapshot: CombatUISnapshot, phase: string, combatResult: string | null): void {
    if (!this.hudLayout) return;

    const layout = this.hudLayout.calculateLayout({
      currentHP: snapshot.playerHP,
      maxHP: snapshot.playerMaxHP,
      block: snapshot.playerBlock,
      enemyCount: snapshot.enemies.length,
    });

    this.hudGroup = this.add.group();

    // Turn indicator — use phase directly from CombatController
    const isPlayerTurn = phase === 'player_turn';
    const isEnemyTurn = phase === 'enemy_turn';
    const turnText = combatResult === 'victory' ? 'Victory!'
      : combatResult === 'defeat' ? 'Defeat...'
      : isPlayerTurn ? `Your Turn (${snapshot.turnNumber})`
      : isEnemyTurn ? 'Enemy Turn' : `Starting...`;

    const turnColor = isPlayerTurn ? '#44ff44' : isEnemyTurn ? '#ff4444' : '#ffffff';

    this.hudGroup.add(
      this.add.text(layout.turnIndicator.x, layout.turnIndicator.y, turnText, {
        fontSize: '22px', color: turnColor, fontStyle: 'bold',
      }).setOrigin(0.5),
    );

    // Player HP bar — use origin(0,0) matching layout's top-left coords
    const hp = layout.playerHPBar;
    const hpPct = snapshot.playerHP / snapshot.playerMaxHP;
    const hpColor = hpPct > 0.5 ? 0x44cc44 : hpPct > 0.25 ? 0xcccc44 : 0xcc4444;
    const hpFillWidth = Math.max(1, hpPct * hp.maxWidth);
    // HP text centered above bar
    const hpTextY = hp.y - hp.height / 2 - 8;

    this.hudGroup.add(this.add.rectangle(hp.x, hp.y, hp.maxWidth, hp.height, 0x333333));
    this.hudGroup.add(this.add.rectangle(hp.x, hp.y, hpFillWidth, hp.height, hpColor));
    this.hudGroup.add(
      this.add.text(hp.x + hp.maxWidth / 2, hpTextY, `${snapshot.playerHP}/${snapshot.playerMaxHP}`, {
        fontSize: '14px', color: '#ffffff',
      }).setOrigin(0.5),
    );

    // Block display
    if (snapshot.playerBlock > 0) {
      this.hudGroup.add(
        this.add.text(hp.x + hp.maxWidth + 10, hp.y, `Block: ${snapshot.playerBlock}`, {
          fontSize: '14px', color: '#4488ff',
        }).setOrigin(0, 0.5),
      );
    }

    // Energy orb
    const energy = layout.energyOrb;
    this.hudGroup.add(this.add.circle(energy.x, energy.y, 30, 0x4488ff).setStrokeStyle(3, 0xffffff));
    this.hudGroup.add(
      this.add.text(energy.x, energy.y, `${snapshot.currentEnergy}`, {
        fontSize: '24px', color: '#ffffff', fontStyle: 'bold',
      }).setOrigin(0.5),
    );

    // End turn button — only during player turn
    if (isPlayerTurn) {
      const btn = layout.endTurnButton;
      // Layout gives top-left corner; use origin(0,0)
      const btnBg = this.add.rectangle(btn.x, btn.y, btn.width, btn.height, 0x884422)
        .setStrokeStyle(2, 0xcc8844)
        .setOrigin(0, 0);
      // No setInteractive — manual hit-testing via endTurnHitArea

      const btnText = this.add.text(
        btn.x + btn.width / 2, btn.y + btn.height / 2,
        'End Turn', { fontSize: '18px', color: '#ffffff', fontStyle: 'bold' },
      ).setOrigin(0.5);

      this.endTurnHitArea = { x: btn.x, y: btn.y, w: btn.width, h: btn.height };

      this.hudGroup.add(btnBg);
      this.hudGroup.add(btnText);
    }
  }

  // ---------------------------------------------------------------------------
  // Enemy Rendering
  // ---------------------------------------------------------------------------

  private renderEnemies(snapshot: CombatUISnapshot): void {
    if (!this.enemyLayout) return;

    const isTargeting = this.inputCtrl?.getPhase() === 'card_selected';
    const targetedIdx = this.inputCtrl?.getState().targetedEnemyIndex ?? null;

    const layouts = this.enemyLayout.calculateLayout(
      snapshot.enemies as UIEnemyState[],
      null,
      targetedIdx,
      isTargeting,
    );

    for (const eLayout of layouts) {
      if (!eLayout.isAlive) continue;

      // Container at panel position (topMargin=200, so body area is ~200-420)
      const container = this.add.container(eLayout.x, eLayout.y);

      // Enemy body (colored rectangle) — centered vertically in panel
      const bodyCenterY = eLayout.height / 2;
      const body = this.add.rectangle(0, bodyCenterY, eLayout.width, eLayout.height, 0x883333)
        .setStrokeStyle(2, eLayout.isTargeted ? 0xffff00 : 0xaa6666);

      // Enemy name above body
      const name = this.add.text(0, bodyCenterY - eLayout.height * 0.5 - 15, eLayout.enemy.name, {
        fontSize: '16px', color: '#ffffff', fontStyle: 'bold',
      }).setOrigin(0.5);

      // HP bar — convert absolute coords to container-relative
      const hpRelX = eLayout.hpBar.x - eLayout.x;
      const hpRelY = eLayout.hpBar.y - eLayout.y;
      const hpBar = this.add.rectangle(hpRelX, hpRelY, eLayout.hpBar.maxWidth, eLayout.hpBar.height, 0x333333);
      const hpFill = this.add.rectangle(hpRelX, hpRelY, eLayout.hpBar.filledWidth, eLayout.hpBar.height,
        this.getHPColor(eLayout.enemy.currentHP, eLayout.enemy.maxHP));
      const hpText = this.add.text(hpRelX + eLayout.hpBar.maxWidth / 2, hpRelY,
        `${eLayout.enemy.currentHP}/${eLayout.enemy.maxHP}`, {
          fontSize: '12px', color: '#ffffff',
        }).setOrigin(0.5);

      // Block display
      let blockText: Phaser.GameObjects.Text | null = null;
      if (eLayout.enemy.block > 0) {
        blockText = this.add.text(0, bodyCenterY + eLayout.height * 0.1, `Block: ${eLayout.enemy.block}`, {
          fontSize: '12px', color: '#4488ff',
        }).setOrigin(0.5);
      }

      // Intent display above enemy
      let intentText: Phaser.GameObjects.Text | null = null;
      if (eLayout.intent.visible && eLayout.intent.data) {
        const intent = eLayout.intent.data;
        const intentLabel = intent.intentType === 'attack'
          ? `ATK ${intent.displayDamage}`
          : intent.intentType === 'defend'
            ? `DEF ${intent.blockAmount}`
            : intent.intentType ?? '???';
        const intentColor = intent.intentType === 'attack' ? '#ff6644'
          : intent.intentType === 'defend' ? '#4488ff' : '#aaaaaa';
        intentText = this.add.text(0, bodyCenterY - eLayout.height * 0.5 - 35, intentLabel, {
          fontSize: '14px', color: intentColor, fontStyle: 'bold',
        }).setOrigin(0.5);
      }

      const children: Phaser.GameObjects.GameObject[] = [body, name, hpBar, hpFill, hpText];
      if (blockText) children.push(blockText);
      if (intentText) children.push(intentText);

      container.add(children);

      // Store hit area for manual pointer testing (no setInteractive)
      if (isTargeting) {
        this.enemyHitAreas.push({
          x: eLayout.x - eLayout.width / 2,
          y: eLayout.y - 20 - eLayout.height / 2,
          w: eLayout.width,
          h: eLayout.height + 40, // extra height for name + intent text
          index: eLayout.index,
        });
      }

      this.enemyContainers.push(container);
    }
  }

  // ---------------------------------------------------------------------------
  // Card Rendering
  // ---------------------------------------------------------------------------

  private renderCards(snapshot: CombatUISnapshot, phase: string): void {
    if (!this.cardLayout || !this.systems) return;

    const hand = this.systems.deckManager.getHand();
    const hoveredIdx = this.inputCtrl?.getState().hoveredCardIndex ?? null;
    const selectedIdx = this.inputCtrl?.getState().selectedCardIndex ?? null;
    const isPlayerTurn = phase === 'player_turn';

    // Build CardUIState array from hand
    const cardStates: CardUIState[] = hand.map(card => ({
      instanceId: card.instanceId,
      cardId: card.data.id,
      name: card.data.name,
      type: card.data.type,
      cost: card.data.cost,
      description: resolveCardDescription(card.data.description, card.data.effects, card.upgraded),
      upgraded: card.upgraded,
    }));

    const layouts = this.cardLayout.calculateLayout(
      cardStates,
      hoveredIdx,
      selectedIdx,
      snapshot.currentEnergy,
      phase,
    );

    for (const cardLayout of layouts) {
      const container = this.add.container(cardLayout.x, cardLayout.y);

      // Card background
      const bg = this.add.rectangle(0, 0, cardLayout.width, cardLayout.height, cardLayout.color)
        .setStrokeStyle(
          cardLayout.isSelected ? 3 : cardLayout.isHovered ? 2 : 1,
          cardLayout.isSelected ? 0xffff00 : cardLayout.isHovered ? 0xffffff : 0x888888,
        );

      if (!cardLayout.isPlayable || !isPlayerTurn) {
        bg.setAlpha(0.5);
      }

      // Energy cost
      const costColor = cardLayout.isPlayable && isPlayerTurn ? '#44ddff' : '#666666';
      const cost = this.add.text(-cardLayout.width * 0.35, -cardLayout.height * 0.38,
        `${cardLayout.card.cost}`, {
          fontSize: '16px', color: costColor, fontStyle: 'bold',
        }).setOrigin(0.5);

      // Card name
      const nameText = this.add.text(0, -cardLayout.height * 0.2, cardLayout.card.name, {
        fontSize: '13px', color: '#ffffff', fontStyle: 'bold',
      }).setOrigin(0.5);

      // Card description (truncated for space)
      const desc = cardLayout.card.description.length > 30
        ? cardLayout.card.description.substring(0, 28) + '...'
        : cardLayout.card.description;
      const descText = this.add.text(0, cardLayout.height * 0.1, desc, {
        fontSize: '10px', color: '#cccccc',
        wordWrap: { width: cardLayout.width - 12 },
      }).setOrigin(0.5);

      container.add([bg, cost, nameText, descText]);
      container.setSize(cardLayout.width, cardLayout.height);

      // Store hit area for manual pointer testing (no setInteractive to avoid lifecycle bugs)
      if (cardLayout.isPlayable && isPlayerTurn) {
        this.cardHitAreas.push({
          x: cardLayout.x - cardLayout.width / 2,
          y: cardLayout.y - cardLayout.height / 2,
          w: cardLayout.width,
          h: cardLayout.height,
          index: cardLayout.index,
        });
      }

      this.cardContainers.push(container);
    }
  }

  // ---------------------------------------------------------------------------
  // Input Handlers
  // ---------------------------------------------------------------------------

  private onCardClick(index: number, card: CardUIState, isPlayable: boolean): void {
    if (!this.turnFlow || !this.systems || !isPlayable) return;

    const snapshot = this.uiState?.getSnapshot();
    if (!snapshot) return;

    const handCards = this.systems.deckManager.getHand();
    const handCard = handCards[index];
    if (!handCard) return;

    const result = this.turnFlow.trySelectCard({
      cardIndex: index,
      cardInstanceId: card.instanceId,
      cardCost: card.cost,
      currentEnergy: snapshot.currentEnergy,
      needsTarget: handCard.data.targets === 'enemy',
      isPlayable,
      card: handCard,
    });

    if (result.needsTarget) {
      // Wait for enemy click — re-render to show targeting mode
      this.rerender();
    } else if (result.success) {
      // Card resolved immediately, input state goes back to idle
      this.rerender();
    }
  }

  private onEnemyClick(index: number): void {
    if (!this.turnFlow || !this.systems) return;

    const combatState = this.systems.combatController.getState();
    const aliveEnemies = combatState.enemies.filter(e => e.isAlive);
    const enemy = aliveEnemies[index];

    if (!enemy) return;

    const result = this.turnFlow.tryTargetEnemy({
      enemyIndex: index,
      totalAlive: aliveEnemies.length,
      enemy,
    });

    if (result.success) {
      this.rerender();
    }
  }

  private onEndTurn(): void {
    if (!this.turnFlow) return;

    const result = this.turnFlow.tryEndTurn();
    if (result.success) {
      this.rerender();

      // After enemy turn resolves, check if combat continues
      this.time.delayedCall(500, () => {
        if (this.turnFlow && !this.turnFlow.isCombatOver()) {
          this.turnFlow.executePlayerTurnStart();
          this.rerender();
        }
      });
    }
  }

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  private getHPColor(current: number, max: number): number {
    const pct = current / max;
    if (pct > 0.5) return 0x44cc44;
    if (pct > 0.25) return 0xcccc44;
    return 0xcc4444;
  }

  // ---------------------------------------------------------------------------
  // Combat End Handlers
  // ---------------------------------------------------------------------------

  private handleVictory(): void {
    LOG.info('Combat victory! Generating rewards...');

    if (!this.systems || !this.sceneData) return;

    const combatState = this.systems.combatController.getState();
    this.registry.set('playerHP', combatState.playerHP);

    const rewardData = this.generateRewardData();

    LOG.info(`Rewards: ${rewardData.goldReward} gold, ${rewardData.cardRewards.length} cards`);

    this.scene.start(SCENE_KEYS.REWARD, rewardData);
  }

  private handleDefeat(): void {
    LOG.info('Combat defeat. Returning to main menu.');
    this.scene.start(SCENE_KEYS.MAIN_MENU);
  }

  private generateRewardData(): { cardRewards: unknown[]; goldReward: number; potionDropped: boolean } {
    const registry = this.getRegistry();
    if (!registry) {
      return { cardRewards: [], goldReward: 0, potionDropped: false };
    }

    const cardMap = new Map(registry.getAllCards().map(c => [c.id, c]));
    const potionMap = new Map(registry.getAllPotions().map(p => [p.id, p]));
    const rewardManager = new RewardManager(cardMap, potionMap);

    const characterId = (this.registry.get('characterId') as string) ?? 'ironclad';
    const seed = this.sceneData?.seed ?? Date.now();

    let rewardState = seed;
    const rewardRng = {
      nextInt(min: number, max: number): number {
        rewardState = (rewardState * 1664525 + 1013904223) & 0x7fffffff;
        return min + (rewardState % (max - min + 1));
      },
      nextFloat(): number {
        rewardState = (rewardState * 1664525 + 1013904223) & 0x7fffffff;
        return rewardState / 0x7fffffff;
      },
    };

    const result = rewardManager.generateRewards(characterId, 'normal', rewardRng);
    return { cardRewards: result.cardRewards, goldReward: result.gold, potionDropped: result.potionDropped };
  }

  private getRegistry(): GameRegistryPlugin | null {
    const plugin = this.plugins.get(PLUGIN_KEYS.GAME_REGISTRY);
    if (!plugin) return null;
    const registry = plugin as unknown as GameRegistryPlugin;
    return registry.isReady() ? registry : null;
  }

  // ---------------------------------------------------------------------------
  // Public Accessors (for testing)
  // ---------------------------------------------------------------------------

  getCombatController(): CombatController | null {
    return this.systems?.combatController ?? null;
  }

  getCombatEventBus(): GameEventBus | null {
    return this.systems?.eventBus ?? null;
  }

  getSystems(): CombatSystems | null {
    return this.systems;
  }

  // ---------------------------------------------------------------------------
  // Manual Pointer Handling (avoids setInteractive lifecycle bugs)
  // ---------------------------------------------------------------------------

  /** Check if pointer is inside a rectangle. */
  private hitTestRect(px: number, py: number, area: { x: number; y: number; w: number; h: number }): boolean {
    return px >= area.x && px <= area.x + area.w && py >= area.y && py <= area.y + area.h;
  }

  /** Find first matching hit area. */
  private hitTestAreas<T extends { x: number; y: number; w: number; h: number }>(
    px: number, py: number, areas: T[],
  ): T | null {
    // Test in reverse (top-most rendered = last in array)
    for (let i = areas.length - 1; i >= 0; i--) {
      if (this.hitTestRect(px, py, areas[i])) return areas[i];
    }
    return null;
  }

  /** Scene-level pointer move handler. Updates cursor and hover state. */
  private handlePointerMove(pointer: Phaser.Input.Pointer): void {
    if (!this.systems) return;
    const phase = this.systems.combatController.getPhase();
    if (phase !== 'player_turn') {
      this.input.manager.setDefaultCursor('default');
      return;
    }

    const px = pointer.x;
    const py = pointer.y;

    // Check cards
    const card = this.hitTestAreas(px, py, this.cardHitAreas);
    if (card) {
      this.input.manager.setDefaultCursor('pointer');
      this.inputCtrl?.hoverCard(card.index);
      return;
    }

    // Check enemies (targeting mode)
    const targeting = this.inputCtrl?.getPhase() === 'card_selected';
    if (targeting) {
      const enemy = this.hitTestAreas(px, py, this.enemyHitAreas);
      if (enemy) {
        this.input.manager.setDefaultCursor('pointer');
        return;
      }
    }

    // Check end turn button
    if (this.endTurnHitArea && this.hitTestRect(px, py, this.endTurnHitArea)) {
      this.input.manager.setDefaultCursor('pointer');
      return;
    }

    this.input.manager.setDefaultCursor('default');
    this.inputCtrl?.hoverCard(null);
  }

  /** Scene-level pointer down handler. Manual hit-testing for all interactive elements. */
  private handlePointerDown(pointer: Phaser.Input.Pointer): void {
    if (!this.systems) return;
    const phase = this.systems.combatController.getPhase();
    if (phase !== 'player_turn') return;

    const px = pointer.x;
    const py = pointer.y;

    // Check cards first
    const card = this.hitTestAreas(px, py, this.cardHitAreas);
    if (card) {
      const hand = this.systems.deckManager.getHand();
      const handCard = hand[card.index];
      if (handCard) {
        const cardUIState: CardUIState = {
          instanceId: handCard.instanceId,
          cardId: handCard.data.id,
          name: handCard.data.name,
          type: handCard.data.type,
          cost: handCard.data.cost,
          description: '',
          upgraded: handCard.upgraded,
        };
        this.onCardClick(card.index, cardUIState, true);
      }
      return;
    }

    // Check enemies (for targeting)
    const targeting = this.inputCtrl?.getPhase() === 'card_selected';
    if (targeting) {
      const enemy = this.hitTestAreas(px, py, this.enemyHitAreas);
      if (enemy) {
        this.onEnemyClick(enemy.index);
        return;
      }
    }

    // Check end turn button
    if (this.endTurnHitArea && this.hitTestRect(px, py, this.endTurnHitArea)) {
      this.onEndTurn();
      return;
    }
  }
}
