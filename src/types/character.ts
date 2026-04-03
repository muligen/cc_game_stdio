/**
 * character.ts — Character data type definitions.
 *
 * Implements: design/gdd/character.md (Character Data Schema, MVP Characters)
 * All character data is loaded from characters.json at runtime.
 */

import type { CombatCardInstance } from './card';

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

/**
 * CharacterInstance — runtime instance of a playable character.
 *
 * Created by CharacterManager when loading a character for a run.
 * Tracks mutable runtime state (HP, deck, gold, potions) alongside
 * the immutable CharacterData definition.
 */
export interface CharacterInstance {
  /** Full character definition (immutable reference from registry). */
  data: CharacterData;
  /** Current HP (starts at maxHP). */
  currentHP: number;
  /** Maximum HP. */
  maxHP: number;
  /** Resolved starter deck as combat-ready card instances. */
  deck: CombatCardInstance[];
  /** Current gold count (starts at 0). */
  gold: number;
  /** Maximum potion slots (from data, default 3). */
  potionSlots: number;
}
