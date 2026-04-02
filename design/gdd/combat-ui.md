# Combat UI

> **Status**: Designed
> **Author**: user + agents
> **Last Updated**: 2026-04-02
> **Implements Pillar**: Readability First (clear visual hierarchy), Informed Strategy (complete battle state visibility)

## Overview

The Combat UI is the complete interface for the battle scene. It renders and handles interaction for:
**Hand** (bottom, up to 10 cards), **Energy Orb** (bottom-left), **Player HP/Block** (bottom-left),
**Enemy Display** (upper center, HP/Block/Intent per enemy), **Relic Bar** (bottom strip),
**Potion Slots** (bottom-right), **End Turn Button** (bottom-right), and **Combat Log** (right side, collapsible).
The Combat UI is the player's window into all battle state information.

## Player Fantasy

**Readability First**: the battle screen is immediately understandable. HP bars show health at a glance,
intent icons tell you exactly what enemies plan to do, and the energy orb shows remaining resources.
**Informed Strategy**: all combat state is transparent — no hidden information. Every number is
clickable for detail. Hover any card for computed damage values.

Reference: Slay the Spire's combat screen is a gold standard in card game UI design.
Clear zones, readable numbers, smooth animations.

## Detailed Design

### Screen Layout (1920x1080 reference)

```
+------------------------------------------------------------------+
|  [Turn indicator: "Player Turn" / "Enemy Turn"]                    |
|                                                                    |
|   +----------+    +----------+    +----------+                    |
|   | Enemy 1  |    | Enemy 2  |    | Enemy 3  |                    |
|   | HP: ████ |    | HP: ██   |    | HP: █████ |                    |
|   | Block: 5 |    | Block: 0 |    | Block: 8 |                    |
|   | Intent:⚔20|    | Intent:🛫|    | Intent:💀3|                    |
|   +----------+    +----------+    +----------+                    |
|                                                                    |
|   [Combat Log - right side, collapsible]                           |
|                                                                    |
|   [Relic Bar — small icons along bottom]                            |
|                                                                    |
|   +------+ +------+ +------+ +------+ +------+   [End Turn]       |
|   |Card 1| |Card 2| |Card 3| |Card 4| |Card 5|   [Potions]      |
|   +------+ +------+ +------+ +------+ +------+                  |
|   ⚡3/3  [HP: 62/80] [Block: 12]                                   |
+------------------------------------------------------------------+
```

### UI Components

| Component | Position | Content | Interactive |
|-----------|----------|---------|-------------|
| **Turn Indicator** | Top center | "Player Turn" / "Enemy Turn" | No |
| **Enemy Display** | Upper center | Enemy sprite, HP bar, Block, Intent | Yes (hover for details) |
| **Player HP Bar** | Bottom left | Current/Max HP, Block value | Yes (hover for history) |
| **Energy Orb** | Bottom left | Current/Max energy number | No (visual only) |
| **Hand Cards** | Bottom center | Up to 10 card instances | Yes (click to play, hover for tooltip) |
| **End Turn Button** | Bottom right | "End Turn" button | Yes |
| **Potion Slots** | Bottom right | Potion bottle icons | Yes (click to use) |
| **Relic Bar** | Bottom edge | Small relic icons | Yes (hover for tooltip) |
| **Combat Log** | Right side | Recent actions/effects | Yes (scroll, collapse) |
| **Pile Counters** | Near energy orb | Draw/Discard/Exhaust counts | Yes (click to view pile) |

### Card Display in Hand

```
+------------------+
| [Cost] [Type]    |  ← top-left: energy cost, card type icon
|                  |
|   [Card Art]     |  ← card illustration area
|                  |
| [Card Name]      |  ← center: name
| [Description]    |  ← effect text with computed values
|                  |
| [Keywords]       |  ← bottom: keyword tags
+------------------+
```

**Card States:**
- **Normal**: Full color, standard position
- **Hovered**: Lifts Y by -20px, shows tooltip with exact computed values
- **Selected/Targeting**: Lifts Y by -40px, glowing border, enemies highlight
- **Unplayable**: Grayed out (cost > currentEnergy, or no valid target)
- **Exhausted**: Brief glow then shrinks away to exhaust pile

### Enemy Intent Display

```
+------------------+
| [Intent Icon]    |  ← sword/shield/buff/debuff icon
| [Intent Value]   |  ← damage number or effect name
|                  |
| [Enemy Sprite]   |
| [HP: ████░███]  |  ← HP bar with numbers
| Block: 5         |  ← block value
| [Status Effects] |  ← small icons for active effects
+------------------+
```

**Intent tooltip on hover:**
- Exact damage after all modifiers (Strength, Vulnerable, Weak)
- Status effect details (name, stacks, duration)
- Intent type explanation text

### HP Bar Design

```
[████████████░░░░░] 62/80
```

- **Green**: HP > 50% maxHP
- **Yellow**: HP 25-50% maxHP
- **Red**: HP < 25% maxHP
- **Block**: Blue overlay on top of HP bar
- Numbers always visible

### Energy Orb

```
   ⚡ 3/3
```

- Circle with current energy number centered
- **Blue** when energy available
- **Gray** when depleted
- Pulses when energy gained/lost

### End Turn Button

- Large, clearly visible in bottom-right
- Pulse animation during player's turn
- Disabled during enemy turn
- Label: "End Turn" (player turn) / "Enemy Turn..." (enemy phase)

### Card Targeting

When a card requires a target (single-enemy):

1. Card lifts from hand (Y offset -40px)
2. Valid targets get glowing border highlight
3. Invalid targets dim
4. Click enemy → card resolves
5. Right-click or ESC → cancel, card returns to hand

### Combat Log

```
+--------------------+
| > Player played    |
|   Strike → Enemy 1 |
|   Dealt 8 damage   |
| > Enemy 2 gains    |
|   12 Block          |
+--------------------+
```

- Default: last 3 entries visible
- Collapsible/expandable
- Scrollable for full history (max 50 entries)
- Color coded: damage (red), block (blue), heal (green), debuff (purple)

### Potion Slots

```
[🧪][🧪][🧪]  ← 3 slots, shows potion icon or empty
```

- Click potion → if target needed, enter target selection; if self-target, use immediately
- Empty slots show empty bottle outline

### Speed Settings

| Speed | Animation Multiplier | Use Case |
|-------|--------------------:|---------|
| 1x (Normal) | 1.0 | Learning, first runs |
| 2x (Fast) | 0.5 | Experienced players |
| 3x (Ultra Fast) | 0.25 | Speed runners (skip non-essential) |

### Animation Feedback

| Event | Animation | Duration |
|-------|-----------|----------|
| Card play | Card moves to center, effect resolves, moves to discard | 0.5s |
| Damage taken | Red number pops from target, screen shake on big hits | 0.3s |
| Block gained | Blue shimmer on entity | 0.2s |
| Energy spent | Orb drains | 0.1s |
| Energy gained | Orb fills | 0.1s |
| Status effect | Icon flash on target | 0.2s |
| Intent revealed | Icon slides in | 0.3s |
| Enemy dies | Fade out + particles | 0.3s |
| Combat end | "Victory!" banner | 0.5s |
| Turn start (player) | Hand cards fan in from bottom | 0.3s |
| Turn start (enemy) | Intent icons update | 0.3s |

## Formulas

### Card Position in Hand

```
cardX(index, handSize, screenWidth):
  totalWidth = handSize * cardWidth + (handSize - 1) * gap
  startX = (screenWidth - totalWidth) / 2
  return startX + index * (cardWidth + gap)

cardY(index, isHovered, isSelected):
  baseY = screenHeight - cardHeight - bottomMargin  // 80px margin
  if isSelected: return baseY - 40
  if isHovered: return baseY - 20
  return baseY
```

### HP Bar Width

```
hpBarWidth(currentHP, maxHP, barMaxWidth):
  return Math.max(1, (currentHP / maxHP) * barMaxWidth)
```

Minimum 1px visible even at 1 HP.

### Block Overlay Width

```
blockOverlayWidth(block, maxHP, barMaxWidth):
  return Math.min((block / maxHP) * barMaxWidth, barMaxWidth)
```

Capped at barMaxWidth.

### Intent Damage Preview

```
intentPreviewDamage(enemy):
  baseDamage = enemy.currentMove.damage
  bonus = getEffectStacks(enemy, "Strength")
  vuln = vulnerableMultiplier(player)  // if player has Vulnerable
  weak = weakMultiplier(enemy)        // if enemy has Weak
  return Math.floor((baseDamage + bonus) * vuln * weak)
```

## Edge Cases

1. **10-card hand overflow**: Cards compress horizontally to fit. Minimum card width
   enforced (80px). If still doesn't fit, overlap with slight Y stagger.

2. **0-card hand**: Valid (all exhausted). Empty hand area shows "No cards in hand".

3. **5+ enemies**: Max 5 displayed. Additional enemies rendered smaller or with
   simplified sprites.

4. **Very long card names**: Truncate with "...". Full name in tooltip.

5. **0 HP display**: HP bar empty, number "0/80" in red. Visual death indicator.

6. **Block exceeds maxHP**: Block overlay caps at barMaxWidth. Shows actual number
   regardless of bar visual.

7. **All enemies dead mid-animation**: Remaining animations skip. Victory banner
   appears immediately.

8. **Player dies mid-card**: Card effect stops, death state displayed, combat ends.

9. **Speed 3x with potion use**: Potion animations play at normal speed regardless
   of speed setting — player must see what happened.

10. **Screen resize (responsive)**: All positions relative to screen dimensions.
    Minimum supported: 1280x720. Cards scale proportionally.

## Dependencies

### Upstream (this system depends on)

| System | Type | Interface |
|--------|------|-----------|
| Combat System | Hard | Combat state, turn phase, entity HP/block/intent |
| Card System | Hard | Card data for display (name, cost, description, art) |
| Energy System | Hard | currentEnergy, effectiveMaxEnergy |
| Status Effect | Hard | Active effects for icon display |
| Enemy AI System | Hard | Intent data for enemy intent display |
| Relic System | Soft | Relic list for relic bar |
| Potion System | Soft | Potion slots for potion display |
| Run State Manager | Soft | HP reference |
| Data/Config | Hard | UI layout config, animation timings |

### Downstream (systems that depend on this)

| System | Type | Interface |
|--------|------|-----------|
| Combat System | Hard | Card play input, end turn input, potion use input |
| Potion System | Hard | Potion use triggered from UI |
| Screen Flow | Hard | Combat end triggers screen transition |

## Tuning Knobs

| Knob | Location | Default | Safe Range | What Breaks |
|------|----------|---------|------------|-------------|
| `cardWidth` | `ui-config.json` | 120px | 80-160 | 80: hard to read; 160: hand too wide |
| `cardHeight` | `ui-config.json` | 170px | 120-200 | 120: text too small |
| `cardHoverLift` | `ui-config.json` | 20px | 10-30 | 10: subtle; 30: jarring |
| `cardSelectLift` | `ui-config.json` | 40px | 20-60 | 20: hard to see selected |
| `animationSpeedMultiplier` | `ui-config.json` | 1.0 | 0.25-1.0 | 0.25: too fast to follow |
| `combatLogMaxEntries` | `ui-config.json` | 50 | 20-100 | 20: scrolls too often |
| `intentUpdateDuration` | `ui-config.json` | 0.3s | 0.1-0.5 | 0.1: too fast; 0.5: too slow |
| `hpBarMaxWidth` | `ui-config.json` | 200px | 100-300 | 100: too narrow for big HP |

## Acceptance Criteria

1. Hand displays current cards with correct cost, name, description.
2. Unplayable cards are visually distinct (grayed out).
3. Card hover shows tooltip with computed values.
4. Card targeting highlights valid enemies.
5. Enemy intent icons display correct type and value.
6. Energy orb shows current/max energy.
7. HP bar shows current/max HP with color coding (green/yellow/red).
8. Block shown as blue overlay on HP bar.
9. End Turn button active during player turn, disabled during enemy turn.
10. Potion slots display current potions; clickable to use.
11. Relic bar displays all relics with hover tooltips.
12. Combat log shows recent actions with color coding.
13. Speed toggle (1x/2x/3x) adjusts animation speed.
14. Combat victory displays victory banner.

## Open Questions

1. **Card art**: Placeholder rectangles for MVP, or should we commission card art
   early? Recommend: colored rectangles with type icons for MVP. Art pass in Polish.
   Owner: Art Director.

2. **Screen shake toggle**: Should screen shake be toggleable for accessibility?
   Recommend: yes, with intensity slider in settings. Owner: UX Designer.

3. **Mobile layout**: How does combat UI adapt to portrait/mobile?
   Recommend: defer to post-MVP. Desktop-first for MVP.
   Owner: UX Designer.
