/**
 * status-effect.ts — Status effect data type definitions.
 *
 * Implements: design/gdd/status-effect.md (Effect Categories, Duration Types, Stacking Modes)
 * All status effect data is loaded from status-effects.json at runtime.
 */

/** Whether the effect is positive, negative, or neutral. */
export type StatusEffectCategory = 'buff' | 'debuff' | 'neutral';

/** How long the effect lasts. Per Status Effect GDD Section 2. */
export enum DurationType {
  /** Persists until combat ends (e.g., Strength, Dexterity). */
  COMBAT = 'combat',
  /** Decrements by 1 at end of target's turn; removed at 0. */
  TURNS = 'turns',
  /** Decrements by 1 when triggered; removed at 0. */
  STACKS = 'stacks',
  /** Never expires naturally. */
  PERMANENT = 'permanent',
}

/** How multiple applications of the same effect combine. Per Status Effect GDD Section 3. */
export enum StackingMode {
  /** New duration added to existing (e.g., Vulnerable 2 + 1 = 3 turns). */
  ADD_DURATION = 'add_duration',
  /** New stacks added to existing (e.g., Poison 3 + 2 = 5 stacks). */
  ADD_STACKS = 'add_stacks',
  /** Take maximum of old and new (e.g., Intangible max(2, 1) = 2). */
  OVERWRITE_MAX = 'overwrite_max',
  /** If already active, ignore new application. */
  DOES_NOT_STACK = 'does_not_stack',
}

/** When a trigger fires. Per Status Effect GDD Section 5. */
export type TriggerTiming =
  | 'on_apply'
  | 'on_turn_start'
  | 'on_turn_end'
  | 'on_card_played'
  | 'on_attack'
  | 'on_damage_taken'
  | 'on_debuff_applied';

/**
 * A trigger callback definition for status effects.
 * Per Status Effect GDD Section 5 (Trigger Timings).
 */
export interface StatusEffectTrigger {
  /** When this trigger fires. */
  timing: TriggerTiming;
  /** Effect to execute when triggered. */
  effect: TriggerEffect;
}

/** Effect executed by a trigger. */
export interface TriggerEffect {
  /** Effect type string — maps to EffectResolver handler. */
  type: string;
  /** Primary magnitude. */
  value: number;
  /** Status effect ID for nested status effects. */
  status?: string;
}

/**
 * StatusEffectData — the full data definition of a status effect.
 * Loaded from status-effects.json. Per Status Effect GDD Section 1.
 */
export interface StatusEffectData {
  /** Unique identifier, e.g. "vulnerable", "strength", "poison". */
  id: string;
  /** Display name. */
  name: string;
  /** Description for tooltips. */
  description: string;
  /** Buff, debuff, or neutral. */
  category: StatusEffectCategory;
  /** How long the effect lasts. */
  durationType: DurationType;
  /** How applications stack. */
  stackingMode: StackingMode;
  /** Optional trigger callbacks. */
  triggers?: StatusEffectTrigger[];
  /** Default value used when not specified by the caller. */
  defaultValue?: number;
  /** Default duration for turn-based effects. */
  defaultDuration?: number;
  /** Icon identifier for UI display. */
  icon?: string;
}

/**
 * StatusEffectInstance — a runtime instance of a status effect on an entity.
 * Tracks current stacks/duration at runtime.
 */
export interface StatusEffectInstance {
  /** References StatusEffectData.id. */
  effectId: string;
  /** Current stacks or duration value. */
  stacks: number;
  /** Source that applied this effect (for debugging). */
  source: string;
}
