# Reward/UI

> **Status**: Designed
> **Author**: user + agents
> **Last Updated**: 2026-04-02
> **Implements Pillar**: Meaningful Opportunity Cost (skip is as prominent as take), Adaptive Builds (card picks shape build direction), Readability First (rarity colors clear at a glance)

## Overview

Reward UI is the complete interface for the post-combat reward selection screen. It renders and handles interaction for: gold display (auto-granted), card selection (pick 1 of 3 or skip), potion acquisition (optional on drop), and relic acquisition (elite/boss). Reward UI also includes the Boss Treasure screen (pick 1 of 3 boss relics) and inter-act reward screens.

## Player Fantasy

**Meaningful Opportunity Cost**: the "Skip" button is just as prominent as "Take". Skipping a bad card isn't a failure — it's a strategic decision to keep your deck lean. **Adaptive Builds**: every card pick shapes your build direction. **Readability First**: card rarity colors are immediately clear (white/blue/gold), gold amount visible at a glance.

Reference: Slay the Spire's reward screen — 3 cards horizontally arranged, Skip is prominent, gold auto-collected.

## Detailed Design

### Screen Layout (1920x1080 reference)

```
+------------------------------------------------------------------+
|  "Combat Victory!"                                                 |
|                                                                    |
|  💰 Gold: +25                                        [Auto-added] |
|                                                                    |
|  +----------+ +----------+ +----------+                           |
|  | [Card 1] | | [Card 2] | | [Card 3] |                           |
|  | Common   | | Rare     | | Uncommon |                           |
|  |          | |          | |          |                            |
|  | Bash     | | Carnage  | | Shrug    |                            |
|  |          | |          | |          |                            |
|  | [Take]   | | [Take]   | | [Take]   |                            |
|  +----------+ +----------+ +----------+                           |
|                     [Skip All Cards]                               |
|                                                                    |
|  🧪 Potion: Fire Potion                            [Take] [Skip]  |
|                                                                    |
|  ⬮ Continue                                                       |
+------------------------------------------------------------------+
```

### UI Components

| Component | Position | Content | Interactive |
|-----------|----------|---------|-------------|
| **Victory Header** | Top center | "Combat Victory!" | No |
| **Gold Display** | Top | "+X Gold" with coin icon | No (auto-added) |
| **Card Rewards** | Center | 3 card previews with rarity | Yes (Take or Skip) |
| **Skip All Cards** | Below cards | "Skip All Cards" button | Yes |
| **Potion Reward** | Below cards | Potion icon + name | Yes (Take/Skip) |
| **Relic Reward** | Below potion | Relic icon + name | Yes (auto or choose) |
| **Continue Button** | Bottom | "Continue" → Map | Yes |
| **Card Tooltip** | Overlay | Full card details on hover | No (info) |

### Card Reward Display

```
+------------------+
| [Rarity Color]   |  ← Border color: White/Blue/Gold
|                  |
|   [Card Art]     |
|                  |
| [Card Name]      |  ← Name
| [Cost] [Type]    |  ← Energy cost, card type
| [Description]    |  ← Effect text
|                  |
|    [Take]        |  ← Click to add to deck
+------------------+
```

### Rarity Color Coding

| Rarity | Border Color | Glow |
|--------|-------------|------|
| COMMON | White/Gray | None |
| UNCOMMON | Blue | Subtle blue |
| RARE | Gold | Gold shimmer |
| BOSS | Red/Orange | Red pulse |

### Card States

| State | Visual |
|-------|--------|
| **Available** | Full color, rarity border, cursor pointer |
| **Hovered** | Lift up 10px, show full card tooltip |
| **Selected (taken)** | Green flash, shrinks to deck |
| **Skipped** | Fades to gray when Skip All clicked |

### Potion Reward Display

Normal:
```
+---------------------------+
| 🧪 [Potion Name]         |
| Effect description        |
| [Take]  [Skip]            |
+---------------------------+
```

Slots full:
```
+---------------------------+
| 🧪 [Potion Name]         |
| Effect description        |
| ⚠️ Potion slots full      |
| [Swap]  [Skip]            |
+---------------------------+
```

Swap opens a sub-dialog showing current potions. Click one to discard, new potion takes its slot.

### Relic Reward Display

```
+---------------------------+
| ⬮ [Relic Name]           |
| Relic description         |
| Tier: COMMON              |
| [Added to inventory]      |  ← Auto-granted
+---------------------------+
```

### Boss Relic Selection

```
+------------------------------------------------------------------+
|  "Boss Defeated! Choose a Relic"                                   |
|                                                                    |
|  +----------+ +----------+ +----------+                           |
|  | [Relic 1]| | [Relic 2]| | [Relic 3]|                           |
|  | Name     | | Name     | | Name     |                            |
|  | Desc     | | Desc     | | Desc     |                            |
|  |          | |          | |          |                            |
|  | [Take]   | | [Take]   | | [Take]   |                            |
|  +----------+ +----------+ +----------+                           |
|                     [Skip All]                                     |
+------------------------------------------------------------------+
```

### Reward Flow

1. Combat victory declared → Reward data generated by Reward System
2. Gold auto-calculated and displayed ("+25 Gold" with coin animation)
3. Card rewards displayed: 3 cards with rarity borders
4. Player selects one card ("Take") or skips all
5. If potion dropped: show potion with Take/Skip/Swap options
6. If relic earned: show relic (auto-granted or choose for boss)
7. Continue button appears after all selections made
8. Click Continue → return to Map

### Animation Feedback

| Event | Animation | Duration |
|-------|-----------|----------|
| Screen open | Fade in from black | 0.3s |
| Gold awarded | Coins fly to gold counter | 0.5s |
| Card hover | Lift 10px, full detail | 0.15s |
| Card taken | Green flash, shrink to deck icon | 0.4s |
| Card skipped | Fade to gray | 0.3s |
| Potion taken | Bottle flies to potion slot | 0.3s |
| Relic obtained | Relic icon pulses, flies to relic bar | 0.4s |
| Boss relic hover | Expand detail panel | 0.2s |
| Continue enabled | Button pulse | Continuous |

## Formulas

### Card Reward Positioning

```
cardRewardX(index, totalCards, screenWidth):
  totalWidth = totalCards * cardWidth + (totalCards - 1) * gap
  startX = (screenWidth - totalWidth) / 2
  return startX + index * (cardWidth + gap)

cardRewardY(isHovered):
  baseY = screenHeight * 0.35
  if isHovered: return baseY - 10
  return baseY
```

### Gold Text Position

```
goldTextPosition():
  return { x: screenWidth / 2, y: screenHeight * 0.15 }
```

### Continue Button State

```
continueButtonEnabled(rewardsProcessed):
  return all required choices made
  // Gold always auto-processed
  // Card: taken or skipped
  // Potion: taken, swapped, or skipped (only if dropped)
  // Relic: auto or chosen
```

## Edge Cases

1. **No cards in pool**: Display "No cards available" in card section. Skip is the only option.

2. **Potion slots full + potion drop**: Show swap dialog. Player can discard any existing potion for the new one, or skip entirely.

3. **Boss relic skip**: Valid. Player may skip all 3 boss relics (they often have downsides). "Skip All" must be clearly visible.

4. **Same rarity for all 3 cards**: Valid. All common or all rare is possible. Display remains the same.

5. **Gold only reward**: If no card reward (pool exhausted) and no potion drop, screen shows just gold and Continue. Quick screen.

6. **Very long card description**: Truncate with "..." in reward card. Full text in hover tooltip.

7. **Boss treasure after Act 1/2 boss**: Separate reward screen with relic pick-3-choose-1 + gold bonus.

8. **Multiple relics from same combat**: Not possible in normal flow. Elite = 1 relic, Boss = pick 1 of 3. Never multiple.

9. **Screen resize during reward**: Cards re-center. All positions relative to screen dimensions.

10. **Rapid clicking Take on multiple cards**: Only first click registers. Cards lock after one selection. Other cards immediately dim.

## Dependencies

### Upstream (this system depends on)

| System | Type | Interface |
|--------|------|-----------|
| Reward System | Hard | Reward data (gold amount, card list, potion, relic) |
| Card System | Hard | CardData for display (name, cost, description, rarity) |
| Relic System | Hard | Relic data for display (name, description, tier) |
| Potion System | Hard | Potion data for display, slot availability check |
| Data/Config | Hard | UI layout config, animation timings |

### Downstream (systems that depend on this)

| System | Type | Interface |
|--------|------|-----------|
| Reward System | Hard | Selection results (which card/potion/relic chosen or skipped) |
| Deck Manager | Hard | Card added to master deck |
| Potion System | Hard | Potion added or swapped |
| Relic System | Hard | Relic added |
| Screen Flow | Hard | Continue triggers screen transition to map |

## Tuning Knobs

| Knob | Location | Default | Safe Range | What Breaks |
|------|----------|---------|------------|-------------|
| `rewardCardWidth` | `ui-config.json` | 140px | 100-180 | 100: too narrow; 180: overflow |
| `rewardCardHeight` | `ui-config.json` | 200px | 150-250 | 150: text cut off |
| `rewardCardGap` | `ui-config.json` | 30px | 15-50 | 15: cramped; 50: too spread |
| `skipButtonProminence` | `ui-config.json` | "medium" | "low"/"medium"/"high" | "high": encourages skipping too much |
| `goldAnimationDuration` | `ui-config.json` | 0.5s | 0.2-1.0 | 0.2: too fast to see; 1.0: slow |
| `cardTakenAnimation` | `ui-config.json` | 0.4s | 0.2-0.8 | 0.2: abrupt; 0.8: sluggish |

## Acceptance Criteria

1. Reward screen displays gold amount with coin animation.
2. 3 cards displayed with correct rarity color borders.
3. Card hover shows full card details in tooltip.
4. Player can select exactly one card (Take) or skip all.
5. Selected card plays take animation and is added to deck.
6. Skipped cards fade to gray.
7. Potion reward shows when dropped, with Take/Skip options.
8. Potion swap dialog appears when slots are full.
9. Relic auto-grant displays relic info with animation.
10. Boss relic screen shows 3 relics with pick-1-or-skip.
11. Continue button only enabled after all choices made.
12. All animations respect speed settings (1x/2x/3x).

## Open Questions

1. **Card preview size**: Should reward cards be the same size as hand cards, or larger for readability?
   Recommend: slightly larger (1.2x) for easier reading. Owner: UX Designer.

2. **Reward screen music**: Should there be a unique track for the reward screen?
   Recommend: short victory jingle, then ambient. Owner: Audio Director.

3. **Quick-take shortcut**: Should there be a keyboard shortcut to quickly take the rarest card?
   Recommend: no for MVP — clicking is fast enough. Owner: UX Designer.
