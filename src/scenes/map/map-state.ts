/**
 * map-state.ts -- Map state manager for the linear demo map.
 *
 * Implements: design/gdd/map-ui.md (Minimal Map Spec)
 * Architecture: ADR-001 Decision 3 (data-driven, testable without Phaser)
 *
 * MapState manages a linear list of nodes. The player starts at floor -1
 * (not on the map), and the first available nodes are at floor 0.
 * For the demo, each floor has exactly one node, forming a vertical line.
 *
 * Key design decisions:
 * - Pure TypeScript -- zero Phaser dependencies, fully testable
 * - Linear progression: complete node N to unlock floor N+1
 * - canSelectNode / selectNode / completeCurrentNode form the core API
 * - Node definitions come from constructor (data-driven)
 *
 * Usage:
 *   const state = new MapState([{ type: 'combat' }, { type: 'combat' }, { type: 'combat' }]);
 *   state.canSelectNode('node_0'); // true
 *   state.selectNode('node_0');    // marks as current
 *   state.completeCurrentNode();   // marks completed, unlocks next
 */

import type { MapNode, MapNodeType, MapNodeState } from './map-node';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Simplified node definition for constructing the map. */
export interface MapNodeDefinition {
  /** What type of encounter this node represents. */
  type: MapNodeType;
}

// ---------------------------------------------------------------------------
// MapState
// ---------------------------------------------------------------------------

/**
 * MapState -- manages the linear map progression for the demo.
 *
 * Creates MapNode instances from definitions, tracks current floor,
 * and enforces selection/completion rules.
 */
export class MapState {
  /** Ordered list of map nodes. */
  private readonly nodes: MapNode[];
  /** Current floor index (-1 means not started / not on any node). */
  private currentFloor: number;

  /**
   * @param nodeDefinitions - Array of node definitions. Each becomes a node
   *   with ID 'node_{index}' on floor {index}.
   */
  constructor(nodeDefinitions: ReadonlyArray<MapNodeDefinition>) {
    this.currentFloor = -1;

    this.nodes = nodeDefinitions.map((def, index) => ({
      id: `node_${index}`,
      floor: index,
      type: def.type,
      state: (index === 0 ? 'available' : 'locked') as MapNodeState,
    }));
  }

  // ---------------------------------------------------------------------------
  // Public API -- Queries
  // ---------------------------------------------------------------------------

  /**
   * Get all nodes (read-only view).
   *
   * @returns A readonly array of all MapNode instances.
   */
  getNodes(): readonly MapNode[] {
    return this.nodes;
  }

  /**
   * Get available (clickable) nodes.
   *
   * Available nodes are those with state 'available' -- the player can
   * click them to enter the encounter.
   *
   * @returns Array of available MapNode instances.
   */
  getAvailableNodes(): MapNode[] {
    return this.nodes.filter((n) => n.state === 'available');
  }

  /**
   * Get current floor index.
   *
   * @returns -1 if not started, otherwise the 0-based floor index.
   */
  getCurrentFloor(): number {
    return this.currentFloor;
  }

  /**
   * Can this node be selected?
   *
   * A node is selectable if:
   * - It exists
   * - Its state is 'available'
   * - No node is currently selected (state 'current')
   *
   * @param nodeId - The node ID to check.
   * @returns True if the node can be selected.
   */
  canSelectNode(nodeId: string): boolean {
    // Cannot select if a node is already current
    if (this.nodes.some((n) => n.state === 'current')) {
      return false;
    }

    const node = this.findNode(nodeId);
    return node !== null && node.state === 'available';
  }

  /**
   * Is the map complete (all nodes done)?
   *
   * @returns True if every node has state 'completed'.
   */
  isMapComplete(): boolean {
    return this.nodes.length > 0 && this.nodes.every((n) => n.state === 'completed');
  }

  /**
   * Total number of floors (same as node count for linear map).
   *
   * @returns The number of nodes on the map.
   */
  getFloorCount(): number {
    return this.nodes.length;
  }

  // ---------------------------------------------------------------------------
  // Public API -- Mutations
  // ---------------------------------------------------------------------------

  /**
   * Select a node -- marks it as current, returns the node.
   *
   * The caller should then launch the encounter for this node.
   * After the encounter, call completeCurrentNode().
   *
   * @param nodeId - The node ID to select.
   * @returns The selected MapNode, or null if selection is invalid.
   */
  selectNode(nodeId: string): MapNode | null {
    if (!this.canSelectNode(nodeId)) {
      return null;
    }

    const node = this.findNode(nodeId);
    if (!node) {
      return null;
    }

    node.state = 'current';
    this.currentFloor = node.floor;
    return node;
  }

  /**
   * Complete the current node -- marks it completed and unlocks next floor.
   *
   * After completing a node, the next floor's nodes become available.
   * If the last node is completed, the map is complete.
   */
  completeCurrentNode(): void {
    const currentNode = this.nodes.find((n) => n.state === 'current');
    if (!currentNode) {
      return;
    }

    currentNode.state = 'completed';

    // Unlock next floor's nodes
    const nextFloor = currentNode.floor + 1;
    for (const node of this.nodes) {
      if (node.floor === nextFloor && node.state === 'locked') {
        node.state = 'available';
      }
    }
  }

  /**
   * Restore node states from saved data (e.g. Phaser registry).
   *
   * Used when MapScene is restarted via scene.start() after combat+reward.
   * The map structure (node count, types) is rebuilt in create(), then
   * this method restores which nodes were completed/available.
   *
   * @param nodeStates - Array of { id, state } pairs to restore.
   */
  restoreState(nodeStates: ReadonlyArray<{ id: string; state: MapNodeState }>): void {
    for (const saved of nodeStates) {
      const node = this.findNode(saved.id);
      if (node) {
        node.state = saved.state;
      }
    }
    // Restore currentFloor from the highest completed node
    this.currentFloor = -1;
    for (const node of this.nodes) {
      if (node.state === 'completed' && node.floor >= this.currentFloor) {
        this.currentFloor = node.floor;
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Private Helpers
  // ---------------------------------------------------------------------------

  /**
   * Find a node by ID.
   *
   * @param nodeId - The node ID to find.
   * @returns The MapNode, or null if not found.
   */
  private findNode(nodeId: string): MapNode | null {
    return this.nodes.find((n) => n.id === nodeId) ?? null;
  }
}
