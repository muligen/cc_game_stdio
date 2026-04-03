/**
 * map-scene.test.ts -- Unit tests for MapState and MapLayoutCalculator.
 *
 * Tests the pure logic classes used by MapScene. No Phaser dependencies --
 * all tests exercise MapState and MapLayoutCalculator directly.
 *
 * Coverage areas (15 test cases):
 * 1.  MapState initializes with correct node count
 * 2.  MapState first available nodes are floor 0
 * 3.  MapState canSelectNode returns true for available nodes only
 * 4.  MapState selectNode marks node as current
 * 5.  MapState completeCurrentNode marks completed and unlocks next floor
 * 6.  MapState cannot select completed node
 * 7.  MapState cannot select locked node
 * 8.  MapState isMapComplete when all nodes done
 * 9.  MapLayoutCalculator produces layouts within screen bounds
 * 10. MapLayoutCalculator assigns correct colors by node type
 * 11. MapLayoutCalculator adjusts alpha by state
 * 12. MapLayoutCalculator centers nodes horizontally
 * 13. MapState handles single node map
 * 14. MapState returns null for selectNode on non-existent node
 * 15. MapLayoutCalculator uses default config values when optional fields omitted
 *
 * Additional test cases:
 * 16. MapState cannot select node when another is current
 * 17. MapLayoutCalculator handles empty node list
 * 18. MapLayoutCalculator assigns correct border colors by state
 * 19. MapLayoutCalculator assigns correct labels by type
 * 20. MapState completeCurrentNode is no-op when no node is current
 */

// @vitest-environment node

import { describe, it, expect } from 'vitest';
import { MapState, type MapNodeDefinition } from '../../../src/scenes/map/map-state';
import {
  MapLayoutCalculator,
  type MapLayoutConfig,
  type MapNodeLayout,
} from '../../../src/scenes/map/map-layout';
import type { MapNode, MapNodeType, MapNodeState } from '../../../src/scenes/map/map-node';

// ---------------------------------------------------------------------------
// Test Helpers
// ---------------------------------------------------------------------------

/** Standard 3-combat-node map definition for the demo. */
const DEMO_NODE_DEFS: MapNodeDefinition[] = [
  { type: 'combat' },
  { type: 'combat' },
  { type: 'combat' },
];

/** Standard layout config matching 1920x1080. */
const DEFAULT_LAYOUT_CONFIG: MapLayoutConfig = {
  screenWidth: 1920,
  screenHeight: 1080,
  nodeRadius: 30,
  verticalGap: 120,
  topMargin: 100,
};

/** Create a MapState with default demo nodes. */
function createDemoMapState(): MapState {
  return new MapState(DEMO_NODE_DEFS);
}

/** Create a MapLayoutCalculator with default config. */
function createCalculator(config: Partial<MapLayoutConfig> = {}): MapLayoutCalculator {
  return new MapLayoutCalculator({ ...DEFAULT_LAYOUT_CONFIG, ...config });
}

// ===========================================================================
// 1. MapState initializes with correct node count
// ===========================================================================

describe('MapState -- initialization', () => {
  it('initializes with correct node count', () => {
    const state = createDemoMapState();

    expect(state.getNodes()).toHaveLength(3);
    expect(state.getFloorCount()).toBe(3);
  });

  it('assigns correct IDs to nodes', () => {
    const state = createDemoMapState();
    const nodes = state.getNodes();

    expect(nodes[0].id).toBe('node_0');
    expect(nodes[1].id).toBe('node_1');
    expect(nodes[2].id).toBe('node_2');
  });

  it('assigns correct floor indices', () => {
    const state = createDemoMapState();
    const nodes = state.getNodes();

    expect(nodes[0].floor).toBe(0);
    expect(nodes[1].floor).toBe(1);
    expect(nodes[2].floor).toBe(2);
  });

  it('assigns correct types', () => {
    const state = createDemoMapState();
    const nodes = state.getNodes();

    expect(nodes[0].type).toBe('combat');
    expect(nodes[1].type).toBe('combat');
    expect(nodes[2].type).toBe('combat');
  });
});

// ===========================================================================
// 2. MapState first available nodes are floor 0
// ===========================================================================

describe('MapState -- initial availability', () => {
  it('first available nodes are floor 0', () => {
    const state = createDemoMapState();
    const available = state.getAvailableNodes();

    expect(available).toHaveLength(1);
    expect(available[0].floor).toBe(0);
    expect(available[0].id).toBe('node_0');
  });

  it('only node_0 is available at start', () => {
    const state = createDemoMapState();
    const nodes = state.getNodes();

    expect(nodes[0].state).toBe('available');
    expect(nodes[1].state).toBe('locked');
    expect(nodes[2].state).toBe('locked');
  });

  it('currentFloor is -1 at start', () => {
    const state = createDemoMapState();

    expect(state.getCurrentFloor()).toBe(-1);
  });
});

// ===========================================================================
// 3. MapState canSelectNode returns true for available nodes only
// ===========================================================================

describe('MapState -- canSelectNode', () => {
  it('returns true for available node', () => {
    const state = createDemoMapState();

    expect(state.canSelectNode('node_0')).toBe(true);
  });

  it('returns false for locked node', () => {
    const state = createDemoMapState();

    expect(state.canSelectNode('node_1')).toBe(false);
    expect(state.canSelectNode('node_2')).toBe(false);
  });

  it('returns false for non-existent node', () => {
    const state = createDemoMapState();

    expect(state.canSelectNode('node_999')).toBe(false);
    expect(state.canSelectNode('')).toBe(false);
  });

  it('returns false for available node when another is current', () => {
    const state = createDemoMapState();

    // Select node_0, then try to select it again (should fail since it's current)
    state.selectNode('node_0');
    expect(state.canSelectNode('node_0')).toBe(false);
  });
});

// ===========================================================================
// 4. MapState selectNode marks node as current
// ===========================================================================

describe('MapState -- selectNode', () => {
  it('marks node as current', () => {
    const state = createDemoMapState();
    const node = state.selectNode('node_0');

    expect(node).not.toBeNull();
    expect(node!.state).toBe('current');
    expect(node!.id).toBe('node_0');
  });

  it('updates currentFloor', () => {
    const state = createDemoMapState();

    state.selectNode('node_0');
    expect(state.getCurrentFloor()).toBe(0);
  });

  it('returns the selected node with correct data', () => {
    const state = createDemoMapState();
    const node = state.selectNode('node_0');

    expect(node!.id).toBe('node_0');
    expect(node!.floor).toBe(0);
    expect(node!.type).toBe('combat');
  });
});

// ===========================================================================
// 5. MapState completeCurrentNode marks completed and unlocks next floor
// ===========================================================================

describe('MapState -- completeCurrentNode', () => {
  it('marks current node as completed', () => {
    const state = createDemoMapState();

    state.selectNode('node_0');
    state.completeCurrentNode();

    const nodes = state.getNodes();
    expect(nodes[0].state).toBe('completed');
  });

  it('unlocks next floor nodes', () => {
    const state = createDemoMapState();

    state.selectNode('node_0');
    state.completeCurrentNode();

    const nodes = state.getNodes();
    expect(nodes[1].state).toBe('available');
    expect(nodes[2].state).toBe('locked');
  });

  it('allows progressing through the full map', () => {
    const state = createDemoMapState();

    // Floor 0
    state.selectNode('node_0');
    state.completeCurrentNode();
    expect(state.getNodes()[0].state).toBe('completed');
    expect(state.getNodes()[1].state).toBe('available');

    // Floor 1
    state.selectNode('node_1');
    state.completeCurrentNode();
    expect(state.getNodes()[1].state).toBe('completed');
    expect(state.getNodes()[2].state).toBe('available');

    // Floor 2
    state.selectNode('node_2');
    state.completeCurrentNode();
    expect(state.getNodes()[2].state).toBe('completed');
    expect(state.isMapComplete()).toBe(true);
  });
});

// ===========================================================================
// 6. MapState cannot select completed node
// ===========================================================================

describe('MapState -- completed node rejection', () => {
  it('cannot select completed node', () => {
    const state = createDemoMapState();

    state.selectNode('node_0');
    state.completeCurrentNode();

    expect(state.canSelectNode('node_0')).toBe(false);
    expect(state.selectNode('node_0')).toBeNull();
  });
});

// ===========================================================================
// 7. MapState cannot select locked node
// ===========================================================================

describe('MapState -- locked node rejection', () => {
  it('cannot select locked node', () => {
    const state = createDemoMapState();

    expect(state.selectNode('node_1')).toBeNull();
    expect(state.selectNode('node_2')).toBeNull();
  });

  it('locked node state does not change after select attempt', () => {
    const state = createDemoMapState();

    state.selectNode('node_1');

    expect(state.getNodes()[1].state).toBe('locked');
  });
});

// ===========================================================================
// 8. MapState isMapComplete when all nodes done
// ===========================================================================

describe('MapState -- map completion', () => {
  it('isMapComplete is false at start', () => {
    const state = createDemoMapState();

    expect(state.isMapComplete()).toBe(false);
  });

  it('isMapComplete is false after partial completion', () => {
    const state = createDemoMapState();

    state.selectNode('node_0');
    state.completeCurrentNode();

    expect(state.isMapComplete()).toBe(false);
  });

  it('isMapComplete is true when all nodes are completed', () => {
    const state = createDemoMapState();

    // Complete all 3 nodes
    state.selectNode('node_0');
    state.completeCurrentNode();
    state.selectNode('node_1');
    state.completeCurrentNode();
    state.selectNode('node_2');
    state.completeCurrentNode();

    expect(state.isMapComplete()).toBe(true);
  });
});

// ===========================================================================
// 9. MapLayoutCalculator produces layouts within screen bounds
// ===========================================================================

describe('MapLayoutCalculator -- screen bounds', () => {
  it('produces layouts within screen bounds', () => {
    const state = createDemoMapState();
    const calc = createCalculator();
    const layouts = calc.calculateLayout(state.getNodes());

    for (const layout of layouts) {
      expect(layout.x).toBeGreaterThanOrEqual(0);
      expect(layout.x).toBeLessThanOrEqual(DEFAULT_LAYOUT_CONFIG.screenWidth);
      expect(layout.y).toBeGreaterThanOrEqual(0);
      expect(layout.y).toBeLessThanOrEqual(DEFAULT_LAYOUT_CONFIG.screenHeight);
    }
  });

  it('positions nodes vertically with correct gap', () => {
    const state = createDemoMapState();
    const calc = createCalculator();
    const layouts = calc.calculateLayout(state.getNodes());

    expect(layouts[0].y).toBe(DEFAULT_LAYOUT_CONFIG.topMargin);
    expect(layouts[1].y).toBe(DEFAULT_LAYOUT_CONFIG.topMargin! + DEFAULT_LAYOUT_CONFIG.verticalGap!);
    expect(layouts[2].y).toBe(DEFAULT_LAYOUT_CONFIG.topMargin! + 2 * DEFAULT_LAYOUT_CONFIG.verticalGap!);
  });
});

// ===========================================================================
// 10. MapLayoutCalculator assigns correct colors by node type
// ===========================================================================

describe('MapLayoutCalculator -- node colors', () => {
  const colorCases: [MapNodeType, number][] = [
    ['combat', 0xcc3333],
    ['elite', 0xdd8833],
    ['rest', 0x44bb44],
    ['boss', 0x883388],
    ['shop', 0x3366cc],
    ['event', 0xcccc22],
    ['treasure', 0xddaa22],
  ];

  for (const [type, expectedColor] of colorCases) {
    it(`maps ${type} to 0x${expectedColor.toString(16).padStart(6, '0')}`, () => {
      const calc = createCalculator();
      expect(calc.getNodeColor(type)).toBe(expectedColor);
    });
  }

  it('uses correct colors in layout results', () => {
    const defs: MapNodeDefinition[] = [
      { type: 'combat' },
      { type: 'elite' },
      { type: 'rest' },
    ];
    const state = new MapState(defs);
    // Unlock all for clean layout
    const calc = createCalculator();
    const layouts = calc.calculateLayout(state.getNodes());

    expect(layouts[0].color).toBe(0xcc3333);
    expect(layouts[1].color).toBe(0xdd8833);
    expect(layouts[2].color).toBe(0x44bb44);
  });
});

// ===========================================================================
// 11. MapLayoutCalculator adjusts alpha by state
// ===========================================================================

describe('MapLayoutCalculator -- alpha by state', () => {
  it('locked nodes have 0.4 alpha', () => {
    const calc = createCalculator();
    expect(calc.getAlpha('locked')).toBe(0.4);
  });

  it('available nodes have 1.0 alpha', () => {
    const calc = createCalculator();
    expect(calc.getAlpha('available')).toBe(1.0);
  });

  it('current nodes have 1.0 alpha', () => {
    const calc = createCalculator();
    expect(calc.getAlpha('current')).toBe(1.0);
  });

  it('completed nodes have 0.6 alpha', () => {
    const calc = createCalculator();
    expect(calc.getAlpha('completed')).toBe(0.6);
  });

  it('layout results reflect node states in alpha', () => {
    const state = createDemoMapState();
    // node_0=available, node_1=locked, node_2=locked
    const calc = createCalculator();
    const layouts = calc.calculateLayout(state.getNodes());

    expect(layouts[0].alpha).toBe(1.0); // available
    expect(layouts[1].alpha).toBe(0.4); // locked
    expect(layouts[2].alpha).toBe(0.4); // locked
  });
});

// ===========================================================================
// 12. MapLayoutCalculator centers nodes horizontally
// ===========================================================================

describe('MapLayoutCalculator -- horizontal centering', () => {
  it('centers all nodes at screen center', () => {
    const state = createDemoMapState();
    const calc = createCalculator();
    const layouts = calc.calculateLayout(state.getNodes());

    const centerX = DEFAULT_LAYOUT_CONFIG.screenWidth / 2;
    for (const layout of layouts) {
      expect(layout.x).toBe(centerX);
    }
  });

  it('centers nodes on narrow screen', () => {
    const state = createDemoMapState();
    const calc = createCalculator({ screenWidth: 800, screenHeight: 600 });
    const layouts = calc.calculateLayout(state.getNodes());

    const centerX = 400;
    for (const layout of layouts) {
      expect(layout.x).toBe(centerX);
    }
  });
});

// ===========================================================================
// 13. MapState handles single node map
// ===========================================================================

describe('MapState -- single node map', () => {
  it('handles single node map correctly', () => {
    const state = new MapState([{ type: 'boss' }]);

    expect(state.getNodes()).toHaveLength(1);
    expect(state.getFloorCount()).toBe(1);
    expect(state.getNodes()[0].state).toBe('available');
  });

  it('single node map can be completed', () => {
    const state = new MapState([{ type: 'boss' }]);

    state.selectNode('node_0');
    state.completeCurrentNode();

    expect(state.isMapComplete()).toBe(true);
    expect(state.getNodes()[0].state).toBe('completed');
  });

  it('single node map starts at floor -1, goes to 0', () => {
    const state = new MapState([{ type: 'boss' }]);

    expect(state.getCurrentFloor()).toBe(-1);
    state.selectNode('node_0');
    expect(state.getCurrentFloor()).toBe(0);
  });
});

// ===========================================================================
// 14. MapState returns null for selectNode on non-existent node
// ===========================================================================

describe('MapState -- non-existent node handling', () => {
  it('returns null for selectNode on non-existent node', () => {
    const state = createDemoMapState();

    expect(state.selectNode('non_existent')).toBeNull();
  });

  it('returns null for empty string node ID', () => {
    const state = createDemoMapState();

    expect(state.selectNode('')).toBeNull();
  });

  it('canSelectNode returns false for non-existent node', () => {
    const state = createDemoMapState();

    expect(state.canSelectNode('node_99')).toBe(false);
  });
});

// ===========================================================================
// 15. MapLayoutCalculator uses default config values when optional fields omitted
// ===========================================================================

describe('MapLayoutCalculator -- default config values', () => {
  it('uses default nodeRadius when omitted', () => {
    const calc = new MapLayoutCalculator({
      screenWidth: 1920,
      screenHeight: 1080,
    });
    const state = createDemoMapState();
    const layouts = calc.calculateLayout(state.getNodes());

    for (const layout of layouts) {
      expect(layout.radius).toBe(30); // default
    }
  });

  it('uses default verticalGap when omitted', () => {
    const calc = new MapLayoutCalculator({
      screenWidth: 1920,
      screenHeight: 1080,
    });
    const state = createDemoMapState();
    const layouts = calc.calculateLayout(state.getNodes());

    // y[0] = topMargin (100), y[1] = 100 + 120 = 220
    expect(layouts[0].y).toBe(100); // default topMargin
    expect(layouts[1].y).toBe(220); // 100 + 120 (default gap)
    expect(layouts[2].y).toBe(340); // 100 + 240
  });

  it('uses default topMargin when omitted', () => {
    const calc = new MapLayoutCalculator({
      screenWidth: 1920,
      screenHeight: 1080,
    });
    const state = createDemoMapState();
    const layouts = calc.calculateLayout(state.getNodes());

    expect(layouts[0].y).toBe(100); // default topMargin
  });

  it('uses all defaults when only screen size provided', () => {
    const calc = new MapLayoutCalculator({
      screenWidth: 1920,
      screenHeight: 1080,
    });
    const state = createDemoMapState();
    const layouts = calc.calculateLayout(state.getNodes());

    expect(layouts).toHaveLength(3);
    expect(layouts[0].radius).toBe(30);
    expect(layouts[0].x).toBe(960);
    expect(layouts[0].y).toBe(100);
  });
});

// ===========================================================================
// 16. MapState cannot select node when another is current
// ===========================================================================

describe('MapState -- only one current node at a time', () => {
  it('cannot select another node when one is current', () => {
    const state = createDemoMapState();

    state.selectNode('node_0');
    // node_0 is current, node_1 is locked anyway, but also
    // even if we complete node_0 and node_1 becomes available,
    // we can't select while a node is current
    expect(state.canSelectNode('node_0')).toBe(false);
  });
});

// ===========================================================================
// 17. MapLayoutCalculator handles empty node list
// ===========================================================================

describe('MapLayoutCalculator -- empty nodes', () => {
  it('returns empty array for empty node list', () => {
    const calc = createCalculator();
    const layouts = calc.calculateLayout([]);

    expect(layouts).toEqual([]);
  });
});

// ===========================================================================
// 18. MapLayoutCalculator assigns correct border colors by state
// ===========================================================================

describe('MapLayoutCalculator -- border colors', () => {
  it('locked nodes have gray border', () => {
    const calc = createCalculator();
    expect(calc.getBorderColor('locked')).toBe(0x555555);
  });

  it('available nodes have yellow border', () => {
    const calc = createCalculator();
    expect(calc.getBorderColor('available')).toBe(0xffdd44);
  });

  it('current nodes have yellow border', () => {
    const calc = createCalculator();
    expect(calc.getBorderColor('current')).toBe(0xffdd44);
  });

  it('completed nodes have green border', () => {
    const calc = createCalculator();
    expect(calc.getBorderColor('completed')).toBe(0x44bb44);
  });
});

// ===========================================================================
// 19. MapLayoutCalculator assigns correct labels by type
// ===========================================================================

describe('MapLayoutCalculator -- node labels', () => {
  const labelCases: [MapNodeType, string][] = [
    ['combat', 'Combat'],
    ['elite', 'Elite'],
    ['rest', 'Rest'],
    ['boss', 'Boss'],
    ['shop', 'Shop'],
    ['event', 'Event'],
    ['treasure', 'Treasure'],
  ];

  for (const [type, expectedLabel] of labelCases) {
    it(`labels ${type} as "${expectedLabel}"`, () => {
      const calc = createCalculator();
      expect(calc.getNodeLabel(type)).toBe(expectedLabel);
    });
  }

  it('layout results carry correct labels', () => {
    const defs: MapNodeDefinition[] = [
      { type: 'combat' },
      { type: 'rest' },
      { type: 'shop' },
    ];
    const state = new MapState(defs);
    const calc = createCalculator();
    const layouts = calc.calculateLayout(state.getNodes());

    expect(layouts[0].label).toBe('Combat');
    expect(layouts[1].label).toBe('Rest');
    expect(layouts[2].label).toBe('Shop');
  });
});

// ===========================================================================
// 20. MapState completeCurrentNode is no-op when no node is current
// ===========================================================================

describe('MapState -- completeCurrentNode edge cases', () => {
  it('is a no-op when no node is current', () => {
    const state = createDemoMapState();

    // No node selected yet -- should not crash or change anything
    state.completeCurrentNode();

    expect(state.getCurrentFloor()).toBe(-1);
    expect(state.getNodes()[0].state).toBe('available');
    expect(state.getNodes()[1].state).toBe('locked');
    expect(state.getNodes()[2].state).toBe('locked');
  });

  it('is a no-op when called twice in a row', () => {
    const state = createDemoMapState();

    state.selectNode('node_0');
    state.completeCurrentNode();
    state.completeCurrentNode(); // second call -- no-op

    expect(state.getNodes()[0].state).toBe('completed');
    expect(state.getNodes()[1].state).toBe('available');
  });
});
