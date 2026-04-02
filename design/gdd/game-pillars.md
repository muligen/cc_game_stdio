# Game Pillars

**Last Updated:** 2026-04-01

---

These pillars are the non-negotiable creative principles that guide every decision
in this project. When two design choices conflict, pillars break the tie. Every
department — design, art, audio, UI, narrative, engineering — must be able to
trace their decisions back to these pillars.

## Pillar 1: Informed Strategy

Players always have the information they need to make meaningful decisions. The
intent system is the beating heart of this principle — enemies telegraph their
next action, turning every combat turn into a solvable tactical puzzle rather
than a leap of faith. Hidden information is the enemy of strategic depth.

### Design Implications

- Enemy intents must always be visible and accurate before the player commits
  to playing cards. No "surprise" actions that contradict the telegraph.
- Card text must be precise and unambiguous. "Deal damage" always means attack
  damage; effects must specify targets, amounts, and conditions explicitly.
- Map node contents (combat type, event categories) should be knowable before
  commitment, allowing route planning based on current deck state and HP.
- Reward screens must present all options simultaneously so the player can weigh
  opportunity costs (see Pillar 2) with full information.

### Anti-Patterns

- Random enemy behavior that cannot be predicted or planned for (e.g., enemies
  rolling a new intent after the player commits to an action).
- Card effects with hidden interactions or undocumented secondary effects.

### Design Test

If we are debating whether to hide information from the player (e.g., hiding
enemy damage values, concealing card rarity in rewards), this pillar says: reveal
it. The player should be solving puzzles, not guessing.

---

## Pillar 2: Meaningful Opportunity Cost

Every choice requires giving something up. Adding a card dilutes the draw pool.
Taking the elite path means skipping a rest site. Buying a relic leaves less gold
for card removal. "Take nothing" is always a valid — and often correct — option.
A choice without a downside is not a choice; it is a click.

### Design Implications

- Card rewards must always include a "skip all" option that is intentionally
  competitive. The best players frequently skip rewards.
- Boss relics must have meaningful downsides alongside their powerful upsides
  (e.g., gain energy but lose a card slot each turn).
- Gold is a zero-sum resource within a run: spending on the shop means less for
  future shops, removing a card means less gold for buying a relic.
- Rest site choices (heal vs. upgrade vs. other) must be genuinely agonizing.
  If one option is always correct, the choice is meaningless.
- Deck thinning (card removal) must be expensive enough that players weigh it
  against alternatives rather than always doing it.

### Anti-Patterns

- Free card additions with no deckbuilding downside (e.g., "gain a card with
  no cost" events that are purely positive).
- Relics with powerful effects and no drawback or opportunity cost.

### Design Test

If we are debating whether to add a feature that gives the player something for
free (no gold cost, no deck cost, no HP risk), this pillar says: add a cost. The
player should feel the weight of every "yes."

---

## Pillar 3: Adaptive Builds

Players start each run from scratch and must adapt to what the game offers. There
is no "perfect deck" to aim for — only the optimal deck for *this specific run's*
available cards, relics, and events. The game rewards flexible strategic thinking
over memorized build orders. No two runs play the same way.

### Design Implications

- Card pool rarity and randomization must ensure players cannot reliably force
  a specific archetype every run. Availability is shaped by RNG, not selection.
- Multiple viable archetypes must exist for each character, and the game should
  not steer players toward one "correct" build path.
- Events, shops, and elite rewards must vary enough between runs that no
  scripted route through the map guarantees success.
- Relic synergies should be emergent (discovered during play) rather than
  deterministic (guaranteed combos). Some relics pair well; others clash — and
  that is the point.
- Meta-progression (unlocks) expands the *possibility space* rather than
  increasing *power*. New cards and relics add options, not raw strength.

### Anti-Patterns

- Guaranteed access to specific powerful cards through deterministic events or
  fixed shops (enables recipe-like play that kills replayability).
- Meta-upgrades that make the player objectively stronger across all runs
  (violates roguelike "each run stands alone" principle).

### Design Test

If we are debating whether to guarantee a specific card or relic is always
available to enable a build, this pillar says: do not guarantee it. The fun is
in making the best of what you are offered, not in executing a plan.

---

## Pillar 4: Calculated Tension

The difficulty curve creates constant moments of tension and relief. Elite fights,
boss encounters, and risky event choices should make the player feel that their
hard-earned progress is at stake — but the risk must always be calculable based
on available information (Pillar 1). Tension comes from the stakes and the math,
not from arbitrary difficulty spikes or gotcha mechanics.

### Design Implications

- Player death must always be traceable to a series of player decisions, not to
  an unavoidable RNG spike. "I chose to fight the elite at low HP" is fair;
  "the enemy did triple damage with no warning" is not.
- HP acts as a long-term resource that players manage across floors. Taking
  damage in early combats to save cards or time must have real consequences
  later in the act.
- Boss fights must be telegraphed in advance (which boss, what mechanics) so
  players can prepare their deck and strategy accordingly.
- Ascension modifiers must be cumulative and transparent — the player should
  always know exactly what changed at each difficulty level.
- Difficulty spikes are front-loaded in each act (elite encounters, boss fights)
  rather than back-loaded (random difficulty jumps).

### Anti-Patterns

- "Gotcha" mechanics: enemies with hidden phases, surprise damage spikes, or
  mechanics that punish the player on first encounter without warning.
- Difficulty that scales arbitrarily (e.g., enemies gaining random stats)
  rather than through predictable, learnable patterns.

### Design Test

If we are debating whether to add a mechanic where the player can die to
something they had no way to predict or prepare for, this pillar says: replace
it with a risk the player can see coming and choose to engage with.

---

## Pillar 5: Readability First

Every visual, audio, and UI choice prioritizes information clarity. If a flashy
effect obscures damage numbers, enemy intents, or card text, the flashy effect
must go. The game respects the player's cognitive load — UI should make the
right decision hard to figure out, not hard to *see*. This applies across all
departments: art, audio, UI design, and narrative presentation.

### Design Implications

- Card art must never overlap or obscure card text, energy cost, or keywords.
  Readability is the primary visual hierarchy constraint.
- Combat VFX (attacks, buffs, debuffs) must be short enough to not delay or
  obscure the next decision point. Juice serves clarity, never fights it.
- Enemy intent icons must be immediately distinguishable at a glance: attack
  (damage amount), defend (block amount), buff/debuff (effect type). No two
  intent types should share similar visual language.
- UI layout must present all relevant decision information without requiring
  the player to navigate sub-menus during combat. Hand, energy, enemy intents,
  and player HP/block should all be visible simultaneously.
- Audio cues must reinforce game state: distinct sounds for incoming damage,
  block application, card draw, and turn transitions. Sound should *reduce*
  cognitive load, not add to it.
- Color choices must account for colorblind accessibility. Red/green should
  never be the sole distinguisher between harmful and beneficial effects.

### Anti-Patterns

- Screen-shake or particle effects that obscure enemy intent displays or card
  text during the player's decision phase.
- Small font sizes or low-contrast text that requires squinting to read card
  effects, especially on smaller screens or mobile browsers.

### Design Test

If we are debating whether to add a visual or audio effect that makes the game
"cooler" but makes it harder to read the board state, this pillar says: simplify
the effect. The coolest thing this game can be is readable.

---

## Pillar Tension Map

Pillars are only useful when they create productive tension — forcing designers
to weigh competing priorities rather than applying one rule everywhere. The key
tensions in this pillar set:

| Tension | Resolution Principle |
|---------|---------------------|
| **Informed Strategy** vs. **Adaptive Builds** | Reveal tactical information (enemy intents, card effects) but keep strategic information uncertain (future card offers, map layout). The player solves the turn, not the run. |
| **Opportunity Cost** vs. **Readability First** | Present complex trade-offs with clear UI so the cost of each option is *obvious*, not *obscured*. Complexity lives in the decision, not in the interface. |
| **Calculated Tension** vs. **Informed Strategy** | Reveal what enemies *will* do (intent), but not what the run *will* offer (future rewards). Tactical certainty creates space for strategic surprise. |
| **Adaptive Builds** vs. **Calculated Tension** | Run variance creates tension — but the tension must be *survivable* through good play. No run should be unwinnable due to bad RNG alone. |

---

## Anti-Pillars

What this game is explicitly NOT. Every "no" protects the pillars above.

1. **Not a reaction game.** There are no timers on decisions, no twitch mechanics,
   no real-time pressure. Thinking time is unlimited. Violating this would
   undermine Informed Strategy and Opportunity Cost pillars by punishing
   deliberation.

2. **Not a memorization test.** The game does not require the player to remember
   information from previous runs or external wikis. All information needed for
   the current decision is visible on screen. Violating this would undermine
   Informed Strategy and Readability First pillars.

3. **Not a power fantasy.** The player is not meant to feel overwhelmingly strong.
   Victories are earned through skillful adaptation, not through outscaled stats.
   Violating this would undermine Calculated Tension and Adaptive Builds pillars
   by removing the stakes that make decisions meaningful.

4. **Not a narrative game.** Story serves the gameplay, not the other way around.
   Events have flavor text and thematic choices, but the primary payoff is
   mechanical (HP/gold/cards), not emotional. Violating this would divert
   resources from the core strategic loop.
