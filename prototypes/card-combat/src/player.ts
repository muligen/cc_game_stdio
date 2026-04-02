// PROTOTYPE - NOT FOR PRODUCTION
// Question: Does the core card combat loop feel right?
// Date: 2026-04-02

export interface PlayerData {
  hp: number;
  maxHp: number;
  block: number;
  energy: number;
  maxEnergy: number;
}

export function createPlayer(): PlayerData {
  return {
    hp: 80,
    maxHp: 80,
    block: 0,
    energy: 3,
    maxEnergy: 3,
  };
}
