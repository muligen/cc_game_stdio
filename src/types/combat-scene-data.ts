/**
 * combat-scene-data.ts — Data transfer object for CombatScene initialization.
 *
 * Implements: ADR-001 Decision 2 (combat-scoped state)
 * Architecture: ADR-001 Decision 3 (data-driven design)
 *
 * CombatSceneData carries all data needed to initialize a combat encounter.
 * It is constructed by the scene transition logic (e.g., MapScene selecting
 * an encounter) and passed to CombatFactory to create combat subsystems.
 *
 * Key design decisions:
 * - cardData provides the full card definitions for the player's deck
 * - statusEffectData provides all status effect definitions for the combat
 * - enemies is optional (S2-03 doesn't spawn enemies; S2-04 will)
 * - seed drives deterministic RNG for the entire combat
 */

import type { CardData } from './card';
import type { EnemyData } from './enemy';
import type { StatusEffectData } from './status-effect';

/**
 * CombatSceneData — initialization payload for a combat encounter.
 *
 * Constructed by the scene flow controller when entering CombatScene.
 * Consumed by CombatFactory.create() to instantiate all combat subsystems.
 */
export interface CombatSceneData {
  /** Player's current HP at combat start. */
  playerHP: number;
  /** Player's maximum HP. */
  playerMaxHP: number;
  /** Character's base energy per turn. */
  baseEnergy: number;
  /** Card instances in the player's deck (instanceId + cardId). */
  deck: ReadonlyArray<{ instanceId: string; cardId: string; upgraded: boolean }>;
  /** Full card definitions for deck card lookup. */
  cardData: CardData[];
  /** Status effect definitions for the combat. */
  statusEffectData: StatusEffectData[];
  /** Master seed for deterministic RNG. */
  seed: number;
  /** Optional enemy definitions for combat initialization (used by S2-04+). */
  enemies?: EnemyData[];
  /** Optional relic bonus energy (permanent, e.g., from cursed relic). */
  relicBonusEnergy?: number;
}
