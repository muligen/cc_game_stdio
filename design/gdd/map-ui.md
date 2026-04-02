# Map UI

> **Status**: Designed
> **Author**: user + agents
> **Last Updated**: 2026-04-02
> **Implements Pillar**: Informed Strategy (complete map visibility enables route planning), Calculated Tension (path choices are irreversible and carry risk), Readability First (node types instantly recognizable)

## Overview

Map UI is the complete interface for the map scene. It renders and handles interaction for the layered node graph: node display (type icons, floor positions), path lines (edge connections), current position indicator, reachable node highlighting, act/floor info display, and node entry interaction. Map UI gives the player a complete view of the entire act's route map, enabling strategic path selection decisions.

## Player Fantasy

**Informed Strategy**: open the map and see all route branches and node types. You can plan the entire path from your current position to the boss. "Left path has an elite with a relic reward, right path has a rest site but is longer." **Calculated Tension**: every path choice is irreversible — you must weigh risk and reward. **Readability First**: node types are instantly recognizable, path lines are clear, current position is prominent.

Reference: Slay the Spire's map view — all node types visible, path branches clear, click to move.

## Detailed Design

### Screen Layout (1920x1080 reference)

```
+------------------------------------------------------------------+
|  [Act indicator: "Act 1" / "Act 2" / "Act 3"]    [Floor: 3/15]  |
|                                                                    |
|  Floor 15 ─── ☠️ Boss                                            |
|  Floor 14 ─── ⚔️ ─── 🏪                                        |
|  Floor 13 ─── ⚔️ ─── ⚔️ ─── 🔥                                |
|  Floor 12 ─── 🏪 ─── 💎 ─── 🏕️ ─── ❓                      |
|  Floor 11 ─── ⚔️ ─── 🔥 ─── ⚔️                                |
|  Floor 10 ─── ⚔️ ─── ⏺️ ─── 🏕️                                |
|  Floor  9 ─── ❓ ─── ⚔️ ─── ⚔️                                 |
|  Floor  8 ─── ⚔️ ─── ⚔️ ─── 🏕️                                |
|  ...                                                               |
|  Floor  1 ─── ⚔️ ─── ⚔️ ─── ❓                                |
|  Floor  0 ─── ⏺️ ─── ⏺️                                        |
|                                                                    |
|  [HP: 62/80] [Gold: 145] [Deck: 15 cards]  [Map Legend - toggle]  |
+------------------------------------------------------------------+
```

### UI Components

| Component | Position | Content | Interactive |
|-----------|----------|---------|-------------|
| **Act Indicator** | Top left | "Act 1" / "Act 2" / "Act 3" | No |
| **Floor Counter** | Top right | "Floor: 3/15" | No |
| **Map Canvas** | Center | Node graph with edges | Yes (click to move) |
| **Node Icons** | On map | Type-specific icon per node | Yes (hover for details) |
| **Path Lines** | Between nodes | Connection lines | No (visual) |
| **Current Node** | Highlighted | Pulsing border, golden glow | No (indicator) |
| **Reachable Nodes** | Highlighted | Bright border, cursor pointer | Yes (click to move) |
| **Status Bar** | Bottom | HP, Gold, Deck size | Yes (click for details) |
| **Map Legend** | Bottom right | Icon → type mapping | Yes (toggle show/hide) |
| **Back Button** | Top left | Return to previous screen | Yes |

### Node Icons

| Type | Icon | Color |
|------|------|-------|
| COMBAT | ⚔️ Sword | Red/Orange |
| ELITE | 💀 Skull | Purple |
| BOSS | 👹 Demon face | Dark Red |
| REST_SITE | 🏕️ Campfire | Green |
| SHOP | 🏪 Shop | Blue |
| EVENT | ❓ Question mark | Yellow |
| TREASURE | 💎 Gem | Gold |
| START | ⏺️ Circle | White |
| BOSS_TREASURE | 💎 Star | Gold |

### Node Visual States

| State | Visual |
|-------|--------|
| **Future (unreachable)** | Dimmed (50% opacity), full icon visible |
| **Reachable** | Full brightness, pulsing border, cursor pointer |
| **Current** | Golden glow, pulsing, enlarged 10% |
| **Visited** | Full brightness, checkmark overlay, slightly muted |
| **Locked** | Gray, lock icon overlay |

### Path Lines

| Type | Visual |
|------|--------|
| **Reachable path** | Bright white/blue, animated flow |
| **Normal path** | Gray, thin |
| **Visited path** | Faded, dotted |

### Node Selection Flow

1. Player sees map with current position highlighted
2. Reachable nodes (connected to current) have bright border
3. Hover reachable node → shows tooltip (node type, floor number, preview info)
4. Click reachable node → confirmation if not trivial ("Enter Combat?")
5. Confirm → transition to node content (combat/shop/etc.)
6. After node completion → return to map, node marked visited, new reachable nodes shown

### Node Tooltip on Hover

```
+-----------------------+
| [Node Type Icon]      |
| Combat (Normal)       |
| Floor 7               |
|                       |
| "Enemy encounter"     |
| [Click to enter]      |
+-----------------------+
```

- Combat nodes: "Enemy encounter"
- Elite nodes: "Elite enemy — Relic reward"
- Boss nodes: "Boss — Act finale"
- Rest Site: "Rest or Upgrade"
- Shop: "Buy/Sell/Remove"
- Event: "Unknown event"
- Treasure: "Free treasure!"

### Map Scrolling

- Map taller than screen → scrollable vertically
- Auto-scroll to current position on map open
- Mouse wheel / drag to scroll
- Minimap strip on right side (optional, for quick navigation)

### Act Transition Screen

```
+----------------------------------+
|                                    |
|   "Act 1 Complete!"              |
|   [Boss Treasure Reward]         |
|                                    |
|   "Entering Act 2..."           |
|   [New map generates]            |
|   [Proceed to Map]               |
|                                    |
+----------------------------------+
```

### Map Legend

```
+---------------------+
| Map Legend           |
| ⚔️ Combat           |
| 💀 Elite             |
| 👹 Boss              |
| 🏕️ Rest Site         |
| 🏪 Shop              |
| ❓ Event             |
| 💎 Treasure          |
+---------------------+
```

Toggle-able via button. Default: visible for first 3 visits, then auto-hidden (player has learned).

### Animation Feedback

| Event | Animation | Duration |
|-------|-----------|----------|
| Map open | Fade in, auto-scroll to current | 0.3s |
| Node hover | Scale up 5%, glow effect | 0.15s |
| Node click (move) | Path line animates, camera follows | 0.5s |
| Node visited | Checkmark fades in | 0.2s |
| Act complete | Map fades out, victory overlay | 0.5s |
| New act map | Map generates visually (nodes appear floor by floor) | 0.8s |
| Boss node pulse | Red glow pulse | Continuous |

## Formulas

### Node Positioning

```
nodeX(node, floorNodes, canvasWidth):
  spacing = canvasWidth / (floorNodes.length + 1)
  return spacing * (floorNodes.indexOf(node) + 1)

nodeY(floorIndex, totalFloors, canvasHeight, topMargin, bottomMargin):
  usableHeight = canvasHeight - topMargin - bottomMargin
  // Bottom = floor 0, Top = floor 14
  return canvasHeight - bottomMargin - (floorIndex / (totalFloors - 1)) * usableHeight

nodeScale(nodeState):
  if nodeState == CURRENT: return 1.1
  if nodeState == REACHABLE: return 1.05
  return 1.0

nodeOpacity(nodeState):
  if nodeState == FUTURE: return 0.5
  if nodeState == REACHABLE: return 1.0
  if nodeState == CURRENT: return 1.0
  if nodeState == VISITED: return 0.7
  if nodeState == LOCKED: return 0.3
```

### Path Line Rendering

```
pathOpacity(fromState, toState):
  if fromState == CURRENT && toState == REACHABLE: return 1.0
  if fromState == VISITED && toState == VISITED: return 0.4
  return 0.2
```

### Scroll Target

```
scrollTargetY(currentFloor, totalFloors, canvasHeight):
  targetNodeY = nodeY(currentFloor, totalFloors, canvasHeight, 80, 80)
  return targetNodeY - canvasHeight / 2
```

## Edge Cases

1. **Map taller than screen**: Vertical scroll with auto-scroll to current position. Minimum viewport shows 5 floors around current.

2. **All paths converge**: Valid — show single path line. Player has no choice at this point, which is by design.

3. **Floor with single node**: Valid (especially floor 0 start). Single node centered.

4. **Floor with 5 nodes**: Nodes compressed horizontally. Minimum 100px spacing enforced. If screen too narrow, allow slight horizontal scroll.

5. **Boss floor (16)**: Rendered at top with special styling. Red background tint. Larger node icon.

6. **Act transition**: Old map fades out, interstitial screen shows, new map generates with animation.

7. **Boss treasure node**: Appears after boss defeat. Special golden styling. Click shows reward screen.

8. **Locked nodes**: Grayed out with lock icon. Hover shows "Locked" tooltip. Cannot click.

9. **Returning from combat to map**: Auto-scroll to current (now visited) position. New reachable nodes highlighted with brief flash.

10. **Minimum screen (1280x720)**: Reduce node icon size by 20%. Reduce spacing. Legend overlays instead of side panel.

## Dependencies

### Upstream (this system depends on)

| System | Type | Interface |
|--------|------|-----------|
| Map System | Hard | Full MapData, node positions, edges, visited status, reachable nodes |
| Run State Manager | Hard | Current HP, gold, deck size, act, floor, current node ID |
| Data/Config | Hard | Node type icons, map layout config, animation timings |

### Downstream (systems that depend on this)

| System | Type | Interface |
|--------|------|-----------|
| Map System | Hard | Node selection input (which node player clicked) |
| Screen Flow | Hard | Node type triggers screen transition (combat/shop/rest/event) |
| Combat System | Soft | Combat encounter triggered from combat/elite/boss nodes |
| Rest Site System | Soft | Rest site UI triggered from rest node |
| Shop System | Soft | Shop UI triggered from shop node |
| Event System | Soft | Event UI triggered from event node |

## Tuning Knobs

| Knob | Location | Default | Safe Range | What Breaks |
|------|----------|---------|------------|-------------|
| `nodeIconSize` | `ui-config.json` | 48px | 32-64 | 32: hard to see; 64: cluttered |
| `nodeSpacing.min` | `ui-config.json` | 100px | 60-140 | 60: overlap; 140: too spread |
| `pathLineWidth` | `ui-config.json` | 3px | 1-5 | 1: invisible; 5: thick |
| `currentNodePulseSpeed` | `ui-config.json` | 1.0s | 0.5-2.0 | 0.5: distracting; 2.0: subtle |
| `mapScrollSpeed` | `ui-config.json` | 400px/s | 200-800 | 200: sluggish; 800: jarring |
| `mapFadeInDuration` | `ui-config.json` | 0.3s | 0.1-0.5 | 0.1: abrupt; 0.5: slow |
| `legendAutoHideAfter` | `ui-config.json` | 3 visits | 0-10 | 0: never show; 10: always show |
| `bossFloorHighlight` | `ui-config.json` | true | false | false: boss not obvious |

## Acceptance Criteria

1. Map displays all nodes for current act with correct type icons.
2. Path lines connect nodes correctly (matching MapData edges).
3. Current node highlighted with golden glow/pulse.
4. Reachable nodes have bright border and are clickable.
5. Clicking reachable node triggers correct screen transition.
6. Visited nodes show checkmark overlay and muted appearance.
7. Map auto-scrolls to current position on open.
8. Act indicator shows correct act number.
9. Floor counter shows correct current floor.
10. Status bar displays HP, gold, deck size from run state.
11. Map legend shows all node types; toggle-able.
12. Node tooltip shows type and floor on hover.
13. Act transition shows interstitial screen with new map generation.
14. Boss floor has distinct visual styling.
15. Responsive down to 1280x720 minimum resolution.

## Open Questions

1. **Minimap**: Should a minimap strip appear during combat for context?
   Recommend: no for MVP. Full map only between encounters. Owner: UX Designer.

2. **Path preview**: Should hovering a far-away node highlight the entire path to it?
   Recommend: yes, show the full path line from current to hovered node. Owner: UX Designer.

3. **Node count on legend**: Should the legend show "3 Elite remaining" counts?
   Recommend: yes, helpful for planning. Owner: Game Designer.
