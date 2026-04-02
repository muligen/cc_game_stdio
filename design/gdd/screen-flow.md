# Screen Flow

> **Status**: Designed
> **Author**: user + agents
> **Last Updated**: 2026-04-02
> **Implements Pillar**: Readability First (clear screen transitions, player always knows where they are), Informed Strategy (state visible across screens)

## Overview

Screen Flow manages all screen transitions and state changes in the game. It defines the complete flow from main menu to game end: Main Menu → Character Select → Map → Combat/Shop/Rest Site/Event → Reward → Map (loop) → Boss → Act Transition → Victory/Defeat. Screen Flow ensures every transition has an appropriate animation and that screen state is consistent with game state.

## Player Fantasy

**Readability First**: every screen change is smooth and meaningful. The player always knows where they are and where they're going next. Loading screens provide useful information (card tips, relic descriptions). No jarring black screens or unresponsive transitions. **Informed Strategy**: information carries across screens so the player always has what they need to make decisions.

Reference: Slay the Spire's screen flow is clean and efficient: Map → Combat → Reward → Map, each step clear and purposeful.

## Detailed Design

### Screen Enumeration

| Screen ID | Name | Description |
|-----------|------|-------------|
| `MAIN_MENU` | Main Menu | Start game, settings, quit |
| `CHARACTER_SELECT` | Character Select | Choose character, view starter deck |
| `MAP` | Map View | Path selection, map navigation |
| `COMBAT` | Combat | Full card combat interface |
| `REWARD` | Reward Selection | Post-combat victory rewards |
| `SHOP` | Shop | Buy/remove cards, buy relics/potions |
| `REST_SITE` | Rest Site | Rest/upgrade/dig/toke options |
| `EVENT` | Event | Choice-based event encounter |
| `BOSS_TREASURE` | Boss Treasure | Boss reward selection |
| `DEATH` | Death Screen | Combat defeat summary |
| `VICTORY` | Victory Screen | Run completion summary |
| `SETTINGS` | Settings | Volume, speed, accessibility |
| `PAUSE` | Pause | Pause menu |

### Screen Flow Graph

```
MAIN_MENU → CHARACTER_SELECT → MAP ──┬──→ COMBAT → REWARD → MAP
                                      ├──→ SHOP → MAP
                                      ├──→ REST_SITE → MAP
                                      ├──→ EVENT → MAP
                                      ├──→ TREASURE → MAP
                                      └──→ BOSS_TREASURE → MAP (new act)

COMBAT → DEATH (if HP <= 0)
MAP (act 3 boss defeated) → VICTORY
MAP → COMBAT (boss) → BOSS_TREASURE → MAP (next act) or VICTORY

Any screen → PAUSE → same screen
Any screen → SETTINGS → same screen
```

### Transition Types

| Type | Animation | Duration | Use Case |
|------|-----------|----------|----------|
| `FADE` | Fade to black then fade in | 0.4s | Screen changes (combat→reward) |
| `SLIDE_LEFT` | Current slides out left, new slides in right | 0.3s | Forward navigation (map→combat) |
| `SLIDE_RIGHT` | Current slides out right, new slides in left | 0.3s | Backward navigation (shop→map) |
| `DISSOLVE` | Cross-fade between screens | 0.5s | Death/Victory screens |
| `INSTANT` | No animation | 0s | Settings/Pause overlay |

### Transition Type Map

| From | To | Type |
|------|----:|------|
| MAIN_MENU | CHARACTER_SELECT | FADE |
| CHARACTER_SELECT | MAP | FADE |
| MAP | COMBAT | SLIDE_LEFT |
| COMBAT | REWARD | FADE |
| REWARD | MAP | SLIDE_RIGHT |
| MAP | SHOP | SLIDE_LEFT |
| SHOP | MAP | SLIDE_RIGHT |
| MAP | REST_SITE | SLIDE_LEFT |
| REST_SITE | MAP | SLIDE_RIGHT |
| MAP | EVENT | SLIDE_LEFT |
| EVENT | MAP | SLIDE_RIGHT |
| COMBAT | DEATH | DISSOLVE |
| COMBAT | BOSS_TREASURE | FADE |
| BOSS_TREASURE | MAP | SLIDE_RIGHT |
| MAP | VICTORY | DISSOLVE |
| Any | PAUSE | INSTANT (overlay) |
| Any | SETTINGS | INSTANT (overlay) |

### Screen Transition Rules

```
transition(fromScreen, toScreen, gameEvent):
  type = getTransitionType(fromScreen, toScreen)
  preloadAssets(toScreen)
  playTransition(type)
  currentScreen = toScreen
  initScreen(toScreen, gameEvent)
```

### Main Menu

```
+----------------------------------+
|                                    |
|   [Game Title]                    |
|                                    |
|   [Play]                          |
|   [Settings]                      |
|   [Quit]                          |
|                                    |
|   v0.1.0                          |
+----------------------------------+
```

- Play → CHARACTER_SELECT
- Settings → SETTINGS overlay
- Quit → confirm dialog → close

### Character Select

```
+----------------------------------+
|                                    |
|   [←]  [Character Portrait]  [→] |
|         "Ironclad"               |
|   HP: 80/80                      |
|   Starter Deck: [view]           |
|   Starter Relic: Burning Blood   |
|                                    |
|   [Start Run]  [Back]            |
+----------------------------------+
```

- Left/Right arrows cycle through characters
- View shows starter deck cards
- Start Run → initialize run → MAP

### Death Screen

```
+----------------------------------+
|                                    |
|   "DEFEATED"                      |
|                                    |
|   Floor: 7                        |
|   Act: 1                          |
|   Combats Won: 5                  |
|   Gold Earned: 120                |
|   Time: 00:23:45                  |
|                                    |
|   [Run History]  [Main Menu]     |
+----------------------------------+
```

### Victory Screen

```
+----------------------------------+
|                                    |
|   "VICTORY!"                      |
|                                    |
|   Character: Ironclad             |
|   Score: 1250                     |
|   Combats Won: 28                 |
|   Elites Killed: 4                |
|   Relics: 12                      |
|   Time: 01:15:30                  |
|                                    |
|   [Play Again]  [Main Menu]      |
+----------------------------------+
```

### Pause Menu

```
+----------------------------------+
|                                    |
|   PAUSED                          |
|                                    |
|   [Resume]                        |
|   [Settings]                      |
|   [Abandon Run]                   |
|   [Main Menu]                     |
+----------------------------------+
```

- Abandon Run → confirmation dialog → MAIN_MENU
- Settings → overlay
- Resume → close pause

### Loading Screen

During asset preloading, show a loading screen with:
- Random card tip ("Tip: Exhaust cards remove themselves from combat")
- Random relic description
- Progress bar (if loading > 0.3s)

## Formulas

### Transition Duration

```
transitionDuration(type):
  switch(type):
    FADE: return 0.4
    SLIDE_LEFT: return 0.3
    SLIDE_RIGHT: return 0.3
    DISSOLVE: return 0.5
    INSTANT: return 0
```

### Screen Stack Management

```
screenStack.push(screen):
  screenHistory.push(currentScreen)
  currentScreen = screen

screenStack.pop():
  if screenHistory.length > 0:
    currentScreen = screenHistory.pop()
```

### Loading Threshold

```
loadingThreshold():
  return estimatedLoadTime > 0.3
  // Show loading screen only if preload estimated > 0.3s
```

## Edge Cases

1. **Rapid screen transitions**: Queue transitions. Never skip. If player triggers transition while one is in progress, queue it and execute after current completes.

2. **Asset load failure**: Show retry dialog on the loading screen. "Failed to load. Retry?" Never soft-lock.

3. **Pause during transition**: Queue pause. Execute after transition completes.

4. **Death during multi-stage combat**: Death screen appears immediately. No remaining combat animations.

5. **Back button on first screen**: CHARACTER_SELECT back → MAIN_MENU. MAP has no back (run in progress).

6. **Victory then immediately replay**: New run initializes. All state reset. Score recorded.

7. **Abandon run confirmation**: Two-step confirmation. "Abandon run? All progress will be lost." → "Are you sure?" → MAIN_MENU.

8. **Settings changes during combat**: Apply immediately. Speed changes take effect on next animation.

9. **Screen resize during transition**: Layout recalculates on new screen init. Transition continues with recalculated positions.

10. **Very fast loading (< 0.1s)**: Skip loading screen entirely. Go straight to target screen.

## Dependencies

### Upstream (this system depends on)

| System | Type | Interface |
|--------|------|-----------|
| Combat UI | Hard | Combat screen rendering and input |
| Map UI | Hard | Map screen rendering and input |
| Reward/UI | Hard | Reward screen rendering and input |
| Run State Manager | Hard | Run status (ACTIVE/VICTORY/DEFEATED) drives screen flow |
| Data/Config | Hard | Screen flow config, transition timings |

### Downstream (systems that depend on this)

| System | Type | Interface |
|--------|------|-----------|
| None (terminal system) | — | Screen Flow is consumed by the player directly |

## Tuning Knobs

| Knob | Location | Default | Safe Range | What Breaks |
|------|----------|---------|------------|-------------|
| `fadeDuration` | `ui-config.json` | 0.4s | 0.2-0.8 | 0.2: jarring; 0.8: slow |
| `slideDuration` | `ui-config.json` | 0.3s | 0.15-0.5 | 0.15: too fast; 0.5: sluggish |
| `dissolveDuration` | `ui-config.json` | 0.5s | 0.3-1.0 | 0.3: abrupt; 1.0: melodramatic |
| `loadingScreenThreshold` | `ui-config.json` | 0.3s | 0.1-0.5 | 0.1: loading screen flickers |
| `pauseOverlayOpacity` | `ui-config.json` | 0.7 | 0.5-0.9 | 0.5: background distracting |
| `deathScreenDelay` | `ui-config.json` | 1.0s | 0.5-2.0 | 0.5: too sudden; 2.0: waiting |
| `victoryBannerDuration` | `ui-config.json` | 2.0s | 1.0-4.0 | 1.0: missed it; 4.0: boring |

## Acceptance Criteria

1. Main menu displays Play, Settings, Quit options.
2. Character select shows available characters with starter info.
3. Map screen displays after character selection and run initialization.
4. Combat screen displays when entering combat node from map.
5. Reward screen displays after combat victory.
6. Death screen displays when player HP reaches 0.
7. Victory screen displays after final boss defeated.
8. Pause menu accessible from any game screen.
9. Screen transitions use correct animation type per transition map.
10. Rapid clicks do not cause duplicate transitions.
11. Asset load failures show retry dialog (no soft-locks).
12. Settings changes apply immediately.
13. Abandon run requires double confirmation.

## Open Questions

1. **Run history screen**: Should there be a dedicated run history screen accessible from death/victory?
   Recommend: yes, Post-MVP. Show past runs with stats. Owner: UX Designer.

2. **Tutorial integration**: Should the first run have tutorial overlays on each screen?
   Recommend: yes, Post-MVP. Contextual tips on first visit to each screen type.
   Owner: Game Designer + UX Designer.

3. **Screen flow analytics**: Should screen transition times be tracked for UX analysis?
   Recommend: yes, Post-MVP. Identify screens where players spend unusual time.
   Owner: Analytics Engineer.
