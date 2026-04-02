# Map System

> **Status**: Designed
> **Author**: user + agents
> **Last Updated**: 2026-04-02
> **Implements Pillar**: Informed Strategy (visible map enables route planning), Calculated Tension (risk/reward of different paths)

## Overview

The Map System manages run-level map generation and path selection. The map uses a **layered
node graph** structure — each floor has several nodes, and the player moves upward from
the bottom start to the boss floor. Node types include: Combat (normal/elite/boss),
Shop, Rest Site, Event, and Treasure. The map is pre-generated at run start using the
Map RNG stream. Players see the full map (explored sections highlighted, unexplored
showing node types). Each act has 15 floors, with 3 acts total plus a final boss.

## Player Fantasy

**Informed Strategy**: the entire map is visible, letting you plan your route. "Should I
risk the elite path for a relic, or take the safe route to preserve HP for the boss?"
Every branch is a risk/reward decision. **Calculated Tension**: different node sequences
create different pressure — consecutive combats drain resources while rest sites offer
relief.

Reference: Slay the Spire's map is a masterclass in meaningful choice. The branching
paths, visible node types, and irreversible decisions create constant strategic tension.

## Detailed Design

### Core Rules

**1. Map Data Schema**

```
interface MapData {
  act: number;              // 1, 2, or 3
  floors: MapFloor[];       // 15 floors per act
  bossFloor: MapFloor;      // floor 16 (boss)
  startNodes: string[];     // starting node IDs
}

interface MapFloor {
  floorIndex: number;       // 0-14 (15 floors per act)
  nodes: MapNode[];         // 2-5 nodes per floor
}

interface MapNode {
  id: string;               // unique node ID
  type: NodeType;           // node type
  floor: number;            // which floor
  edges: string[];          // connected node IDs on next floor
  visited: boolean;         // has player been here
  locked: boolean;          // some events can lock nodes
}

enum NodeType {
  COMBAT,           // normal combat encounter
  ELITE,            // elite combat (harder, relic reward)
  BOSS,             // boss combat
  REST_SITE,        // rest: heal or upgrade card
  SHOP,             // buy cards, relics, potions; remove card
  EVENT,            // random event (choice-based)
  TREASURE,         // free relic/gold/potion (no combat)
  START,            // starting node
  BOSS_TREASURE     // post-boss reward (act 1→2, 2→3)
}
```

**2. Map Generation Algorithm**

```
generateMap(act, rng, ascensionLevel):
  floors = []
  for floorIndex = 0 to 14:
    nodeCount = rng.nextInt(2, 5)  // 2-5 nodes per floor
    nodes = []
    for i = 0 to nodeCount:
      type = rollNodeType(floorIndex, act, rng, ascensionLevel)
      nodes.push(createNode(type, floorIndex))
    floors.push(floor)

  // Connect floors (ensure reachability)
  for i = 0 to 13:
    connectFloors(floors[i], floors[i + 1], rng)

  // Validate: every node reachable from start
  if not validateReachability(floors):
    return generateMap(act, rng, ascensionLevel)  // regenerate

  // Boss floor
  bossFloor = createBossFloor(act)

  return MapData { act, floors, bossFloor }
```

**3. Node Type Distribution**

| Floor Range | Combat | Elite | Shop | Rest | Event | Treasure |
|-------------|--------|-------|------|------|-------|----------|
| 0-3 | 60% | 0% | 10% | 15% | 15% | 0% |
| 4-7 | 50% | 10% | 15% | 15% | 10% | 0% |
| 8-11 | 40% | 15% | 10% | 15% | 15% | 5% |
| 12-14 | 35% | 20% | 10% | 20% | 10% | 5% |

**Guarantees per act:**
- At least 1 Elite in floors 5-14
- At most 3 Elites per act (normal), 4 (Ascension 7+)
- At least 2 Rest Sites per act
- At most 4 Rest Sites per act

**4. Edge Connection Rules**

```
connectFloors(currentFloor, nextFloor, rng):
  // Each node connects to 1-3 nodes on next floor
  // Every node on next floor receives at least 1 connection
  // Paths cannot cross (visual clarity)
  // No disconnected nodes allowed

  for each node in currentFloor.nodes:
    connectionCount = rng.nextInt(1, 3)
    targets = selectNearbyNodes(nextFloor, node.position, connectionCount, rng)
    node.edges = targets

  // Ensure every next-floor node has at least 1 incoming edge
  for each node in nextFloor.nodes:
    if node has no incoming edges:
      connect nearest currentFloor node to this node
```

**5. Path Selection Rules**

- Player moves to directly connected nodes on the next floor only
- No skipping floors or backtracking
- Each move advances one floor
- Path selection is permanent (irreversible)

**6. Act Structure**

| Act | Floors | Boss | Character |
|-----|--------|------|-----------|
| 1 | 15 + Boss | Act 1 Boss | Front-loaded learning |
| 2 | 15 + Boss | Act 2 Boss | More elites, harder events |
| 3 | 15 + Boss | Final Boss | Hardest combats |

After Act 1 and Act 2 bosses: boss treasure node appears (free relic + gold).

**7. Map Visibility**

- All nodes visible (type shown)
- Visited nodes: fully highlighted
- Current node: pulsing indicator
- Reachable nodes (connected to current): slightly brighter
- Future floors: dimmed but types visible

### Node Types

**COMBAT**: Generates a combat encounter based on act and floor position. Uses
encounter tables from Data/Config. Earlier floors have easier enemies.

**ELITE**: Harder combat with guaranteed relic reward on first kill. Uses elite
encounter tables.

**BOSS**: Act-ending boss fight. Uses boss encounter data. Always on floor 16.

**REST_SITE**: Player chooses one of:
- Rest: Heal 30% of maxHP
- Upgrade: Upgrade one card in deck
- (Post-MVP: Dig — obtain a random card, Toke — obtain a random relic)

**SHOP**: Buy cards, relics, potions. Remove one card from deck (paid service).

**EVENT**: Random event with choice-based outcomes. Uses event pool filtered by act.

**TREASURE**: Free reward — random relic + gold (25-50). No combat.

### Map Generation

**RNG Usage:**
- Uses dedicated Map RNG stream (separate from combat/reward/AI)
- Deterministic: same seed produces identical map
- All randomness consumed during generation, not during play

**Generation Validation:**
After generation, run reachability check:
```
validateReachability(floors):
  visited = new Set()
  queue = [startNodes]
  while queue not empty:
    node = queue.dequeue()
    if node not in visited:
      visited.add(node)
      for edge in node.edges:
        queue.enqueue(edge)
  return visited.size == totalNodeCount
```

If validation fails, regenerate (should be extremely rare with proper connection rules).

### Interactions with Other Systems

| System | Direction | Data Exchanged | When |
|--------|-----------|---------------|------|
| Data/Config | Config → Map | Node type weights, encounter tables, act definitions | Load time |
| RNG System | RNG → Map | Map RNG stream for generation | Run start |
| Combat System | Map → Combat | Encounter data when entering combat node | Node entry |
| Rest Site System | Map → Rest | Trigger rest site UI | Rest node entry |
| Shop System | Map → Shop | Trigger shop UI | Shop node entry |
| Event System | Map → Event | Trigger event, filtered by act | Event node entry |
| Reward System | Map → Reward | Boss treasure reward | Post-boss |
| Run State Manager | Map → Run | Current position, visited nodes, act progress | Continuous |
| Map UI | Map → UI | Full map data, current node, reachable nodes | Continuous |

## Formulas

### Node Type Roll

```
rollNodeType(floorIndex, act, rng, ascensionLevel):
  weights = getWeights(floorIndex, act, ascensionLevel)
  return rng.weightedPick(weights)
```

### Distance to Boss

```
distanceToBoss(currentFloor):
  return (15 - currentFloor) + 1  // floors remaining + boss floor
```

### Path Length Range

```
minPathLength(startFloor, endFloor):
  return endFloor - startFloor  // 1 floor per step minimum
```

### Rest Site Heal Amount

```
restHeal(maxHP):
  return Math.floor(maxHP * 0.30)
```

## Edge Cases

1. **Disconnected node**: Generation must guarantee reachability. Validation step
   after generation; regenerate if invalid. Should never reach players.

2. **All paths converge on one node**: Valid. Multiple routes leading to the same
   node is correct behavior — the player's earlier choices determined the path.

3. **No backtracking**: By design. Once a floor is passed, it cannot be revisited.
   This creates meaningful path decisions.

4. **Shop on floor 14**: Valid. A shop right before the boss can be strategically
   valuable for last-minute preparations.

5. **Elite on floor 0-3**: Not allowed. Minimum elite floor is 4. Enforced by
   generation weights (0% elite chance on floors 0-3).

6. **Map persists for entire act**: Generated once at act start. No mid-act
   regeneration. After boss, new act = new map.

7. **Act transition**: New map generated for each act. Player resources carry over
   (HP, deck, relics, gold, potions). Only the map resets.

8. **Boss treasure node**: Appears automatically after Act 1 and Act 2 bosses.
   Offers a choice of relics (3 pick 1) + gold.

9. **Dead-end node (no outgoing edges on floor 14)**: Valid — floor 14 is the last
   normal floor. All paths lead to the boss.

10. **Single-path act**: If all paths converge into one, the player has only one route.
    Valid but rare. Generation weights encourage diversity.

## Dependencies

### Upstream (this system depends on)

| System | Type | Interface |
|--------|------|-----------|
| Data/Config | Hard | Node type weights, encounter tables, act definitions |
| RNG System | Hard | Map RNG stream for deterministic generation |

### Downstream (systems that depend on this)

| System | Type | Interface |
|--------|------|-----------|
| Combat System | Hard | Encounter data when entering combat/elite/boss nodes |
| Rest Site System | Hard | Triggered when entering rest site node |
| Shop System | Hard | Triggered when entering shop node |
| Event System | Hard | Triggered when entering event node |
| Reward System | Soft | Boss treasure reward generation |
| Run State Manager | Hard | Current position, visited nodes, act progress |
| Map UI | Hard | Full map data for display |

## Tuning Knobs

| Knob | Location | Default | Safe Range | What Breaks |
|------|----------|---------|------------|-------------|
| `floorsPerAct` | `game-config.json` | 15 | 10-20 | 10: too short; 20: too grindy |
| `nodesPerFloor.min` | `game-config.json` | 2 | 2-3 | <2: no choice |
| `nodesPerFloor.max` | `game-config.json` | 5 | 4-6 | 6: cluttered |
| `eliteMinFloor` | `game-config.json` | 4 | 3-6 | 3: elites too early |
| `maxElitesPerAct` | `game-config.json` | 3 | 2-5 | 5: too many elites |
| `restSiteMinPerAct` | `game-config.json` | 2 | 1-3 | 1: very harsh |
| `restSiteMaxPerAct` | `game-config.json` | 4 | 3-5 | 5: too many rests |
| `restHealPercent` | `game-config.json` | 0.30 | 0.20-0.40 | 0.20: weak heal; 0.40: too easy |

## Acceptance Criteria

1. Map generated at run start with correct node distribution per floor range.
2. All nodes reachable from at least one start node (validation passes).
3. Each floor has 2-5 nodes.
4. Player can only move to directly connected nodes on next floor.
5. No backtracking allowed.
6. At least 1 Elite appears in floors 5-14 per act.
7. At least 2 Rest Sites per act.
8. Boss appears on floor 16 (after 15 normal floors).
9. Act transition generates new map for next act.
10. Map RNG stream ensures same seed produces same map.
11. Node types visible on map before entering.
12. Boss treasure node appears after Act 1 and Act 2 bosses.

## Open Questions

1. **Map animation**: Should the map animate when moving between nodes?
   Recommend: yes, smooth camera follow (0.3s). Owner: UX Designer. Map UI GDD.

2. **Mini-map**: Should there be a mini-map during combat showing map progress?
   Recommend: no for MVP. The full map is accessible between combats.
   Owner: UX Designer.

3. **Branching factor tuning**: Should later acts have more branching (more nodes
   per floor)? Recommend: yes, Act 3 has 3-6 nodes per floor vs Act 1's 2-5.
   Owner: Game Designer. Balance pass.
