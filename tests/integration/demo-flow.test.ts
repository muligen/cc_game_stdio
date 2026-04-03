/**
 * demo-flow.test.ts — End-to-end integration test for the complete demo game flow.
 *
 * Wires together ALL systems for a full demo cycle:
 *   CharacterManager -> CombatFactory -> CombatController -> TurnFlowController
 *   -> RewardManager -> RewardController -> Second Combat
 *
 * Uses REAL instances of all systems (no mocks except TurnFlowController deps
 * where the real CombatController is already the backend). Reads actual JSON data
 * from assets/data/ for complete end-to-end coverage.
 *
 * Implements: Sprint 3 Task S3-12 (End-to-End Demo Flow Integration Test)
 * Design docs: design/gdd/combat.md, design/gdd/reward.md, design/gdd/character.md
 *
 * Test cases (10):
 * 1. Full combat flow: init -> player turn -> play Strike -> enemy turn -> victory
 * 2. Damage numbers track via CombatAnimationCoordinator
 * 3. UI state syncs via CombatUIState (HP/energy/block)
 * 4. Input flow: CombatInputController + TurnFlowController process card + end turn
 * 5. Layout calculations: CardHandDisplay + EnemyDisplay + CombatHudLayout
 * 6. Reward generation: RewardManager produces cards + gold
 * 7. Reward selection: RewardController tracks selected card
 * 8. Second combat with new card in deck
 * 9. Defeat scenario: player HP=1, enemy does damage -> defeat
 * 10. Complete demo loop: character -> combat -> reward -> second combat
 */

// @vitest-environment node

import { describe, it, expect, beforeEach } from 'vitest';

// --- System imports ---
import { CharacterManager } from '../../src/systems/character-manager';
import { CombatFactory } from '../../src/systems/combat-factory';
import { RewardManager } from '../../src/systems/reward-manager';
import { RewardController } from '../../src/scenes/reward/reward-controller';
import { CombatUIState, CombatUISnapshot, UITurnPhase } from '../../src/scenes/combat/combat-ui-state';
import { CombatInputController, type CardInputInfo } from '../../src/scenes/combat/combat-input';
import { TurnFlowController, type TurnFlowDeps, type CardPlayRequest } from '../../src/scenes/combat/turn-flow-controller';
import { CardHandDisplay, type CardUIState } from '../../src/scenes/combat/card-hand-display';
import { EnemyDisplay } from '../../src/scenes/combat/enemy-display';
import { CombatHudLayout, type HudLayoutParams } from '../../src/scenes/combat/combat-hud-layout';
import { CombatAnimationCoordinator } from '../../src/scenes/combat/combat-animation';
import { GameRNG } from '../../src/utils/rng';

// --- Type imports ---
import type { CardData, CombatCardInstance } from '../../src/types/card';
import type { StatusEffectData } from '../../src/types/status-effect';
import type { PotionData } from '../../src/types/potion';
import type { CombatEnemyInstance, EnemyMove } from '../../src/types/enemy';
import type { CombatSceneData } from '../../src/types/combat-scene-data';
import { TargetType, CardType } from '../../src/types/card';
import { TurnPhase } from '../../src/types/combat';

// --- JSON data ---
import charactersJson from '../../assets/data/characters.json';
import cardsJson from '../../assets/data/cards.json';
import enemiesJson from '../../assets/data/enemies.json';
import statusEffectsJson from '../../assets/data/status-effects.json';
import potionsJson from '../../assets/data/potions.json';

// ---------------------------------------------------------------------------
// Data Helpers
// ---------------------------------------------------------------------------

/** Build a Map<string, T> from an array of objects with an `id` field. */
function indexById<T extends { id: string }>(items: T[]): Map<string, T> {
  const map = new Map<string, T>();
  for (const item of items) {
    map.set(item.id, item);
  }
  return map;
}

/** Cultist enemy with full move definitions so the enemy turn actually does something. */
function getCultistWithMoves() {
  const cultistBase = enemiesJson.find((e) => e.id === 'cultist')!;
  return {
    ...cultistBase,
    firstMove: 'incantation',
    moveDefinitions: {
      incantation: {
        id: 'incantation',
        name: 'Incantation',
        intent: 'magic' as const,
        effects: [{ type: 'apply_status' as const, value: 3, status: 'strength' }],
      } as EnemyMove,
      dark_strike: {
        id: 'dark_strike',
        name: 'Dark Strike',
        intent: 'attack' as const,
        effects: [{ type: 'deal_damage' as const, value: 6 }],
        damage: 6,
      } as EnemyMove,
    },
  };
}

// ---------------------------------------------------------------------------
// Shared Fixtures
// ---------------------------------------------------------------------------

const characters = indexById(charactersJson as { id: string }[]);
const cards = indexById(cardsJson as { id: string }[]);
const statusEffectData = statusEffectsJson as unknown as StatusEffectData[];
const potions = indexById(potionsJson as { id: string }[]);

/** Fixed seed for deterministic tests. */
const TEST_SEED = 42;

// ---------------------------------------------------------------------------
// Test Helper: Create full combat systems from payload
// ---------------------------------------------------------------------------

interface CombatContext {
  systems: ReturnType<typeof CombatFactory.create>;
  uiState: CombatUIState;
  inputCtrl: CombatInputController;
  turnFlow: TurnFlowController;
  animationCoord: CombatAnimationCoordinator;
}

function createCombatContext(payload: CombatSceneData): CombatContext {
  // 1. Create combat systems from factory
  const systems = CombatFactory.create(payload);

  // 2. Create UI state sync
  const uiState = new CombatUIState(systems.eventBus, {
    playerHP: payload.playerHP,
    playerMaxHP: payload.playerMaxHP,
    playerBlock: 0,
    currentEnergy: payload.baseEnergy,
    effectiveMaxEnergy: payload.baseEnergy,
  });
  uiState.subscribe();

  // 3. Create input controller
  const inputCtrl = new CombatInputController();

  // 4. Create animation coordinator
  const animationCoord = new CombatAnimationCoordinator();

  // 5. Create turn flow controller with real systems
  const turnFlow = new TurnFlowController({
    combatController: systems.combatController,
    inputController: inputCtrl,
    eventBus: systems.eventBus,
  });

  return { systems, uiState, inputCtrl, turnFlow, animationCoord };
}

/** Register enemies in UI state after initCombat spawns them. */
function syncEnemiesToUI(uiState: CombatUIState, enemies: CombatEnemyInstance[]): void {
  for (const enemy of enemies) {
    uiState.addEnemy(enemy.instanceId, enemy.data.name, enemy.currentHP, enemy.maxHP);
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('S3-12 End-to-End Demo Flow', () => {
  let charManager: CharacterManager;

  beforeEach(() => {
    charManager = new CharacterManager(
      characters as Map<string, import('../../src/types/character').CharacterData>,
      cards as Map<string, CardData>,
      statusEffectData,
    );
  });

  // -------------------------------------------------------------------------
  // Test 1: Full combat flow
  // -------------------------------------------------------------------------
  it('1. Full combat flow: init -> play cards -> enemy turns -> victory', () => {
    // --- Character setup ---
    const payload = charManager.createCombatPayload('ironclad', TEST_SEED);
    const cultist = getCultistWithMoves();
    payload.enemies = [cultist];

    const ctx = createCombatContext(payload);

    // --- Init combat ---
    ctx.systems.combatController.initCombat(
      payload.playerHP,
      payload.playerMaxHP,
      payload.baseEnergy,
      { enemies: payload.enemies },
    );

    const state = ctx.systems.combatController.getState();
    expect(state.phase).toBe(TurnPhase.PLAYER_TURN);
    expect(state.turnNumber).toBe(1);
    expect(state.enemies.length).toBe(1);
    expect(state.enemies[0].isAlive).toBe(true);

    // Register enemies in UI
    syncEnemiesToUI(ctx.uiState, state.enemies);

    // --- Combat loop: play cards and end turns until victory or defeat ---
    const maxTurns = 50;
    for (let turn = 0; turn < maxTurns; turn++) {
      if (ctx.turnFlow.isCombatOver()) break;

      // Play all playable attack cards
      const hand = ctx.systems.deckManager.getHand();
      for (const card of [...hand]) {
        if (ctx.turnFlow.isCombatOver()) break;

        const combatState = ctx.systems.combatController.getState();
        const energy = combatState.currentEnergy;
        const cost = card.data.cost;
        const needsTarget = card.data.targets === TargetType.ENEMY;

        if (cost > energy) continue;

        if (needsTarget) {
          // Find a living enemy
          const enemy = combatState.enemies.find((e) => e.isAlive);
          if (!enemy) break;

          const result = ctx.turnFlow.trySelectCard({
            cardIndex: ctx.systems.deckManager.getHand().findIndex(
              (c) => c.instanceId === card.instanceId
            ),
            cardInstanceId: card.instanceId,
            cardCost: cost,
            currentEnergy: ctx.systems.combatController.getState().currentEnergy,
            needsTarget: true,
            isPlayable: true,
            card,
          });

          if (result.success && result.needsTarget) {
            ctx.turnFlow.tryTargetEnemy({
              enemyIndex: 0,
              totalAlive: combatState.enemies.filter((e) => e.isAlive).length,
              enemy,
            });
          }
        } else {
          // Non-targeted card (Defend, etc.)
          const currentHand = ctx.systems.deckManager.getHand();
          const idx = currentHand.findIndex((c) => c.instanceId === card.instanceId);
          if (idx === -1) continue;

          ctx.turnFlow.trySelectCard({
            cardIndex: idx,
            cardInstanceId: card.instanceId,
            cardCost: cost,
            currentEnergy: ctx.systems.combatController.getState().currentEnergy,
            needsTarget: false,
            isPlayable: true,
            card,
          });
        }

        if (ctx.turnFlow.isCombatOver()) break;
      }

      if (ctx.turnFlow.isCombatOver()) break;

      // End player turn -> enemy turn -> next player turn
      ctx.turnFlow.tryEndTurn();

      if (ctx.turnFlow.isCombatOver()) break;

      ctx.turnFlow.executePlayerTurnStart();
    }

    // --- Verify victory ---
    expect(ctx.turnFlow.isCombatOver()).toBe(true);
    expect(ctx.turnFlow.getResult()).toBe('victory');
    expect(ctx.systems.combatController.getState().result).toBe('victory');

    ctx.uiState.destroy();
  });

  // -------------------------------------------------------------------------
  // Test 2: Damage numbers track via CombatAnimationCoordinator
  // -------------------------------------------------------------------------
  it('2. CombatAnimationCoordinator queues damage animations for card plays', () => {
    const payload = charManager.createCombatPayload('ironclad', TEST_SEED);
    const cultist = getCultistWithMoves();
    payload.enemies = [cultist];

    const ctx = createCombatContext(payload);

    ctx.systems.combatController.initCombat(
      payload.playerHP, payload.playerMaxHP, payload.baseEnergy,
      { enemies: payload.enemies },
    );

    const state = ctx.systems.combatController.getState();
    const enemy = state.enemies[0];

    // Queue a damage animation for a Strike play
    ctx.animationCoord.queueDamageNumber(enemy.instanceId, 400, 120, 6, 0);

    const pending = ctx.animationCoord.getPendingAnimations();
    expect(pending.length).toBe(1);
    expect(pending[0].type).toBe('damage_number');
    expect(pending[0].value).toBe(6);
    expect(pending[0].targetId).toBe(enemy.instanceId);
    expect(pending[0].color).toBe('#FF4444');

    // Queue another with blocked damage
    ctx.animationCoord.clear();
    ctx.animationCoord.queueDamageNumber(enemy.instanceId, 400, 120, 4, 3);

    const pending2 = ctx.animationCoord.getPendingAnimations();
    expect(pending2.length).toBe(2);
    expect(pending2[0].value).toBe(4);
    expect(pending2[1].value).toBe(3);
    expect(pending2[1].color).toBe('#4488FF');

    ctx.uiState.destroy();
  });

  // -------------------------------------------------------------------------
  // Test 3: UI state syncs HP/energy/block at each step
  // -------------------------------------------------------------------------
  it('3. CombatUIState reflects correct HP/energy/block during combat', () => {
    const payload = charManager.createCombatPayload('ironclad', TEST_SEED);
    const cultist = getCultistWithMoves();
    payload.enemies = [cultist];

    const ctx = createCombatContext(payload);

    ctx.systems.combatController.initCombat(
      payload.playerHP, payload.playerMaxHP, payload.baseEnergy,
      { enemies: payload.enemies },
    );

    // Subscribe after init so we can register enemies
    syncEnemiesToUI(ctx.uiState, ctx.systems.combatController.getState().enemies);

    // After init: player should have starting HP and energy
    const snapshot0 = ctx.uiState.getSnapshot();
    expect(snapshot0.playerHP).toBe(80);
    expect(snapshot0.playerMaxHP).toBe(80);
    expect(snapshot0.playerBlock).toBe(0);
    expect(snapshot0.currentEnergy).toBe(3);

    // Play a Defend card to gain block
    const hand = ctx.systems.deckManager.getHand();
    const defend = hand.find((c) => c.data.id === 'defend_red');
    if (defend) {
      ctx.systems.combatController.playCard(defend, null);
    }

    const snapshot1 = ctx.uiState.getSnapshot();
    // Energy should decrease by 1
    expect(snapshot1.currentEnergy).toBe(2);
    // Block should be 5 from Defend
    expect(snapshot1.playerBlock).toBe(5);

    ctx.uiState.destroy();
  });

  // -------------------------------------------------------------------------
  // Test 4: Input flow works with TurnFlowController
  // -------------------------------------------------------------------------
  it('4. CombatInputController + TurnFlowController process card selection and end turn', () => {
    const payload = charManager.createCombatPayload('ironclad', TEST_SEED);
    const cultist = getCultistWithMoves();
    payload.enemies = [cultist];

    const ctx = createCombatContext(payload);

    ctx.systems.combatController.initCombat(
      payload.playerHP, payload.playerMaxHP, payload.baseEnergy,
      { enemies: payload.enemies },
    );

    // Input should start in idle
    expect(ctx.inputCtrl.getPhase()).toBe('idle');
    expect(ctx.inputCtrl.canEndTurn()).toBe(true);

    // Select a card that needs a target (Strike)
    const hand = ctx.systems.deckManager.getHand();
    const strike = hand.find((c) => c.data.id === 'strike_red');
    expect(strike).toBeDefined();

    if (strike) {
      const cardInfo: CardInputInfo = {
        instanceId: strike.instanceId,
        cost: 1,
        currentEnergy: 3,
        needsTarget: true,
        isPlayable: true,
      };

      const selectResult = ctx.inputCtrl.selectCard(0, cardInfo);
      expect(selectResult.phase).toBe('card_selected');
      expect(ctx.inputCtrl.canClickEnemy()).toBe(true);

      // Click enemy target
      const state = ctx.systems.combatController.getState();
      const clickResult = ctx.inputCtrl.clickEnemy(0, state.enemies.filter((e) => e.isAlive).length);
      expect(clickResult.phase).toBe('resolving');

      // End resolving
      ctx.inputCtrl.endResolving();
      expect(ctx.inputCtrl.getPhase()).toBe('idle');
    }

    // End turn via TurnFlowController
    const endResult = ctx.turnFlow.tryEndTurn();
    expect(endResult.success).toBe(true);

    // After end turn, input should be in enemy_turn
    expect(ctx.inputCtrl.getPhase()).toBe('enemy_turn');

    // Combat should still be going (enemy only applied strength on turn 1)
    expect(ctx.turnFlow.isCombatOver()).toBe(false);

    // Start next player turn
    ctx.turnFlow.executePlayerTurnStart();
    expect(ctx.inputCtrl.getPhase()).toBe('idle');

    ctx.uiState.destroy();
  });

  // -------------------------------------------------------------------------
  // Test 5: Layout calculations produce valid results
  // -------------------------------------------------------------------------
  it('5. CardHandDisplay + EnemyDisplay + CombatHudLayout produce valid layouts', () => {
    const SCREEN_W = 1280;
    const SCREEN_H = 720;

    // Card hand layout
    const handDisplay = new CardHandDisplay({
      screenWidth: SCREEN_W,
      screenHeight: SCREEN_H,
      cardWidth: 120,
      cardHeight: 170,
      gap: 10,
      bottomMargin: 80,
    });

    const handCards: CardUIState[] = [
      { instanceId: 'c1', cardId: 'strike_red', name: 'Strike', type: 'attack', cost: 1, description: 'Deal 6 damage.', upgraded: false },
      { instanceId: 'c2', cardId: 'defend_red', name: 'Defend', type: 'skill', cost: 1, description: 'Gain 5 Block.', upgraded: false },
      { instanceId: 'c3', cardId: 'bash', name: 'Bash', type: 'attack', cost: 2, description: 'Deal 8 damage.', upgraded: false },
      { instanceId: 'c4', cardId: 'strike_red', name: 'Strike', type: 'attack', cost: 1, description: 'Deal 6 damage.', upgraded: false },
      { instanceId: 'c5', cardId: 'defend_red', name: 'Defend', type: 'skill', cost: 1, description: 'Gain 5 Block.', upgraded: false },
    ];

    const cardLayout = handDisplay.calculateLayout(handCards, null, null, 3, 'player_turn');
    expect(cardLayout.length).toBe(5);
    // All cards should be within screen bounds
    for (const card of cardLayout) {
      expect(card.x).toBeGreaterThanOrEqual(0);
      expect(card.x + card.width).toBeLessThanOrEqual(SCREEN_W + 1); // +1 for floating point
      expect(card.y).toBeGreaterThan(0);
      expect(card.y).toBeLessThan(SCREEN_H);
    }
    // Strike should be red (attack color)
    expect(cardLayout[0].color).toBe(0xcc3333);
    // Defend should be blue (skill color)
    expect(cardLayout[1].color).toBe(0x3366cc);
    // Cards should be playable in player_turn with energy
    expect(cardLayout[0].isPlayable).toBe(true);
    expect(cardLayout[0].alpha).toBe(1.0);

    // Enemy display layout
    const enemyDisplay = new EnemyDisplay({
      screenWidth: SCREEN_W,
      screenHeight: SCREEN_H,
      panelWidth: 160,
      panelHeight: 220,
      gap: 40,
      topMargin: 80,
    });

    const uiEnemies = [
      { instanceId: 'e0', name: 'Cultist', currentHP: 50, maxHP: 50, block: 0, isAlive: true, intent: null },
    ];
    const enemyLayout = enemyDisplay.calculateLayout(uiEnemies, null, null, false);
    expect(enemyLayout.length).toBe(1);
    expect(enemyLayout[0].isAlive).toBe(true);
    // Enemy should be roughly centered
    expect(enemyLayout[0].x).toBeGreaterThan(SCREEN_W / 2 - 200);
    expect(enemyLayout[0].x).toBeLessThan(SCREEN_W / 2 + 200);

    // HUD layout
    const hudLayout = new CombatHudLayout({
      screenWidth: SCREEN_W,
      screenHeight: SCREEN_H,
    });

    const hudResult = hudLayout.calculateLayout({
      currentHP: 80,
      maxHP: 80,
      block: 5,
      enemyCount: 1,
    } as HudLayoutParams);

    // HP bar should show full health (green)
    expect(hudResult.playerHPBar.color).toBe(0x44bb44); // GREEN
    expect(hudResult.playerHPBar.filledWidth).toBe(200); // full
    // Energy orb should be in bottom-left area
    expect(hudResult.energyOrb.x).toBeGreaterThan(0);
    expect(hudResult.energyOrb.y).toBeGreaterThan(SCREEN_H / 2);
    // End turn button should be in bottom-right
    expect(hudResult.endTurnButton.x + hudResult.endTurnButton.width).toBeLessThanOrEqual(SCREEN_W);
    // Enemy display should have 1 entry
    expect(hudResult.enemies.length).toBe(1);
  });

  // -------------------------------------------------------------------------
  // Test 6: Reward generation
  // -------------------------------------------------------------------------
  it('6. RewardManager generates card rewards and gold after victory', () => {
    const rng = new GameRNG(TEST_SEED);
    const rewardStream = rng.getStream('rewardRNG');

    const rewardManager = new RewardManager(
      cards as Map<string, CardData>,
      potions as Map<string, PotionData>,
    );

    const result = rewardManager.generateRewards('ironclad', 'normal', rewardStream);

    // Should produce gold
    expect(result.gold).toBeGreaterThan(0);
    expect(result.gold).toBeGreaterThanOrEqual(15); // normal base
    expect(result.gold).toBeLessThanOrEqual(20); // normal base + variance

    // Should produce card rewards
    expect(result.cardRewards.length).toBeGreaterThan(0);
    expect(result.cardRewards.length).toBeLessThanOrEqual(3);

    // Card rewards should not be starter rarity
    for (const card of result.cardRewards) {
      expect(card.rarity).not.toBe('starter');
      expect(card.rarity).not.toBe('special');
      expect(card.character).toBe('ironclad');
    }
  });

  // -------------------------------------------------------------------------
  // Test 7: Reward selection
  // -------------------------------------------------------------------------
  it('7. RewardController tracks card selection and produces result', () => {
    const rng = new GameRNG(TEST_SEED);
    const rewardStream = rng.getStream('rewardRNG');

    const rewardManager = new RewardManager(
      cards as Map<string, CardData>,
      potions as Map<string, PotionData>,
    );

    const rewards = rewardManager.generateRewards('ironclad', 'normal', rewardStream);

    // Create reward controller with generated rewards
    const rewardCtrl = new RewardController(
      rewards.cardRewards,
      rewards.gold,
      rewards.potionDropped,
    );

    // Initial state
    const state0 = rewardCtrl.getState();
    expect(state0.selectedCardIndex).toBeNull();
    expect(state0.skipped).toBe(false);
    expect(rewardCtrl.isComplete()).toBe(false);

    // Select first card
    const selected = rewardCtrl.selectCard(0);
    expect(selected).not.toBeNull();
    expect(selected!.id).toBe(rewards.cardRewards[0].id);

    // Controller should be complete
    expect(rewardCtrl.isComplete()).toBe(true);

    // Get result
    const result = rewardCtrl.getResult();
    expect(result.addedCard).not.toBeNull();
    expect(result.addedCard!.id).toBe(rewards.cardRewards[0].id);
    expect(result.goldGained).toBe(rewards.gold);

    // Cannot select again
    const secondSelect = rewardCtrl.selectCard(1);
    expect(secondSelect).toBeNull();
  });

  // -------------------------------------------------------------------------
  // Test 8: Second combat with new card from reward
  // -------------------------------------------------------------------------
  it('8. Second combat with new reward card in deck', () => {
    // --- First combat ---
    const payload1 = charManager.createCombatPayload('ironclad', TEST_SEED);
    const cultist = getCultistWithMoves();
    payload1.enemies = [cultist];

    const ctx1 = createCombatContext(payload1);
    ctx1.systems.combatController.initCombat(
      payload1.playerHP, payload1.playerMaxHP, payload1.baseEnergy,
      { enemies: payload1.enemies },
    );

    // Play until victory (simplified: just deal enough damage)
    const state1 = ctx1.systems.combatController.getState();
    const enemy1 = state1.enemies[0];

    // Directly deal 50 damage to kill the cultist
    const hand1 = ctx1.systems.deckManager.getHand();
    const strikes = hand1.filter((c) => c.data.id === 'strike_red');
    for (const strike of strikes) {
      if (ctx1.systems.combatController.getState().currentEnergy < 1) break;
      if (!enemy1.isAlive) break;
      ctx1.systems.combatController.playCard(strike, enemy1);
    }

    // If not dead yet, bash and more strikes
    if (enemy1.isAlive) {
      const bash = hand1.find((c) => c.data.id === 'bash');
      if (bash && ctx1.systems.combatController.getState().currentEnergy >= 2) {
        ctx1.systems.combatController.playCard(bash, enemy1);
      }
    }

    // Continue turns until victory
    for (let i = 0; i < 20; i++) {
      if (ctx1.systems.combatController.getPhase() === TurnPhase.COMBAT_OVER) break;

      if (ctx1.systems.combatController.getPhase() === TurnPhase.PLAYER_TURN) {
        const currentHand = ctx1.systems.deckManager.getHand();
        const currentState = ctx1.systems.combatController.getState();
        const aliveEnemy = currentState.enemies.find((e) => e.isAlive);
        for (const card of [...currentHand]) {
          if (!aliveEnemy?.isAlive) break;
          const cs = ctx1.systems.combatController.getState();
          if (card.data.cost > cs.currentEnergy) continue;
          if (card.data.targets === TargetType.ENEMY) {
            ctx1.systems.combatController.playCard(card, aliveEnemy);
          } else {
            ctx1.systems.combatController.playCard(card, null);
          }
        }
      }

      // End player turn
      if (ctx1.systems.combatController.getPhase() === TurnPhase.PLAYER_TURN) {
        ctx1.systems.combatController.endPlayerTurn();
      }
      // Execute enemy turn
      if (ctx1.systems.combatController.getPhase() === TurnPhase.ENEMY_TURN) {
        ctx1.systems.combatController.executeEnemyTurn();
      }
      // Start next player turn
      if (ctx1.systems.combatController.getPhase() === TurnPhase.ENEMY_TURN) {
        ctx1.systems.combatController.startPlayerTurn();
      }
    }

    expect(ctx1.systems.combatController.getState().result).toBe('victory');
    ctx1.uiState.destroy();

    // --- Generate reward ---
    const rewardRng = new GameRNG(TEST_SEED + 1);
    const rewardManager = new RewardManager(
      cards as Map<string, CardData>,
      potions as Map<string, PotionData>,
    );
    const rewards = rewardManager.generateRewards('ironclad', 'normal', rewardRng.getStream('rewardRNG'));
    expect(rewards.cardRewards.length).toBeGreaterThan(0);

    const rewardCtrl = new RewardController(rewards.cardRewards, rewards.gold, rewards.potionDropped);
    const selectedCard = rewardCtrl.selectCard(0);
    expect(selectedCard).not.toBeNull();

    // --- Create second combat payload with the reward card added ---
    const instance = charManager.loadCharacter('ironclad');

    // Add the reward card to the deck
    const rewardCardInstance: CombatCardInstance = {
      instanceId: `ironclad_${selectedCard!.id}_0`,
      data: selectedCard!,
      upgraded: false,
      costOverride: null,
      timesPlayedThisCombat: 0,
      retained: false,
    };
    instance.deck.push(rewardCardInstance);

    // Build a second combat payload manually with updated deck
    const deck2 = instance.deck.map((card) => ({
      instanceId: card.instanceId,
      cardId: card.data.id,
      upgraded: card.upgraded,
    }));
    const cardData2 = (() => {
      const seen = new Set<string>();
      const unique: CardData[] = [];
      for (const card of instance.deck) {
        if (!seen.has(card.data.id)) {
          seen.add(card.data.id);
          unique.push(card.data);
        }
      }
      return unique;
    })();

    const payload2: CombatSceneData = {
      playerHP: instance.currentHP,
      playerMaxHP: instance.maxHP,
      baseEnergy: instance.data.energy,
      deck: deck2,
      cardData: cardData2,
      statusEffectData,
      seed: TEST_SEED + 100,
      enemies: [getCultistWithMoves()],
    };

    // --- Run second combat ---
    const ctx2 = createCombatContext(payload2);
    ctx2.systems.combatController.initCombat(
      payload2.playerHP, payload2.playerMaxHP, payload2.baseEnergy,
      { enemies: payload2.enemies },
    );

    // Verify deck now has original + reward card
    const deckSize = deck2.length;
    expect(deckSize).toBe(11); // 10 starter + 1 reward

    // Verify combat initializes properly
    expect(ctx2.systems.combatController.getState().phase).toBe(TurnPhase.PLAYER_TURN);

    // Play through to victory
    for (let i = 0; i < 30; i++) {
      if (ctx2.systems.combatController.getPhase() === TurnPhase.COMBAT_OVER) break;

      if (ctx2.systems.combatController.getPhase() === TurnPhase.PLAYER_TURN) {
        const currentHand = ctx2.systems.deckManager.getHand();
        const currentState = ctx2.systems.combatController.getState();
        const aliveEnemy = currentState.enemies.find((e) => e.isAlive);
        for (const card of [...currentHand]) {
          if (!aliveEnemy?.isAlive) break;
          const cs = ctx2.systems.combatController.getState();
          if (card.data.cost > cs.currentEnergy) continue;
          if (card.data.targets === TargetType.ENEMY) {
            ctx2.systems.combatController.playCard(card, aliveEnemy);
          } else {
            ctx2.systems.combatController.playCard(card, null);
          }
        }
      }

      if (ctx2.systems.combatController.getPhase() === TurnPhase.PLAYER_TURN) {
        ctx2.systems.combatController.endPlayerTurn();
      }
      if (ctx2.systems.combatController.getPhase() === TurnPhase.ENEMY_TURN) {
        ctx2.systems.combatController.executeEnemyTurn();
      }
      if (ctx2.systems.combatController.getPhase() === TurnPhase.ENEMY_TURN) {
        ctx2.systems.combatController.startPlayerTurn();
      }
    }

    expect(ctx2.systems.combatController.getState().result).toBe('victory');
    ctx2.uiState.destroy();
  });

  // -------------------------------------------------------------------------
  // Test 9: Defeat scenario
  // -------------------------------------------------------------------------
  it('9. Defeat scenario: player at 1 HP, enemy deals damage -> defeat', () => {
    const payload = charManager.createCombatPayload('ironclad', TEST_SEED);
    // Override enemy to deal damage on first move
    const lethalEnemy = {
      id: 'lethal_test',
      name: 'Lethal Enemy',
      type: 'normal' as const,
      hp: 50,
      act: 1,
      selectionMode: 'rotating',
      moves: [{ moveId: 'kill', weight: 1 }],
      moveDefinitions: {
        kill: {
          id: 'kill',
          name: 'Kill',
          intent: 'attack' as const,
          effects: [{ type: 'deal_damage' as const, value: 10 }],
          damage: 10,
        } as EnemyMove,
      },
    };

    payload.enemies = [lethalEnemy];
    // Set player HP to 1 for instant death
    payload.playerHP = 1;

    const ctx = createCombatContext(payload);
    ctx.systems.combatController.initCombat(
      1, // playerHP = 1
      payload.playerMaxHP,
      payload.baseEnergy,
      { enemies: payload.enemies },
    );

    expect(ctx.systems.combatController.getState().playerHP).toBe(1);

    // End player turn -> enemy turn
    ctx.systems.combatController.endPlayerTurn();
    ctx.systems.combatController.executeEnemyTurn();

    // Player should be dead
    expect(ctx.systems.combatController.getState().result).toBe('defeat');
    expect(ctx.systems.combatController.getState().phase).toBe(TurnPhase.COMBAT_OVER);
    expect(ctx.systems.combatController.getState().playerHP).toBe(0);

    ctx.uiState.destroy();
  });

  // -------------------------------------------------------------------------
  // Test 10: Complete demo loop
  // -------------------------------------------------------------------------
  it('10. Complete demo loop: character -> combat -> reward -> second combat with new card', () => {
    // =============================================
    // PHASE 1: Character Setup
    // =============================================
    const instance = charManager.loadCharacter('ironclad');
    expect(instance.data.id).toBe('ironclad');
    expect(instance.currentHP).toBe(80);
    expect(instance.deck.length).toBe(10); // 5 Strikes + 4 Defends + 1 Bash

    // =============================================
    // PHASE 2: First Combat
    // =============================================
    const payload = charManager.createCombatPayload('ironclad', TEST_SEED);
    const cultist = getCultistWithMoves();
    payload.enemies = [cultist];

    const ctx = createCombatContext(payload);
    ctx.systems.combatController.initCombat(
      payload.playerHP, payload.playerMaxHP, payload.baseEnergy,
      { enemies: payload.enemies },
    );
    syncEnemiesToUI(ctx.uiState, ctx.systems.combatController.getState().enemies);

    // Verify combat UI state
    const uiSnap = ctx.uiState.getSnapshot();
    expect(uiSnap.playerHP).toBe(80);
    expect(uiSnap.turnPhase).toBe(UITurnPhase.UNKNOWN); // UI hasn't received turn start yet

    // Combat loop
    for (let i = 0; i < 30; i++) {
      if (ctx.systems.combatController.getPhase() === TurnPhase.COMBAT_OVER) break;

      if (ctx.systems.combatController.getPhase() === TurnPhase.PLAYER_TURN) {
        const currentHand = ctx.systems.deckManager.getHand();
        const currentState = ctx.systems.combatController.getState();
        const aliveEnemy = currentState.enemies.find((e) => e.isAlive);
        for (const card of [...currentHand]) {
          if (!aliveEnemy?.isAlive) break;
          const cs = ctx.systems.combatController.getState();
          if (card.data.cost > cs.currentEnergy) continue;
          if (card.data.targets === TargetType.ENEMY) {
            ctx.systems.combatController.playCard(card, aliveEnemy);
          } else {
            ctx.systems.combatController.playCard(card, null);
          }
        }
      }

      if (ctx.systems.combatController.getPhase() === TurnPhase.PLAYER_TURN) {
        ctx.systems.combatController.endPlayerTurn();
      }
      if (ctx.systems.combatController.getPhase() === TurnPhase.ENEMY_TURN) {
        ctx.systems.combatController.executeEnemyTurn();
      }
      if (ctx.systems.combatController.getPhase() === TurnPhase.ENEMY_TURN) {
        ctx.systems.combatController.startPlayerTurn();
      }
    }

    // =============================================
    // PHASE 3: Victory Verification
    // =============================================
    expect(ctx.systems.combatController.getState().result).toBe('victory');
    const playerHPAfterCombat = ctx.systems.combatController.getState().playerHP;
    expect(playerHPAfterCombat).toBeGreaterThan(0);
    expect(playerHPAfterCombat).toBeLessThanOrEqual(80);

    ctx.uiState.destroy();

    // =============================================
    // PHASE 4: Reward Generation
    // =============================================
    const rewardRng = new GameRNG(TEST_SEED + 7);
    const rewardManager = new RewardManager(
      cards as Map<string, CardData>,
      potions as Map<string, PotionData>,
    );
    const rewards = rewardManager.generateRewards('ironclad', 'normal', rewardRng.getStream('rewardRNG'));

    expect(rewards.gold).toBeGreaterThan(0);
    expect(rewards.cardRewards.length).toBeGreaterThan(0);

    // =============================================
    // PHASE 5: Reward Selection
    // =============================================
    const rewardCtrl = new RewardController(rewards.cardRewards, rewards.gold, rewards.potionDropped);
    const selectedCard = rewardCtrl.selectCard(0);
    expect(selectedCard).not.toBeNull();
    expect(rewardCtrl.isComplete()).toBe(true);

    const rewardResult = rewardCtrl.getResult();
    expect(rewardResult.addedCard).not.toBeNull();

    // =============================================
    // PHASE 6: Second Combat with New Card
    // =============================================
    // Add reward card to deck
    const rewardCardInstance: CombatCardInstance = {
      instanceId: `ironclad_${selectedCard!.id}_reward`,
      data: selectedCard!,
      upgraded: false,
      costOverride: null,
      timesPlayedThisCombat: 0,
      retained: false,
    };

    const updatedDeck = [...instance.deck, rewardCardInstance];
    const deckEntries = updatedDeck.map((card) => ({
      instanceId: card.instanceId,
      cardId: card.data.id,
      upgraded: card.upgraded,
    }));

    const uniqueCardData = (() => {
      const seen = new Set<string>();
      const unique: CardData[] = [];
      for (const card of updatedDeck) {
        if (!seen.has(card.data.id)) {
          seen.add(card.data.id);
          unique.push(card.data);
        }
      }
      return unique;
    })();

    const payload2: CombatSceneData = {
      playerHP: playerHPAfterCombat,
      playerMaxHP: 80,
      baseEnergy: 3,
      deck: deckEntries,
      cardData: uniqueCardData,
      statusEffectData,
      seed: TEST_SEED + 200,
      enemies: [getCultistWithMoves()],
    };

    const ctx2 = createCombatContext(payload2);
    ctx2.systems.combatController.initCombat(
      playerHPAfterCombat, 80, 3,
      { enemies: payload2.enemies },
    );

    // Verify the new card exists in the deck
    expect(deckEntries.length).toBe(11);
    expect(deckEntries.some((d) => d.cardId === selectedCard!.id)).toBe(true);

    // Check if the new card is in hand (may or may not be drawn)
    // At minimum, verify combat starts correctly
    expect(ctx2.systems.combatController.getState().phase).toBe(TurnPhase.PLAYER_TURN);

    // Play through second combat
    for (let i = 0; i < 30; i++) {
      if (ctx2.systems.combatController.getPhase() === TurnPhase.COMBAT_OVER) break;

      if (ctx2.systems.combatController.getPhase() === TurnPhase.PLAYER_TURN) {
        const currentHand = ctx2.systems.deckManager.getHand();
        const currentState = ctx2.systems.combatController.getState();
        const aliveEnemy = currentState.enemies.find((e) => e.isAlive);
        for (const card of [...currentHand]) {
          if (!aliveEnemy?.isAlive) break;
          const cs = ctx2.systems.combatController.getState();
          if (card.data.cost > cs.currentEnergy) continue;
          if (card.data.targets === TargetType.ENEMY) {
            ctx2.systems.combatController.playCard(card, aliveEnemy);
          } else {
            ctx2.systems.combatController.playCard(card, null);
          }
        }
      }

      if (ctx2.systems.combatController.getPhase() === TurnPhase.PLAYER_TURN) {
        ctx2.systems.combatController.endPlayerTurn();
      }
      if (ctx2.systems.combatController.getPhase() === TurnPhase.ENEMY_TURN) {
        ctx2.systems.combatController.executeEnemyTurn();
      }
      if (ctx2.systems.combatController.getPhase() === TurnPhase.ENEMY_TURN) {
        ctx2.systems.combatController.startPlayerTurn();
      }
    }

    // Verify second combat victory
    expect(ctx2.systems.combatController.getState().result).toBe('victory');

    // Layout verification for second combat state
    const handDisplay = new CardHandDisplay({ screenWidth: 1280, screenHeight: 720 });
    const handCards: CardUIState[] = ctx2.systems.deckManager.getHand().map((c) => ({
      instanceId: c.instanceId,
      cardId: c.data.id,
      name: c.data.name,
      type: c.data.type,
      cost: c.data.cost,
      description: c.data.description,
      upgraded: c.upgraded,
    }));
    const layout = handDisplay.calculateLayout(handCards, null, null, 0, 'combat_over');
    // All cards should be unplayable in combat_over
    for (const card of layout) {
      expect(card.isPlayable).toBe(false);
    }

    ctx2.uiState.destroy();
  });
});
