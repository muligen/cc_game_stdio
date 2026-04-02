// PROTOTYPE - NOT FOR PRODUCTION
// Question: Does the core card combat loop feel right?
// Date: 2026-04-02

import Phaser from 'phaser';
import { CardData, createStarterDeck } from './card';
import { EnemyData, createCultist } from './enemy';
import { PlayerData, createPlayer } from './player';

// ── Layout constants ───────────────────────────────────────────────
const W = 1280;
const H = 720;
const CARD_W = 120;
const CARD_H = 170;
const CARD_GAP = 20;
const CARD_Y = H - CARD_H - 40;

// ── Colors ─────────────────────────────────────────────────────────
const CLR_BG = 0x1a1a2e;
const CLR_CARD_ATTACK = 0xc0392b;
const CLR_CARD_SKILL = 0x2471a3;
const CLR_CARD_HOVER = 0xf1c40f;
const CLR_CARD_SELECTED = 0xf39c12;
const CLR_ENERGY_BG = 0x2c3e50;
const CLR_ENERGY_FILL = 0x27ae60;
const CLR_HP_GREEN = 0x27ae60;
const CLR_HP_RED = 0xe74c3c;
const CLR_BLOCK_BLUE = 0x3498db;
const CLR_BTN = 0x8e44ad;
const CLR_BTN_HOVER = 0x9b59b6;
const CLR_TEXT = 0xecf0f1;
const CLR_ENEMY_BODY = 0xd35400;
const CLR_DMG_POPUP = 0xff4444;
const CLR_BLK_POPUP = 0x44aaff;
const CLR_PLAYER_BODY = 0x2ecc71;

type Phase = 'player' | 'enemy' | 'gameover';

export class CombatScene extends Phaser.Scene {
  // ── State ──────────────────────────────────────────────────────
  player!: PlayerData;
  enemy!: EnemyData;
  deck: CardData[] = [];
  hand: CardData[] = [];
  discardPile: CardData[] = [];
  phase: Phase = 'player';
  selectedCardIndex: number = -1;

  // ── Visuals ────────────────────────────────────────────────────
  cardContainers: Phaser.GameObjects.Container[] = [];
  enemyContainer!: Phaser.GameObjects.Container;
  playerContainer!: Phaser.GameObjects.Container;
  energyText!: Phaser.GameObjects.Text;
  energyBg!: Phaser.GameObjects.Graphics;
  playerHpBar!: Phaser.GameObjects.Graphics;
  playerHpText!: Phaser.GameObjects.Text;
  playerBlockText!: Phaser.GameObjects.Text;
  enemyHpBar!: Phaser.GameObjects.Graphics;
  enemyHpText!: Phaser.GameObjects.Text;
  enemyBlockText!: Phaser.GameObjects.Text;
  enemyIntentText!: Phaser.GameObjects.Text;
  endTurnBtn!: Phaser.GameObjects.Container;
  phaseText!: Phaser.GameObjects.Text;

  constructor() {
    super({ key: 'CombatScene' });
  }

  create() {
    this.cameras.main.setBackgroundColor(CLR_BG);

    this.player = createPlayer();
    this.enemy = createCultist();
    this.deck = createStarterDeck();

    this.createPlayerUI();
    this.createEnemyUI();
    this.createEnergyUI();
    this.createEndTurnButton();
    this.createPhaseText();

    this.startPlayerTurn();
  }

  // ── Player Visuals ─────────────────────────────────────────────
  createPlayerUI() {
    this.playerContainer = this.add.container(200, H - 280);

    // Body rectangle
    const body = this.add.rectangle(0, 0, 80, 120, CLR_PLAYER_BODY);
    body.setStrokeStyle(2, 0xffffff);
    this.playerContainer.add(body);

    const label = this.add.text(0, -10, 'Player', {
      fontSize: '14px', color: '#ffffff',
      fontFamily: 'monospace',
    }).setOrigin(0.5);
    this.playerContainer.add(label);

    // HP bar background
    this.playerHpBar = this.add.graphics();
    this.playerContainer.add(this.playerHpBar);

    this.playerHpText = this.add.text(0, 50, '', {
      fontSize: '14px', color: '#ffffff', fontFamily: 'monospace',
    }).setOrigin(0.5);
    this.playerContainer.add(this.playerHpText);

    this.playerBlockText = this.add.text(0, 70, '', {
      fontSize: '13px', color: '#3498db', fontFamily: 'monospace',
    }).setOrigin(0.5);
    this.playerContainer.add(this.playerBlockText);

    this.updatePlayerUI();
  }

  updatePlayerUI() {
    const p = this.player;
    const barW = 100;
    const barH = 12;
    const barX = -barW / 2;
    const barY = 35;

    this.playerHpBar.clear();
    // Background
    this.playerHpBar.fillStyle(0x444444);
    this.playerHpBar.fillRect(barX, barY, barW, barH);
    // HP fill
    const hpRatio = Math.max(0, p.hp / p.maxHp);
    this.playerHpBar.fillStyle(hpRatio > 0.3 ? CLR_HP_GREEN : CLR_HP_RED);
    this.playerHpBar.fillRect(barX, barY, barW * hpRatio, barH);
    // Block overlay
    if (p.block > 0) {
      this.playerHpBar.fillStyle(CLR_BLOCK_BLUE, 0.6);
      this.playerHpBar.fillRect(barX, barY, barW, barH);
    }
    this.playerHpBar.lineStyle(1, 0xffffff);
    this.playerHpBar.strokeRect(barX, barY, barW, barH);

    this.playerHpText.setText(`${p.hp}/${p.maxHp}`);
    this.playerBlockText.setText(p.block > 0 ? `Block: ${p.block}` : '');
  }

  // ── Enemy Visuals ──────────────────────────────────────────────
  createEnemyUI() {
    this.enemyContainer = this.add.container(W - 300, 250);
    this.enemyContainer.setSize(140, 160);

    const body = this.add.rectangle(0, 0, 120, 140, CLR_ENEMY_BODY);
    body.setStrokeStyle(3, 0xffffff);
    body.setName('enemyBody');
    this.enemyContainer.add(body);

    const label = this.add.text(0, -30, this.enemy.name, {
      fontSize: '16px', color: '#ffffff', fontFamily: 'monospace',
    }).setOrigin(0.5);
    this.enemyContainer.add(label);

    // HP bar
    this.enemyHpBar = this.add.graphics();
    this.enemyContainer.add(this.enemyHpBar);

    this.enemyHpText = this.add.text(0, 50, '', {
      fontSize: '14px', color: '#ffffff', fontFamily: 'monospace',
    }).setOrigin(0.5);
    this.enemyContainer.add(this.enemyHpText);

    // Intent text
    this.enemyIntentText = this.add.text(0, -70, '', {
      fontSize: '13px', color: '#ff6666', fontFamily: 'monospace',
    }).setOrigin(0.5);
    this.enemyContainer.add(this.enemyIntentText);

    // Make enemy clickable (for targeting)
    body.setInteractive({ useHandCursor: true });
    body.on('pointerdown', () => this.onEnemyClicked());

    this.updateEnemyUI();
  }

  updateEnemyUI() {
    const e = this.enemy;
    const barW = 120;
    const barH = 12;
    const barX = -barW / 2;
    const barY = 35;

    this.enemyHpBar.clear();
    this.enemyHpBar.fillStyle(0x444444);
    this.enemyHpBar.fillRect(barX, barY, barW, barH);
    const hpRatio = Math.max(0, e.hp / e.maxHp);
    this.enemyHpBar.fillStyle(hpRatio > 0.3 ? CLR_HP_GREEN : CLR_HP_RED);
    this.enemyHpBar.fillRect(barX, barY, barW * hpRatio, barH);
    this.enemyHpBar.lineStyle(1, 0xffffff);
    this.enemyHpBar.fillRect(barX, barY, barW, barH);

    this.enemyHpText.setText(`${Math.max(0, e.hp)}/${e.maxHp}`);

    // Show intent
    if (e.intent === 'attack') {
      this.enemyIntentText.setText(`Intent: Attack ${e.intentValue}`);
    }
  }

  // ── Energy UI ──────────────────────────────────────────────────
  createEnergyUI() {
    const x = 60;
    const y = H / 2;

    this.energyBg = this.add.graphics();
    this.energyBg.fillStyle(CLR_ENERGY_BG);
    this.energyBg.fillCircle(x, y, 35);
    this.energyBg.lineStyle(3, CLR_ENERGY_FILL);
    this.energyBg.strokeCircle(x, y, 35);

    this.energyText = this.add.text(x, y, '', {
      fontSize: '22px', color: '#ffffff', fontFamily: 'monospace', fontStyle: 'bold',
    }).setOrigin(0.5);

    this.updateEnergyUI();
  }

  updateEnergyUI() {
    this.energyText.setText(`${this.player.energy}/${this.player.maxEnergy}`);
  }

  // ── End Turn Button ────────────────────────────────────────────
  createEndTurnButton() {
    const x = W - 120;
    const y = H - 80;

    const bg = this.add.rectangle(0, 0, 140, 50, CLR_BTN);
    bg.setStrokeStyle(2, 0xffffff);
    bg.setInteractive({ useHandCursor: true });

    const label = this.add.text(0, 0, 'End Turn', {
      fontSize: '18px', color: '#ffffff', fontFamily: 'monospace',
    }).setOrigin(0.5);

    this.endTurnBtn = this.add.container(x, y, [bg, label]);
    this.endTurnBtn.setSize(140, 50);

    bg.on('pointerover', () => bg.setFillStyle(CLR_BTN_HOVER));
    bg.on('pointerout', () => bg.setFillStyle(CLR_BTN));
    bg.on('pointerdown', () => this.onEndTurn());
  }

  createPhaseText() {
    this.phaseText = this.add.text(W / 2, 30, '', {
      fontSize: '20px', color: '#f1c40f', fontFamily: 'monospace', fontStyle: 'bold',
    }).setOrigin(0.5);
  }

  // ── Turn Flow ──────────────────────────────────────────────────
  startPlayerTurn() {
    this.phase = 'player';
    this.phaseText.setText('-- Your Turn --');
    this.player.block = 0;
    this.player.energy = this.player.maxEnergy;

    // Discard hand, draw new hand
    this.discardHand();
    this.drawHand(5);

    this.updatePlayerUI();
    this.updateEnergyUI();
    this.setEndTurnEnabled(true);
    this.clearCardSelection();
  }

  drawHand(count: number) {
    this.hand = [];
    // Simple: shuffle deck each turn (no draw/discard piles for prototype)
    const shuffled = [...this.deck].sort(() => Math.random() - 0.5);
    for (let i = 0; i < Math.min(count, shuffled.length); i++) {
      this.hand.push(shuffled[i]);
    }
    this.renderHand();
  }

  discardHand() {
    this.hand.forEach((c) => this.discardPile.push(c));
    this.hand = [];
    this.clearHandVisuals();
  }

  clearHandVisuals() {
    this.cardContainers.forEach((c) => c.destroy());
    this.cardContainers = [];
  }

  // ── Card Rendering ─────────────────────────────────────────────
  renderHand() {
    this.clearHandVisuals();

    const totalW = this.hand.length * (CARD_W + CARD_GAP) - CARD_GAP;
    const startX = (W - totalW) / 2;

    this.hand.forEach((card, i) => {
      const x = startX + i * (CARD_W + CARD_GAP) + CARD_W / 2;
      const container = this.createCardVisual(card, x, CARD_Y, i);
      this.cardContainers.push(container);
    });
  }

  createCardVisual(card: CardData, x: number, y: number, index: number): Phaser.GameObjects.Container {
    const bg = this.add.rectangle(0, 0, CARD_W, CARD_H,
      card.type === 'attack' ? CLR_CARD_ATTACK : CLR_CARD_SKILL);
    bg.setStrokeStyle(2, 0xffffff);
    bg.setName('cardBg');

    const costText = this.add.text(-CARD_W / 2 + 15, -CARD_H / 2 + 15, `${card.cost}`, {
      fontSize: '18px', color: '#f1c40f', fontFamily: 'monospace', fontStyle: 'bold',
    }).setOrigin(0.5);

    const nameText = this.add.text(0, -CARD_H / 2 + 45, card.name, {
      fontSize: '14px', color: '#ffffff', fontFamily: 'monospace', fontStyle: 'bold',
    }).setOrigin(0.5);

    const descText = this.add.text(0, 10, card.description, {
      fontSize: '11px', color: '#dddddd', fontFamily: 'monospace',
      align: 'center', lineSpacing: 2,
    }).setOrigin(0.5);

    const container = this.add.container(x, y, [bg, costText, nameText, descText]);
    container.setSize(CARD_W, CARD_H);

    bg.setInteractive({ useHandCursor: true });

    bg.on('pointerover', () => {
      if (this.phase !== 'player') return;
      if (this.selectedCardIndex !== -1) return;
      container.setY(y - 20);
    });

    bg.on('pointerout', () => {
      if (this.selectedCardIndex === index) return;
      container.setY(y);
    });

    bg.on('pointerdown', () => {
      if (this.phase !== 'player') return;
      this.onCardClicked(index);
    });

    return container;
  }

  // ── Card Interaction ───────────────────────────────────────────
  onCardClicked(index: number) {
    const card = this.hand[index];
    if (!card) return;

    // Can't afford
    if (card.cost > this.player.energy) {
      this.flashMessage('Not enough energy!', '#e74c3c');
      return;
    }

    // Skill cards resolve immediately
    if (card.type === 'skill') {
      this.playCard(index);
      return;
    }

    // Attack cards need a target — select this card
    if (this.selectedCardIndex === index) {
      // Deselect
      this.clearCardSelection();
      return;
    }

    this.clearCardSelection();
    this.selectedCardIndex = index;
    this.highlightSelectedCard();
  }

  highlightSelectedCard() {
    this.cardContainers.forEach((c, i) => {
      const bg = c.getByName('cardBg') as Phaser.GameObjects.Rectangle;
      if (i === this.selectedCardIndex) {
        bg.setStrokeStyle(4, CLR_CARD_SELECTED);
        c.setY(CARD_Y - 30);
      } else {
        bg.setStrokeStyle(2, 0x666666);
      }
    });
    this.flashMessage('Click the enemy to attack', '#f39c12');
  }

  clearCardSelection() {
    this.selectedCardIndex = -1;
    this.cardContainers.forEach((c) => {
      const bg = c.getByName('cardBg') as Phaser.GameObjects.Rectangle;
      bg.setStrokeStyle(2, 0xffffff);
      c.setY(CARD_Y);
    });
  }

  onEnemyClicked() {
    if (this.phase !== 'player') return;
    if (this.selectedCardIndex === -1) return;

    this.playCard(this.selectedCardIndex);
  }

  playCard(index: number) {
    const card = this.hand[index];
    if (!card) return;
    if (card.cost > this.player.energy) return;

    // Pay cost
    this.player.energy -= card.cost;

    // Execute card effect
    card.execute(this);

    // Remove from hand
    this.hand.splice(index, 1);
    this.discardPile.push(card);
    this.selectedCardIndex = -1;

    this.updateEnergyUI();
    this.updatePlayerUI();
    this.updateEnemyUI();

    // Check win
    if (this.enemy.hp <= 0) {
      this.endGame(true);
      return;
    }

    this.renderHand();
  }

  // ── Damage helpers (called from card.execute) ──────────────────
  calculateDamage(baseDamage: number): number {
    let dmg = baseDamage;
    // Vulnerable: +50% damage taken
    if (this.enemy.vulnerable > 0) {
      dmg = Math.floor(dmg * 1.5);
    }
    return dmg;
  }

  dealDamageToEnemy(amount: number) {
    this.enemy.hp -= amount;
    this.spawnDamagePopup(W - 300, 200, `-${amount}`, CLR_DMG_POPUP);

    // Tick down vulnerable after the hit
    if (this.enemy.vulnerable > 0) {
      this.enemy.vulnerable--;
    }
  }

  // ── End Turn ───────────────────────────────────────────────────
  onEndTurn() {
    if (this.phase !== 'player') return;
    this.setEndTurnEnabled(false);
    this.clearCardSelection();
    this.discardHand();
    this.startEnemyTurn();
  }

  setEndTurnEnabled(enabled: boolean) {
    const bg = this.endTurnBtn.getAt(0) as Phaser.GameObjects.Rectangle;
    if (enabled) {
      bg.setInteractive({ useHandCursor: true });
      bg.setAlpha(1);
    } else {
      bg.removeInteractive();
      bg.setAlpha(0.5);
    }
  }

  // ── Enemy Turn ─────────────────────────────────────────────────
  startEnemyTurn() {
    this.phase = 'enemy';
    this.phaseText.setText("-- Enemy's Turn --");

    // Delayed execution so the player can see the phase text
    this.time.delayedCall(800, () => this.executeEnemyAction());
  }

  executeEnemyAction() {
    const e = this.enemy;
    if (e.intent === 'attack') {
      let dmg = e.intentValue;
      // Could factor in player debuffs here
      this.dealDamageToPlayer(dmg);
    }

    this.updatePlayerUI();
    this.updateEnemyUI();

    if (this.player.hp <= 0) {
      this.endGame(false);
      return;
    }

    // Next turn after a pause
    this.time.delayedCall(600, () => this.startPlayerTurn());
  }

  dealDamageToPlayer(amount: number) {
    let remaining = amount;

    // Block absorbs damage first
    if (this.player.block > 0) {
      if (this.player.block >= remaining) {
        this.player.block -= remaining;
        this.spawnDamagePopup(200, H - 310, `Block -${remaining}`, CLR_BLK_POPUP);
        remaining = 0;
      } else {
        remaining -= this.player.block;
        this.spawnDamagePopup(200, H - 310, `Block -${this.player.block}`, CLR_BLK_POPUP);
        this.player.block = 0;
      }
    }

    if (remaining > 0) {
      this.player.hp -= remaining;
      this.spawnDamagePopup(200, H - 280, `-${remaining}`, CLR_DMG_POPUP);
    }
  }

  // ── Game Over ──────────────────────────────────────────────────
  endGame(victory: boolean) {
    this.phase = 'gameover';
    this.clearHandVisuals();

    const msg = victory ? 'VICTORY!' : 'DEFEAT';
    const color = victory ? '#27ae60' : '#e74c3c';

    this.phaseText.setText('');

    const overlay = this.add.rectangle(W / 2, H / 2, W, H, 0x000000, 0.6);

    const resultText = this.add.text(W / 2, H / 2 - 40, msg, {
      fontSize: '48px', color, fontFamily: 'monospace', fontStyle: 'bold',
    }).setOrigin(0.5);

    const restartBtn = this.add.text(W / 2, H / 2 + 40, '[ Click to Restart ]', {
      fontSize: '20px', color: '#ffffff', fontFamily: 'monospace',
    }).setOrigin(0.5).setInteractive({ useHandCursor: true });

    restartBtn.on('pointerdown', () => {
      overlay.destroy();
      resultText.destroy();
      restartBtn.destroy();
      this.scene.restart();
    });
  }

  // ── VFX ────────────────────────────────────────────────────────
  spawnDamagePopup(x: number, y: number, text: string, color: number) {
    const hexStr = '#' + color.toString(16).padStart(6, '0');
    const popup = this.add.text(x, y, text, {
      fontSize: '22px', color: hexStr, fontFamily: 'monospace', fontStyle: 'bold',
    }).setOrigin(0.5);

    this.tweens.add({
      targets: popup,
      y: y - 60,
      alpha: 0,
      duration: 900,
      ease: 'Power2',
      onComplete: () => popup.destroy(),
    });
  }

  flashMessage(text: string, color: string) {
    const msg = this.add.text(W / 2, H / 2 - 50, text, {
      fontSize: '16px', color, fontFamily: 'monospace',
    }).setOrigin(0.5);

    this.tweens.add({
      targets: msg,
      alpha: 0,
      y: msg.y - 20,
      duration: 800,
      onComplete: () => msg.destroy(),
    });
  }
}
