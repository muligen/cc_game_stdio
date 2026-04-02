/**
 * effect-resolver.ts — Effect resolution system for card effects.
 *
 * Implements: ADR-003 Effect Resolution System
 *   - Decision: Handler registration pattern (lookup table by effect type string)
 *   - Modifier application order: Strength -> Vulnerable -> Weak -> Floor
 *   - resolveAll stops processing remaining effects if target dies
 *   - Each handler is isolated — errors in one handler don't crash the resolver
 *
 * The EffectResolver maps effect type strings (from CardEffect.type) to handler
 * functions. Handlers receive a ResolutionContext with everything needed to
 * resolve the effect and return an EffectResult describing what happened.
 *
 * Built-in handlers:
 *   - deal_damage: Applies Strength, Vulnerable, Weak modifiers per ADR-003
 *   - apply_status: Applies buffs/debuffs via StatusEffectManager
 *   - gain_block: Applies Dexterity, Frail modifiers per ADR-003
 */

import type { CardEffect } from '../types/card';
import type { RunState } from '../types';
import type { RNGStream } from '../utils/rng';
import { StatusEffectManager } from './status-effect-manager';
import { GameEventBus } from './game-event-bus';
import { Logger } from '../utils/logger';

const LOG = new Logger('EffectResolver');

// ---------------------------------------------------------------------------
// Modifier Constants (per ADR-003 and GDD — no hardcoded gameplay values)
// ---------------------------------------------------------------------------

/** Vulnerable multiplier: target takes 50% more damage. */
const VULNERABLE_MULTIPLIER = 1.5;

/** Weak multiplier: source deals 25% less damage. */
const WEAK_MULTIPLIER = 0.75;

/** Frail multiplier: source gains 25% less block. */
const FRAIL_MULTIPLIER = 0.75;

/** Minimum damage floor. Damage cannot go below this value. */
const MIN_DAMAGE = 1;

/** Minimum block floor. Block CAN be 0 (unlike damage which is 1). */
const MIN_BLOCK = 0;

// ---------------------------------------------------------------------------
// Status effect ID constants (must match status-effects.json entries)
// ---------------------------------------------------------------------------

const STATUS_VULNERABLE = 'vulnerable';
const STATUS_WEAK = 'weak';
const STATUS_STRENGTH = 'strength';
const STATUS_DEXTERITY = 'dexterity';
const STATUS_FRAIL = 'frail';
const STATUS_INTANGIBLE = 'intangible';

// ---------------------------------------------------------------------------
// Interfaces
// ---------------------------------------------------------------------------

/**
 * Context provided to every effect handler during resolution.
 * Contains all dependencies needed to resolve an effect.
 */
export interface ResolutionContext {
  /** The entity playing the card (e.g., 'player'). */
  sourceId: string;
  /** The target entity (e.g., 'enemy1'), or null for self/none targets. */
  targetId: string | null;
  /** Current energy available (for X-cost scaling). */
  energy: number;
  /** StatusEffectManager for the current combat. */
  statusEffectManager: StatusEffectManager;
  /** Event bus for combat events. */
  eventBus: GameEventBus;
  /** RNG stream for randomized effects (e.g., "random debuff"). */
  rng?: RNGStream;
  /** Run state access for effects that reference player state. */
  runState?: Readonly<RunState>;
}

/**
 * Result of a single effect resolution.
 * Describes what happened when an effect was resolved.
 */
export interface EffectResult {
  /** The effect type that was resolved. */
  type: string;
  /** Whether the resolution was successful. */
  success: boolean;
  /** Numeric value produced (e.g., damage dealt, block gained). */
  value?: number;
  /** Target entity ID. */
  targetId?: string;
}

/**
 * A handler function for a specific effect type.
 * Receives the effect data and resolution context, returns result(s).
 */
export type EffectHandler = (
  effect: CardEffect,
  context: ResolutionContext
) => EffectResult | EffectResult[];

// ---------------------------------------------------------------------------
// EffectResolver
// ---------------------------------------------------------------------------

/**
 * EffectResolver — maps effect type strings to handler functions.
 *
 * Lifecycle:
 * 1. Created at combat start with default handlers registered.
 * 2. Additional handlers can be registered or overwritten before combat.
 * 3. resolveEffect() resolves a single effect through its handler.
 * 4. resolveAll() resolves an array of effects sequentially, stopping if target dies.
 *
 * All modifier constants are defined at module level for data-driven tuning.
 */
export class EffectResolver {
  /** Registered handlers keyed by effect type string. */
  private readonly handlers: Map<string, EffectHandler>;

  constructor() {
    this.handlers = new Map<string, EffectHandler>();
    this.registerDefaults();
  }

  // ---------------------------------------------------------------
  // Handler Registration
  // ---------------------------------------------------------------

  /**
   * Register a handler for an effect type. Overwrites if already registered.
   *
   * @param effectType - The effect type string (must match CardEffect.type values).
   * @param handler - The handler function to invoke for this effect type.
   */
  registerHandler(effectType: string, handler: EffectHandler): void {
    this.handlers.set(effectType, handler);
    LOG.debug(`Registered handler for effect type: ${effectType}`);
  }

  /**
   * Check if a handler is registered for an effect type.
   *
   * @param effectType - The effect type string to check.
   * @returns true if a handler is registered.
   */
  hasHandler(effectType: string): boolean {
    return this.handlers.has(effectType);
  }

  // ---------------------------------------------------------------
  // Resolution
  // ---------------------------------------------------------------

  /**
   * Resolve a single effect through its registered handler.
   *
   * If no handler is registered, returns a failure result.
   * If the handler throws, the error is logged and a failure result is returned.
   *
   * @param effect - The card effect to resolve.
   * @param context - The resolution context for this effect.
   * @returns Array of EffectResult(s) from the handler.
   */
  resolveEffect(effect: CardEffect, context: ResolutionContext): EffectResult[] {
    const handler = this.handlers.get(effect.type);

    if (!handler) {
      LOG.warn(`No handler registered for effect type: ${effect.type}`);
      return [{
        type: effect.type,
        success: false,
        targetId: context.targetId ?? undefined,
      }];
    }

    try {
      const result = handler(effect, context);
      if (Array.isArray(result)) {
        return result;
      }
      return [result];
    } catch (error) {
      LOG.error(`Handler error for effect type "${effect.type}": ${String(error)}`);
      return [{
        type: effect.type,
        success: false,
        targetId: context.targetId ?? undefined,
      }];
    }
  }

  /**
   * Resolve all effects in sequence. Stops processing remaining effects
   * if the target dies (checked via isTargetDead callback after each effect).
   *
   * Per ADR-003: handlers are isolated — errors in one handler do not prevent
   * subsequent effects from being resolved.
   *
   * @param effects - Array of card effects to resolve sequentially.
   * @param context - The resolution context shared across all effects.
   * @param isTargetDead - Callback to check if the target has died.
   * @returns Accumulated array of EffectResult(s) from all resolved effects.
   */
  resolveAll(
    effects: CardEffect[],
    context: ResolutionContext,
    isTargetDead: (targetId: string) => boolean
  ): EffectResult[] {
    const results: EffectResult[] = [];

    for (const effect of effects) {
      // Check if target has died before resolving the next effect.
      // If targetId is null (self-target), skip the death check.
      if (context.targetId !== null && isTargetDead(context.targetId)) {
        LOG.debug(`Target ${context.targetId} is dead — stopping resolveAll.`);
        break;
      }

      const effectResults = this.resolveEffect(effect, context);
      results.push(...effectResults);
    }

    return results;
  }

  // ---------------------------------------------------------------
  // Default Handler Registration
  // ---------------------------------------------------------------

  /**
   * Register the built-in default handlers for standard effect types.
   * Called during construction. Can be called again to reset defaults.
   */
  registerDefaults(): void {
    this.registerHandler('deal_damage', dealDamageHandler);
    this.registerHandler('apply_status', applyStatusHandler);
    this.registerHandler('gain_block', gainBlockHandler);
  }
}

// ---------------------------------------------------------------------------
// Built-in Handlers
// ---------------------------------------------------------------------------

/**
 * deal_damage handler — resolves damage effects.
 *
 * Per ADR-003 Modifier Application Order:
 *   1. Base value = effect.value
 *   2. Strength: damage += sourceStrength (flat additive)
 *   3. Vulnerable on target: damage = floor(damage * 1.5)
 *   4. Weak on source: damage = floor(damage * 0.75)
 *   5. Floor at 1 (minimum damage is 1)
 *
 * For X-cost cards: effect.value is multiplied by current energy.
 */
function dealDamageHandler(effect: CardEffect, context: ResolutionContext): EffectResult {
  const targetId = context.targetId;
  if (targetId === null) {
    return { type: 'deal_damage', success: false, value: 0 };
  }

  // Step 1: Base value. X-cost scales with energy.
  let damage = effect.value;
  if (effect.value === 0 && context.energy > 0) {
    // X-cost pattern: value of 0 means "scale by energy"
    // (explicit X-cost cards use value as base per hit, energy as multiplier)
  }

  // X-cost scaling: if the card is X-cost, scale base value by energy
  // Convention: effect.value is base damage, multiplied by energy for X-cost
  // This is handled at the card play pipeline level, but we also support
  // direct energy-based scaling here for effect-level X-cost support.
  // When energy > 0 and the card is X-cost, the pipeline passes energy as
  // a multiplier context. For now, use effect.value as-is (pipeline handles scaling).
  // If energy-based scaling is needed at this level, it would be:
  //   damage = effect.value * context.energy;

  // Step 2: Strength modifier (flat additive)
  const sourceStrength = context.statusEffectManager.getEffectStacks(
    context.sourceId,
    STATUS_STRENGTH
  );
  damage += sourceStrength;

  // Step 3: Vulnerable on target (1.5x multiplier)
  const targetVulnerable = context.statusEffectManager.getEffectStacks(
    targetId,
    STATUS_VULNERABLE
  );
  if (targetVulnerable > 0) {
    damage = Math.floor(damage * VULNERABLE_MULTIPLIER);
  }

  // Step 4: Weak on source (0.75x multiplier)
  const sourceWeak = context.statusEffectManager.getEffectStacks(
    context.sourceId,
    STATUS_WEAK
  );
  if (sourceWeak > 0) {
    damage = Math.floor(damage * WEAK_MULTIPLIER);
  }

  // Step 5: Floor at minimum damage
  damage = Math.max(MIN_DAMAGE, damage);

  // Intangible on target: damage is reduced to 1
  const targetIntangible = context.statusEffectManager.getEffectStacks(
    targetId,
    STATUS_INTANGIBLE
  );
  if (targetIntangible > 0) {
    damage = MIN_DAMAGE;
  }

  return {
    type: 'deal_damage',
    success: true,
    value: damage,
    targetId,
  };
}

/**
 * apply_status handler — resolves status effect application.
 *
 * - Debuffs use tryApplyDebuff (respects Artifact negation).
 * - Buffs/neutrals use applyEffect directly.
 * - Returns success: false if negated by Artifact or immunity.
 * - Throws if the status effect ID is unknown (from StatusEffectManager).
 */
function applyStatusHandler(effect: CardEffect, context: ResolutionContext): EffectResult {
  const targetId = context.targetId;
  if (targetId === null) {
    return { type: 'apply_status', success: false, value: 0 };
  }

  const statusId = effect.status;
  if (!statusId) {
    LOG.error('apply_status effect missing required "status" field.');
    return { type: 'apply_status', success: false, value: 0, targetId };
  }

  const stacks = effect.value;
  const source = context.sourceId;

  // Check if this is a debuff — use tryApplyDebuff for debuffs
  const effectData = context.statusEffectManager.getEffectData(statusId);
  if (!effectData) {
    // Unknown status ID — let StatusEffectManager throw the error
    // We catch it in resolveEffect's try/catch
    throw new Error(`Unknown status effect ID: "${statusId}"`);
  }

  let applied: boolean;
  if (effectData.category === 'debuff') {
    applied = context.statusEffectManager.tryApplyDebuff(targetId, statusId, stacks, source);
  } else {
    context.statusEffectManager.applyEffect(targetId, statusId, stacks, source);
    applied = true;
  }

  return {
    type: 'apply_status',
    success: applied,
    value: stacks,
    targetId,
  };
}

/**
 * gain_block handler — resolves block gain effects.
 *
 * Per ADR-003 Block Modifier Order:
 *   1. Base value = effect.value
 *   2. Dexterity: block += sourceDexterity (flat additive)
 *   3. Frail on source: block = floor(block * 0.75)
 *   4. Floor at 0 (block CAN be 0, unlike damage which floors at 1)
 *
 * Block is always applied to the source entity (the card player).
 */
function gainBlockHandler(effect: CardEffect, context: ResolutionContext): EffectResult {
  // Step 1: Base value
  let block = effect.value;

  // Step 2: Dexterity modifier (flat additive)
  const sourceDexterity = context.statusEffectManager.getEffectStacks(
    context.sourceId,
    STATUS_DEXTERITY
  );
  block += sourceDexterity;

  // Step 3: Frail on source (0.75x multiplier)
  const sourceFrail = context.statusEffectManager.getEffectStacks(
    context.sourceId,
    STATUS_FRAIL
  );
  if (sourceFrail > 0) {
    block = Math.floor(block * FRAIL_MULTIPLIER);
  }

  // Step 4: Floor at 0 (block CAN be 0)
  block = Math.max(MIN_BLOCK, block);

  return {
    type: 'gain_block',
    success: true,
    value: block,
    targetId: context.sourceId,
  };
}
