/**
 * enemy-display.test.ts — Unit tests for EnemyDisplay.
 *
 * Verifies layout calculation for enemy display in combat.
 * Pure math tests — no Phaser dependencies.
 *
 * Coverage areas:
 * 1. Empty enemies returns empty layout
 * 2. Single enemy centered horizontally
 * 3. Multiple enemies spread evenly with correct gap
 * 4. HP bar width follows GDD formula
 * 5. HP bar color thresholds (green/yellow/red)
 * 6. Block overlay width capped at barMaxWidth
 * 7. Intent visibility and positioning
 * 8. Dead enemies included with isAlive=false
 * 9. Targeting highlight state
 * 10. Hover state
 * 11. Block value display
 * 12. Edge cases: 0 HP, 0 block, no intent
 * 13. Many enemies (5+)
 */

// @vitest-environment node

import { describe, it, expect } from 'vitest';
import {
  EnemyDisplay,
  type EnemyDisplayConfig,
  type EnemyLayoutResult,
  HPBarColor,
} from '../../../src/scenes/combat/enemy-display';
import type { UIEnemyState, UIIntentData } from '../../../src/scenes/combat/combat-ui-state';

// ---------------------------------------------------------------------------
// Test Helpers
// ---------------------------------------------------------------------------

/** Default config with known screen dimensions for predictable tests. */
const DEFAULT_CONFIG: EnemyDisplayConfig = {
  hpBarMaxWidth: 200,
  hpBarHeight: 16,
  blockOverlayHeight: 16,
  panelWidth: 160,
  panelHeight: 220,
  gap: 40,
  topMargin: 80,
  hpBarYOffset: 0,
  intentYOffset: -40,
  blockValueYOffset: -20,
  screenWidth: 1920,
  screenHeight: 1080,
};

/** Create an EnemyDisplay with default config. */
function createDisplay(config: Partial<EnemyDisplayConfig> = {}): EnemyDisplay {
  return new EnemyDisplay({ ...DEFAULT_CONFIG, ...config });
}

/** Create a UIEnemyState for testing. */
function makeEnemy(overrides: Partial<UIEnemyState> = {}): UIEnemyState {
  return {
    instanceId: `enemy_${Math.random().toString(36).slice(2, 8)}`,
    name: 'Slime',
    currentHP: 50,
    maxHP: 50,
    block: 0,
    isAlive: true,
    intent: null,
    ...overrides,
  };
}

/** Create an array of N enemies with sequential instance IDs. */
function makeEnemies(count: number, overrides: Partial<UIEnemyState> = {}): UIEnemyState[] {
  return Array.from({ length: count }, (_, i) =>
    makeEnemy({ instanceId: `enemy_${i}`, name: `Enemy ${i}`, ...overrides })
  );
}

/** Create a UIIntentData for testing. */
function makeIntent(overrides: Partial<UIIntentData> = {}): UIIntentData {
  return {
    intentType: 'attack',
    displayDamage: 10,
    blockAmount: 0,
    effectName: null,
    ...overrides,
  };
}

/** Helper: calculate expected panel center X. */
function expectedPanelX(index: number, count: number, config: EnemyDisplayConfig = DEFAULT_CONFIG): number {
  const panelWidth = config.panelWidth ?? 160;
  const gap = config.gap ?? 40;
  const totalWidth = count * panelWidth + (count - 1) * gap;
  const startX = (config.screenWidth - totalWidth) / 2;
  return startX + index * (panelWidth + gap) + panelWidth / 2;
}

/** Helper: calculate expected HP bar filled width. */
function expectedHPBarWidth(currentHP: number, maxHP: number, config: EnemyDisplayConfig = DEFAULT_CONFIG): number {
  const barMaxWidth = config.hpBarMaxWidth ?? 200;
  if (maxHP <= 0) return 1;
  const ratio = Math.max(0, currentHP) / maxHP;
  return Math.max(1, ratio * barMaxWidth);
}

// ===========================================================================
// 1. Empty enemies
// ===========================================================================

describe('EnemyDisplay — empty enemies', () => {
  it('returns empty array for empty enemies', () => {
    const display = createDisplay();
    const layout = display.calculateLayout([], null, null);
    expect(layout).toEqual([]);
  });
});

// ===========================================================================
// 2. Single enemy centered
// ===========================================================================

describe('EnemyDisplay — single enemy', () => {
  it('centers a single enemy horizontally', () => {
    const display = createDisplay();
    const enemies = makeEnemies(1);
    const layout = display.calculateLayout(enemies, null, null);

    expect(layout).toHaveLength(1);

    const expectedX = DEFAULT_CONFIG.screenWidth / 2;
    expect(layout[0].x).toBeCloseTo(expectedX, 2);
    expect(layout[0].y).toBe(DEFAULT_CONFIG.topMargin);
    expect(layout[0].width).toBe(DEFAULT_CONFIG.panelWidth);
    expect(layout[0].height).toBe(DEFAULT_CONFIG.panelHeight);
  });
});

// ===========================================================================
// 3. Multiple enemies spread evenly
// ===========================================================================

describe('EnemyDisplay — multiple enemies spread', () => {
  it('positions 3 enemies with correct spacing', () => {
    const display = createDisplay();
    const enemies = makeEnemies(3);
    const layout = display.calculateLayout(enemies, null, null);

    expect(layout).toHaveLength(3);

    for (let i = 0; i < 3; i++) {
      expect(layout[i].x).toBeCloseTo(expectedPanelX(i, 3), 2);
      expect(layout[i].y).toBe(DEFAULT_CONFIG.topMargin);
    }

    // Verify gap between consecutive panels (distance between centers)
    const centerGap = layout[1].x - layout[0].x;
    expect(centerGap).toBe(DEFAULT_CONFIG.panelWidth + DEFAULT_CONFIG.gap);
  });

  it('positions 5 enemies within screen bounds', () => {
    const display = createDisplay();
    const enemies = makeEnemies(5);
    const layout = display.calculateLayout(enemies, null, null);

    expect(layout).toHaveLength(5);

    // First panel left edge
    const firstLeft = layout[0].x - DEFAULT_CONFIG.panelWidth / 2;
    // Last panel right edge
    const lastRight = layout[4].x + DEFAULT_CONFIG.panelWidth / 2;

    expect(firstLeft).toBeGreaterThanOrEqual(-0.01);
    expect(lastRight).toBeLessThanOrEqual(DEFAULT_CONFIG.screenWidth + 0.01);
  });
});

// ===========================================================================
// 4. HP bar width
// ===========================================================================

describe('EnemyDisplay — HP bar width', () => {
  it('full HP produces full bar width', () => {
    const display = createDisplay();
    const enemies = makeEnemies(1, { currentHP: 50, maxHP: 50 });
    const layout = display.calculateLayout(enemies, null, null);

    expect(layout[0].hpBar.filledWidth).toBeCloseTo(DEFAULT_CONFIG.hpBarMaxWidth, 2);
  });

  it('half HP produces half bar width', () => {
    const display = createDisplay();
    const enemies = makeEnemies(1, { currentHP: 25, maxHP: 50 });
    const layout = display.calculateLayout(enemies, null, null);

    expect(layout[0].hpBar.filledWidth).toBeCloseTo(DEFAULT_CONFIG.hpBarMaxWidth / 2, 2);
  });

  it('1 HP produces minimum 1px bar width', () => {
    const display = createDisplay();
    const enemies = makeEnemies(1, { currentHP: 1, maxHP: 100 });
    const layout = display.calculateLayout(enemies, null, null);

    expect(layout[0].hpBar.filledWidth).toBeGreaterThanOrEqual(1);
  });

  it('0 HP still shows minimum 1px bar', () => {
    const display = createDisplay();
    const enemies = makeEnemies(1, { currentHP: 0, maxHP: 50 });
    const layout = display.calculateLayout(enemies, null, null);

    expect(layout[0].hpBar.filledWidth).toBe(1);
  });

  it('calculateHPBarWidth matches GDD formula', () => {
    const display = createDisplay();

    // Various HP ratios
    const testCases: [number, number][] = [
      [100, 100],
      [75, 100],
      [50, 100],
      [25, 100],
      [1, 100],
      [0, 100],
      [30, 60],
    ];

    for (const [currentHP, maxHP] of testCases) {
      const result = display.calculateHPBarWidth(currentHP, maxHP);
      const expected = expectedHPBarWidth(currentHP, maxHP);
      expect(result).toBeCloseTo(expected, 2);
    }
  });

  it('negative HP clamps to 0 ratio', () => {
    const display = createDisplay();
    const enemies = makeEnemies(1, { currentHP: -10, maxHP: 50 });
    const layout = display.calculateLayout(enemies, null, null);

    expect(layout[0].hpBar.filledWidth).toBe(1);
  });
});

// ===========================================================================
// 5. HP bar color
// ===========================================================================

describe('EnemyDisplay — HP bar color', () => {
  it('full HP is green', () => {
    const display = createDisplay();
    expect(display.getHPBarColor(100, 100)).toBe(HPBarColor.GREEN);
  });

  it('75% HP is green (> 50%)', () => {
    const display = createDisplay();
    expect(display.getHPBarColor(75, 100)).toBe(HPBarColor.GREEN);
  });

  it('51% HP is green', () => {
    const display = createDisplay();
    expect(display.getHPBarColor(51, 100)).toBe(HPBarColor.GREEN);
  });

  it('50% HP is yellow (at boundary, not > 50%)', () => {
    const display = createDisplay();
    expect(display.getHPBarColor(50, 100)).toBe(HPBarColor.YELLOW);
  });

  it('40% HP is yellow', () => {
    const display = createDisplay();
    expect(display.getHPBarColor(40, 100)).toBe(HPBarColor.YELLOW);
  });

  it('26% HP is yellow', () => {
    const display = createDisplay();
    expect(display.getHPBarColor(26, 100)).toBe(HPBarColor.YELLOW);
  });

  it('25% HP is red (at boundary, not > 25%)', () => {
    const display = createDisplay();
    expect(display.getHPBarColor(25, 100)).toBe(HPBarColor.RED);
  });

  it('10% HP is red', () => {
    const display = createDisplay();
    expect(display.getHPBarColor(10, 100)).toBe(HPBarColor.RED);
  });

  it('1% HP is red', () => {
    const display = createDisplay();
    expect(display.getHPBarColor(1, 100)).toBe(HPBarColor.RED);
  });

  it('0 HP is red', () => {
    const display = createDisplay();
    expect(display.getHPBarColor(0, 100)).toBe(HPBarColor.RED);
  });

  it('0 maxHP returns red', () => {
    const display = createDisplay();
    expect(display.getHPBarColor(0, 0)).toBe(HPBarColor.RED);
  });

  it('color is included in layout results', () => {
    const display = createDisplay();
    const enemies = [
      makeEnemy({ instanceId: 'e0', currentHP: 80, maxHP: 100 }),
      makeEnemy({ instanceId: 'e1', currentHP: 40, maxHP: 100 }),
      makeEnemy({ instanceId: 'e2', currentHP: 10, maxHP: 100 }),
    ];
    const layout = display.calculateLayout(enemies, null, null);

    expect(layout[0].hpBar.color).toBe(HPBarColor.GREEN);
    expect(layout[1].hpBar.color).toBe(HPBarColor.YELLOW);
    expect(layout[2].hpBar.color).toBe(HPBarColor.RED);
  });
});

// ===========================================================================
// 6. Block overlay width
// ===========================================================================

describe('EnemyDisplay — block overlay width', () => {
  it('0 block produces 0 width overlay', () => {
    const display = createDisplay();
    expect(display.calculateBlockOverlayWidth(0, 50)).toBe(0);
  });

  it('block proportional to maxHP produces proportional width', () => {
    const display = createDisplay();
    // block=25, maxHP=50 -> ratio 0.5 -> half of barMaxWidth
    const result = display.calculateBlockOverlayWidth(25, 50);
    expect(result).toBeCloseTo(DEFAULT_CONFIG.hpBarMaxWidth / 2, 2);
  });

  it('block overlay capped at barMaxWidth when block exceeds maxHP', () => {
    const display = createDisplay();
    // block=100, maxHP=50 -> ratio 2.0 -> would be 2x barMaxWidth, capped
    const result = display.calculateBlockOverlayWidth(100, 50);
    expect(result).toBe(DEFAULT_CONFIG.hpBarMaxWidth);
  });

  it('block overlay in layout matches formula', () => {
    const display = createDisplay();
    const enemies = makeEnemies(1, { block: 15, maxHP: 50 });
    const layout = display.calculateLayout(enemies, null, null);

    const expectedWidth = Math.min((15 / 50) * DEFAULT_CONFIG.hpBarMaxWidth, DEFAULT_CONFIG.hpBarMaxWidth);
    expect(layout[0].blockOverlay.filledWidth).toBeCloseTo(expectedWidth, 2);
  });

  it('negative block produces 0 width', () => {
    const display = createDisplay();
    expect(display.calculateBlockOverlayWidth(-5, 50)).toBe(0);
  });

  it('zero maxHP produces 0 width', () => {
    const display = createDisplay();
    expect(display.calculateBlockOverlayWidth(10, 0)).toBe(0);
  });
});

// ===========================================================================
// 7. Intent visibility and positioning
// ===========================================================================

describe('EnemyDisplay — intent display', () => {
  it('intent is hidden when enemy has no intent', () => {
    const display = createDisplay();
    const enemies = makeEnemies(1, { intent: null });
    const layout = display.calculateLayout(enemies, null, null);

    expect(layout[0].intent.visible).toBe(false);
    expect(layout[0].intent.data).toBeNull();
  });

  it('intent is visible when enemy has intent data', () => {
    const display = createDisplay();
    const intent = makeIntent({ intentType: 'attack', displayDamage: 15 });
    const enemies = makeEnemies(1, { intent });
    const layout = display.calculateLayout(enemies, null, null);

    expect(layout[0].intent.visible).toBe(true);
    expect(layout[0].intent.data).toBe(intent);
    expect(layout[0].intent.data!.intentType).toBe('attack');
    expect(layout[0].intent.data!.displayDamage).toBe(15);
  });

  it('intent is hidden for dead enemies even if intent data exists', () => {
    const display = createDisplay();
    const intent = makeIntent();
    const enemies = makeEnemies(1, { isAlive: false, intent });
    const layout = display.calculateLayout(enemies, null, null);

    expect(layout[0].intent.visible).toBe(false);
  });

  it('intent X is centered on panel', () => {
    const display = createDisplay();
    const intent = makeIntent();
    const enemies = makeEnemies(1, { intent });
    const layout = display.calculateLayout(enemies, null, null);

    expect(layout[0].intent.x).toBe(layout[0].x);
  });

  it('intent Y is at topMargin + intentYOffset', () => {
    const display = createDisplay();
    const intent = makeIntent();
    const enemies = makeEnemies(1, { intent });
    const layout = display.calculateLayout(enemies, null, null);

    expect(layout[0].intent.y).toBe(DEFAULT_CONFIG.topMargin + DEFAULT_CONFIG.intentYOffset);
  });
});

// ===========================================================================
// 8. Dead enemies
// ===========================================================================

describe('EnemyDisplay — dead enemies', () => {
  it('dead enemies are included in layout with isAlive=false', () => {
    const display = createDisplay();
    const enemies = [
      makeEnemy({ instanceId: 'e0', isAlive: true }),
      makeEnemy({ instanceId: 'e1', isAlive: false }),
      makeEnemy({ instanceId: 'e2', isAlive: true }),
    ];
    const layout = display.calculateLayout(enemies, null, null);

    expect(layout).toHaveLength(3);
    expect(layout[0].isAlive).toBe(true);
    expect(layout[1].isAlive).toBe(false);
    expect(layout[2].isAlive).toBe(true);
  });

  it('dead enemies still get valid positions', () => {
    const display = createDisplay();
    const enemies = [
      makeEnemy({ instanceId: 'e0', isAlive: false }),
    ];
    const layout = display.calculateLayout(enemies, null, null);

    expect(layout[0].x).toBeCloseTo(DEFAULT_CONFIG.screenWidth / 2, 2);
    expect(layout[0].y).toBe(DEFAULT_CONFIG.topMargin);
  });

  it('dead enemies are not targetable', () => {
    const display = createDisplay();
    const enemies = [
      makeEnemy({ instanceId: 'e0', isAlive: false }),
    ];
    const layout = display.calculateLayout(enemies, null, 0, true);

    expect(layout[0].isTargeted).toBe(false);
  });

  it('each layout result carries the source enemy reference', () => {
    const display = createDisplay();
    const enemies = makeEnemies(3);
    const layout = display.calculateLayout(enemies, null, null);

    expect(layout[0].enemy).toBe(enemies[0]);
    expect(layout[1].enemy).toBe(enemies[1]);
    expect(layout[2].enemy).toBe(enemies[2]);
  });
});

// ===========================================================================
// 9. Targeting highlight
// ===========================================================================

describe('EnemyDisplay — targeting highlight', () => {
  it('targeted enemy has isTargeted=true when isTargeting is true', () => {
    const display = createDisplay();
    const enemies = makeEnemies(3);
    const layout = display.calculateLayout(enemies, null, 1, true);

    expect(layout[0].isTargeted).toBe(false);
    expect(layout[1].isTargeted).toBe(true);
    expect(layout[2].isTargeted).toBe(false);
  });

  it('no targeting when isTargeting is false', () => {
    const display = createDisplay();
    const enemies = makeEnemies(3);
    const layout = display.calculateLayout(enemies, null, 1, false);

    for (const result of layout) {
      expect(result.isTargeted).toBe(false);
    }
  });

  it('null targetedIndex produces no targeting', () => {
    const display = createDisplay();
    const enemies = makeEnemies(3);
    const layout = display.calculateLayout(enemies, null, null, true);

    for (const result of layout) {
      expect(result.isTargeted).toBe(false);
    }
  });

  it('dead enemy cannot be targeted even if targetedIndex matches', () => {
    const display = createDisplay();
    const enemies = [
      makeEnemy({ instanceId: 'e0', isAlive: false }),
    ];
    const layout = display.calculateLayout(enemies, null, 0, true);

    expect(layout[0].isTargeted).toBe(false);
  });
});

// ===========================================================================
// 10. Hover state
// ===========================================================================

describe('EnemyDisplay — hover state', () => {
  it('hovered enemy has isHovered=true', () => {
    const display = createDisplay();
    const enemies = makeEnemies(3);
    const layout = display.calculateLayout(enemies, 1, null);

    expect(layout[0].isHovered).toBe(false);
    expect(layout[1].isHovered).toBe(true);
    expect(layout[2].isHovered).toBe(false);
  });

  it('null hoveredIndex produces no hover', () => {
    const display = createDisplay();
    const enemies = makeEnemies(3);
    const layout = display.calculateLayout(enemies, null, null);

    for (const result of layout) {
      expect(result.isHovered).toBe(false);
    }
  });

  it('hover and target can both be on the same enemy', () => {
    const display = createDisplay();
    const enemies = makeEnemies(3);
    const layout = display.calculateLayout(enemies, 1, 1, true);

    expect(layout[1].isHovered).toBe(true);
    expect(layout[1].isTargeted).toBe(true);
  });
});

// ===========================================================================
// 11. Block value display
// ===========================================================================

describe('EnemyDisplay — block value', () => {
  it('block value is carried into layout', () => {
    const display = createDisplay();
    const enemies = makeEnemies(1, { block: 12 });
    const layout = display.calculateLayout(enemies, null, null);

    expect(layout[0].blockOverlay.blockValue).toBe(12);
  });

  it('0 block produces 0 block value', () => {
    const display = createDisplay();
    const enemies = makeEnemies(1, { block: 0 });
    const layout = display.calculateLayout(enemies, null, null);

    expect(layout[0].blockOverlay.blockValue).toBe(0);
  });
});

// ===========================================================================
// 12. Edge cases
// ===========================================================================

describe('EnemyDisplay — edge cases', () => {
  it('0 maxHP still produces layout without crashing', () => {
    const display = createDisplay();
    const enemies = makeEnemies(1, { currentHP: 0, maxHP: 0 });
    const layout = display.calculateLayout(enemies, null, null);

    expect(layout).toHaveLength(1);
    expect(layout[0].hpBar.filledWidth).toBe(1);
    expect(layout[0].hpBar.color).toBe(HPBarColor.RED);
    expect(layout[0].blockOverlay.filledWidth).toBe(0);
  });

  it('very high block produces overlay capped at barMaxWidth', () => {
    const display = createDisplay();
    const enemies = makeEnemies(1, { block: 999, maxHP: 50 });
    const layout = display.calculateLayout(enemies, null, null);

    expect(layout[0].blockOverlay.filledWidth).toBe(DEFAULT_CONFIG.hpBarMaxWidth);
  });

  it('each layout result carries correct index', () => {
    const display = createDisplay();
    const enemies = makeEnemies(5);
    const layout = display.calculateLayout(enemies, null, null);

    for (let i = 0; i < 5; i++) {
      expect(layout[i].index).toBe(i);
    }
  });
});

// ===========================================================================
// 13. Many enemies (5+)
// ===========================================================================

describe('EnemyDisplay — many enemies', () => {
  it('5 enemies all get valid positions', () => {
    const display = createDisplay();
    const enemies = makeEnemies(5);
    const layout = display.calculateLayout(enemies, null, null);

    expect(layout).toHaveLength(5);

    for (let i = 0; i < 5; i++) {
      expect(isFinite(layout[i].x)).toBe(true);
      expect(isFinite(layout[i].y)).toBe(true);
      expect(layout[i].x).toBeCloseTo(expectedPanelX(i, 5), 2);
    }
  });

  it('positions match expected formula for various enemy counts', () => {
    const display = createDisplay();

    for (const count of [1, 2, 3, 4, 5]) {
      const enemies = makeEnemies(count);
      const layout = display.calculateLayout(enemies, null, null);

      for (let i = 0; i < count; i++) {
        expect(layout[i].x).toBeCloseTo(expectedPanelX(i, count), 2);
      }
    }
  });
});
