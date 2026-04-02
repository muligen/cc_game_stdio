/**
 * combat.ts — Combat state type definitions.
 *
 * Implements: design/gdd/combat.md (Combat States, Turn Flow)
 * Combat state is created when combat starts and destroyed when combat ends.
 * Per ADR-001 Decision 2: combat state is scoped to CombatScene.
 */

/** Turn phase within combat. Per Combat GDD Section 1. */
export enum TurnPhase {
  INITIALIZING = 'initializing',
  PLAYER_TURN = 'player_turn',
  ENEMY_TURN = 'enemy_turn',
  COMBAT_OVER = 'combat_over',
}

/** Sub-states within a player turn. */
export enum PlayerTurnSubState {
  DRAWING = 'drawing',
  WAITING_FOR_INPUT = 'waiting_for_input',
  PLAYING_CARD = 'playing_card',
  TARGETING = 'targeting',
}

/** Sub-states within an enemy turn. */
export enum EnemyTurnSubState {
  ENEMY_START = 'enemy_start',
  ENEMY_ACTING = 'enemy_acting',
  ENEMY_END = 'enemy_end',
}

/** Combat result. Per Combat GDD Section 1. */
export type CombatResult = 'victory' | 'defeat';

/**
 * Enemy instance during combat.
 * Tracks runtime state for a single enemy in combat.
 */
export interface EnemyInstance {
  /** Unique combat-scoped instance ID. */
  instanceId: string;
  /** References EnemyData.id. */
  enemyId: string;
  /** Current HP. */
  currentHP: number;
  /** Maximum HP. */
  maxHP: number;
  /** Current block amount. */
  block: number;
  /** Whether this enemy is alive. */
  isAlive: boolean;
  /** Current intent (selected move). */
  currentMove: string | null;
  /** Currently selected move index (for rotating AI). */
  moveIndex: number;
  /** Consecutive count for current move. */
  consecutiveCount: number;
  /** Active status effects on this enemy. */
  statusEffects: Array<{
    effectId: string;
    stacks: number;
    source: string;
  }>;
  /** Current boss phase (null for non-bosses). */
  currentPhase: number | null;
  /** Whether the enemy is stunned. */
  isStunned: boolean;
}

/**
 * CombatState — mutable combat-scoped state.
 * Created on combat start, destroyed on combat end.
 * Per ADR-001 Decision 2 and Combat GDD.
 */
export interface CombatState {
  /** Current turn phase. */
  phase: TurnPhase;
  /** Current turn number (starts at 1). */
  turnNumber: number;
  /** Player's current block. */
  playerBlock: number;
  /** Active enemy instances. */
  enemies: EnemyInstance[];
  /** Card IDs in the draw pile. */
  drawPile: string[];
  /** Card instance IDs in hand. */
  hand: string[];
  /** Card instance IDs in discard pile. */
  discardPile: string[];
  /** Card instance IDs in exhaust pile. */
  exhaustPile: string[];
  /** Current energy available this turn. */
  currentEnergy: number;
  /** Effective max energy for this turn. */
  effectiveMaxEnergy: number;
  /** Cards played this turn count. */
  cardsPlayedThisTurn: number;
  /** Combat result (set when combat ends). */
  result: CombatResult | null;
}
