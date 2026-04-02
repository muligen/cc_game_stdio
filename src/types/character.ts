/**
 * character.ts — Character data type definitions.
 *
 * Implements: design/gdd/character.md (Character Data Schema, MVP Characters)
 * All character data is loaded from characters.json at runtime.
 */

/**
 * Unlock condition for characters. Post-MVP feature.
 * Structured as a tagged union for extensibility.
 */
export type UnlockCondition =
  | { type: 'none' }
  | { type: 'defeat_boss'; bossId: string }
  | { type: 'reach_act'; act: number }
  | { type: 'win_with_character'; characterId: string };

/**
 * CharacterData — the full data definition of a playable character.
 * Loaded from characters.json. Per Character GDD Section 1.
 */
export interface CharacterData {
  /** Unique identifier, e.g. "ironclad". */
  id: string;
  /** Display name. */
  name: string;
  /** 1-2 sentence blurb. */
  description: string;
  /** Starting HP. */
  hp: number;
  /** Starting max HP. */
  maxHp: number;
  /** Base energy per turn (default 3). */
  energy: number;
  /** Card IDs for the starting deck. */
  starterDeck: string[];
  /** Relic IDs for starting relics. */
  starterRelics: string[];
  /** Character-exclusive card IDs. */
  cardPool: string[];
  /** Theme color for UI (hex string). */
  color: string;
  /** Maximum potion slots. Default 3. */
  maxPotionSlots?: number;
  /** Unlock condition (Post-MVP). */
  unlockCondition?: UnlockCondition;
}
