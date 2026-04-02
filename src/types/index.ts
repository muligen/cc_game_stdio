/**
 * index.ts — Re-exports all type definitions.
 * Provides a single import point for all game data types.
 * Usage: import type { CardData, EnemyData } from '../types';
 */

// --- Card System ---
export type {
  CardData,
  CardEffect,
  CardInstance,
  CombatCardInstance,
  CardUpgrade,
  ConditionData,
  ComparisonOp,
  TargetOverride,
} from './card';
export {
  CardType,
  Rarity,
  CostType,
  TargetType,
  Keyword,
} from './card';

// --- Enemy AI System ---
export type {
  EnemyData,
  EnemyMove,
  MoveEffect,
  MoveEntry,
  MoveCondition,
  BossPhase,
  EnemyType,
  EnemyTarget,
  CombatEnemyInstance,
} from './enemy';
export { IntentType } from './enemy';

// --- Status Effect System ---
export type {
  StatusEffectData,
  StatusEffectTrigger,
  TriggerEffect,
  StatusEffectInstance,
  StatusEffectCategory,
  TriggerTiming,
} from './status-effect';
export { DurationType, StackingMode } from './status-effect';

// --- Relic System ---
export type {
  RelicData,
  RelicTriggerData,
  RelicTriggerCondition,
  RelicTriggerEffect,
  RelicCounter,
  RelicInstance,
} from './relic';
export { RelicTier } from './relic';

// --- Potion System ---
export type {
  PotionData,
  PotionEffect,
  PotionTarget,
} from './potion';
export { PotionRarity } from './potion';

// --- Character System ---
export type {
  CharacterData,
  UnlockCondition,
} from './character';

// --- Combat System ---
export type {
  CombatState,
  EnemyInstance,
  CombatResult,
} from './combat';
export {
  TurnPhase,
  PlayerTurnSubState,
  EnemyTurnSubState,
} from './combat';

// --- Map System ---
export type {
  MapData,
  MapFloor,
  MapNode,
  MapConfig,
  FloorWeightConfig,
} from './map';
export { NodeType } from './map';

// --- Reward System ---
export type {
  RewardConfig,
  RewardChoice,
  RewardType,
  RewardRarity,
} from './reward';

// --- Energy System ---
export type {
  EnergyState,
  EnergyCostType,
} from './energy';

// --- Run State ---
import type { CardInstance } from './card';
import type { MapData } from './map';

export type RunStatus = 'ACTIVE' | 'victory' | 'defeated' | 'abandoned';

export interface RunState {
  runId: string;
  seed: number;
  characterId: string;
  currentHP: number;
  maxHP: number;
  gold: number;
  masterDeck: CardInstance[];
  relics: string[];
  potions: (string | null)[];
  currentAct: number;
  currentFloor: number;
  currentNodeId: string | null;
  visitedNodes: string[];
  mapData: MapData[];
  combatsWon: number;
  elitesKilled: string[];
  bossesKilled: string[];
  turnCount: number;
  cardsPlayedCount: number;
  status: RunStatus;
  score: number;
}

// --- Ascension ---
export interface AscensionData {
  id: string;
  level: number;
  description: string;
  modifications: AscensionModification[];
}

export interface AscensionModification {
  target: string;
  operation: string;
  value: number;
}

// --- Event ---
export interface EventData {
  id: string;
  name: string;
  act: number;
  choices: EventChoice[];
}

export interface EventChoice {
  description: string;
  effects: EventEffect[];
  condition?: EventCondition;
}

export interface EventCondition {
  type: string;
  value: number;
}

export interface EventEffect {
  type: string;
  value: number;
  status?: string;
}

// --- Shop Config ---
export interface ShopConfig {
  commonCardCost: number;
  uncommonCardCost: number;
  rareCardCost: number;
  removeCost: number;
  relicPrices: Record<string, number>;
  shopCardCount: number;
  shopRelicCount: number;
}

// --- UI Config ---
export interface UIConfig {
  cardWidth: number;
  cardHeight: number;
  cardHoverLift: number;
  cardSelectLift: number;
  animationSpeedMultiplier: number;
  combatLogMaxEntries: number;
  intentUpdateDuration: number;
  hpBarMaxWidth: number;
  fadeDuration: number;
  slideDuration: number;
  dissolveDuration: number;
}
