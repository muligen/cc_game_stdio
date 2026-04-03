/**
 * map-node.ts -- Map node data types for the roguelike deckbuilder map.
 *
 * Implements: design/gdd/map-ui.md (Minimal Map Spec)
 * Architecture: ADR-001 Decision 3 (data-driven design)
 *
 * These types represent individual nodes on the map. MapNode is the data model
 * consumed by MapState (pure logic) and MapLayoutCalculator (pure layout).
 * MapScene creates Phaser GameObjects from these data structures.
 *
 * Key design decisions:
 * - MapNodeType is a string union, not an enum, for JSON serialization
 * - MapNodeState tracks progression: locked -> available -> current -> completed
 * - MapNode has mutable state (state field) but immutable identity (id, floor, type)
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Types of map nodes. Per map-ui GDD minimal spec. */
export type MapNodeType =
  | 'combat'
  | 'elite'
  | 'rest'
  | 'shop'
  | 'event'
  | 'boss'
  | 'treasure';

/** State of a map node in the progression lifecycle. */
export type MapNodeState = 'locked' | 'available' | 'current' | 'completed';

/**
 * MapNode -- a single node on the map.
 *
 * Identity fields (id, floor, type) are readonly. The state field is mutable
 * and managed by MapState.
 */
export interface MapNode {
  /** Unique node identifier, e.g. 'node_0'. */
  readonly id: string;
  /** 0-based floor index (vertical position on the map). */
  readonly floor: number;
  /** What type of encounter this node represents. */
  readonly type: MapNodeType;
  /** Current progression state of this node. */
  state: MapNodeState;
}
