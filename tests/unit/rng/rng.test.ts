/**
 * rng.test.ts — Unit tests for the seeded RNG system.
 *
 * Implements acceptance criteria and edge cases from design/gdd/rng.md.
 *
 * Coverage areas:
 * - Determinism: same seed produces same sequence
 * - Sub-stream isolation: consuming values in one stream does not affect another
 * - Serialization roundtrip: serialize/deserialize preserves next values
 * - Distribution uniformity: nextInt distribution is even
 * - Seed hex sharing: fromHex(getSeedHex()) produces identical sequences
 * - Edge cases: seed 0, empty arrays, min > max, negative weights, all-zero weights
 * - Collection operations: shuffle, pick, weightedPick
 * - Performance: 10,000 values in < 5ms
 */

// @vitest-environment node

import { describe, it, expect } from 'vitest';
import {
  GameRNG,
  RNGStream,
  type RNGStreamId,
  type WeightedItem,
} from '../../../src/utils/rng';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Read N values from nextInt(0, 100) on the given stream. */
function readIntSequence(stream: RNGStream, count: number): number[] {
  const values: number[] = [];
  for (let i = 0; i < count; i++) {
    values.push(stream.nextInt(0, 100));
  }
  return values;
}

/** Read N values from nextFloat() on the given stream. */
function readFloatSequence(stream: RNGStream, count: number): number[] {
  const values: number[] = [];
  for (let i = 0; i < count; i++) {
    values.push(stream.nextFloat());
  }
  return values;
}

// ---------------------------------------------------------------------------
// Determinism (Acceptance Criterion #1)
// ---------------------------------------------------------------------------

describe('Determinism', () => {
  it('produces the same sequence for the same seed', () => {
    const seed = 0xa3f7b2c1;
    const rng1 = new GameRNG(seed);
    const rng2 = new GameRNG(seed);

    const seq1 = readIntSequence(rng1.getStream('mapRNG'), 10);
    const seq2 = readIntSequence(rng2.getStream('mapRNG'), 10);

    expect(seq1).toEqual(seq2);
  });

  it('produces different sequences for different seeds', () => {
    const rng1 = new GameRNG(12345);
    const rng2 = new GameRNG(67890);

    const seq1 = readIntSequence(rng1.getStream('mapRNG'), 10);
    const seq2 = readIntSequence(rng2.getStream('mapRNG'), 10);

    expect(seq1).not.toEqual(seq2);
  });

  it('produces the same float sequence for the same seed', () => {
    const seed = 0xdeadbeef;
    const rng1 = new GameRNG(seed);
    const rng2 = new GameRNG(seed);

    const seq1 = readFloatSequence(rng1.getStream('combatRNG'), 20);
    const seq2 = readFloatSequence(rng2.getStream('combatRNG'), 20);

    expect(seq1).toEqual(seq2);
  });
});

// ---------------------------------------------------------------------------
// Sub-stream Isolation (Acceptance Criterion #2)
// ---------------------------------------------------------------------------

describe('Sub-stream isolation', () => {
  it('mapRNG consumption does not affect combatRNG', () => {
    const seed = 42;
    const rng1 = new GameRNG(seed);
    const rng2 = new GameRNG(seed);

    // Consume 1000 values from mapRNG on rng1
    readIntSequence(rng1.getStream('mapRNG'), 1000);

    // combatRNG on rng1 should still match combatRNG on rng2 (no prior consumption)
    const combat1 = rng1.getStream('combatRNG').nextInt(0, 100);
    const combat2 = rng2.getStream('combatRNG').nextInt(0, 100);

    expect(combat1).toBe(combat2);
  });

  it('all five streams are independent', () => {
    const seed = 98765;
    const rng = new GameRNG(seed);

    // Get first value from each stream
    const firstValues: Record<RNGStreamId, number> = {
      mapRNG: rng.getStream('mapRNG').nextFloat(),
      combatRNG: rng.getStream('combatRNG').nextFloat(),
      aiRNG: rng.getStream('aiRNG').nextFloat(),
      rewardRNG: rng.getStream('rewardRNG').nextFloat(),
      eventRNG: rng.getStream('eventRNG').nextFloat(),
    };

    // Now create a fresh RNG and verify each stream's first value matches
    // even though we consumed in interleaved order above
    const rng2 = new GameRNG(seed);
    expect(rng2.getStream('mapRNG').nextFloat()).toBe(firstValues.mapRNG);
    expect(rng2.getStream('combatRNG').nextFloat()).toBe(firstValues.combatRNG);
    expect(rng2.getStream('aiRNG').nextFloat()).toBe(firstValues.aiRNG);
    expect(rng2.getStream('rewardRNG').nextFloat()).toBe(firstValues.rewardRNG);
    expect(rng2.getStream('eventRNG').nextFloat()).toBe(firstValues.eventRNG);
  });
});

// ---------------------------------------------------------------------------
// Serialization Roundtrip (Acceptance Criterion #3)
// ---------------------------------------------------------------------------

describe('Serialization roundtrip', () => {
  it('preserves next value after serialize/deserialize', () => {
    const rng = new GameRNG(0xcafebabe);
    const stream = rng.getStream('mapRNG');

    // Consume some values
    readIntSequence(stream, 50);

    // Serialize
    const snapshot = rng.serialize();

    // Deserialize
    const restored = GameRNG.deserialize(snapshot);

    // Next values should match
    expect(restored.getStream('mapRNG').nextInt(0, 999)).toBe(
      rng.getStream('mapRNG').nextInt(0, 999)
    );
  });

  it('preserves all five streams independently', () => {
    const rng = new GameRNG(11111);

    // Consume different amounts from each stream
    readIntSequence(rng.getStream('mapRNG'), 10);
    readIntSequence(rng.getStream('combatRNG'), 20);
    readIntSequence(rng.getStream('aiRNG'), 30);
    readIntSequence(rng.getStream('rewardRNG'), 40);
    readIntSequence(rng.getStream('eventRNG'), 50);

    const snapshot = rng.serialize();
    const restored = GameRNG.deserialize(snapshot);

    const ids: RNGStreamId[] = [
      'mapRNG', 'combatRNG', 'aiRNG', 'rewardRNG', 'eventRNG',
    ];
    for (const id of ids) {
      expect(restored.getStream(id).nextInt(0, 9999)).toBe(
        rng.getStream(id).nextInt(0, 9999)
      );
    }
  });

  it('preserves consumed count informationally', () => {
    const stream = new RNGStream(12345);
    readIntSequence(stream, 42);

    const snapshot = stream.serialize();
    expect(snapshot.consumed).toBe(42);

    const restored = RNGStream.deserialize(snapshot);
    expect(restored.consumed).toBe(42);
  });
});

// ---------------------------------------------------------------------------
// Distribution Uniformity (Acceptance Criterion #4)
// ---------------------------------------------------------------------------

describe('Distribution uniformity', () => {
  it('nextInt(0, 9) produces even distribution over 10,000 calls', () => {
    const rng = new GameRNG(77777);
    const stream = rng.getStream('mapRNG');
    const buckets: number[] = new Array(10).fill(0);

    for (let i = 0; i < 10_000; i++) {
      const val = stream.nextInt(0, 9);
      buckets[val]++;
    }

    // Each digit should appear between 900 and 1100 times (±10% of 1000)
    for (let digit = 0; digit <= 9; digit++) {
      expect(buckets[digit]).toBeGreaterThanOrEqual(900);
      expect(buckets[digit]).toBeLessThanOrEqual(1100);
    }
  });

  it('nextFloat() produces values in [0, 1)', () => {
    const rng = new GameRNG(99999);
    const stream = rng.getStream('combatRNG');

    for (let i = 0; i < 10_000; i++) {
      const val = stream.nextFloat();
      expect(val).toBeGreaterThanOrEqual(0);
      expect(val).toBeLessThan(1);
    }
  });
});

// ---------------------------------------------------------------------------
// Seed Hex Sharing (Acceptance Criterion #5)
// ---------------------------------------------------------------------------

describe('Seed hex sharing', () => {
  it('fromHex(getSeedHex()) produces identical sequences', () => {
    const original = new GameRNG(0xbadf00d);
    const hex = original.getSeedHex();
    const restored = GameRNG.fromHex(hex);

    // Verify hex format
    expect(hex).toBe('#0BADF00D');

    // Verify sequences match
    const seq1 = readIntSequence(original.getStream('mapRNG'), 20);
    const seq2 = readIntSequence(restored.getStream('mapRNG'), 20);

    expect(seq1).toEqual(seq2);
  });

  it('roundtrips seed 0 correctly', () => {
    const rng = new GameRNG(0);
    const hex = rng.getSeedHex();
    expect(hex).toBe('#00000000');

    const restored = GameRNG.fromHex(hex);
    expect(restored.getStream('mapRNG').nextFloat()).toBe(
      rng.getStream('mapRNG').nextFloat()
    );
  });

  it('roundtrips max uint32 correctly', () => {
    const rng = new GameRNG(0xffffffff);
    const hex = rng.getSeedHex();
    expect(hex).toBe('#FFFFFFFF');

    const restored = GameRNG.fromHex(hex);
    expect(restored.getStream('mapRNG').nextFloat()).toBe(
      rng.getStream('mapRNG').nextFloat()
    );
  });

  it('handles lowercase hex input', () => {
    const rng = GameRNG.fromHex('#badf00d');
    expect(rng.getSeedHex()).toBe('#0BADF00D');
  });

  it('handles hex without # prefix', () => {
    const rng = GameRNG.fromHex('A3F7B2C1');
    expect(rng.getSeedHex()).toBe('#A3F7B2C1');
  });
});

// ---------------------------------------------------------------------------
// RNGStream — nextInt edge cases (Edge Case #6)
// ---------------------------------------------------------------------------

describe('nextInt edge cases', () => {
  it('swaps min and max when min > max', () => {
    const rng = new GameRNG(55555);
    const stream = rng.getStream('combatRNG');

    // nextInt(10, 1) should behave like nextInt(1, 10)
    const val = stream.nextInt(10, 1);
    expect(val).toBeGreaterThanOrEqual(1);
    expect(val).toBeLessThanOrEqual(10);
  });

  it('returns min when min == max', () => {
    const rng = new GameRNG(55555);
    const stream = rng.getStream('combatRNG');

    for (let i = 0; i < 10; i++) {
      expect(stream.nextInt(5, 5)).toBe(5);
    }
  });
});

// ---------------------------------------------------------------------------
// RNGStream — nextFloat overloads
// ---------------------------------------------------------------------------

describe('nextFloat with range', () => {
  it('nextFloat(min, max) returns values in [min, max)', () => {
    const rng = new GameRNG(33333);
    const stream = rng.getStream('aiRNG');

    for (let i = 0; i < 1000; i++) {
      const val = stream.nextFloat(10, 20);
      expect(val).toBeGreaterThanOrEqual(10);
      expect(val).toBeLessThan(20);
    }
  });
});

// ---------------------------------------------------------------------------
// RNGStream — shuffle (Fisher-Yates)
// ---------------------------------------------------------------------------

describe('shuffle', () => {
  it('returns a new array (does not mutate original)', () => {
    const rng = new GameRNG(44444);
    const stream = rng.getStream('mapRNG');
    const original = [1, 2, 3, 4, 5];

    const shuffled = stream.shuffle(original);

    expect(original).toEqual([1, 2, 3, 4, 5]);
    expect(shuffled).toHaveLength(5);
    expect(shuffled.sort()).toEqual([1, 2, 3, 4, 5]);
  });

  it('is deterministic for the same seed', () => {
    const rng1 = new GameRNG(44444);
    const rng2 = new GameRNG(44444);

    const arr = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];

    const shuffled1 = rng1.getStream('mapRNG').shuffle(arr);
    const shuffled2 = rng2.getStream('mapRNG').shuffle(arr);

    expect(shuffled1).toEqual(shuffled2);
  });

  it('handles empty array', () => {
    const rng = new GameRNG(44444);
    const stream = rng.getStream('mapRNG');

    expect(stream.shuffle([])).toEqual([]);
  });

  it('handles single-element array', () => {
    const rng = new GameRNG(44444);
    const stream = rng.getStream('mapRNG');

    expect(stream.shuffle([42])).toEqual([42]);
  });
});

// ---------------------------------------------------------------------------
// RNGStream — pick (Edge Case #3)
// ---------------------------------------------------------------------------

describe('pick', () => {
  it('returns an element from the array', () => {
    const rng = new GameRNG(66666);
    const stream = rng.getStream('rewardRNG');
    const arr = [10, 20, 30, 40, 50];

    const val = stream.pick(arr);
    expect(arr).toContain(val);
  });

  it('throws on empty array', () => {
    const rng = new GameRNG(66666);
    const stream = rng.getStream('rewardRNG');

    expect(() => stream.pick([])).toThrow('Cannot pick from empty array');
  });

  it('returns the only element from a single-element array', () => {
    const rng = new GameRNG(66666);
    const stream = rng.getStream('rewardRNG');

    expect(stream.pick([42])).toBe(42);
  });
});

// ---------------------------------------------------------------------------
// RNGStream — weightedPick (Edge Cases #3, #4, #5)
// ---------------------------------------------------------------------------

describe('weightedPick', () => {
  it('picks according to weights', () => {
    const rng = new GameRNG(88888);
    const stream = rng.getStream('aiRNG');

    const items: WeightedItem<string>[] = [
      { item: 'common', weight: 80 },
      { item: 'rare', weight: 15 },
      { item: 'legendary', weight: 5 },
    ];

    const counts: Record<string, number> = { common: 0, rare: 0, legendary: 0 };

    for (let i = 0; i < 10_000; i++) {
      const picked = stream.weightedPick(items);
      counts[picked]++;
    }

    // Common should be most frequent, legendary least frequent
    expect(counts.common).toBeGreaterThan(counts.rare);
    expect(counts.rare).toBeGreaterThan(counts.legendary);
  });

  it('picks the only item with positive weight', () => {
    const rng = new GameRNG(88888);
    const stream = rng.getStream('aiRNG');

    const items: WeightedItem<string>[] = [
      { item: 'only', weight: 10 },
    ];

    expect(stream.weightedPick(items)).toBe('only');
  });

  it('throws on empty array', () => {
    const rng = new GameRNG(88888);
    const stream = rng.getStream('aiRNG');

    expect(() => stream.weightedPick([])).toThrow('Cannot pick from empty array');
  });

  it('throws when all weights are zero (Edge Case #4)', () => {
    const rng = new GameRNG(88888);
    const stream = rng.getStream('aiRNG');

    const items: WeightedItem<string>[] = [
      { item: 'a', weight: 0 },
      { item: 'b', weight: 0 },
    ];

    expect(() => stream.weightedPick(items)).toThrow('No valid items to pick from');
  });

  it('throws when all weights are negative (Edge Case #5)', () => {
    const rng = new GameRNG(88888);
    const stream = rng.getStream('aiRNG');

    const items: WeightedItem<string>[] = [
      { item: 'a', weight: -5 },
      { item: 'b', weight: -10 },
    ];

    expect(() => stream.weightedPick(items)).toThrow('No valid items to pick from');
  });

  it('silently clamps negative weights to zero (Edge Case #5)', () => {
    const rng = new GameRNG(88888);
    const stream = rng.getStream('aiRNG');

    // Only 'valid' has positive weight, so it must always be picked
    const items: WeightedItem<string>[] = [
      { item: 'negative', weight: -10 },
      { item: 'valid', weight: 5 },
    ];

    for (let i = 0; i < 100; i++) {
      expect(stream.weightedPick(items)).toBe('valid');
    }
  });

  it('is deterministic for the same seed', () => {
    const rng1 = new GameRNG(88888);
    const rng2 = new GameRNG(88888);

    const items: WeightedItem<number>[] = [
      { item: 1, weight: 10 },
      { item: 2, weight: 20 },
      { item: 3, weight: 30 },
    ];

    const picks1: number[] = [];
    const picks2: number[] = [];

    for (let i = 0; i < 50; i++) {
      picks1.push(rng1.getStream('aiRNG').weightedPick(items));
      picks2.push(rng2.getStream('aiRNG').weightedPick(items));
    }

    expect(picks1).toEqual(picks2);
  });
});

// ---------------------------------------------------------------------------
// RNGStream — chance
// ---------------------------------------------------------------------------

describe('chance', () => {
  it('always returns true when probability is 1', () => {
    const rng = new GameRNG(22222);
    const stream = rng.getStream('eventRNG');

    for (let i = 0; i < 100; i++) {
      expect(stream.chance(1)).toBe(true);
    }
  });

  it('always returns false when probability is 0', () => {
    const rng = new GameRNG(22222);
    const stream = rng.getStream('eventRNG');

    for (let i = 0; i < 100; i++) {
      expect(stream.chance(0)).toBe(false);
    }
  });

  it('returns approximately correct ratio for probability 0.5', () => {
    const rng = new GameRNG(22222);
    const stream = rng.getStream('eventRNG');

    let trues = 0;
    const trials = 10_000;
    for (let i = 0; i < trials; i++) {
      if (stream.chance(0.5)) trues++;
    }

    // Should be roughly 5000 ±10%
    expect(trues).toBeGreaterThan(4500);
    expect(trues).toBeLessThan(5500);
  });

  it('clamps negative probabilities to 0', () => {
    const rng = new GameRNG(22222);
    const stream = rng.getStream('eventRNG');

    expect(stream.chance(-1)).toBe(false);
  });

  it('clamps probabilities > 1 to 1', () => {
    const rng = new GameRNG(22222);
    const stream = rng.getStream('eventRNG');

    expect(stream.chance(2)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Seed 0 (Edge Case #1)
// ---------------------------------------------------------------------------

describe('Seed 0', () => {
  it('produces valid output from seed 0', () => {
    const rng = new GameRNG(0);
    const stream = rng.getStream('mapRNG');

    // Should produce valid floats without errors
    for (let i = 0; i < 100; i++) {
      const val = stream.nextFloat();
      expect(val).toBeGreaterThanOrEqual(0);
      expect(val).toBeLessThan(1);
    }
  });

  it('is deterministic for seed 0', () => {
    const rng1 = new GameRNG(0);
    const rng2 = new GameRNG(0);

    expect(rng1.getStream('mapRNG').nextFloat()).toBe(
      rng2.getStream('mapRNG').nextFloat()
    );
  });
});

// ---------------------------------------------------------------------------
// GameRNG.generateSeed
// ---------------------------------------------------------------------------

describe('GameRNG.generateSeed', () => {
  it('produces a valid uint32', () => {
    const seed = GameRNG.generateSeed();
    expect(seed).toBeGreaterThanOrEqual(0);
    expect(seed).toBeLessThanOrEqual(0xffffffff);
    expect(Number.isInteger(seed)).toBe(true);
  });

  it('produces different seeds on successive calls (statistically)', () => {
    const seeds = new Set<number>();
    for (let i = 0; i < 10; i++) {
      seeds.add(GameRNG.generateSeed());
    }
    // At least 8 out of 10 should be unique
    expect(seeds.size).toBeGreaterThanOrEqual(8);
  });
});

// ---------------------------------------------------------------------------
// Performance (Acceptance Criterion #7)
// ---------------------------------------------------------------------------

describe('Performance', () => {
  it('generates 10,000 random values in < 5ms', () => {
    const rng = new GameRNG(12345);
    const stream = rng.getStream('mapRNG');

    const start = performance.now();
    for (let i = 0; i < 10_000; i++) {
      stream.nextFloat();
    }
    const elapsed = performance.now() - start;

    expect(elapsed).toBeLessThan(5);
  });
});
