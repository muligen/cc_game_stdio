# Game Concept

## Overview

A roguelike deckbuilder inspired by Slay the Spire. Players build a deck of
cards during each run by battling enemies, visiting shops, and making
risk/reward decisions on a procedurally generated map. The game runs in the
browser using WebGL via Phaser 3.

## Genre

Roguelike Deckbuilder

## Platform

Web browser (WebGL via Phaser 3)

## Target Audience

- Fans of deckbuilding games (Slay the Spire, Monster Train, Inscryption)
- Roguelike enthusiasts who enjoy strategic decision-making
- Casual and hardcore players alike (easy to learn, hard to master)

## Core Gameplay Loop

### Macro Loop (full run, 30-90 min)

1. Select a character
2. Navigate procedurally generated map across 3 Acts
3. Build deck through combat rewards, shops, and events
4. Defeat Act bosses to progress
5. Win or die (permadeath — all run progress lost, meta-unlocks persist)

### Meso Loop (per floor, 5-15 min)

1. Choose next node on the map (branching paths)
2. Resolve node (combat / event / shop / rest / treasure)
3. Receive rewards and make deckbuilding decisions
4. Continue to next floor

### Micro Loop (per combat turn, ~30s)

1. See enemy intents (telegraphed actions)
2. Draw 5 cards, get 3 energy
3. Play cards strategically (attack/block/utility)
4. End turn — block expires, enemy acts
5. Repeat until enemies dead or player HP = 0

## Core Systems

### 1. Card System

- **Energy cost**: Each card costs energy to play. Base energy is 3 per turn.
- **Card types**:
  - **Attack** — Deal damage, sometimes with additional effects
  - **Skill** — Defensive/utility (block, draw, heal, buff)
  - **Power** — Persistent passive effect for the rest of combat
  - **Status** — Negative cards added by enemies (Wound, Burn, Dazed, Slimed)
  - **Curse** — Negative cards from events/relics; usually unplayable
- **Rarity**: Common, Uncommon, Rare (with pity system)
- **Card upgrade**: At Rest Sites, upgrade one card (+suffix, improved stats)
- **Keywords**: Exhaust, Ethereal, Innate, Retain, Unplayable
- **Deck piles**: Draw, Hand, Discard, Exhaust

### 2. Combat System

- **Turn-based**: Player acts first, then enemies
- **Intent system**: Enemies telegraph their next action (damage amount,
  buff/debuff, defend). This is the core strategic innovation — player always
  has information to make informed decisions.
- **Block**: Temporary HP shield, resets each turn
- **Buffs/Debuffs**: Vulnerable (+50% damage taken), Weak (-25% damage dealt),
  Frail (-25% block), Poison (DOT bypassing block), Strength (+damage),
  Dexterity (+block), and more
- **Enemy AI**: Weighted move pools with anti-degeneracy rules (e.g. won't
  attack twice in a row)

### 3. Map System

- **Act structure**: 3 Acts, each ~15-17 floors, plus hidden 4th Act
- **Procedural generation**: Branching paths on a grid, reconnecting routes
- **Node types**:
  - Monster (standard combat)
  - Elite (hard combat, guaranteed relic reward)
  - Rest Site (heal 30% HP OR upgrade one card)
  - Shop (buy cards, relics, potions; remove cards)
  - Event (narrative choices with mechanical outcomes)
  - Treasure (relic chest)
  - Boss (end-of-Act fight, 3 possible per Act)

### 4. Relic System

- Permanent passive bonuses for the entire run
- **Rarity tiers**: Starter, Common, Uncommon, Rare, Boss, Shop, Event
- **Boss relics**: Powerful upside with a downside trade-off
- Sources: boss rewards, elite drops, chests, shops, events

### 5. Potion System

- Single-use combat consumables, does not cost energy
- Default capacity: 3 slots (expandable via relics)
- **Categories**: Damage, Block, Buff, Debuff, Card Discovery, Healing
- Drop chance: 40% base, adjusts dynamically

### 6. Character System

Each character has unique:
- Starting HP, starter relic, starter deck
- Exclusive card pool
- Unique core mechanic

**Planned characters** (design in later stages):
- Warrior-type (strength stacking, exhaust synergy)
- Rogue-type (poison, shivs, discard synergy)
- Mage-type (orb/channeling system)
- Monk-type (stance dancing, scry/retain)

### 7. Event System

- Random encounters with narrative choices
- Risk/reward outcomes: gain/lose HP, gold, cards, relics, curses
- Act-specific and shared events
- Shrine subcategory (encountered at most once per run)

### 8. Ascension Mode

- 20 cumulative difficulty levels
- Each level adds one permanent modifier (less gold, stronger enemies,
  fewer potion slots, etc.)
- Unlocked by beating the game with that character
- Provides long-term challenge for experienced players

## Player Fantasy

Strategic mastery — the thrill of building a synergistic deck from scratch each
run, adapting to what the game offers, and making optimal decisions under
uncertainty. Every choice matters: which card to pick, which path to take, when
to skip a reward to keep the deck lean.

## Visual Style

- 2D card game aesthetic
- Clean, readable card layouts with clear iconography
- Dark fantasy atmosphere
- Animated combat effects for attacks, buffs, and debuffs

## Technical Approach

- **Framework**: Phaser 3 (WebGL rendering)
- **Language**: TypeScript
- **Platform**: Web browser
- **Rendering**: WebGL with Canvas fallback
- **Art**: 2D sprites, card art, UI elements
- **Audio**: Web Audio API (via Phaser)

## Differentiation

This game focuses on faithfully recreating the Slay the Spire experience as a
web-native game. Key differentiators:

- Instant access in browser (no download/install)
- Cross-platform via web (desktop, mobile browsers)
- Lightweight and fast-loading

## Success Criteria

- Complete game loop: start run → play through 3 Acts → win/lose
- At least 1 playable character with full card pool
- Functional combat with intent system
- Procedural map generation
- Card rewards, shop, and basic relics
- Responsive web performance (60fps target)
