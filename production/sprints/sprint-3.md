# Sprint 3 -- Demo Sprint

## Sprint Goal

Build the visual demo for investor presentation. The player sees a complete combat
experience: cards rendered visually, enemies with HP bars and intents, interactive
card play (click card → click enemy → resolve), enemy turn with visible actions,
victory → reward card selection → next combat with the new card in deck.

This sprint transforms 858 passing backend tests into a **visible, playable game**.

## Capacity

- Total days: 14 working days (accelerated sprint for demo deadline)
- Buffer (15%): 2 days
- Available: 12 days

## Context

- **Milestone**: Milestone 1: Combat System MVP
- **Previous Sprint**: Sprint 2 -- 858 tests, all combat backend logic complete
- **What's Done**: CombatController, Turn Flow, Damage Pipeline, Death Checks, Block,
  Intent Display, Display Events, First Turn Handling, CombatLogger, CombatFactory,
  CombatScene (logic-only), all data JSON files exist
- **What's Missing**: ALL visual rendering, screen transitions, Character System,
  Reward System, input handling

### Architecture References

- ADR-001: Scene plugin pattern, data-driven design
- ADR-002: Combat Resolution Pipeline (events drive visual updates)
- ADR-003: Effect Resolution System
- ADR-004: Event Bus (combat-scoped events for UI subscriptions)

### Design Doc References

- `design/gdd/combat-ui.md` -- Full combat UI specification
- `design/gdd/screen-flow.md` -- Scene transitions
- `design/gdd/reward.md` -- Reward generation rules
- `design/gdd/character.md` -- Character data, starter deck

## Demo Flow (Target Investor Experience)

```
Boot → Auto-load Ironclad → Auto-enter Combat
  → See 5 cards in hand, enemy with intent
  → Click Strike → enemy highlights → click enemy → card resolves
  → See damage number, HP bar update, energy spent
  → Click End Turn → enemy acts → see damage to player
  → Repeat until victory
  → Reward screen: 3 cards + gold → pick 1 or skip
  → Auto-enter next combat
  → New card appears in hand
```

## Tasks

### Must Have (Demo Critical Path)

| ID | Task | Owner | Est. Days | Dependencies | Acceptance Criteria |
|----|------|-------|-----------|-------------|-------------------|
| S3-01 | Implement CharacterManager: load CharacterData from registry, resolve starterDeck card IDs into CardData[], create run state with HP/maxHP/energy/deck | gameplay-programmer | 1.0 | None (types + data exist) | CharacterManager.loadCharacter('ironclad') returns full starter deck with 10 resolved cards; provides combat scene data payload |
| S3-02 | Implement SceneFlowController: minimal scene transition system (BootScene → CombatScene → RewardScene → CombatScene), per screen-flow GDD transition types | gameplay-programmer | 1.0 | None | Scene transitions work without crashes; CombatScene receives valid CombatSceneData; BootScene auto-loads Ironclad data |
| S3-03 | Implement CombatScene visual state sync: subscribe to combat events (onHPChanged, onEnergyChanged, onDamageDealt, onBlockGained, onCardPlayed, onIntentSelected, onEnemyDeath, onCombatEnd), update visual state from events | gameplay-programmer | 1.5 | S3-02 | CombatScene subscribes to all display events; event payloads correctly update visual state; no Phaser rendering yet (state tracking only) |
| S3-04 | Implement card hand rendering: Phaser GameObjects for cards (colored rectangles with Text for name/cost/description), fan layout per combat-ui GDD formula, hover lift (-20px), unplayable gray-out | gameplay-programmer | 1.5 | S3-03 | Cards render in fan layout at bottom of screen; hover shows tooltip; unplayable cards grayed out; max 10 cards handled |
| S3-05 | Implement enemy display: enemy panels (sprite placeholder + HP bar + block value + intent icon), targeting highlight when card selected, HP bar color coding (green/yellow/red) | gameplay-programmer | 1.5 | S3-03 | Enemies render in upper center; HP bar updates on damage; block shows blue overlay; intent shows type + value; targeting highlight works |
| S3-06 | Implement combat HUD: energy orb (current/max), player HP bar, end turn button, pile counters (draw/discard/exhaust), turn indicator | gameplay-programmer | 1.0 | S3-03 | Energy orb updates on card play; HP bar color-codes correctly; end turn button active during player turn only; pile counters accurate |
| S3-07 | Implement card play input flow: click card in hand → enters targeting mode → valid enemies highlight → click enemy → call playCard() → resolve animation → next card state; right-click/ESC cancels targeting | gameplay-programmer | 1.5 | S3-04, S3-05 | Full card play input loop works: click → target → resolve; self-target cards play immediately; X-cost and unplayable handled; ESC cancels targeting |
| S3-08 | Implement combat turn flow UI: End Turn button calls endPlayerTurn() → enemy turn executes with visual delay → startPlayerTurn() draws cards with animation → enemy intents update | gameplay-programmer | 1.0 | S3-06, S3-07 | Clicking End Turn triggers enemy turn; enemy actions visible; new cards drawn at turn start; combat ends correctly (victory/defeat) |
| S3-09 | Implement combat animation basics: damage number popups (float up + fade), card play animation (card moves to center then to discard), enemy death fade-out | gameplay-programmer | 1.0 | S3-07, S3-08 | Damage numbers appear on hit; cards animate to center on play; dead enemies fade out; animations don't block input incorrectly |
| S3-10 | Implement Reward System backend: generateRewards() with gold (15-20 for normal), 3 cards from character pool (respect rarity), 40% potion drop, per reward GDD | gameplay-programmer | 1.0 | S3-01 | Reward generation produces valid rewards; gold correct for enemy type; 3 unique cards from character pool; seeded RNG deterministic |
| S3-11 | Implement RewardScene UI: display 3 cards with names/descriptions, gold amount, skip button; clicking card adds to deck; auto-transition to next combat | gameplay-programmer | 1.5 | S3-09, S3-10 | Reward screen shows 3 cards; click adds card to deck and transitions; skip skips all rewards; gold auto-added; next combat has new card |
| S3-12 | End-to-end demo test: full flow from boot → character load → combat → card play → enemy turn → victory → reward → next combat → verify new card in hand | gameplay-programmer | 1.0 | S3-11 | Complete demo loop runs without crashes; all 858 existing tests still pass; combat formulas produce correct visual results |

### Should Have

| ID | Task | Owner | Est. Days | Dependencies | Acceptance Criteria |
|----|------|-------|-----------|-------------|-------------------|
| S3-13 | Implement combat log display: right-side panel showing recent actions with color coding (damage=red, block=blue, heal=green, status=purple), per combat-ui GDD | gameplay-programmer | 0.5 | S3-08 | Combat log shows last 3 entries; color coded; expandable to 50 |
| S3-14 | Implement MapScene minimal: vertical encounter list (3 combat nodes), click node → combat, after combat → back to map, per map-ui GDD minimal spec | gameplay-programmer | 1.0 | S3-11 | Map shows 3 nodes; clicking starts combat; returns to map after combat; visual indicator for completed nodes |

### Nice to Have

| ID | Task | Owner | Est. Days | Dependencies | Acceptance Criteria |
|----|------|-------|-----------|-------------|-------------------|
| S3-15 | Implement TriggerManager bridge: connect EventBus events to relic trigger callbacks per ADR-004 Decision 5; implement Burning Blood relic (heal 6 HP after combat) | gameplay-programmer | 1.0 | S3-08 | TriggerManager subscribes to onCombatEnd; Burning Blood heals 6 HP after victory; trigger fires at correct timing |

## Risks

| Risk | Probability | Impact | Mitigation |
|------|------------|--------|------------|
| Phaser rendering performance with 10 cards + 3 enemies | Low | Medium | Use sprite batching; profile early in S3-04 |
| Card targeting input conflicts with hover state | Medium | Low | Clear state machine: idle → hovering → targeting → resolving |
| Animation timing blocking input (feels unresponsive) | Medium | High | Use Phaser tweens with input-enabled flag; never block >0.5s |
| Combat event subscription leak between combats | Medium | High | ADR-004: destroy combat-scoped bus on combat end; re-subscribe in create() |
| Reward card generation pool too small (duplicates) | Low | Low | cards.json has 30+ Ironclad cards; 3 unique picks easily achievable |

## Definition of Done

- [ ] All Must Have tasks (S3-01 through S3-12) completed
- [ ] Demo flow runs end-to-end without crashes
- [ ] All 858 existing tests still pass (no regressions)
- [ ] `tsc --noEmit` passes with zero errors
- [ ] Visual elements match combat-ui GDD layout (positions, colors, sizing)
- [ ] Card play input responsive (no >0.5s input blocks)
- [ ] Energy and HP display update correctly per combat events

---

## Sprint Notes

### Priority Order

This sprint prioritizes **visible results** over architectural purity:

1. **S3-01**: Character data loading — needed to create valid combat payloads
2. **S3-02**: Scene transitions — needed to flow between screens
3. **S3-03**: Event → visual state bridge — foundation for all rendering
4. **S3-04/S3-05**: Card hand + enemies — the two biggest visual components
5. **S3-06**: HUD — essential combat info (energy, HP, end turn)
6. **S3-07**: Input flow — makes the game playable
7. **S3-08**: Turn flow UI — completes the combat loop visually
8. **S3-09**: Animations — polish that makes it feel like a game
9. **S3-10/S3-11**: Rewards — the post-combat payoff
10. **S3-12**: End-to-end test — verify everything works together

### Placeholder Art Strategy

For the demo, all visuals use **Phaser built-in shapes + Text**:

- Cards: Colored rectangles (red=attack, blue=skill, green=power) with Text overlay
- Enemies: Gray rectangles with Text name
- HP bars: Rectangle with fill (green/yellow/red)
- Energy orb: Circle with Text number
- End turn button: Rectangle with Text
- Intent icons: Text symbols (⚔=attack, 🛡=defend, ✨=buff)

No external art assets required. Art pass deferred to Polish stage.

### Architecture Alignment

- **ADR-001**: CombatScene follows scene plugin pattern. UI components are Phaser
  GameObjects managed by the scene, not separate systems.
- **ADR-004**: Combat-scoped GameEventBus drives all visual updates. UI subscribes
  to events, never polls state. This keeps rendering decoupled from logic.
- **Combat UI GDD**: Layout positions reference 1920x1080 as per combat-ui.md.
  All positions relative to screen dimensions for responsiveness.

### Testing Strategy

- **Visual components**: Integration tests using Phaser's headless mode where possible;
  screenshot comparison deferred to Polish
- **Input flow**: Unit tests for state machine transitions (idle → targeting → resolving)
- **Reward generation**: Unit tests with seeded RNG (deterministic)
- **Regression**: All 858 existing tests must pass after every task
