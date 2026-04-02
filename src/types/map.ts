/**
 * map.ts — Map data type definitions.
 *
 * Implements: design/gdd/map.md (Map Data Schema, Node Types, Generation)
 * Map data is generated at run start using the Map RNG stream.
 */

/** Node type classification. Per Map GDD Section 1. */
export enum NodeType {
  COMBAT = 'combat',
  ELITE = 'elite',
  BOSS = 'boss',
  REST_SITE = 'rest_site',
  SHOP = 'shop',
  EVENT = 'event',
  TREASURE = 'treasure',
  START = 'start',
  BOSS_TREASURE = 'boss_treasure',
}

/**
 * MapNode — a single node on the map graph.
 * Per Map GDD Section 1 (MapNode interface).
 */
export interface MapNode {
  /** Unique node ID. */
  id: string;
  /** Node type. */
  type: NodeType;
  /** Which floor this node is on (0-14 per act). */
  floor: number;
  /** Position index within the floor (for rendering). */
  position: number;
  /** Connected node IDs on the next floor. */
  edges: string[];
  /** Whether the player has visited this node. */
  visited: boolean;
  /** Whether this node is locked (some events can lock nodes). */
  locked: boolean;
}

/**
 * MapFloor — a horizontal layer of nodes on the map.
 * Per Map GDD Section 1 (MapFloor interface).
 */
export interface MapFloor {
  /** Floor index (0-14 for normal floors). */
  floorIndex: number;
  /** Nodes on this floor. */
  nodes: MapNode[];
}

/**
 * MapData — the full map for a single act.
 * Generated at act start using Map RNG stream.
 * Per Map GDD Section 1 (MapData interface).
 */
export interface MapData {
  /** Act number (1, 2, or 3). */
  act: number;
  /** 15 normal floors per act. */
  floors: MapFloor[];
  /** Boss floor (floor 16). */
  bossFloor: MapFloor;
  /** Starting node IDs (bottom floor). */
  startNodes: string[];
}

/**
 * MapConfig — map generation configuration.
 * Loaded from map-config.json. Per Map GDD Tuning Knobs.
 */
export interface MapConfig {
  /** Number of floors per act. Default 15. */
  floorsPerAct: number;
  /** Minimum nodes per floor. Default 2. */
  nodesPerFloorMin: number;
  /** Maximum nodes per floor. Default 5. */
  nodesPerFloorMax: number;
  /** Minimum floor for elite encounters. Default 4. */
  eliteMinFloor: number;
  /** Maximum elites per act. Default 3. */
  maxElitesPerAct: number;
  /** Minimum rest sites per act. Default 2. */
  restSiteMinPerAct: number;
  /** Maximum rest sites per act. Default 4. */
  restSiteMaxPerAct: number;
  /** Rest site heal percentage. Default 0.30. */
  restHealPercent: number;
  /** Node type weights per floor range. */
  floorWeights: FloorWeightConfig[];
}

/** Node type weights for a range of floors. */
export interface FloorWeightConfig {
  /** Start of the floor range (inclusive). */
  floorStart: number;
  /** End of the floor range (inclusive). */
  floorEnd: number;
  /** Weight for combat nodes. */
  combatWeight: number;
  /** Weight for elite nodes. */
  eliteWeight: number;
  /** Weight for shop nodes. */
  shopWeight: number;
  /** Weight for rest site nodes. */
  restWeight: number;
  /** Weight for event nodes. */
  eventWeight: number;
  /** Weight for treasure nodes. */
  treasureWeight: number;
}
