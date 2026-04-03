import { chromium } from 'playwright';

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ viewport: { width: 1920, height: 1080 } });
const page = await context.newPage();

const errors = [];
page.on('pageerror', err => errors.push(err.message));

await page.goto('http://localhost:3000/');
await page.waitForTimeout(3000);

// Start combat
await page.click('canvas');
await page.waitForTimeout(3000);

// Play one non-targeted card (Defend) to trigger rerender, then check UI
const areas = await page.evaluate(() => {
  const scene = window.game.scene.scenes.find(s => s.sys.settings.key === 'CombatScene');
  return {
    cardHitAreas: scene.cardHitAreas,
    enemyHitAreas: scene.enemyHitAreas,
    endTurnHitArea: scene.endTurnHitArea,
    enemyContainers: scene.enemyContainers.map(c => ({ x: c.x, y: c.y, visible: c.visible, alpha: c.alpha })),
    cardContainers: scene.cardContainers.map(c => ({ x: c.x, y: c.y })),
    uiState: scene.uiState?.getSnapshot(),
    camera: { w: scene.cameras.main.width, h: scene.cameras.main.height },
  };
});

console.log('=== UI State ===');
console.log('Camera:', JSON.stringify(areas.camera));
console.log('Player HP:', areas.uiState?.playerHP, '/', areas.uiState?.playerMaxHP);
console.log('Energy:', areas.uiState?.currentEnergy);
console.log('Turn:', areas.uiState?.turnNumber);
console.log('Enemies:', JSON.stringify(areas.uiState?.enemies, null, 2));

console.log('\n=== Card Hit Areas ===');
areas.cardHitAreas.forEach(a => console.log(`  Card ${a.index}: x=${a.x} y=${a.y} w=${a.w} h=${a.h}`));

console.log('\n=== Enemy Hit Areas ===');
areas.enemyHitAreas.forEach(a => console.log(`  Enemy ${a.index}: x=${a.x} y=${a.y} w=${a.w} h=${a.h}`));

console.log('\n=== Enemy Container Positions ===');
areas.enemyContainers.forEach((c, i) => console.log(`  Enemy ${i}: x=${c.x} y=${c.y}`));

console.log('\n=== Card Container Positions ===');
areas.cardContainers.forEach((c, i) => console.log(`  Card ${i}: x=${c.x} y=${c.y}`));

console.log('\n=== End Turn ===');
console.log(JSON.stringify(areas.endTurnHitArea));

await page.screenshot({ path: 'ui-debug.png', fullPage: true });

// Check all display objects in the scene
const displayList = await page.evaluate(() => {
  const scene = window.game.scene.scenes.find(s => s.sys.settings.key === 'CombatScene');
  const children = scene.children.list;
  return children.filter(c => c.type === 'Text' || c.type === 'Container' || c.type === 'Rectangle' || c.type === 'Circle').map(c => ({
    type: c.type,
    x: Math.round(c.x),
    y: Math.round(c.y),
    text: c.text?.substring(0, 40) || undefined,
    visible: c.visible,
    alpha: Math.round(c.alpha * 100) / 100,
    origin: c.originX != null ? `${c.originX},${c.originY}` : undefined,
  }));
});

console.log('\n=== All Display Objects ===');
displayList.forEach(d => {
  const label = d.text ? ` "${d.text}"` : '';
  console.log(`  ${d.type} (${d.x},${d.y})${label} vis=${d.visible} α=${d.alpha}`);
});

console.log(`\nErrors: ${errors.length}`);
errors.forEach(e => console.log('  ' + e.substring(0, 120)));

await browser.close();
