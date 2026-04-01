---
name: drive
description: "Continuous project autopilot: reads project state, proposes the single most important next action, asks for yes/no approval, delegates execution, and loops. Run /drive to start."
argument-hint: "[optional: 'status' to see current position, 'reset' to restart from assessment, or a stage name to jump to that stage]"
user-invocable: true
allowed-tools: Read, Glob, Grep, Write, Edit, Bash, WebSearch, Task, AskUserQuestion
---

# Project Driver — Continuous Autopilot

This skill is the project's autopilot. It reads the current project state,
determines the single most important next action, proposes it to the user, and
executes it on approval. Then it loops. The user only needs to say **yes** or
**no** at each step.

---

## Arguments

- **(no argument)** — Start or continue the Drive Loop from where you left off
- **`status`** — Show current position in the workflow map without proposing anything
- **`reset`** — Discard session state and re-assess from scratch
- **`[stage-name]`** — Jump to a specific stage's workflow (e.g., `/drive production`)

---

## The Drive Loop

On each iteration, follow these four phases in order:

### Phase 1: Assess

Read the following files (in order):

1. `production/stage.txt` — current stage (authoritative source, set by `/gate-check`)
2. `production/session-state/drive-state.md` — session progress (if exists)
3. `production/session-state/active.md` — any active work context

Then scan key artifacts:

```
# Check these artifacts to understand what exists
- design/gdd/game-concept.md      (concept exists?)
- design/gdd/game-pillars.md      (pillars defined?)
- design/gdd/systems-index.md     (systems mapped? how many designed vs total?)
- design/gdd/*.md                 (list all GDD files)
- .claude/docs/technical-preferences.md  (engine configured?)
- docs/architecture/*.md          (ADR count)
- prototypes/*/REPORT.md          (prototype reports)
- production/sprints/*.md         (sprint plans)
- production/milestones/*.md      (milestone definitions)
- src/                            (file count, directory structure)
- tests/                          (test files)
```

If `production/stage.txt` does not exist, auto-detect stage using the same
heuristics as `/project-stage-detect`:

| Stage | Indicators |
|-------|-----------|
| **Concept** | No game-concept.md |
| **Systems Design** | Game concept exists, systems-index missing or incomplete |
| **Technical Setup** | Systems index exists, engine not configured |
| **Pre-Production** | Engine configured, src/ has <10 files |
| **Production** | src/ has 10+ files, active development |
| **Polish** | Explicit only (set by `/gate-check`) |
| **Release** | Explicit only (set by `/gate-check`) |

### Phase 2: Propose

Consult the **Stage-Based Workflow Map** below. Find the current stage and the
first step whose expected output artifact is missing (or whose prerequisite steps
are all done). Present ONE proposed action:

```
=== Next Step: [Step ID] ===
Stage: [current stage]
Action: [Clear, specific description]
Delegates to: [/skill-name or agent-name]
Why now: [Why this is next, referencing what exists and what's missing]
Expected output: [What artifact this produces]
```

Then use `AskUserQuestion`:

- **Yes, proceed** — execute this step
- **Not now** — defer, move to next step
- **Skip** — permanently skip this step
- **Why this step?** — explain reasoning, then re-ask

### Phase 3: Execute

When the user approves:

- **For skills**: Use the Skill tool with `skill: "[name]", args: "[arguments]"`
- **For agents**: Use the Task tool with `subagent_type: "[agent-name]"` and a
  detailed prompt including file paths, design doc references, and constraints
- Provide full context in every delegation prompt
- Wait for completion
- Verify the expected output artifact was created (read or glob for it)
- If the artifact is missing, flag the step as incomplete and explain what happened

### Phase 4: Record

After execution (or deferral/skipping), update the state file at
`production/session-state/drive-state.md`. Create it if it doesn't exist:

```markdown
# Drive Session State

## Session Info
- Started: [ISO timestamp]
- Last Updated: [ISO timestamp]
- Stage: [current stage]

## Current Position
- Step ID: [last proposed/completed step ID]
- Next Step: [what the next iteration should propose]

## Steps Completed
1. [Step ID] [description] — [result: done / skipped / deferred]

## Notes
- [any user decisions affecting future steps]
```

Then **loop back to Phase 1** — reassess project state and propose the next action.

---

## Stage-Based Workflow Map

This is the complete map of all steps across all stages. Use it to determine
what comes next based on the current project state.

### Concept Stage

| ID | Action | Skill/Agent | Output | Prerequisite |
|----|--------|-------------|--------|--------------|
| C.1 | Brainstorm game concept | `/brainstorm` | `design/gdd/game-concept.md` | None |
| C.2 | Review concept quality | `/design-review design/gdd/game-concept.md` | Review verdict | C.1 |
| C.3 | Define game pillars | delegate to `creative-director` | `design/gdd/game-pillars.md` | C.2 |
| C.4 | Gate check: Concept → Systems Design | `/gate-check systems-design` | PASS/CONCERNS/FAIL | C.3 |

If C.4 returns FAIL: identify failed items from the gate check, propose targeted
fix steps, then retry C.4.

### Systems Design Stage

| ID | Action | Skill/Agent | Output | Prerequisite |
|----|--------|-------------|--------|--------------|
| S.1 | Map all systems and dependencies | `/map-systems` | `design/gdd/systems-index.md` | C.4 PASS |
| S.2 | Design next system GDD (repeat per system) | `/design-system [system]` | Individual GDD in `design/gdd/` | S.1 |
| S.3 | Design-review each completed GDD | `/design-review [path]` | Review verdicts | S.2 (per system) |
| S.4 | Gate check: Systems Design → Technical Setup | `/gate-check technical-setup` | PASS/CONCERNS/FAIL | All S.2/S.3 done |

For S.2: read `design/gdd/systems-index.md` to find which systems need GDDs.
Design them in the priority order specified by the systems index. This step
loops — propose one system at a time, get approval, execute, then propose the
next system.

### Technical Setup Stage

| ID | Action | Skill/Agent | Output | Prerequisite |
|----|--------|-------------|--------|--------------|
| T.1 | Configure engine and preferences | `/setup-engine` | Updated CLAUDE.md, technical-preferences | S.4 PASS |
| T.2 | Create initial architecture decision | `/architecture-decision` | First ADR in `docs/architecture/` | T.1 |
| T.3 | Additional ADRs for core systems | delegate to `technical-director` | Additional ADRs | T.2 |
| T.4 | Gate check: Technical Setup → Pre-Production | `/gate-check pre-production` | PASS/CONCERNS/FAIL | T.3 |

For T.3: review the systems-index and create ADRs for architecturally
significant systems (rendering, data management, networking if applicable).
Not every system needs an ADR — focus on systems with non-obvious technical
choices.

### Pre-Production Stage

| ID | Action | Skill/Agent | Output | Prerequisite |
|----|--------|-------------|--------|--------------|
| P.1 | Prototype core mechanic | `/prototype [core-mechanic]` | Prototype + report in `prototypes/` | T.4 PASS |
| P.2 | Playtest the prototype | `/playtest-report` | Playtest report | P.1 |
| P.3 | Go/no-go decision on prototype | delegate to `creative-director` | Decision documented | P.2 |
| P.4 | Complete remaining GDDs (if any) | `/design-system [system]` | Additional GDDs | P.3 |
| P.5 | Create first milestone | delegate to `producer` | Milestone in `production/milestones/` | P.3 |
| P.6 | Plan first sprint | `/sprint-plan new` | Sprint plan in `production/sprints/` | P.5 |
| P.7 | Gate check: Pre-Production → Production | `/gate-check production` | PASS/CONCERNS/FAIL | P.6 |

If P.3 returns "no-go": propose pivoting the prototype or redesigning the core
mechanic. Loop back to P.1 with adjusted parameters.

### Production Stage

The production stage is a repeating sprint cycle. Each sprint follows the same
pattern.

| ID | Action | Skill/Agent | Output | Prerequisite |
|----|--------|-------------|--------|--------------|
| Pr.1 | Sprint planning | `/sprint-plan` | Sprint plan | P.7 PASS |
| Pr.2 | Implement sprint tasks (one at a time) | `team-*` or individual agents | Code in `src/` | Pr.1 |
| Pr.3 | Code review for each completed task | `/code-review` | Review feedback | Pr.2 (per task) |
| Pr.4 | Test each completed feature | delegate to `qa-tester` | Test results | Pr.3 |
| Pr.5 | Sprint retrospective | `/retrospective` | Retro findings | Sprint done |
| Pr.6 | Milestone review (when milestone due) | `/milestone-review` | Milestone status | As needed |
| Pr.7 | Scope check (every 2-3 sprints) | `/scope-check` | Scope report | As needed |
| Pr.8 | Tech debt scan (every 2-3 sprints) | `/tech-debt` | Debt register | As needed |
| Pr.9 | Gate check: Production → Polish | `/gate-check polish` | PASS/CONCERNS/FAIL | All milestones done |

For Pr.2: read the sprint plan to identify tasks. Propose one task at a time.
Use the appropriate `team-*` skill for cross-domain tasks, or individual
specialist agents for single-domain tasks. After each task completes, propose
the next task in the sprint.

### Polish Stage

| ID | Action | Skill/Agent | Output | Prerequisite |
|----|--------|-------------|--------|--------------|
| Po.1 | Performance profiling | `/perf-profile` | Profile report | Pr.9 PASS |
| Po.2 | Balance check | `/balance-check` | Balance report | Po.1 |
| Po.3 | Asset audit | `/asset-audit` | Audit results | Po.1 |
| Po.4 | Polish team for problem areas | `/team-polish` | Polish results | Po.1–Po.3 |
| Po.5 | Accessibility review | delegate to `accessibility-specialist` | A11y report | Po.4 |
| Po.6 | Localization pass | `/localize` | Localized strings | Po.4 |
| Po.7 | Final playtest | `/playtest-report` | Playtest results | Po.4–Po.6 |
| Po.8 | Gate check: Polish → Release | `/gate-check release` | PASS/CONCERNS/FAIL | Po.7 |

### Release Stage

| ID | Action | Skill/Agent | Output | Prerequisite |
|----|--------|-------------|--------|--------------|
| R.1 | Release checklist | `/release-checklist` | Checklist | Po.8 PASS |
| R.2 | Launch checklist | `/launch-checklist` | Launch readiness | R.1 |
| R.3 | Generate changelog | `/changelog` | Changelog | R.2 |
| R.4 | Generate patch notes | `/patch-notes` | Player-facing notes | R.3 |
| R.5 | Execute release | `/team-release` | Deployed build | R.4 |
| R.6 | Post-release monitoring | delegate to `release-manager` | Stability report | R.5 |

---

## Special Modes

### Status Mode (`/drive status`)

Read `production/session-state/drive-state.md` and present a summary:

```
=== Drive Status ===
Stage: [current]
Last Step: [ID and description]
Steps Completed This Session: [N]

Next Up: [what the next iteration would propose]
```

Do not propose any action. Just report.

### Reset Mode (`/drive reset`)

Delete `production/session-state/drive-state.md` (if the user confirms) and
re-assess from scratch. Useful if the state file is stale or incorrect.

### Stage Jump (`/drive [stage-name]`)

Skip directly to a specific stage's workflow. Valid stage names:
`concept`, `systems-design`, `technical-setup`, `pre-production`,
`production`, `polish`, `release`.

This updates `production/stage.txt` and resets the step position within that
stage. Use with caution — skipping stages may leave gaps.

---

## Edge Cases

### Empty Project (no artifacts at all)

This is the most common starting point. The Drive Loop should:
1. Auto-detect stage as "Concept"
2. Create `production/session-state/drive-state.md` (initial state)
3. Propose C.1: `/brainstorm` as the first step

### User Interrupts with Free-Form Request

If during the Drive Loop the user types a request that's not a yes/no answer:
1. Handle their request directly or delegate to the appropriate agent
2. After handling, update drive-state.md
3. Resume the Drive Loop from Phase 1 (re-assess)

### Gate Check Fails

If a `/gate-check` returns FAIL:
1. Read the gate check output to identify which items failed
2. Propose targeted fix steps (one at a time) to address each failure
3. After fixes, re-propose the gate check
4. Do NOT advance the stage until PASS is achieved

### Conflicting State

If `production/stage.txt` says one stage but artifacts suggest a different stage:
- Trust `production/stage.txt` (it was set explicitly by `/gate-check`)
- Warn the user about the discrepancy
- Propose running `/project-stage-detect` to reconcile

### Context Window Pressure

If the conversation is getting long:
1. Ensure drive-state.md is fully up to date
2. Suggest the user run `/compact Focus on the Drive Loop — state is in production/session-state/drive-state.md`
3. After compaction, the Drive Loop will read drive-state.md to recover

---

## Collaborative Protocol

1. **One step at a time** — never propose multiple actions
2. **Clear format** — always use the standardized proposal format
3. **User decides** — never auto-execute without approval
4. **Record everything** — update drive-state.md after every step
5. **Loop continuously** — after each step, immediately propose the next
6. **Respect "stop"** — exit the loop when the user says stop/pause/done
