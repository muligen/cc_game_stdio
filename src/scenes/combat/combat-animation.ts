/**
 * Combat Animation Coordinator
 *
 * Pure TypeScript animation coordinator that tracks pending animations and
 * provides timing data. No Phaser rendering — just animation state and durations.
 * The Phaser scene reads this to create tweens.
 *
 * Design doc: S3-09 Combat Animation System
 */

/** Animation color constants. */
const ANIMATION_COLORS = {
  DAMAGE: '#FF4444',
  BLOCKED: '#4488FF',
  BLOCK_GAIN: '#4488FF',
  HEAL: '#44FF44',
  STATUS_DEBUFF: '#AA44FF',
  STATUS_BUFF: '#FFAA44',
} as const;

/** A single animation event to be rendered by the Phaser scene. */
export interface AnimationEvent {
  type:
    | 'damage_number'
    | 'card_play'
    | 'card_discard'
    | 'enemy_death'
    | 'block_gain'
    | 'heal'
    | 'status_apply'
    | 'intent_reveal'
    | 'energy_change'
    | 'turn_start';
  targetId: string;
  x: number;
  y: number;
  value: number;
  duration: number;
  delay: number;
  color: string;
  text?: string;
}

/** Configuration for animation durations and visual parameters. */
export interface AnimationConfig {
  damageDuration?: number;
  damageFloatDistance?: number;
  cardPlayDuration?: number;
  enemyDeathDuration?: number;
  blockGainDuration?: number;
  healDuration?: number;
  statusApplyDuration?: number;
  intentRevealDuration?: number;
  energyChangeDuration?: number;
}

/** Default animation configuration values. */
const DEFAULT_CONFIG: Required<AnimationConfig> = {
  damageDuration: 300,
  damageFloatDistance: 40,
  cardPlayDuration: 500,
  enemyDeathDuration: 300,
  blockGainDuration: 200,
  healDuration: 200,
  statusApplyDuration: 200,
  intentRevealDuration: 300,
  energyChangeDuration: 100,
};

/**
 * Coordinates combat animations without depending on Phaser.
 *
 * Queues animation events with timing data so the Phaser scene can
 * create corresponding tweens. Tracks pending state and total duration
 * to allow input blocking while animations play.
 */
export class CombatAnimationCoordinator {
  private queue: AnimationEvent[] = [];
  private config: Required<AnimationConfig>;

  constructor(config?: AnimationConfig) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  // ---------------------------------------------------------------------------
  // Queue methods
  // ---------------------------------------------------------------------------

  /**
   * Queue a damage number floating up from target.
   * If blocked > 0, a second blue animation is queued for the blocked portion.
   */
  queueDamageNumber(
    targetId: string,
    x: number,
    y: number,
    damage: number,
    blocked: number,
  ): void {
    if (damage > 0) {
      this.queue.push({
        type: 'damage_number',
        targetId,
        x,
        y,
        value: damage,
        duration: this.config.damageDuration,
        delay: 0,
        color: ANIMATION_COLORS.DAMAGE,
        text: `-${damage}`,
      });
    }

    if (blocked > 0) {
      this.queue.push({
        type: 'damage_number',
        targetId,
        x,
        y: y - this.config.damageFloatDistance,
        value: blocked,
        duration: this.config.damageDuration,
        delay: 0,
        color: ANIMATION_COLORS.BLOCKED,
        text: `${blocked} Blocked`,
      });
    }
  }

  /** Queue a card play animation (card moves to center). */
  queueCardPlay(
    cardId: string,
    fromX: number,
    fromY: number,
    toX: number,
    toY: number,
  ): void {
    this.queue.push({
      type: 'card_play',
      targetId: cardId,
      x: fromX,
      y: fromY,
      value: 0,
      duration: this.config.cardPlayDuration,
      delay: 0,
      color: '#FFFFFF',
    });

    // Secondary event representing the destination
    this.queue.push({
      type: 'card_play',
      targetId: cardId,
      x: toX,
      y: toY,
      value: 0,
      duration: 0,
      delay: this.config.cardPlayDuration,
      color: '#FFFFFF',
    });
  }

  /** Queue enemy death fade-out. */
  queueEnemyDeath(enemyId: string, x: number, y: number): void {
    this.queue.push({
      type: 'enemy_death',
      targetId: enemyId,
      x,
      y,
      value: 0,
      duration: this.config.enemyDeathDuration,
      delay: 0,
      color: '#FFFFFF',
      text: 'Death',
    });
  }

  /** Queue block gain shimmer. */
  queueBlockGain(
    targetId: string,
    x: number,
    y: number,
    amount: number,
  ): void {
    this.queue.push({
      type: 'block_gain',
      targetId,
      x,
      y,
      value: amount,
      duration: this.config.blockGainDuration,
      delay: 0,
      color: ANIMATION_COLORS.BLOCK_GAIN,
      text: `+${amount} Block`,
    });
  }

  /** Queue heal number. */
  queueHeal(targetId: string, x: number, y: number, amount: number): void {
    this.queue.push({
      type: 'heal',
      targetId,
      x,
      y,
      value: amount,
      duration: this.config.healDuration,
      delay: 0,
      color: ANIMATION_COLORS.HEAL,
      text: `+${amount}`,
    });
  }

  /**
   * Queue status effect application flash.
   * Debuffs are purple, buffs are orange.
   */
  queueStatusApply(
    targetId: string,
    x: number,
    y: number,
    statusName: string,
  ): void {
    const isDebuff = this.isDebuffStatus(statusName);
    this.queue.push({
      type: 'status_apply',
      targetId,
      x,
      y,
      value: 0,
      duration: this.config.statusApplyDuration,
      delay: 0,
      color: isDebuff ? ANIMATION_COLORS.STATUS_DEBUFF : ANIMATION_COLORS.STATUS_BUFF,
      text: statusName,
    });
  }

  // ---------------------------------------------------------------------------
  // Queue management
  // ---------------------------------------------------------------------------

  /** Get all pending animations. */
  getPendingAnimations(): ReadonlyArray<AnimationEvent> {
    return this.queue;
  }

  /** Clear completed animations (call after rendering frame). */
  clear(): void {
    this.queue = [];
  }

  /** Total duration of all queued animations (for blocking input). */
  getTotalDuration(): number {
    if (this.queue.length === 0) {
      return 0;
    }

    let maxEnd = 0;
    for (const anim of this.queue) {
      const end = anim.delay + anim.duration;
      if (end > maxEnd) {
        maxEnd = end;
      }
    }
    return maxEnd;
  }

  /** Whether animations are still playing. */
  isAnimating(): boolean {
    return this.queue.length > 0;
  }

  // ---------------------------------------------------------------------------
  // Internal helpers
  // ---------------------------------------------------------------------------

  /**
   * Determine if a status effect is a debuff based on name.
   * Uses a known set of debuff names; anything else is treated as a buff.
   */
  private isDebuffStatus(statusName: string): boolean {
    const debuffNames = new Set([
      'Vulnerable',
      'Weak',
      'Frail',
      'Poison',
      'Burn',
      'Dazed',
      'Entangled',
      'Bleed',
    ]);
    return debuffNames.has(statusName);
  }
}
