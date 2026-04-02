# Save/Load System

> **Status**: Designed
> **Author**: user + agents
> **Last Updated**: 2026-04-02
> **Implements Pillar**: Infrastructure — no direct pillar alignment (supports all pillars via persistence)

## Overview

The Save/Load System manages persistent game state storage. It handles two data categories: **Run State** (complete current run state for mid-session recovery) and **Meta State** (cross-run meta-progression, achievements, unlocks). Uses browser localStorage or IndexedDB for storage, with auto-save on every major game event and full state recovery on load.

## Player Fantasy

Players can close the browser at any time and resume exactly where they left off. No need to complete a run in one sitting. Meta-progression progress is never lost. Seamless save/restore experience.

## Detailed Design

### Save Data Schema

```
interface SaveData {
  version: string              // save format version for migration
  timestamp: number            // last save time (epoch ms)
  
  // Active run state (null if no active run)
  runState: RunState | null
  
  // Meta progression (always saved)
  metaState: MetaState
  
  // Settings
  settings: GameSettings
  
  // Ascension progress per character
  ascensionProgress: Record<string, number>
}

interface GameSettings {
  masterVolume: number         // 0.0 - 1.0
  musicVolume: number
  sfxVolume: number
  animationSpeed: number       // 1, 2, or 3
  screenShake: boolean
  screenShakeIntensity: number // 0.0 - 1.0
}
```

### Auto-Save Triggers

| Trigger | What's Saved | Priority |
|---------|-------------|----------|
| After combat | Full run state + meta | Critical |
| After map node selection | Full run state | Critical |
| After shop/rest/event | Full run state | Critical |
| After reward selection | Full run state | Critical |
| Settings change | Settings only | Normal |
| Meta unlock purchase | Meta state only | Critical |
| Run end (victory/death) | Clear run state, save meta | Critical |

### Save Flow

```
autoSave():
  saveData = {
    version: CURRENT_SAVE_VERSION,
    timestamp: Date.now(),
    runState: runStateManager.serialize(),
    metaState: metaProgression.serialize(),
    settings: settingsManager.serialize(),
    ascensionProgress: ascensionSystem.serialize()
  }
  storage.set(SAVE_KEY, JSON.stringify(saveData))
```

### Load Flow

```
loadSave():
  raw = storage.get(SAVE_KEY)
  if !raw: return null
  
  saveData = JSON.parse(raw)
  
  // Version migration
  if saveData.version != CURRENT_SAVE_VERSION:
    saveData = migrateSave(saveData)
    if !saveData: return null  // migration failed
  
  // Restore all state
  if saveData.runState:
    runStateManager.restore(saveData.runState)
  metaProgression.restore(saveData.metaState)
  settingsManager.restore(saveData.settings)
  ascensionSystem.restore(saveData.ascensionProgress)
  
  return saveData
```

### Storage Backend

```
class SaveStorage {
  private backend: StorageBackend
  
  constructor():
    if supportsLocalStorage():
      this.backend = new LocalStorageBackend()
    else:
      this.backend = new IndexedDBBackend()
  
  set(key: string, data: string): void
  get(key: string): string | null
  delete(key: string): void
  exists(key: string): boolean
}
```

### Save Version Migration

```
migrateSave(saveData):
  while saveData.version != CURRENT_SAVE_VERSION:
    migrator = getMigrator(saveData.version)
    if !migrator:
      // Cannot migrate — warn user, offer fresh start
      showWarning("Save data from incompatible version.")
      return null
    saveData = migrator.migrate(saveData)
  return saveData
```

### Run Recovery on Load

```
recoverRun(saveData):
  if !saveData.runState: return "MAIN_MENU"
  
  run = saveData.runState
  
  if run.status == "ACTIVE":
    return "MAP"  // always return to map on recovery
  
  if run.status == "VICTORY" || run.status == "DEFEATED":
    return "MAIN_MENU"
```

## Formulas

### Save Data Size

```
saveDataSize(saveData):
  return JSON.stringify(saveData).length  // bytes
```

### Max Save Size

```
maxSaveSize():
  return 5 * 1024 * 1024  // 5MB (typical localStorage limit)
```

### Save Validation

```
isSaveValid(saveData):
  return saveData
    && saveData.version
    && saveData.metaState
    && saveData.timestamp > 0
```

### Save Age

```
saveAge(saveData):
  return Date.now() - saveData.timestamp  // ms since last save
```

## Edge Cases

1. **No save data**: First launch. Show main menu. Create default meta state.

2. **Corrupted save data**: JSON parse fails. Show warning. Offer "Start Fresh" option. Attempt recovery from backup slot.

3. **Save data too large**: Exceeds storage limit. Trim combat history. Warn user.

4. **Mid-combat save**: Combat state NOT saved. On load, player returns to MAP.

5. **Mid-event save**: Same as mid-combat. Return to MAP.

6. **Multiple tabs**: localStorage is shared. If save timestamp is newer than expected, warn: "Another session may have modified save data."

7. **Browser data cleared**: All progress lost. No recovery. Export feature for Post-MVP.

8. **Version downgrade**: Not supported. If save from newer version, warn and offer fresh start.

9. **Auto-save during transition**: Queued. Save executes after transition completes.

10. **Settings-only save**: Lightweight — only serialize settings, not full run state.

## Dependencies

### Upstream (this system depends on)

| System | Type | Interface |
|--------|------|-----------|
| Run State Manager | Hard | Full RunState serialization/deserialization |
| Meta-Progression | Hard | Full MetaState serialization/deserialization |
| Map System | Hard | MapData included in run state |
| Deck Manager | Hard | Master deck state in run state |
| Ascension System | Hard | Per-character ascension progress |
| Settings | Hard | User preferences |

### Downstream (systems that depend on this)

| System | Type | Interface |
|--------|------|-----------|
| Screen Flow | Soft | Load determines starting screen |
| All game systems | Soft | State restoration feeds into all systems |

## Tuning Knobs

| Knob | Location | Default | Safe Range | What Breaks |
|------|----------|---------|------------|-------------|
| `autoSaveEnabled` | `save-config.json` | true | false | false: progress lost on close |
| `maxSaveSizeBytes` | `save-config.json` | 5242880 | 1MB-10MB | 1MB: may truncate; 10MB: exceeds limit |
| `saveCompressionEnabled` | `save-config.json` | false | true/false | true: slower saves |
| `combatHistoryMaxEntries` | `save-config.json` | 50 | 0-200 | 0: no history; 200: large saves |
| `backupSaveEnabled` | `save-config.json` | true | false | false: no backup on corruption |

## Acceptance Criteria

1. Auto-save triggers after every major game event.
2. Game state fully restored on reload (run state, meta, settings).
3. Meta progression persists across browser sessions.
4. Corrupted save shows warning with recovery option.
5. Mid-combat/mid-event save returns player to map on reload.
6. Settings changes persist across sessions.
7. Save version migration handles format changes.
8. Save data size within browser storage limits.
9. Multiple tab detection warns user.
10. Fresh start option available when save is incompatible.

## Open Questions

1. **Cloud save sync**: Should save data sync to a server for cross-device play?
   Recommend: Post-MVP. Requires backend infrastructure. Owner: Technical Director.

2. **Save file export**: Should players be able to export/import save data?
   Recommend: yes, as JSON file. Useful for backup and sharing. Owner: UX Designer.

3. **Multiple save slots**: Should players have multiple run save slots?
   Recommend: no for MVP — single active run. Post-MVP: 3 slots. Owner: Game Designer.
