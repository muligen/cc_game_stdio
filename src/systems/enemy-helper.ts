/**
 * enemy-helper.ts — Static utility class for enemy operations.
 *
 * Implements: design/gdd/enemy.md (Enemy System, Combat Resolution, AI Move Selection)
 * Architecture: Static utility — no DI needed. All methods are static.
 *
 * Provides:
 * - createInstance: Create a CombatEnemyInstance from EnemyData with rolled HP.
 * - isImmune: Check if enemy is immune to a specific status effect.
 * - getMoveById: Look up a move by ID from the enemy's move list.
 * - getMoveDamage / getMoveBlock: Retrieve move values.
 * - isAlive: Check if enemy is alive.
 * - takeDamage: Deal damage to enemy (block absorbs first).
 * - gainBlock / resetBlock: Block management.
 * - getFirstMove / selectMove: AI move selection.
 *
 * Key design decisions:
 * - HP rolling uses hpMin/hpMax if present, otherwise falls back to data.hp.
 * - Block absorbs damage before HP (per Combat GDD resolution order).
 * - Enemy HP is clamped to 0 (no negative HP values).
 * - Enemy dies (isAlive = false) when currentHP reaches 0.
 * - Move selection respects AI pattern: random, sequential, patterned, boss.
 * - Boss immunity: check data.immunities array per GDD Edge Case #10.
 * - Boss firstMove tracking uses firstMoveUsed field on CombatEnemyInstance.
 */

import {
  type EnemyData,
  type EnemyMove,
  type CombatEnemyInstance,
} from '../types/enemy';
import type { RNGStream } from '../utils/rng';
import { Logger } from '../utils/logger';

const LOG = new Logger('EnemyHelper');

/**
 * Result of dealing damage to an enemy.
 * Returned by takeDamage for combat system event emission.
 */
export interface DamageResult {
  /** HP lost after block absorption. */
  hpLost: number;
  /** Damage absorbed by block. */
  blocked: number;
}

/**
 * EnemyHelper — static utility class for enemy operations.
 *
 * Methods mutate the passed-in CombatEnemyInstance where documented
 * (takeDamage, gainBlock, resetBlock, selectMove). No singletons or
 * global state. Usage: EnemyHelper.takeDamage(instance, 10)
 */
export class EnemyHelper {
  // Private constructor prevents instantiation — pure static class.
  private constructor() {
    // Not instantiable.
  }

  // ---------------------------------------------------------------
  // Instance Creation
  // ---------------------------------------------------------------

  /**
   * Create a CombatEnemyInstance from EnemyData with rolled HP.
   *
   * Per GDD: HP is rolled from hpMin..hpMax using the provided RNG stream.
   * Falls back to data.hp if hpMin/hpMax are not defined.
   *
   * @param data - The enemy definition from GameRegistry.
   * @param instanceId - Unique combat-scoped instance ID.
   * @param hpRNG - RNG stream for HP rolling (typically combatRNG).
   * @returns A fresh CombatEnemyInstance ready for combat.
   */
  static createInstance(
    data: EnemyData,
    instanceId: string,
    hpRNG: RNGStream
  ): CombatEnemyInstance {
    let maxHP: number;
    if (data.hpMin !== undefined && data.hpMax !== undefined) {
      maxHP = hpRNG.nextInt(data.hpMin, data.hpMax);
    } else {
      maxHP = data.hp;
    }

    const instance: CombatEnemyInstance = {
      instanceId,
      data,
      currentHP: maxHP,
      maxHP,
      block: 0,
      isAlive: true,
      currentMove: null,
      moveHistory: [],
      firstMoveUsed: false,
    };

    LOG.debug(
      `Created enemy instance ${instanceId} (${data.name}) with HP ${maxHP}/${maxHP}`
    );
    return instance;
  }

  // ---------------------------------------------------------------
  // Immunity
  // ---------------------------------------------------------------

  /**
   * Check if an enemy is immune to a specific status effect.
   *
   * Per GDD Edge Case #10: Bosses may have specific immunities.
   * Works with either a CombatEnemyInstance or raw EnemyData.
   *
   * @param enemy - The enemy instance or data to check.
   * @param effectId - The status effect ID to check immunity for.
   * @returns true if the enemy is immune to the effect.
   */
  static isImmune(
    enemy: CombatEnemyInstance | EnemyData,
    effectId: string
  ): boolean {
    const data = 'data' in enemy ? enemy.data : enemy;
    if (!data.immunities) {
      return false;
    }
    return data.immunities.includes(effectId);
  }

  // ---------------------------------------------------------------
  // Move Queries
  // ---------------------------------------------------------------

  /**
   * Get a move by ID from the enemy's move list.
   *
   * @param data - The enemy definition.
   * @param moveId - The move ID to look up.
   * @returns The EnemyMove if found, undefined otherwise.
   */
  static getMoveById(_data: EnemyData, _moveId: string): EnemyMove | undefined {
    // EnemyData.moves is MoveEntry[] — moveId references are looked up
    // from a global move registry. For now, we return undefined since
    // MoveEntry has moveId, not a full EnemyMove.
    // This method is for use with future move resolution or when
    // moves are inline EnemyMove objects.
    return undefined;
  }

  /**
   * Calculate actual damage for a move.
   *
   * Per GDD: base damage from the move definition. Str/Weak/Vulnerable
   * modifiers are applied by the combat system, not here.
   *
   * @param move - The enemy move.
   * @returns The base damage value, or 0 if the move has no damage.
   */
  static getMoveDamage(move: EnemyMove): number {
    return move.damage ?? 0;
  }

  /**
   * Calculate actual block for a move.
   *
   * @param move - The enemy move.
   * @returns The block value, or 0 if the move has no block.
   */
  static getMoveBlock(move: EnemyMove): number {
    return move.block ?? 0;
  }

  // ---------------------------------------------------------------
  // Alive Check
  // ---------------------------------------------------------------

  /**
   * Check if an enemy is alive.
   *
   * @param enemy - The enemy instance.
   * @returns true if the enemy's isAlive flag is true.
   */
  static isAlive(enemy: CombatEnemyInstance): boolean {
    return enemy.isAlive;
  }

  // ---------------------------------------------------------------
  // Damage / Block
  // ---------------------------------------------------------------

  /**
   * Deal damage to an enemy (reduces HP, checks death).
   *
   * Per Combat GDD resolution order:
   * 1. Block absorbs damage first: blocked = min(block, damage)
   * 2. Remaining damage reduces HP: hpLost = damage - blocked
   * 3. HP clamped to 0 (no negative values)
   * 4. If HP reaches 0, isAlive = false
   *
   * @param enemy - The enemy instance to damage (mutated in place).
   * @param amount - The raw damage amount.
   * @returns DamageResult with hpLost and blocked amounts.
   */
  static takeDamage(enemy: CombatEnemyInstance, amount: number): DamageResult {
    if (amount <= 0) {
      return { hpLost: 0, blocked: 0 };
    }

    const blocked = Math.min(enemy.block, amount);
    const remaining = amount - blocked;
    enemy.block -= blocked;

    const hpLost = Math.min(enemy.currentHP, remaining);
    enemy.currentHP -= hpLost;

    if (enemy.currentHP <= 0) {
      enemy.currentHP = 0;
      enemy.isAlive = false;
      LOG.debug(`Enemy ${enemy.instanceId} died from ${amount} damage.`);
    }

    return { hpLost, blocked };
  }

  /**
   * Add block to an enemy.
   *
   * @param enemy - The enemy instance (mutated in place).
   * @param amount - The block amount to add.
   * @returns The new total block value.
   */
  static gainBlock(enemy: CombatEnemyInstance, amount: number): number {
    if (amount <= 0) {
      return enemy.block;
    }
    enemy.block += amount;
    return enemy.block;
  }

  /**
   * Reset block to 0 (at start of enemy's turn).
   *
   * Per Combat GDD: block is reset at the start of each entity's turn.
   *
   * @param enemy - The enemy instance (mutated in place).
   */
  static resetBlock(enemy: CombatEnemyInstance): void {
    enemy.block = 0;
  }

  // ---------------------------------------------------------------
  // AI Move Selection
  // ---------------------------------------------------------------

  /**
   * Get the first move for an enemy.
   *
   * Per GDD: uses firstMove override if set on the EnemyData.
   * Looks up the move from the enemy's available moves.
   *
   * @param data - The enemy definition.
   * @returns The first EnemyMove, or undefined if no firstMove override.
   */
  static getFirstMove(data: EnemyData): EnemyMove | undefined {
    if (!data.firstMove) {
      return undefined;
    }
    // firstMove references a moveId; we need to resolve it.
    // Since moves are MoveEntry[], we find the entry and would need
    // a move registry to get the full EnemyMove.
    // For now, return undefined as move resolution requires the registry.
    return undefined;
  }

  /**
   * Select the next move for an enemy using AI pattern.
   *
   * Per GDD move selection:
   * - random: weighted random from all moves.
   * - sequential: cycle through moves in order.
   * - patterned: follow movePattern array, then repeat.
   * - boss: same as patterned with firstMove override for first turn.
   *
   * @param enemy - The enemy instance (moveHistory used for pattern tracking).
   * @param aiRNG - RNG stream for random move selection.
   * @returns The selected move entry's moveId.
   */
  static selectMove(
    enemy: CombatEnemyInstance,
    aiRNG: RNGStream
  ): string {
    const data = enemy.data;
    const pattern = data.aiPattern ?? data.selectionMode ?? 'random';

    // Boss pattern: use firstMove on first turn, then patterned.
    // firstMove does NOT push to moveHistory — it's an opener separate from the pattern cycle.
    // firstMoveUsed field on CombatEnemyInstance tracks consumption.
    if (pattern === 'boss' && data.firstMove && !enemy.firstMoveUsed) {
      enemy.firstMoveUsed = true;
      return data.firstMove;
    }

    switch (pattern) {
      case 'random':
      case 'weighted':
        return EnemyHelper.selectRandomMove(data, aiRNG);

      case 'sequential':
      case 'rotating':
        return EnemyHelper.selectSequentialMove(data, enemy);

      case 'patterned':
      case 'boss':
        return EnemyHelper.selectPatternedMove(data, enemy, aiRNG);

      default:
        LOG.warn(`Unknown AI pattern "${pattern}" for ${data.id}. Falling back to random.`);
        return EnemyHelper.selectRandomMove(data, aiRNG);
    }
  }

  // ---------------------------------------------------------------
  // Private: Move Selection Helpers
  // ---------------------------------------------------------------

  /**
   * Select a random move using weighted selection from moves.
   */
  private static selectRandomMove(
    data: EnemyData,
    aiRNG: RNGStream
  ): string {
    if (data.moves.length === 0) {
      throw new Error(`Enemy ${data.id} has no moves defined.`);
    }

    const weightedItems = data.moves.map((entry) => ({
      item: entry.moveId,
      weight: entry.weight,
    }));

    return aiRNG.weightedPick(weightedItems);
  }

  /**
   * Select a move by cycling through the move list in order.
   */
  private static selectSequentialMove(
    data: EnemyData,
    enemy: CombatEnemyInstance
  ): string {
    if (data.moves.length === 0) {
      throw new Error(`Enemy ${data.id} has no moves defined.`);
    }

    const index = enemy.moveHistory.length % data.moves.length;
    const moveId = data.moves[index].moveId;
    enemy.moveHistory.push(moveId);
    return moveId;
  }

  /**
   * Select a move following the movePattern, then repeat from start.
   * Falls back to sequential if no movePattern is defined.
   */
  private static selectPatternedMove(
    data: EnemyData,
    enemy: CombatEnemyInstance,
    _aiRNG: RNGStream
  ): string {
    const pattern = data.movePattern;

    if (!pattern || pattern.length === 0) {
      // No explicit pattern defined; fall back to sequential
      return EnemyHelper.selectSequentialMove(data, enemy);
    }

    const index = enemy.moveHistory.length % pattern.length;
    const moveId = pattern[index];
    enemy.moveHistory.push(moveId);
    return moveId;
  }
}
