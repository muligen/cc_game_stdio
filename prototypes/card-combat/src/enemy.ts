// PROTOTYPE - NOT FOR PRODUCTION
// Question: Does the core card combat loop feel right?
// Date: 2026-04-02

export interface EnemyData {
  name: string;
  hp: number;
  maxHp: number;
  vulnerable: number;
  intent: 'attack';
  intentValue: number;
}

export function createCultist(): EnemyData {
  return {
    name: 'Cultist',
    hp: 50,
    maxHp: 50,
    vulnerable: 0,
    intent: 'attack',
    intentValue: 6,
  };
}
