/**
 * status-effect-manager.ts — Status effect management system.
 *
 * Implements: design/gdd/status-effect.md (Core Rules, Formulas, Edge Cases)
 * Architecture: ADR-001 Decision 2 (combat-scoped state), ADR-003 (effect resolution),
 *               ADR-004 (event bus for status effect triggers)
 *
 * Manages all buffs, debuffs, and neutral effects on combat entities.
 * Handles stacking rules, duration tracking, turn-end processing, and Artifact negation.
 *
 * Key design decisions:
 * - All numeric values come from StatusEffectData loaded from status-effects.json.
 * - STACKS duration effects are NOT decremented by processTurnEnd — external callers
 *   (e.g., poison damage handler) handle that via modifyEffect.
 * - processTurnEnd only handles TURNS duration effects (duration -= 1, remove at 0).
 * - isPlayerTurn parameter is accepted for future trigger timing but unused in current logic.
 * - Artifact negation is handled by tryApplyDebuff, not applyEffect.
 */

import {
  DurationType,
  StackingMode,
  type StatusEffectCategory,
  type StatusEffectData,
  type StatusEffectInstance,
} from '../types/status-effect';
import { Logger } from '../utils/logger';

const LOG = new Logger('StatusEffectManager');

/**
 * Callback type for checking if a target is immune to a specific debuff.
 * Used for boss immunity per GDD Edge Case #10.
 */
export type ImmunityChecker = (targetId: string, effectId: string) => boolean;

/**
 * Represents a change to an entity's status effects.
 * Emitted when effects are applied, removed, or modified.
 */
export interface StatusEffectChangeEvent {
  targetId: string;
  effectId: string;
  stacks: number;
  source: string;
}

/**
 * StatusEffectManager — manages status effects on combat entities.
 *
 * Lifecycle:
 * 1. Created at combat start with status effect definitions from GameRegistry.
 * 2. applyEffect() / tryApplyDebuff() called by combat system, card effects, enemy AI.
 * 3. processTurnEnd() called at end of each entity's turn.
 * 4. clearAllEffects() / resetForCombat() called when combat ends or entity dies.
 *
 * All numeric values come from the StatusEffectData config. No hardcoded gameplay values.
 */
export class StatusEffectManager {
  /** Status effect definitions loaded from status-effects.json. */
  private readonly effectDefinitions: Map<string, StatusEffectData>;

  /** Active effects per entity: entityId -> list of active instances. */
  private readonly entityEffects: Map<string, StatusEffectInstance[]>;

  /** Optional callback for checking target immunity to specific debuffs. */
  private immunityChecker: ImmunityChecker | null;

  /**
   * Event listeners for status effect changes.
   * In production, these will be emitted via the CombatEventBus (ADR-004).
   * For now, a simple callback list keeps the system testable without Phaser.
   */
  private readonly changeListeners: Array<(event: StatusEffectChangeEvent) => void>;

  /**
   * @param effectData - Array of status effect definitions from status-effects.json.
   */
  constructor(effectData: StatusEffectData[]) {
    this.effectDefinitions = new Map<string, StatusEffectData>();
    this.entityEffects = new Map<string, StatusEffectInstance[]>();
    this.immunityChecker = null;
    this.changeListeners = [];

    for (const data of effectData) {
      this.effectDefinitions.set(data.id, data);
    }

    LOG.info(`Initialized with ${this.effectDefinitions.size} effect definitions.`);
  }

  // ---------------------------------------------------------------
  // Configuration
  // ---------------------------------------------------------------

  /**
   * Set the immunity checker callback for boss immunity.
   * Per GDD Edge Case #10: immune debuffs are silently ignored and do NOT consume Artifact.
   */
  setImmunityChecker(checker: ImmunityChecker): void {
    this.immunityChecker = checker;
  }

  /**
   * Register a listener for status effect changes.
   * Used for event-driven UI updates (ADR-001, ADR-004).
   */
  onStatusEffectChange(listener: (event: StatusEffectChangeEvent) => void): void {
    this.changeListeners.push(listener);
  }

  // ---------------------------------------------------------------
  // Core: Apply Effects
  // ---------------------------------------------------------------

  /**
   * Apply a status effect to a target entity.
   *
   * Handles all 4 stacking modes per GDD Section 3:
   * - addDuration: new duration added to existing
   * - addStacks: new stacks added to existing
   * - overwriteMax: take maximum of old and new
   * - doesNotStack: ignore new application if already active
   *
   * @param targetId - The entity receiving the effect.
   * @param effectId - The status effect definition ID (e.g., "vulnerable").
   * @param stacks - Number of stacks or duration to apply.
   * @param source - What applied this effect (for debugging).
   * @returns true if the effect was newly created, false if it modified an existing one.
   * @throws Error if the effectId is unknown.
   */
  applyEffect(targetId: string, effectId: string, stacks: number, source: string): boolean {
    const data = this.getRequiredEffectData(effectId);

    const effects = this.getOrCreateEffects(targetId);
    const existing = effects.find((e) => e.effectId === effectId);

    if (existing) {
      this.applyStacking(existing, stacks, data.stackingMode);
      this.notifyChange({ targetId, effectId, stacks: existing.stacks, source });
      LOG.debug(`Applied ${effectId} to ${targetId}: stacking to ${existing.stacks}`);
      return false;
    }

    // New effect instance
    const instance: StatusEffectInstance = {
      effectId,
      stacks,
      source,
    };
    effects.push(instance);
    this.notifyChange({ targetId, effectId, stacks, source });
    LOG.debug(`Applied new ${effectId}(${stacks}) to ${targetId} from ${source}`);
    return true;
  }

  /**
   * Try to apply a debuff to a target, with Artifact negation.
   *
   * Per GDD Section 6 (Artifact Negation):
   * 1. Check if target is immune (boss immunity) — ignore, do NOT consume Artifact.
   * 2. Check if target has Artifact stacks > 0 — negate, consume 1 Artifact stack.
   * 3. Apply normally.
   *
   * @param targetId - The entity receiving the debuff.
   * @param effectId - The debuff effect ID.
   * @param stacks - Number of stacks/duration.
   * @param source - What applied this debuff.
   * @returns true if the debuff was applied, false if negated or immune.
   */
  tryApplyDebuff(targetId: string, effectId: string, stacks: number, source: string): boolean {
    const data = this.getRequiredEffectData(effectId);

    // Per GDD: only debuffs are negated by Artifact. Buffs and neutrals pass through.
    if (data.category !== 'debuff') {
      this.applyEffect(targetId, effectId, stacks, source);
      return true;
    }

    // GDD Edge Case #10: Boss immunity — silently ignored, does NOT consume Artifact.
    if (this.immunityChecker && this.immunityChecker(targetId, effectId)) {
      LOG.debug(`${targetId} is immune to ${effectId}. Not applied.`);
      return false;
    }

    // GDD Section 6: Artifact negation
    const artifactStacks = this.getEffectStacks(targetId, 'artifact');
    if (artifactStacks > 0) {
      this.modifyEffect(targetId, 'artifact', -1);
      LOG.debug(`Artifact on ${targetId} negated ${effectId}. Artifact remaining: ${artifactStacks - 1}`);
      return false;
    }

    // Apply normally
    this.applyEffect(targetId, effectId, stacks, source);
    return true;
  }

  // ---------------------------------------------------------------
  // Core: Remove Effects
  // ---------------------------------------------------------------

  /**
   * Remove a specific status effect from a target.
   *
   * @returns true if the effect was found and removed, false if not found.
   */
  removeEffect(targetId: string, effectId: string): boolean {
    const effects = this.entityEffects.get(targetId);
    if (!effects) {
      return false;
    }

    const index = effects.findIndex((e) => e.effectId === effectId);
    if (index === -1) {
      return false;
    }

    effects.splice(index, 1);
    this.notifyChange({ targetId, effectId, stacks: 0, source: 'removed' });
    LOG.debug(`Removed ${effectId} from ${targetId}`);
    return true;
  }

  /**
   * Remove all effects matching a filter from a target.
   *
   * Per GDD Open Question #2: supports filtering by category for "remove all debuffs" cards.
   *
   * @param targetId - The entity to clean up.
   * @param filter - Optional filter object. If absent, removes ALL effects.
   * @returns The number of effects removed.
   */
  removeEffects(
    targetId: string,
    filter?: { category?: StatusEffectCategory; effectId?: string }
  ): number {
    const effects = this.entityEffects.get(targetId);
    if (!effects) {
      return 0;
    }

    if (!filter) {
      // Remove all
      const count = effects.length;
      effects.length = 0;
      return count;
    }

    let removed = 0;
    for (let i = effects.length - 1; i >= 0; i--) {
      const instance = effects[i];
      const data = this.effectDefinitions.get(instance.effectId);

      let matches = true;
      if (filter.category && data) {
        matches = matches && data.category === filter.category;
      }
      if (filter.effectId) {
        matches = matches && instance.effectId === filter.effectId;
      }

      if (matches) {
        effects.splice(i, 1);
        removed++;
      }
    }

    return removed;
  }

  // ---------------------------------------------------------------
  // Queries
  // ---------------------------------------------------------------

  /**
   * Get the current stacks/duration of an effect on a target.
   *
   * Per GDD Formulas: returns 0 if the effect is not present.
   * Used by damage/block modifier calculations.
   */
  getEffectStacks(targetId: string, effectId: string): number {
    const effects = this.entityEffects.get(targetId);
    if (!effects) {
      return 0;
    }
    const instance = effects.find((e) => e.effectId === effectId);
    return instance ? instance.stacks : 0;
  }

  /**
   * Check if a target has a specific status effect active.
   */
  hasEffect(targetId: string, effectId: string): boolean {
    const effects = this.entityEffects.get(targetId);
    if (!effects) {
      return false;
    }
    return effects.some((e) => e.effectId === effectId);
  }

  /**
   * Get all active effects on a target as a read-only snapshot.
   *
   * Used by Combat UI for effect icon/tooltip display (ADR-004).
   */
  getAllEffects(targetId: string): ReadonlyArray<Readonly<StatusEffectInstance>> {
    const effects = this.entityEffects.get(targetId);
    if (!effects) {
      return [];
    }
    return effects.map((e) => ({ ...e }));
  }

  /**
   * Get the static effect definition for a given effect ID.
   *
   * Returns undefined if the effect ID is not found.
   */
  getEffectData(effectId: string): StatusEffectData | undefined {
    return this.effectDefinitions.get(effectId);
  }

  // ---------------------------------------------------------------
  // Modify Stacks
  // ---------------------------------------------------------------

  /**
   * Modify the stacks of an existing effect by a delta amount.
   *
   * Per GDD Formulas (Poison tick): stacks -= 1 then check for removal.
   * Used by external callers to decrement STACKS-duration effects.
   *
   * If the effect does not exist, this is a no-op.
   * If stacks reach 0 or below, the effect is automatically removed.
   *
   * @returns The new stacks value, or 0 if the effect was removed/not found.
   */
  modifyEffect(targetId: string, effectId: string, delta: number): number {
    const effects = this.entityEffects.get(targetId);
    if (!effects) {
      return 0;
    }

    const instance = effects.find((e) => e.effectId === effectId);
    if (!instance) {
      return 0;
    }

    instance.stacks += delta;

    // Remove at exactly 0 for all types (no meaningful effect at 0 stacks).
    // Allow negative stacks for COMBAT/PERMANENT effects (e.g., Strength, Dexterity).
    const definition = this.effectDefinitions.get(effectId);
    const durationType = definition?.durationType;
    const canGoNegative = durationType === DurationType.COMBAT || durationType === DurationType.PERMANENT;

    if (instance.stacks <= 0 && !(canGoNegative && instance.stacks < 0)) {
      this.removeEffect(targetId, effectId);
      return 0;
    }

    this.notifyChange({ targetId, effectId, stacks: instance.stacks, source: 'modified' });
    return instance.stacks;
  }

  // ---------------------------------------------------------------
  // Turn Processing
  // ---------------------------------------------------------------

  /**
   * Process turn-end effects for a target entity.
   *
   * Per GDD Section 4 (Turn-End Processing Order):
   * 1. Poison damage — handled externally by the combat system (via modifyEffect).
   * 2. Turn-based effects decrement — handled here: TURNS duration effects get -1.
   * 3. Remove expired effects — handled here: effects at 0 stacks are removed.
   * 4. onTurnEnd triggers — not implemented yet (future TriggerManager integration).
   *
   * Important: STACKS-duration effects are NOT decremented here.
   * External callers (e.g., poison damage handler) use modifyEffect for those.
   *
   * @param targetId - The entity whose turn is ending.
   * @param isPlayerTurn - Whether this is the player's turn. Accepted for future
   *                       trigger timing but unused in current logic.
   */
  processTurnEnd(targetId: string, _isPlayerTurn: boolean): void {
    const effects = this.entityEffects.get(targetId);
    if (!effects) {
      return;
    }

    // Decrement TURNS-duration effects by 1.
    // Collect expired effect IDs to remove after iteration.
    const expiredIds: string[] = [];

    for (const instance of effects) {
      const data = this.effectDefinitions.get(instance.effectId);
      if (!data) {
        continue;
      }

      if (data.durationType === DurationType.TURNS) {
        instance.stacks -= 1;
        LOG.debug(
          `Turn-end: ${instance.effectId} on ${targetId} decremented to ${instance.stacks}`
        );

        if (instance.stacks <= 0) {
          expiredIds.push(instance.effectId);
        }
      }
    }

    // Remove expired effects.
    for (const effectId of expiredIds) {
      this.removeEffect(targetId, effectId);
      LOG.debug(`Turn-end: Removed expired ${effectId} from ${targetId}`);
    }
  }

  // ---------------------------------------------------------------
  // Combat Lifecycle
  // ---------------------------------------------------------------

  /**
   * Clear all effects on a specific entity.
   *
   * Per GDD Edge Case #7: If an entity dies mid-turn, remaining effects are cleared.
   * No post-death triggers fire.
   */
  clearAllEffects(targetId: string): void {
    const effects = this.entityEffects.get(targetId);
    if (effects) {
      effects.length = 0;
    }
    this.entityEffects.delete(targetId);
  }

  /**
   * Reset the entire manager for a new combat encounter.
   *
   * Per GDD Edge Case #8: When combat ends, ALL effects on ALL entities are removed.
   * No effects persist between combats (Strength/Dexterity are combat-only).
   */
  resetForCombat(): void {
    this.entityEffects.clear();
    LOG.info('All status effects cleared for new combat.');
  }

  // ---------------------------------------------------------------
  // Private Helpers
  // ---------------------------------------------------------------

  /**
   * Apply stacking logic when an effect already exists on the target.
   */
  private applyStacking(
    existing: StatusEffectInstance,
    newStacks: number,
    mode: StackingMode
  ): void {
    switch (mode) {
      case StackingMode.ADD_DURATION:
      case StackingMode.ADD_STACKS:
        existing.stacks += newStacks;
        break;

      case StackingMode.OVERWRITE_MAX:
        existing.stacks = Math.max(existing.stacks, newStacks);
        break;

      case StackingMode.DOES_NOT_STACK:
        // Ignore new application entirely
        break;

      default:
        LOG.warn(`Unknown stacking mode: ${mode}. Treating as does_not_stack.`);
        break;
    }
  }

  /**
   * Get or create the effects array for an entity.
   */
  private getOrCreateEffects(targetId: string): StatusEffectInstance[] {
    let effects = this.entityEffects.get(targetId);
    if (!effects) {
      effects = [];
      this.entityEffects.set(targetId, effects);
    }
    return effects;
  }

  /**
   * Get effect data, throwing if the ID is unknown.
   */
  private getRequiredEffectData(effectId: string): StatusEffectData {
    const data = this.effectDefinitions.get(effectId);
    if (!data) {
      throw new Error(`Unknown status effect ID: "${effectId}"`);
    }
    return data;
  }

  /**
   * Notify all registered change listeners.
   */
  private notifyChange(event: StatusEffectChangeEvent): void {
    for (const listener of this.changeListeners) {
      listener(event);
    }
  }
}
