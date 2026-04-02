/**
 * enemy.ts — Enemy data type definitions.
 *
 * Implements: design/gdd/enemy-ai.md (Enemy Data Schema, Intent Types, Move Selection)
 * All enemy data is loaded from enemies.json at runtime.
 */

/** Enemy classification type. */
export type EnemyType = 'normal' | 'elite' | 'boss';

/** Intent type icons shown to the player. Per Enemy AI GDD Section 2. */
export enum IntentType {
  ATTACK = 'attack',
  ATTACK_DEFEND = 'attack_defend',
  DEFEND = 'defend',
  BUFF = 'buff',
  DEBUFF = 'debuff',
  STRONG_DEBUFF = 'strong_debuff',
  MAGIC = 'magic',
  SLEEP = 'sleep',
  STUN = 'stun',
  UNKNOWN = 'unknown',
}

/** Target type for enemy moves. */
export type EnemyTarget = 'self' | 'player' | 'all_players';

/**
 * A single move that an enemy can perform.
 * Per Enemy AI GDD Section 1 (EnemyMove interface).
 */
export interface EnemyMove {
  /** Move identifier. */
  id: string;
  /** Display name. */
  name: string;
  /** Intent icon to show the player. */
  intent: IntentType;
  /** Ordered effects to execute. */
  effects: MoveEffect[];
  /** Base damage (null if not an attack). */
  damage?: number;
  /** Block to gain (null if none). */
  block?: number;
  /** Who the move targets. */
  target?: EnemyTarget;
  /** Number of hits (default 1). */
  hits?: number;
}

/** Effect within an enemy move. Uses the same DSL as card effects per ADR-003. */
export interface MoveEffect {
  /** Effect type string — maps to EffectResolver handler. */
  type: string;
  /** Primary magnitude. */
  value: number;
  /** Status effect ID for status-related effects. */
  status?: string;
  /** Duration for timed effects. */
  duration?: number;
}

/**
 * Entry in an enemy's move list with selection weights.
 * Per Enemy AI GDD Section 3 (Move Selection — Weighted Pool).
 */
export interface MoveEntry {
  /** Reference to EnemyMove.id. */
  moveId: string;
  /** Weight for weighted pool selection. */
  weight: number;
  /** Max consecutive times this move can repeat. */
  maxConsecutive?: number;
  /** Conditional move selection rules. */
  conditions?: MoveCondition[];
}

/** Condition for conditional move selection. Per Enemy AI GDD Section 3 Mode 3. */
export interface MoveCondition {
  /** What triggers this condition. */
  trigger: string;
  /** Threshold value for the condition. */
  threshold?: number;
  /** Comparison operator. */
  operator?: string;
  /** Effect ID to check. */
  effectId?: string;
  /** The move to use if this condition matches. */
  moveId: string;
}

/**
 * Boss phase transition definition.
 * Per Enemy AI GDD Section 3 (Boss Phase System).
 */
export interface BossPhase {
  /** Phase identifier. */
  phaseId: string;
  /** Trigger when HP <= this percentage. */
  hpThreshold: number;
  /** New move pool for this phase. */
  moves: MoveEntry[];
  /** Effects and message on phase transition. */
  onPhaseTransition?: {
    effects: MoveEffect[];
    message?: string;
  };
}

/**
 * EnemyData — the full data definition of an enemy.
 * Loaded from enemies.json. Per Enemy AI GDD Section 1.
 */
export interface EnemyData {
  /** Unique identifier, e.g. "enemy_jaw_worm". */
  id: string;
  /** Display name. */
  name: string;
  /** Enemy type: normal, elite, or boss. */
  type: EnemyType;
  /** Base HP. */
  hp: number;
  /** Which act this enemy appears in. */
  act?: number;
  /** Move selection definitions. */
  moves: MoveEntry[];
  /** Boss-only: phase transitions. */
  phases?: BossPhase[];
  /** Selection mode: "rotating", "weighted", or "conditional". */
  selectionMode?: string;
  /** HP range minimum for rolled HP (optional, uses hp if not set). */
  hpMin?: number;
  /** HP range maximum for rolled HP (optional, uses hp if not set). */
  hpMax?: number;
  /** First move override (e.g., Cultist always opens with Incantation). */
  firstMove?: string;
  /** Status effect immunities (boss immunity per GDD). */
  immunities?: string[];
  /** AI pattern type for EnemyHelper.selectMove. */
  aiPattern?: 'random' | 'sequential' | 'patterned' | 'boss';
  /** Optional fixed move pattern for patterned AI. */
  movePattern?: string[];
}

/**
 * CombatEnemyInstance — runtime enemy instance with full EnemyData reference.
 *
 * Extends the combat tracking concept for use with EnemyHelper utility methods.
 * Holds an immutable reference to the full EnemyData definition alongside
 * mutable combat state (HP, block, move history).
 */
export interface CombatEnemyInstance {
  /** Unique instance ID for this combat. */
  instanceId: string;
  /** Full enemy definition (immutable reference from GameRegistry). */
  data: EnemyData;
  /** Current HP. */
  currentHP: number;
  /** Maximum HP (rolled from hpMin..hpMax at spawn, or data.hp). */
  maxHP: number;
  /** Current block amount. */
  block: number;
  /** Whether this enemy is alive. */
  isAlive: boolean;
  /** Currently selected move (intent) for next turn. */
  currentMove: EnemyMove | null;
  /** Move history for AI pattern tracking (move IDs). */
  moveHistory: string[];
  /** Whether the boss firstMove opener has been consumed. Per GDD boss AI pattern. */
  firstMoveUsed: boolean;
}
