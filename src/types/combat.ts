/**
 * combat.ts — Combat state type definitions.
 *
 * Implements: design/gdd/combat.md (Combat States, Turn Flow)
 * Combat state is created when combat starts and destroyed when combat ends.
 * Per ADR-001 Decision 2: combat state is scoped to CombatScene.
 */

import type { CombatEnemyInstance } from './enemy';

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
 * Backward-compatible alias for CombatEnemyInstance.
 * Consolidated from the old EnemyInstance type that duplicated fields.
 * Use CombatEnemyInstance in new code.
 */
export type EnemyInstance = CombatEnemyInstance;

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
  enemies: CombatEnemyInstance[];
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
