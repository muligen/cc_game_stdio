import { chromium } from 'playwright';

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ viewport: { width: 1920, height: 1080 } });
const page = await context.newPage();

const errors = [];
const logs = [];
page.on('pageerror', err => errors.push(err.message));
page.on('console', msg => {
  if (msg.type() === 'error') logs.push(`[CONSOLE ERROR] ${msg.text()}`);
});

await page.goto('http://localhost:3000/');
await page.waitForTimeout(3000);
console.log('=== Step 1: Main Menu Loaded ===');
await page.screenshot({ path: 'playtest-01-menu.png' });

// Click to start combat
await page.click('canvas');
await page.waitForTimeout(3000);
console.log('=== Step 2: Combat Started ===');

// Check combat state
const combatState = await page.evaluate(() => {
  const scene = window.game.scene.scenes.find(s => s.sys.settings.key === 'CombatScene');
  if (!scene) return { error: 'CombatScene not found' };
  const snap = scene.uiState?.getSnapshot();
  const hand = scene.systems?.deckManager?.getHand()?.map(c => ({
    name: c.data.name, cost: c.data.cost, type: c.data.type, targets: c.data.targets,
  }));
  return {
    phase: scene.systems?.combatController?.getPhase(),
    hp: `${snap?.playerHP}/${snap?.playerMaxHP}`,
    energy: snap?.currentEnergy,
    turn: snap?.turnNumber,
    enemies: snap?.enemies?.map(e => ({
      name: e.name, hp: `${e.currentHP}/${e.maxHP}`, intent: e.intent,
    })),
    hand,
    cards: scene.cardHitAreas?.length,
    enemyHitAreas: scene.enemyHitAreas?.length,
    endTurnBtn: !!scene.endTurnHitArea,
  };
});
console.log('Combat State:', JSON.stringify(combatState, null, 2));
await page.screenshot({ path: 'playtest-02-combat-start.png' });

// Step 3: Play a non-targeted card (Defend)
console.log('\n=== Step 3: Play non-targeted card ===');
const defendIdx = await page.evaluate(() => {
  const scene = window.game.scene.scenes.find(s => s.sys.settings.key === 'CombatScene');
  const hand = scene.systems?.deckManager?.getHand();
  const idx = hand?.findIndex(c => c.data.targets !== 'enemy');
  return idx ?? -1;
});
console.log(`Defend card index: ${defendIdx}`);

if (defendIdx >= 0) {
  // Click the defend card's hit area
  const area = await page.evaluate((idx) => {
    const scene = window.game.scene.scenes.find(s => s.sys.settings.key === 'CombatScene');
    const a = scene.cardHitAreas?.[idx];
    return a ? { x: a.x + a.w/2, y: a.y + a.h/2 } : null;
  }, defendIdx);
  if (area) {
    await page.mouse.click(area.x, area.y);
    await page.waitForTimeout(500);
  }
}

const afterCard = await page.evaluate(() => {
  const scene = window.game.scene.scenes.find(s => s.sys.settings.key === 'CombatScene');
  const snap = scene.uiState?.getSnapshot();
  return {
    energy: snap?.currentEnergy,
    block: snap?.playerBlock,
    handSize: scene.systems?.deckManager?.getHand()?.length,
  };
});
console.log('After playing card:', JSON.stringify(afterCard));
await page.screenshot({ path: 'playtest-03-after-card.png' });

// Step 4: End turn
console.log('\n=== Step 4: End Turn ===');
const endTurnArea = await page.evaluate(() => {
  const scene = window.game.scene.scenes.find(s => s.sys.settings.key === 'CombatScene');
  const a = scene.endTurnHitArea;
  return a ? { x: a.x + a.w/2, y: a.y + a.h/2 } : null;
});
if (endTurnArea) {
  await page.mouse.click(endTurnArea.x, endTurnArea.y);
  await page.waitForTimeout(2000);
}

const afterEnemyTurn = await page.evaluate(() => {
  const scene = window.game.scene.scenes.find(s => s.sys.settings.key === 'CombatScene');
  const snap = scene.uiState?.getSnapshot();
  const phase = scene.systems?.combatController?.getPhase();
  return {
    phase,
    hp: `${snap?.playerHP}/${snap?.playerMaxHP}`,
    block: snap?.playerBlock,
    energy: snap?.currentEnergy,
    enemies: snap?.enemies?.map(e => ({
      name: e.name, hp: `${e.currentHP}/${e.maxHP}`, intent: e.intent, alive: e.isAlive,
    })),
  };
});
console.log('After enemy turn:', JSON.stringify(afterEnemyTurn, null, 2));
await page.screenshot({ path: 'playtest-04-after-enemy.png' });

// Step 5: Play attack cards to kill enemy
console.log('\n=== Step 5: Kill enemy with attacks ===');
for (let round = 0; round < 20; round++) {
  const state = await page.evaluate(() => {
    const scene = window.game.scene.scenes.find(s => s.sys.settings.key === 'CombatScene');
    if (!scene?.systems) return null;
    const snap = scene.uiState?.getSnapshot();
    const phase = scene.systems.combatController.getPhase();
    const combatResult = scene.systems.combatController.getState().result;
    return {
      phase, combatResult,
      hp: snap?.playerHP,
      enemies: snap?.enemies?.map(e => ({ name: e.name, hp: e.currentHP, alive: e.isAlive })),
      energy: snap?.currentEnergy,
      cards: scene.cardHitAreas?.length,
    };
  });

  if (!state) break;
  if (state.combatResult === 'victory') {
    console.log(`  VICTORY at round ${round}!`);
    break;
  }
  if (state.combatResult === 'defeat') {
    console.log(`  DEFEAT at round ${round}. HP: ${state.hp}`);
    break;
  }
  if (state.phase !== 'player_turn') {
    await page.waitForTimeout(500);
    continue;
  }

  // Play the first available attack card
  const attackIdx = await page.evaluate(() => {
    const scene = window.game.scene.scenes.find(s => s.sys.settings.key === 'CombatScene');
    const hand = scene.systems?.deckManager?.getHand();
    const areas = scene.cardHitAreas;
    if (!hand || !areas) return -1;
    for (const area of areas) {
      if (hand[area.index]?.data?.targets === 'enemy') return area.index;
    }
    return -1;
  });

  if (attackIdx >= 0) {
    // Click attack card
    const cardArea = await page.evaluate((idx) => {
      const scene = window.game.scene.scenes.find(s => s.sys.settings.key === 'CombatScene');
      const a = scene.cardHitAreas?.[idx];
      return a ? { x: a.x + a.w/2, y: a.y + a.h/2 } : null;
    }, attackIdx);
    if (cardArea) {
      await page.mouse.click(cardArea.x, cardArea.y);
      await page.waitForTimeout(300);
    }

    // Click enemy to target
    await page.waitForTimeout(100);
    const enemyArea = await page.evaluate(() => {
      const scene = window.game.scene.scenes.find(s => s.sys.settings.key === 'CombatScene');
      // Find first alive enemy area or click center where enemy is
      const snap = scene.uiState?.getSnapshot();
      const aliveEnemy = snap?.enemies?.find(e => e.isAlive);
      if (!aliveEnemy) return null;
      // Enemy container is at known position, click center
      return { x: 960, y: 310 }; // approx center of enemy body
    });
    if (enemyArea) {
      await page.mouse.click(enemyArea.x, enemyArea.y);
      await page.waitForTimeout(300);
    }
  } else {
    // No attack cards, play any card or end turn
    const anyArea = await page.evaluate(() => {
      const scene = window.game.scene.scenes.find(s => s.sys.settings.key === 'CombatScene');
      const a = scene.cardHitAreas?.[0];
      return a ? { x: a.x + a.w/2, y: a.y + a.h/2 } : null;
    });
    if (anyArea) {
      await page.mouse.click(anyArea.x, anyArea.y);
      await page.waitForTimeout(300);
    }

    // End turn if no more cards
    const endBtn = await page.evaluate(() => {
      const scene = window.game.scene.scenes.find(s => s.sys.settings.key === 'CombatScene');
      const a = scene.endTurnHitArea;
      return a ? { x: a.x + a.w/2, y: a.y + a.h/2 } : null;
    });
    if (endBtn) {
      await page.mouse.click(endBtn.x, endBtn.y);
      await page.waitForTimeout(1500);
    }
  }

  const checkState = await page.evaluate(() => {
    const scene = window.game.scene.scenes.find(s => s.sys.settings.key === 'CombatScene');
    return {
      result: scene?.systems?.combatController?.getState()?.result,
      enemyHP: scene?.uiState?.getSnapshot()?.enemies?.[0]?.currentHP,
    };
  });
  if (checkState.result === 'victory' || checkState.result === 'defeat') break;
}

await page.waitForTimeout(1500);
await page.screenshot({ path: 'playtest-05-after-combat.png' });

// Step 6: Check if we reached reward scene
console.log('\n=== Step 6: Post-combat ===');
const postCombat = await page.evaluate(() => {
  const scenes = window.game.scene.scenes.map(s => ({
    key: s.sys.settings.key,
    active: s.sys.isActive(),
    visible: s.sys.isVisible(),
  }));
  return scenes;
});
console.log('Active scenes:', JSON.stringify(postCombat, null, 2));

// Wait for reward scene transition
await page.waitForTimeout(2000);
await page.screenshot({ path: 'playtest-06-reward.png' });

const rewardState = await page.evaluate(() => {
  const scene = window.game.scene.scenes.find(s => s.sys.settings.key === 'RewardScene');
  if (!scene || !scene.sys.isActive()) return { active: false };
  return { active: true };
});
console.log('Reward scene active:', rewardState.active);

// Click to select a reward card (click center of screen)
if (rewardState.active) {
  await page.mouse.click(960, 500);
  await page.waitForTimeout(1000);
  // Click skip/continue
  await page.mouse.click(960, 900);
  await page.waitForTimeout(1000);
  await page.screenshot({ path: 'playtest-07-after-reward.png' });
}

// Step 7: Check map scene
console.log('\n=== Step 7: Map Scene ===');
await page.waitForTimeout(1000);
const mapState = await page.evaluate(() => {
  const scene = window.game.scene.scenes.find(s => s.sys.settings.key === 'MapScene');
  if (!scene || !scene.sys.isActive()) return { active: false };
  const nodes = scene.mapState?.getNodes?.()?.map(n => ({
    id: n.nodeId, state: n.state, type: n.type,
  }));
  return { active: true, nodes };
});
console.log('Map state:', JSON.stringify(mapState, null, 2));
await page.screenshot({ path: 'playtest-08-map.png' });

// Final summary
console.log('\n=== SUMMARY ===');
console.log(`Errors: ${errors.length}`);
errors.forEach(e => console.log(`  ERROR: ${e.substring(0, 150)}`));
console.log(`Console errors: ${logs.length}`);
logs.forEach(l => console.log(`  ${l.substring(0, 150)}`));

await browser.close();
