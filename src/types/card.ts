/**
 * card.ts — Card data type definitions.
 *
 * Implements: design/gdd/card.md (Card Data Schema, Card Types, Keywords)
 * All card data is loaded from JSON config files at runtime.
 * No hardcoded card values in code.
 */

/** Card type classification. Per Card System GDD Section 1. */
export enum CardType {
  ATTACK = 'attack',
  SKILL = 'skill',
  POWER = 'power',
  STATUS = 'status',
  CURSE = 'curse',
}

/** Rarity tier for cards. Per Card System GDD Section 2 and Reward System GDD. */
export enum Rarity {
  STARTER = 'starter',
  COMMON = 'common',
  UNCOMMON = 'uncommon',
  RARE = 'rare',
  SPECIAL = 'special',
  BOSS = 'boss',
  SHOP = 'shop',
  EVENT = 'event',
}

/** How the card cost is determined. Per Card System GDD Section 2. */
export enum CostType {
  NORMAL = 'normal',
  X = 'x',
  UNPLAYABLE = 'unplayable',
}

/** Who or what the card targets. Per Card System GDD Section 2. */
export enum TargetType {
  SELF = 'self',
  ENEMY = 'enemy',
  ALL_ENEMY = 'all_enemy',
  NONE = 'none',
}

/** Special keywords that modify card behavior. Per Card System GDD Section 3. */
export enum Keyword {
  EXHAUST = 'exhaust',
  ETHEREAL = 'ethereal',
  INNATE = 'innate',
  RETAIN = 'retain',
  UNPLAYABLE = 'unplayable',
  SCRY = 'scry',
}

/**
 * A single effect within a card's effect list.
 * Per ADR-003 Effect Data Model and Card System GDD Section 2.
 * The `type` field maps to an EffectResolver handler at runtime.
 */
export interface CardEffect {
  /** Effect type string — maps to a handler in the EffectResolver. */
  type: string;
  /** Primary magnitude (damage, block, etc.). */
  value: number;
  /** Magnitude when the card is upgraded. */
  upgradedValue?: number;
  /** Number of hits for multi-hit effects. Default 1. */
  hits?: number;
  /** Status effect ID for apply_status effects. */
  status?: string;
  /** Duration for timed effects. */
  duration?: number;
  /** Duration when the card is upgraded. */
  upgradedDuration?: number;
  /** Override the card's default target. */
  target?: TargetOverride;
  /** Optional precondition. */
  condition?: ConditionData;
}

/** Target override for individual effects within a card. */
export type TargetOverride = 'self' | 'all_enemies' | 'random_enemy' | 'none';

/** Condition for conditional effects. Per ADR-003 Conditional Effects. */
export type ConditionData =
  | { type: 'hand_size'; operator: ComparisonOp; value: number }
  | { type: 'hp_percent'; operator: ComparisonOp; value: number }
  | { type: 'status_stacks'; status: string; operator: ComparisonOp; value: number }
  | { type: 'card_type_in_hand'; cardType: CardType; operator: ComparisonOp; value: number }
  | { type: 'cards_played_this_turn'; operator: ComparisonOp; value: number }
  | { type: 'enemy_count'; operator: ComparisonOp; value: number }
  | { type: 'has_relic'; relicId: string }
  | { type: 'random_chance'; chance: number };

/** Comparison operators for conditions. */
export type ComparisonOp =
  | 'equal'
  | 'not_equal'
  | 'greater_than'
  | 'less_than'
  | 'greater_than_or_equal'
  | 'less_than_or_equal';

/** Upgrade delta — what changes when the card is upgraded. */
export interface CardUpgrade {
  /** Override base cost on upgrade (e.g., cost reduction). */
  cost?: number;
  /** Override base damage on upgrade. */
  damage?: number;
  /** Override base block on upgrade. */
  block?: number;
  /** Override description on upgrade. */
  description?: string;
  /** Override effect values on upgrade. */
  effects?: CardEffect[];
}

/**
 * CardData — the full data definition of a card.
 * Loaded from cards.json. Per Card System GDD Section 2 schema.
 */
export interface CardData {
  /** Unique identifier, e.g. "strike_red". Format: {type}_{name}. */
  id: string;
  /** Display name, e.g. "Strike". */
  name: string;
  /** Card type classification. */
  type: CardType;
  /** Rarity tier. */
  rarity: Rarity;
  /** Energy cost to play. */
  cost: number;
  /** How the cost is determined. */
  costType: CostType;
  /** Character ID or null for universal cards. */
  character: string | null;
  /** Who/what the card targets. */
  targets: TargetType;
  /** Ordered list of effects executed on play. */
  effects: CardEffect[];
  /** Special modifiers (Exhaust, Ethereal, etc.). */
  keywords: Keyword[];
  /** What changes when the card is upgraded. */
  upgrade: CardUpgrade;
  /** Template string for card text display. */
  description: string;
  /** Optional lore text. */
  flavorText?: string;
}

/**
 * CardInstance — a runtime instance of a card in the player's deck.
 * Tracks upgrade state per card. Per Run State GDD Section 2.
 */
export interface CardInstance {
  /** Unique per-run instance ID. */
  instanceId: string;
  /** References CardData.id. */
  cardId: string;
  /** Whether this card has been upgraded. */
  upgraded: boolean;
}

/**
 * CombatCardInstance — runtime card state during combat.
 *
 * Lives only during combat; separate from the persistent CardInstance
 * used in RunState for deck management and save/load.
 * Per design/gdd/card.md (Card Play Flow, Card Keywords).
 */
export interface CombatCardInstance {
  /** Unique instance ID for this combat run. */
  instanceId: string;
  /** Full card definition (immutable reference from GameRegistry). */
  data: CardData;
  /** Whether this card has been upgraded. */
  upgraded: boolean;
  /** Temporary cost override (e.g., from Simulate Helix relic). null = use default. */
  costOverride: number | null;
  /** Times this card was played in the current combat. */
  timesPlayedThisCombat: number;
  /** Whether this card was retained from the previous turn. */
  retained: boolean;
}
