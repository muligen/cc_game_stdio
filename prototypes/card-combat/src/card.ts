// PROTOTYPE - NOT FOR PRODUCTION
// Question: Does the core card combat loop feel right?
// Date: 2026-04-02

export interface CardData {
  name: string;
  cost: number;
  type: 'attack' | 'skill';
  description: string;
  execute: (scene: any) => void;
}

export function createStrike(): CardData {
  return {
    name: 'Strike',
    cost: 1,
    type: 'attack',
    description: 'Deal 6 damage.',
    execute(scene) {
      const dmg = scene.calculateDamage(6);
      scene.dealDamageToEnemy(dmg);
    },
  };
}

export function createDefend(): CardData {
  return {
    name: 'Defend',
    cost: 1,
    type: 'skill',
    description: 'Gain 5 Block.',
    execute(scene) {
      scene.player.block += 5;
      scene.updatePlayerUI();
    },
  };
}

export function createBash(): CardData {
  return {
    name: 'Bash',
    cost: 2,
    type: 'attack',
    description: 'Deal 8 damage.\nApply 2 Vulnerable.',
    execute(scene) {
      const dmg = scene.calculateDamage(8);
      scene.dealDamageToEnemy(dmg);
      scene.enemy.vulnerable += 2;
    },
  };
}

/** The starter deck: 2 Strike, 2 Defend, 1 Bash */
export function createStarterDeck(): CardData[] {
  return [
    createStrike(),
    createStrike(),
    createDefend(),
    createDefend(),
    createBash(),
  ];
}
