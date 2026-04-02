/**
 * relic.ts — Relic data type definitions.
 *
 * Implements: design/gdd/relic.md (Relic Data Schema, Tiers, Triggers, Counter)
 * All relic data is loaded from relics.json at runtime.
 */

/** Relic tier / source classification. Per Relic GDD Section 2. */
export enum RelicTier {
  STARTER = 'starter',
  COMMON = 'common',
  UNCOMMON = 'uncommon',
  RARE = 'rare',
  BOSS = 'boss',
  SHOP = 'shop',
  EVENT = 'event',
}

/**
 * A trigger definition for a relic.
 * Per Relic GDD Section 3 (Relic Triggers).
 * Uses the same effect DSL as cards per ADR-003.
 */
export interface RelicTriggerData {
  /** Event name that fires this trigger (e.g., "on_combat_end"). */
  event: string;
  /** Optional condition that must be met. */
  condition?: RelicTriggerCondition;
  /** Effects to execute when triggered. */
  effects: RelicTriggerEffect[];
  /** Priority for execution ordering (lower = first). Default 0. */
  priority?: number;
}

/** Condition for a relic trigger. */
export interface RelicTriggerCondition {
  /** What to check. */
  type: string;
  /** Value to compare against. */
  value?: number;
  /** Card type to filter by (for card-related triggers). */
  cardType?: string;
  /** Status effect stacks to check. */
  statusStacks?: Record<string, number>;
}

/** Effect within a relic trigger. Uses the same DSL as card effects. */
export interface RelicTriggerEffect {
  /** Effect type string — maps to EffectResolver handler. */
  type: string;
  /** Primary magnitude. */
  value: number;
  /** Status effect ID for status-related effects. */
  status?: string;
}

/**
 * Counter mechanism for relics that track a value.
 * Per Relic GDD Section 4 (Relic Counter System).
 */
export interface RelicCounter {
  /** Starting counter value. */
  initial: number;
  /** Target value that triggers the effect. */
  target: number;
}

/**
 * RelicData — the full data definition of a relic.
 * Loaded from relics.json. Per Relic GDD Section 1.
 */
export interface RelicData {
  /** Unique identifier, e.g. "burning_blood". */
  id: string;
  /** Display name. */
  name: string;
  /** Effect description for tooltips. */
  description: string;
  /** Optional lore flavor text. */
  flavorText?: string;
  /** Relic tier / source. */
  tier: RelicTier;
  /** When this relic fires. */
  triggers: RelicTriggerData[];
  /** Optional counter mechanism. */
  counter?: RelicCounter;
  /** Whether player can get multiple copies. Usually false. */
  stackable: boolean;
}

/**
 * RelicInstance — a runtime instance of a relic in the player's collection.
 * Tracks counter state and enabled status.
 */
export interface RelicInstance {
  /** References RelicData.id. */
  relicId: string;
  /** Current counter value. */
  counter: number;
  /** Whether the relic is currently active. */
  enabled: boolean;
}
