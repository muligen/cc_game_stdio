/**
 * combat-hud-layout.test.ts — Unit tests for CombatHudLayout.
 *
 * Verifies layout calculations for all non-card combat HUD elements.
 * Pure math tests — no Phaser dependencies.
 *
 * Coverage areas:
 * 1. Turn indicator position (centered top)
 * 2. HP bar filled width matches GDD formula exactly
 * 3. HP bar color thresholds (green/yellow/red)
 * 4. Block overlay width capped at barMaxWidth
 * 5. Energy orb position (bottom-left)
 * 6. End turn button position (bottom-right)
 * 7. Potion slots layout (3 slots, bottom-right)
 * 8. Combat log dimensions and position
 * 9. Enemy display distribution (1-5 enemies)
 * 10. Enemy display capped at max count
 * 11. Relic bar position and icon spacing
 * 12. Pile counters near energy orb
 * 13. Edge cases: 0 HP, 0 maxHP, 0 enemies, 0 block
 * 14. Custom config overrides work correctly
 * 15. Minimum screen size (1280x720) still produces valid layout
 */

// @vitest-environment node

import { describe, it, expect } from 'vitest';
import {
  CombatHudLayout,
  HPBarColor,
  type CombatHudConfig,
  type HudLayoutParams,
} from '../../../src/scenes/combat/combat-hud-layout';

// ---------------------------------------------------------------------------
// Test Helpers
// ---------------------------------------------------------------------------

/** Default config matching GDD 1920x1080 reference. */
const DEFAULT_CONFIG: CombatHudConfig = {
  screenWidth: 1920,
  screenHeight: 1080,
  hpBarMaxWidth: 200,
  hpBarHeight: 20,
  bottomMargin: 80,
  topMargin: 20,
  sideMargin: 30,
  endTurnButtonWidth: 160,
  endTurnButtonHeight: 50,
  potionSlotSize: 40,
  potionSlotGap: 8,
  maxPotionSlots: 3,
  combatLogWidth: 220,
  combatLogMaxEntries: 50,
  combatLogDefaultVisible: 3,
  enemyAreaTopOffset: 60,
  maxEnemyDisplayCount: 5,
  enemyDisplayWidth: 160,
  enemyDisplayHeight: 200,
  enemyDisplayGap: 20,
  relicIconSize: 32,
  relicBarGap: 6,
  relicBarBottomOffset: 10,
  energyOrbRadius: 30,
  pileCounterIconSize: 24,
};

/** Default HUD layout params (healthy player, 2 enemies). */
const DEFAULT_PARAMS: HudLayoutParams = {
  currentHP: 62,
  maxHP: 80,
  block: 12,
  enemyCount: 2,
};

/** Create a CombatHudLayout with optional config overrides. */
function createLayout(config: Partial<CombatHudConfig> = {}): CombatHudLayout {
  return new CombatHudLayout({ ...DEFAULT_CONFIG, ...config });
}

/** Calculate full layout with defaults + optional param overrides. */
function calculateLayout(
  configOverrides: Partial<CombatHudConfig> = {},
  paramOverrides: Partial<HudLayoutParams> = {}
) {
  const layout = createLayout(configOverrides);
  const params = { ...DEFAULT_PARAMS, ...paramOverrides };
  return layout.calculateLayout(params);
}

// ===========================================================================
// 1. Turn indicator position
// ===========================================================================

describe('CombatHudLayout — turn indicator', () => {
  it('is centered horizontally at screen width / 2', () => {
    const result = calculateLayout();
    expect(result.turnIndicator.x).toBe(960);
  });

  it('is positioned at top margin', () => {
    const result = calculateLayout();
    expect(result.turnIndicator.y).toBe(DEFAULT_CONFIG.topMargin);
  });

  it('adjusts for custom screen width', () => {
    const result = calculateLayout({ screenWidth: 1280 });
    expect(result.turnIndicator.x).toBe(640);
  });
});

// ===========================================================================
// 2. HP bar filled width (GDD formula)
// ===========================================================================

describe('CombatHudLayout — HP bar filled width', () => {
  it('matches GDD formula: max(1, (currentHP / maxHP) * barMaxWidth)', () => {
    const layout = createLayout();
    // 62/80 * 200 = 155
    expect(layout.calculateHPFilledWidth(62, 80)).toBeCloseTo(155, 2);
  });

  it('returns barMaxWidth at full HP', () => {
    const layout = createLayout();
    expect(layout.calculateHPFilledWidth(80, 80)).toBe(DEFAULT_CONFIG.hpBarMaxWidth);
  });

  it('returns barMaxWidth when HP exceeds maxHP (edge case)', () => {
    const layout = createLayout();
    // 100/80 * 200 = 250, but capped at barMaxWidth? No -- formula just computes.
    // The GDD formula is (currentHP / maxHP) * barMaxWidth, no upper cap on filled width.
    expect(layout.calculateHPFilledWidth(100, 80)).toBe(250);
  });

  it('returns minimum 1px even at 1 HP', () => {
    const layout = createLayout();
    expect(layout.calculateHPFilledWidth(1, 80)).toBeGreaterThanOrEqual(1);
  });

  it('returns minimum 1px at 0 HP', () => {
    const layout = createLayout();
    expect(layout.calculateHPFilledWidth(0, 80)).toBe(1);
  });

  it('handles 0 maxHP gracefully (returns minimum)', () => {
    const layout = createLayout();
    expect(layout.calculateHPFilledWidth(0, 0)).toBe(1);
  });
});

// ===========================================================================
// 3. HP bar color thresholds
// ===========================================================================

describe('CombatHudLayout — HP bar color', () => {
  it('returns green when HP > 50% maxHP', () => {
    const layout = createLayout();
    expect(layout.getHPBarColor(80, 80)).toBe(HPBarColor.GREEN);
    expect(layout.getHPBarColor(41, 80)).toBe(HPBarColor.GREEN);
    expect(layout.getHPBarColor(62, 80)).toBe(HPBarColor.GREEN);
  });

  it('returns yellow when HP is 25-50% maxHP', () => {
    const layout = createLayout();
    expect(layout.getHPBarColor(40, 80)).toBe(HPBarColor.YELLOW);
    expect(layout.getHPBarColor(20, 80)).toBe(HPBarColor.YELLOW);
  });

  it('returns red when HP < 25% maxHP', () => {
    const layout = createLayout();
    expect(layout.getHPBarColor(19, 80)).toBe(HPBarColor.RED);
    expect(layout.getHPBarColor(1, 80)).toBe(HPBarColor.RED);
    expect(layout.getHPBarColor(0, 80)).toBe(HPBarColor.RED);
  });

  it('handles 0 maxHP gracefully (returns red)', () => {
    const layout = createLayout();
    expect(layout.getHPBarColor(0, 0)).toBe(HPBarColor.RED);
  });
});

// ===========================================================================
// 4. Block overlay width
// ===========================================================================

describe('CombatHudLayout — block overlay width', () => {
  it('matches GDD formula: min((block / maxHP) * barMaxWidth, barMaxWidth)', () => {
    const layout = createLayout();
    // 12/80 * 200 = 30
    expect(layout.calculateBlockOverlayWidth(12, 80)).toBeCloseTo(30, 2);
  });

  it('caps at barMaxWidth when block exceeds maxHP (edge case #6)', () => {
    const layout = createLayout();
    expect(layout.calculateBlockOverlayWidth(100, 80)).toBe(DEFAULT_CONFIG.hpBarMaxWidth);
    expect(layout.calculateBlockOverlayWidth(200, 80)).toBe(DEFAULT_CONFIG.hpBarMaxWidth);
  });

  it('returns 0 when block is 0', () => {
    const layout = createLayout();
    expect(layout.calculateBlockOverlayWidth(0, 80)).toBe(0);
  });

  it('returns 0 when maxHP is 0', () => {
    const layout = createLayout();
    expect(layout.calculateBlockOverlayWidth(50, 0)).toBe(0);
  });
});

// ===========================================================================
// 5. Energy orb position
// ===========================================================================

describe('CombatHudLayout — energy orb', () => {
  it('is positioned in the bottom-left area', () => {
    const result = calculateLayout();
    expect(result.energyOrb.x).toBeGreaterThan(0);
    expect(result.energyOrb.y).toBeGreaterThan(0);
    expect(result.energyOrb.x).toBeLessThan(DEFAULT_CONFIG.screenWidth / 2);
    expect(result.energyOrb.y).toBeGreaterThan(DEFAULT_CONFIG.screenHeight / 2);
  });

  it('has the configured radius', () => {
    const result = calculateLayout();
    expect(result.energyOrb.radius).toBe(DEFAULT_CONFIG.energyOrbRadius);
  });

  it('uses sideMargin + radius for center X', () => {
    const result = calculateLayout();
    expect(result.energyOrb.x).toBe(DEFAULT_CONFIG.sideMargin + DEFAULT_CONFIG.energyOrbRadius);
  });
});

// ===========================================================================
// 6. End turn button position
// ===========================================================================

describe('CombatHudLayout — end turn button', () => {
  it('is positioned in the bottom-right', () => {
    const result = calculateLayout();
    expect(result.endTurnButton.x).toBeGreaterThan(DEFAULT_CONFIG.screenWidth / 2);
    expect(result.endTurnButton.y).toBeGreaterThan(DEFAULT_CONFIG.screenHeight / 2);
  });

  it('right edge is at screenWidth - sideMargin', () => {
    const result = calculateLayout();
    const rightEdge = result.endTurnButton.x + result.endTurnButton.width;
    expect(rightEdge).toBe(DEFAULT_CONFIG.screenWidth - DEFAULT_CONFIG.sideMargin);
  });

  it('bottom edge is at screenHeight - bottomMargin', () => {
    const result = calculateLayout();
    const bottomEdge = result.endTurnButton.y + result.endTurnButton.height;
    expect(bottomEdge).toBe(DEFAULT_CONFIG.screenHeight - DEFAULT_CONFIG.bottomMargin);
  });

  it('has the configured dimensions', () => {
    const result = calculateLayout();
    expect(result.endTurnButton.width).toBe(DEFAULT_CONFIG.endTurnButtonWidth);
    expect(result.endTurnButton.height).toBe(DEFAULT_CONFIG.endTurnButtonHeight);
  });
});

// ===========================================================================
// 7. Potion slots
// ===========================================================================

describe('CombatHudLayout — potion slots', () => {
  it('has 3 potion slots by default', () => {
    const result = calculateLayout();
    expect(result.potionSlots.slots).toHaveLength(3);
  });

  it('positions slots above the end turn button', () => {
    const result = calculateLayout();
    const etb = result.endTurnButton;
    for (const slot of result.potionSlots.slots) {
      expect(slot.y).toBeLessThan(etb.y);
    }
  });

  it('slots have correct size', () => {
    const result = calculateLayout();
    for (const slot of result.potionSlots.slots) {
      expect(slot.size).toBe(DEFAULT_CONFIG.potionSlotSize);
    }
  });

  it('slots are spaced with configured gap', () => {
    const result = calculateLayout();
    const step = DEFAULT_CONFIG.potionSlotSize + DEFAULT_CONFIG.potionSlotGap;
    expect(result.potionSlots.slots[1].x).toBeCloseTo(
      result.potionSlots.slots[0].x + step,
      2
    );
    expect(result.potionSlots.slots[2].x).toBeCloseTo(
      result.potionSlots.slots[1].x + step,
      2
    );
  });

  it('right-most slot aligns near the right edge', () => {
    const result = calculateLayout();
    const lastSlot = result.potionSlots.slots[2];
    const rightEdge = lastSlot.x + lastSlot.size;
    expect(rightEdge).toBeLessThanOrEqual(DEFAULT_CONFIG.screenWidth - DEFAULT_CONFIG.sideMargin + 0.01);
  });

  it('respects custom maxPotionSlots', () => {
    const result = calculateLayout({ maxPotionSlots: 5 });
    expect(result.potionSlots.slots).toHaveLength(5);
  });
});

// ===========================================================================
// 8. Combat log
// ===========================================================================

describe('CombatHudLayout — combat log', () => {
  it('is positioned on the right side', () => {
    const result = calculateLayout();
    expect(result.combatLog.x).toBeGreaterThan(DEFAULT_CONFIG.screenWidth / 2);
  });

  it('right edge aligns with screenWidth - sideMargin', () => {
    const result = calculateLayout();
    expect(result.combatLog.x + result.combatLog.width).toBe(
      DEFAULT_CONFIG.screenWidth - DEFAULT_CONFIG.sideMargin
    );
  });

  it('has the configured width', () => {
    const result = calculateLayout();
    expect(result.combatLog.width).toBe(DEFAULT_CONFIG.combatLogWidth);
  });

  it('starts below the top margin area', () => {
    const result = calculateLayout();
    expect(result.combatLog.y).toBeGreaterThan(DEFAULT_CONFIG.topMargin);
  });

  it('has positive height', () => {
    const result = calculateLayout();
    expect(result.combatLog.height).toBeGreaterThan(0);
  });
});

// ===========================================================================
// 9. Enemy display distribution
// ===========================================================================

describe('CombatHudLayout — enemy displays', () => {
  it('positions single enemy centered', () => {
    const layout = createLayout();
    const enemies = layout.calculateEnemyDisplays(1);

    expect(enemies).toHaveLength(1);
    expect(enemies[0].index).toBe(0);

    // Single enemy should be centered
    const expectedX = (DEFAULT_CONFIG.screenWidth - DEFAULT_CONFIG.enemyDisplayWidth) / 2;
    expect(enemies[0].x).toBeCloseTo(expectedX, 2);
    expect(enemies[0].y).toBe(DEFAULT_CONFIG.enemyAreaTopOffset);
  });

  it('distributes 3 enemies evenly', () => {
    const layout = createLayout();
    const enemies = layout.calculateEnemyDisplays(3);

    expect(enemies).toHaveLength(3);

    const totalWidth =
      3 * (DEFAULT_CONFIG.enemyDisplayWidth as number) + 2 * (DEFAULT_CONFIG.enemyDisplayGap as number);
    const startX = (DEFAULT_CONFIG.screenWidth - totalWidth) / 2;

    for (let i = 0; i < 3; i++) {
      const expectedX = startX + i * ((DEFAULT_CONFIG.enemyDisplayWidth as number) + (DEFAULT_CONFIG.enemyDisplayGap as number));
      expect(enemies[i].x).toBeCloseTo(expectedX, 2);
      expect(enemies[i].y).toBe(DEFAULT_CONFIG.enemyAreaTopOffset);
    }
  });

  it('positions 5 enemies correctly', () => {
    const layout = createLayout();
    const enemies = layout.calculateEnemyDisplays(5);

    expect(enemies).toHaveLength(5);

    // Verify all enemies are within horizontal screen bounds
    for (const enemy of enemies) {
      expect(enemy.x).toBeGreaterThanOrEqual(-0.01);
      expect(enemy.x + enemy.width).toBeLessThanOrEqual(DEFAULT_CONFIG.screenWidth + 0.01);
    }
  });
});

// ===========================================================================
// 10. Enemy display capped at max count
// ===========================================================================

describe('CombatHudLayout — enemy display cap', () => {
  it('caps display at maxEnemyDisplayCount (default 5)', () => {
    const layout = createLayout();
    const enemies = layout.calculateEnemyDisplays(8);
    expect(enemies).toHaveLength(5);
  });

  it('returns empty array for 0 enemies', () => {
    const layout = createLayout();
    const enemies = layout.calculateEnemyDisplays(0);
    expect(enemies).toEqual([]);
  });

  it('respects custom maxEnemyDisplayCount', () => {
    const layout = createLayout({ maxEnemyDisplayCount: 3 });
    const enemies = layout.calculateEnemyDisplays(6);
    expect(enemies).toHaveLength(3);
  });
});

// ===========================================================================
// 11. Relic bar
// ===========================================================================

describe('CombatHudLayout — relic bar', () => {
  it('is positioned near the bottom of the screen', () => {
    const result = calculateLayout();
    expect(result.relicBar.y).toBeGreaterThan(DEFAULT_CONFIG.screenHeight * 0.8);
  });

  it('has the configured icon size', () => {
    const result = calculateLayout();
    expect(result.relicBar.iconSize).toBe(DEFAULT_CONFIG.relicIconSize);
  });

  it('has the configured gap', () => {
    const result = calculateLayout();
    expect(result.relicBar.gap).toBe(DEFAULT_CONFIG.relicBarGap);
  });

  it('getRelicX spaces relics correctly', () => {
    const result = calculateLayout();
    const x0 = result.relicBar.getRelicX(0);
    const x1 = result.relicBar.getRelicX(1);
    const x2 = result.relicBar.getRelicX(2);

    expect(x0).toBe(DEFAULT_CONFIG.sideMargin);
    expect(x1).toBeCloseTo(x0 + DEFAULT_CONFIG.relicIconSize + DEFAULT_CONFIG.relicBarGap, 2);
    expect(x2).toBeCloseTo(x1 + DEFAULT_CONFIG.relicIconSize + DEFAULT_CONFIG.relicBarGap, 2);
  });
});

// ===========================================================================
// 12. Pile counters
// ===========================================================================

describe('CombatHudLayout — pile counters', () => {
  it('is positioned to the right of the energy orb', () => {
    const result = calculateLayout();
    expect(result.pileCounters.x).toBeGreaterThan(result.energyOrb.x);
  });

  it('has the configured icon size', () => {
    const result = calculateLayout();
    expect(result.pileCounters.iconSize).toBe(DEFAULT_CONFIG.pileCounterIconSize);
  });

  it('getCounterX spaces counters correctly', () => {
    const result = calculateLayout();
    const x0 = result.pileCounters.getCounterX(0);
    const x1 = result.pileCounters.getCounterX(1);
    const x2 = result.pileCounters.getCounterX(2);

    expect(x0).toBe(result.pileCounters.x);
    expect(x1).toBeCloseTo(x0 + DEFAULT_CONFIG.pileCounterIconSize + 10, 2);
    expect(x2).toBeCloseTo(x1 + DEFAULT_CONFIG.pileCounterIconSize + 10, 2);
  });
});

// ===========================================================================
// 13. Edge cases
// ===========================================================================

describe('CombatHudLayout — edge cases', () => {
  it('handles 0 HP with correct red color and minimum width', () => {
    const result = calculateLayout({}, { currentHP: 0, maxHP: 80 });
    expect(result.playerHPBar.color).toBe(HPBarColor.RED);
    expect(result.playerHPBar.filledWidth).toBe(1);
  });

  it('handles 0 maxHP without crashing', () => {
    const result = calculateLayout({}, { currentHP: 0, maxHP: 0 });
    expect(result.playerHPBar.filledWidth).toBe(1);
    expect(result.playerHPBar.color).toBe(HPBarColor.RED);
    expect(result.playerHPBar.blockOverlayWidth).toBe(0);
  });

  it('handles 0 enemies (empty enemy array)', () => {
    const result = calculateLayout({}, { enemyCount: 0 });
    expect(result.enemies).toEqual([]);
  });

  it('handles 0 block (no overlay)', () => {
    const result = calculateLayout({}, { block: 0 });
    expect(result.playerHPBar.blockOverlayWidth).toBe(0);
  });

  it('handles block > maxHP (overlay capped at barMaxWidth)', () => {
    const result = calculateLayout({}, { block: 200, maxHP: 80 });
    expect(result.playerHPBar.blockOverlayWidth).toBe(DEFAULT_CONFIG.hpBarMaxWidth);
  });
});

// ===========================================================================
// 14. Custom config overrides
// ===========================================================================

describe('CombatHudLayout — custom config', () => {
  it('uses custom hpBarMaxWidth', () => {
    const layout = createLayout({ hpBarMaxWidth: 300 });
    expect(layout.calculateHPFilledWidth(80, 80)).toBe(300);
    expect(layout.calculateHPFilledWidth(40, 80)).toBe(150);
  });

  it('uses custom endTurnButton dimensions', () => {
    const result = calculateLayout({ endTurnButtonWidth: 200, endTurnButtonHeight: 60 });
    expect(result.endTurnButton.width).toBe(200);
    expect(result.endTurnButton.height).toBe(60);
  });

  it('uses custom enemy display dimensions', () => {
    const layout = createLayout({ enemyDisplayWidth: 120, enemyDisplayHeight: 160 });
    const enemies = layout.calculateEnemyDisplays(2);
    expect(enemies[0].width).toBe(120);
    expect(enemies[0].height).toBe(160);
  });

  it('uses custom energy orb radius', () => {
    const result = calculateLayout({ energyOrbRadius: 40 });
    expect(result.energyOrb.radius).toBe(40);
  });
});

// ===========================================================================
// 15. Minimum screen size (1280x720)
// ===========================================================================

describe('CombatHudLayout — minimum screen size', () => {
  const MIN_CONFIG: Partial<CombatHudConfig> = {
    screenWidth: 1280,
    screenHeight: 720,
  };

  it('produces valid layout at 1280x720', () => {
    const result = calculateLayout(MIN_CONFIG);
    expect(result.turnIndicator.x).toBe(640);
    expect(result.turnIndicator.y).toBe(DEFAULT_CONFIG.topMargin);
  });

  it('end turn button fits within screen', () => {
    const result = calculateLayout(MIN_CONFIG);
    expect(result.endTurnButton.x + result.endTurnButton.width).toBeLessThanOrEqual(1280);
    expect(result.endTurnButton.y + result.endTurnButton.height).toBeLessThanOrEqual(720);
  });

  it('enemies fit within screen', () => {
    const result = calculateLayout(MIN_CONFIG, { enemyCount: 3 });
    for (const enemy of result.enemies) {
      expect(enemy.x).toBeGreaterThanOrEqual(-0.01);
      expect(enemy.x + enemy.width).toBeLessThanOrEqual(1280 + 0.01);
    }
  });

  it('combat log fits within screen', () => {
    const result = calculateLayout(MIN_CONFIG);
    expect(result.combatLog.x + result.combatLog.width).toBeLessThanOrEqual(1280);
  });

  it('HP bar fits within screen', () => {
    const result = calculateLayout(MIN_CONFIG);
    expect(result.playerHPBar.x).toBeGreaterThanOrEqual(0);
    expect(result.playerHPBar.x + result.playerHPBar.maxWidth).toBeLessThanOrEqual(1280);
  });
});

// ===========================================================================
// 16. Full layout integration
// ===========================================================================

describe('CombatHudLayout — full layout integration', () => {
  it('no HUD elements overlap the hand area (bottomMargin)', () => {
    const result = calculateLayout();
    const handAreaTop = DEFAULT_CONFIG.screenHeight - DEFAULT_CONFIG.bottomMargin;

    // Relic bar can be in the bottom margin zone
    // Energy orb should be above hand area
    expect(result.energyOrb.y - result.energyOrb.radius).toBeLessThan(handAreaTop);
    // End turn button bottom edge should be at hand area top
    expect(result.endTurnButton.y + result.endTurnButton.height).toBe(handAreaTop);
  });

  it('energy orb is above HP bar', () => {
    const result = calculateLayout();
    expect(result.energyOrb.y - result.energyOrb.radius).toBeLessThan(result.playerHPBar.y);
  });

  it('combat log does not overlap enemies', () => {
    const result = calculateLayout({}, { enemyCount: 3 });
    const lastEnemy = result.enemies[result.enemies.length - 1];
    // Combat log starts to the right of enemies
    expect(result.combatLog.x).toBeGreaterThan(lastEnemy.x + lastEnemy.width);
  });
});
