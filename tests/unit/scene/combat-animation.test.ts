/**
 * Tests for CombatAnimationCoordinator
 *
 * Verifies animation queuing, timing, color assignment, and queue management.
 *
 * Design doc: S3-09 Combat Animation System
 */

import { describe, it, expect } from 'vitest';
import {
  CombatAnimationCoordinator,
  type AnimationEvent,
  type AnimationConfig,
} from '../../../src/scenes/combat/combat-animation';

describe('CombatAnimationCoordinator', () => {
  describe('queueDamageNumber', () => {
    it('creates animation with correct type, value, duration', () => {
      const coord = new CombatAnimationCoordinator();
      coord.queueDamageNumber('enemy1', 100, 200, 15, 0);

      const pending = coord.getPendingAnimations();
      expect(pending).toHaveLength(1);

      const anim = pending[0];
      expect(anim.type).toBe('damage_number');
      expect(anim.targetId).toBe('enemy1');
      expect(anim.x).toBe(100);
      expect(anim.y).toBe(200);
      expect(anim.value).toBe(15);
      expect(anim.duration).toBe(300);
      expect(anim.delay).toBe(0);
      expect(anim.color).toBe('#FF4444');
      expect(anim.text).toBe('-15');
    });

    it('shows blocked amount as blue', () => {
      const coord = new CombatAnimationCoordinator();
      coord.queueDamageNumber('player', 50, 80, 10, 5);

      const pending = coord.getPendingAnimations();
      expect(pending).toHaveLength(2);

      // First animation is the actual damage (red)
      expect(pending[0].value).toBe(10);
      expect(pending[0].color).toBe('#FF4444');
      expect(pending[0].text).toBe('-10');

      // Second animation is the blocked portion (blue)
      expect(pending[1].value).toBe(5);
      expect(pending[1].color).toBe('#4488FF');
      expect(pending[1].text).toBe('5 Blocked');
    });

    it('only queues blocked animation when blocked > 0', () => {
      const coord = new CombatAnimationCoordinator();
      coord.queueDamageNumber('enemy1', 100, 200, 20, 0);

      const pending = coord.getPendingAnimations();
      expect(pending).toHaveLength(1);
      expect(pending[0].color).toBe('#FF4444');
    });

    it('only queues damage animation when damage > 0', () => {
      const coord = new CombatAnimationCoordinator();
      coord.queueDamageNumber('player', 50, 80, 0, 10);

      const pending = coord.getPendingAnimations();
      expect(pending).toHaveLength(1);
      expect(pending[0].color).toBe('#4488FF');
    });
  });

  describe('queueCardPlay', () => {
    it('creates card_play animation', () => {
      const coord = new CombatAnimationCoordinator();
      coord.queueCardPlay('card-1', 10, 500, 400, 300);

      const pending = coord.getPendingAnimations();
      expect(pending).toHaveLength(2);

      // Origin animation
      const origin = pending[0];
      expect(origin.type).toBe('card_play');
      expect(origin.targetId).toBe('card-1');
      expect(origin.x).toBe(10);
      expect(origin.y).toBe(500);
      expect(origin.duration).toBe(500);

      // Destination event
      const dest = pending[1];
      expect(dest.x).toBe(400);
      expect(dest.y).toBe(300);
      expect(dest.delay).toBe(500);
    });
  });

  describe('queueEnemyDeath', () => {
    it('creates enemy_death animation', () => {
      const coord = new CombatAnimationCoordinator();
      coord.queueEnemyDeath('goblin1', 200, 150);

      const pending = coord.getPendingAnimations();
      expect(pending).toHaveLength(1);

      const anim = pending[0];
      expect(anim.type).toBe('enemy_death');
      expect(anim.targetId).toBe('goblin1');
      expect(anim.x).toBe(200);
      expect(anim.y).toBe(150);
      expect(anim.duration).toBe(300);
      expect(anim.text).toBe('Death');
    });
  });

  describe('queueBlockGain', () => {
    it('creates block_gain animation', () => {
      const coord = new CombatAnimationCoordinator();
      coord.queueBlockGain('player', 100, 200, 8);

      const pending = coord.getPendingAnimations();
      expect(pending).toHaveLength(1);

      const anim = pending[0];
      expect(anim.type).toBe('block_gain');
      expect(anim.targetId).toBe('player');
      expect(anim.value).toBe(8);
      expect(anim.duration).toBe(200);
      expect(anim.color).toBe('#4488FF');
      expect(anim.text).toBe('+8 Block');
    });
  });

  describe('queueHeal', () => {
    it('creates heal animation with green color', () => {
      const coord = new CombatAnimationCoordinator();
      coord.queueHeal('player', 100, 200, 12);

      const pending = coord.getPendingAnimations();
      expect(pending).toHaveLength(1);

      const anim = pending[0];
      expect(anim.type).toBe('heal');
      expect(anim.targetId).toBe('player');
      expect(anim.value).toBe(12);
      expect(anim.duration).toBe(200);
      expect(anim.color).toBe('#44FF44');
      expect(anim.text).toBe('+12');
    });
  });

  describe('queueStatusApply', () => {
    it('creates status_apply animation for debuff (purple)', () => {
      const coord = new CombatAnimationCoordinator();
      coord.queueStatusApply('enemy1', 150, 100, 'Vulnerable');

      const pending = coord.getPendingAnimations();
      expect(pending).toHaveLength(1);

      const anim = pending[0];
      expect(anim.type).toBe('status_apply');
      expect(anim.targetId).toBe('enemy1');
      expect(anim.duration).toBe(200);
      expect(anim.color).toBe('#AA44FF');
      expect(anim.text).toBe('Vulnerable');
    });

    it('creates status_apply animation for buff (orange)', () => {
      const coord = new CombatAnimationCoordinator();
      coord.queueStatusApply('player', 150, 100, 'Strength');

      const pending = coord.getPendingAnimations();
      expect(pending).toHaveLength(1);
      expect(pending[0].color).toBe('#FFAA44');
      expect(pending[0].text).toBe('Strength');
    });

    it('recognizes common debuffs', () => {
      const coord = new CombatAnimationCoordinator();
      const debuffs = ['Vulnerable', 'Weak', 'Frail', 'Poison', 'Burn', 'Dazed', 'Entangled', 'Bleed'];

      for (const debuff of debuffs) {
        coord.queueStatusApply('target', 0, 0, debuff);
      }

      const pending = coord.getPendingAnimations();
      for (const anim of pending) {
        expect(anim.color).toBe('#AA44FF');
      }
    });
  });

  describe('getPendingAnimations', () => {
    it('returns queued items', () => {
      const coord = new CombatAnimationCoordinator();
      coord.queueDamageNumber('e1', 0, 0, 5, 0);
      coord.queueBlockGain('p1', 0, 0, 3);

      const pending = coord.getPendingAnimations();
      expect(pending).toHaveLength(2);
    });

    it('returns empty array when nothing queued', () => {
      const coord = new CombatAnimationCoordinator();
      expect(coord.getPendingAnimations()).toHaveLength(0);
    });
  });

  describe('clear', () => {
    it('removes all pending animations', () => {
      const coord = new CombatAnimationCoordinator();
      coord.queueDamageNumber('e1', 0, 0, 5, 0);
      coord.queueBlockGain('p1', 0, 0, 3);
      expect(coord.getPendingAnimations()).toHaveLength(2);

      coord.clear();
      expect(coord.getPendingAnimations()).toHaveLength(0);
    });
  });

  describe('getTotalDuration', () => {
    it('returns 0 when queue is empty', () => {
      const coord = new CombatAnimationCoordinator();
      expect(coord.getTotalDuration()).toBe(0);
    });

    it('returns duration for a single animation', () => {
      const coord = new CombatAnimationCoordinator();
      coord.queueDamageNumber('e1', 0, 0, 5, 0);
      // damageDuration default is 300ms, delay is 0
      expect(coord.getTotalDuration()).toBe(300);
    });

    it('sums durations correctly accounting for delays', () => {
      const coord = new CombatAnimationCoordinator();
      // queueCardPlay creates two events: origin (500ms) + destination (delay 500ms, duration 0)
      coord.queueCardPlay('card-1', 0, 0, 100, 100);
      // getTotalDuration should be max(delay + duration) = max(0+500, 500+0) = 500
      expect(coord.getTotalDuration()).toBe(500);
    });

    it('computes max overlap across multiple animations', () => {
      const coord = new CombatAnimationCoordinator();
      coord.queueDamageNumber('e1', 0, 0, 5, 0);  // 300ms
      coord.queueEnemyDeath('e1', 0, 0);            // 300ms
      // Both have delay 0, so max end = 300
      expect(coord.getTotalDuration()).toBe(300);
    });
  });

  describe('isAnimating', () => {
    it('returns false when queue is empty', () => {
      const coord = new CombatAnimationCoordinator();
      expect(coord.isAnimating()).toBe(false);
    });

    it('returns true when queue non-empty', () => {
      const coord = new CombatAnimationCoordinator();
      coord.queueDamageNumber('e1', 0, 0, 5, 0);
      expect(coord.isAnimating()).toBe(true);
    });

    it('returns false after clear', () => {
      const coord = new CombatAnimationCoordinator();
      coord.queueDamageNumber('e1', 0, 0, 5, 0);
      coord.clear();
      expect(coord.isAnimating()).toBe(false);
    });
  });

  describe('multiple animations', () => {
    it('can queue multiple different animation types', () => {
      const coord = new CombatAnimationCoordinator();
      coord.queueDamageNumber('e1', 100, 100, 10, 0);
      coord.queueBlockGain('player', 200, 200, 5);
      coord.queueHeal('player', 200, 200, 3);
      coord.queueEnemyDeath('e1', 100, 100);
      coord.queueStatusApply('e1', 100, 100, 'Vulnerable');

      const pending = coord.getPendingAnimations();
      expect(pending).toHaveLength(5);
      expect(pending.map((a) => a.type)).toEqual([
        'damage_number',
        'block_gain',
        'heal',
        'enemy_death',
        'status_apply',
      ]);
    });
  });

  describe('config', () => {
    it('applies default config values when not specified', () => {
      const coord = new CombatAnimationCoordinator();
      coord.queueDamageNumber('e1', 0, 0, 5, 0);
      expect(coord.getPendingAnimations()[0].duration).toBe(300);

      coord.clear();
      coord.queueEnemyDeath('e1', 0, 0);
      expect(coord.getPendingAnimations()[0].duration).toBe(300);

      coord.clear();
      coord.queueBlockGain('p1', 0, 0, 5);
      expect(coord.getPendingAnimations()[0].duration).toBe(200);

      coord.clear();
      coord.queueHeal('p1', 0, 0, 5);
      expect(coord.getPendingAnimations()[0].duration).toBe(200);
    });

    it('allows custom config overrides for damage duration', () => {
      const config: AnimationConfig = { damageDuration: 500 };
      const coord = new CombatAnimationCoordinator(config);
      coord.queueDamageNumber('e1', 0, 0, 5, 0);
      expect(coord.getPendingAnimations()[0].duration).toBe(500);
    });

    it('allows custom config overrides for card play duration', () => {
      const config: AnimationConfig = { cardPlayDuration: 800 };
      const coord = new CombatAnimationCoordinator(config);
      coord.queueCardPlay('card-1', 0, 0, 100, 100);
      // Origin event uses custom duration
      expect(coord.getPendingAnimations()[0].duration).toBe(800);
    });

    it('allows custom config overrides for enemy death duration', () => {
      const config: AnimationConfig = { enemyDeathDuration: 600 };
      const coord = new CombatAnimationCoordinator(config);
      coord.queueEnemyDeath('e1', 0, 0);
      expect(coord.getPendingAnimations()[0].duration).toBe(600);
    });

    it('allows custom config overrides for block gain duration', () => {
      const config: AnimationConfig = { blockGainDuration: 400 };
      const coord = new CombatAnimationCoordinator(config);
      coord.queueBlockGain('p1', 0, 0, 5);
      expect(coord.getPendingAnimations()[0].duration).toBe(400);
    });

    it('allows custom config overrides for heal duration', () => {
      const config: AnimationConfig = { healDuration: 350 };
      const coord = new CombatAnimationCoordinator(config);
      coord.queueHeal('p1', 0, 0, 5);
      expect(coord.getPendingAnimations()[0].duration).toBe(350);
    });

    it('allows custom config overrides for status apply duration', () => {
      const config: AnimationConfig = { statusApplyDuration: 500 };
      const coord = new CombatAnimationCoordinator(config);
      coord.queueStatusApply('e1', 0, 0, 'Vulnerable');
      expect(coord.getPendingAnimations()[0].duration).toBe(500);
    });

    it('preserves defaults for unspecified config values', () => {
      const config: AnimationConfig = { damageDuration: 999 };
      const coord = new CombatAnimationCoordinator(config);

      // damage uses custom
      coord.queueDamageNumber('e1', 0, 0, 5, 0);
      expect(coord.getPendingAnimations()[0].duration).toBe(999);

      coord.clear();

      // block uses default
      coord.queueBlockGain('p1', 0, 0, 5);
      expect(coord.getPendingAnimations()[0].duration).toBe(200);
    });
  });
});
