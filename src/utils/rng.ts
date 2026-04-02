/**
 * rng.ts — Seeded pseudo-random number generation for deterministic gameplay.
 *
 * Implements: design/gdd/rng.md
 *
 * Uses mulberry32 as the core 32-bit PRNG algorithm. Each run is initialized
 * with a master seed, and independent sub-streams are derived for each game
 * subsystem so that consumption in one system never affects another.
 *
 * Key properties:
 * - Deterministic: same seed + same actions = identical outcomes
 * - Sub-stream isolation: each system gets its own RNG instance
 * - Serializable: full state capture for save/load
 * - 32-bit safe: no BigInt or 64-bit arithmetic required
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** IDs for the five independent RNG sub-streams. */
export type RNGStreamId =
  | 'mapRNG'
  | 'combatRNG'
  | 'aiRNG'
  | 'rewardRNG'
  | 'eventRNG';

/** Mapping from stream ID to its numeric index for sub-seed derivation. */
const STREAM_INDICES: Record<RNGStreamId, number> = {
  mapRNG: 0,
  combatRNG: 1,
  aiRNG: 2,
  rewardRNG: 3,
  eventRNG: 4,
};

/** Ordered list of all stream IDs. */
const ALL_STREAM_IDS: RNGStreamId[] = [
  'mapRNG',
  'combatRNG',
  'aiRNG',
  'rewardRNG',
  'eventRNG',
];

/** A weighted item for use with {@link RNGStream.weightedPick}. */
export interface WeightedItem<T> {
  item: T;
  weight: number;
}

/** Captured state of a single RNG sub-stream for save/load. */
export interface StreamSnapshot {
  /** Internal mulberry32 state (single uint32). */
  state: number;
  /** Count of values consumed (informational, not used in restoration). */
  consumed: number;
}

/** Captured state of the entire RNG system for save/load. */
export interface RNGSnapshot {
  /** Original master seed (for seed sharing). */
  masterSeed: number;
  /** Per-stream snapshots keyed by stream ID. */
  streams: Record<RNGStreamId, StreamSnapshot>;
}

// ---------------------------------------------------------------------------
// Mulberry32 core
// ---------------------------------------------------------------------------

/**
 * Advance the mulberry32 state by one step and return a float in [0, 1).
 *
 * This mutates the `stateHolder.state` field in place.
 */
function mulberry32Next(stateHolder: { state: number }): number {
  let s = stateHolder.state;
  s = (s + 0x6d2b79f5) | 0;
  stateHolder.state = s;
  let t = Math.imul(s ^ (s >>> 15), 1 | s);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t) ^ t) | 0;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

// ---------------------------------------------------------------------------
// Sub-seed derivation (32-bit safe)
// ---------------------------------------------------------------------------

/**
 * Derive a sub-seed from the master seed using the GDD formula.
 *
 * ```
 * subSeed(i):
 *   let s = (masterSeed + Math.imul(i, 0x9E3779B9)) | 0
 *   s = (s + 0x6D2B79F5) | 0
 *   let t = Math.imul(s ^ (s >>> 15), 1 | s)
 *   t = (t + Math.imul(t ^ (t >>> 7), 61 | t) ^ t) | 0
 *   return ((t ^ (t >>> 14)) >>> 0)
 * ```
 *
 * All operations use `Math.imul` for correct 32-bit multiplication and
 * `>>> 0` for unsigned conversion. No BigInt or 64-bit arithmetic required.
 */
function deriveSubSeed(masterSeed: number, index: number): number {
  let s = (masterSeed + Math.imul(index, 0x9e3779b9)) | 0;
  s = (s + 0x6d2b79f5) | 0;
  let t = Math.imul(s ^ (s >>> 15), 1 | s);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t) ^ t) | 0;
  return (t ^ (t >>> 14)) >>> 0;
}

// ---------------------------------------------------------------------------
// RNGStream — a single independent sub-stream
// ---------------------------------------------------------------------------

/**
 * A deterministic random number stream derived from the master seed.
 *
 * Each game subsystem receives its own `RNGStream` instance, ensuring that
 * consuming values in one system never affects the sequence produced by another.
 */
export class RNGStream {
  /** Internal mulberry32 state. */
  private stateHolder: { state: number };
  /** Number of values consumed from this stream (informational). */
  private _consumed: number;

  /** @param seed - The derived sub-seed for this stream. */
  constructor(seed: number) {
    this.stateHolder = { state: seed >>> 0 };
    this._consumed = 0;
  }

  // -- Basic generation -----------------------------------------------------

  /**
   * Generate a random float in `[0, 1)`.
   *
   * This is the fundamental generation method; all other methods build on it.
   */
  nextFloat(): number;

  /**
   * Generate a random float in `[min, max)`.
   *
   * @param min - Lower bound (inclusive).
   * @param max - Upper bound (exclusive).
   */
  nextFloat(min: number, max: number): number;

  nextFloat(min?: number, max?: number): number {
    const raw = mulberry32Next(this.stateHolder);
    this._consumed++;
    if (min === undefined || max === undefined) {
      return raw;
    }
    return min + raw * (max - min);
  }

  /**
   * Generate a random integer in `[min, max]` (both inclusive).
   *
   * If `min > max`, the values are swapped automatically.
   */
  nextInt(min: number, max: number): number {
    if (min > max) {
      if (typeof process !== 'undefined' && process.env?.NODE_ENV !== 'production') {
        console.warn(
          `[RNGStream] nextInt called with min(${min}) > max(${max}). Swapping.`
        );
      }
      [min, max] = [max, min];
    }
    const raw = mulberry32Next(this.stateHolder);
    this._consumed++;
    return min + Math.floor(raw * (max - min + 1));
  }

  // -- Collection operations ------------------------------------------------

  /**
   * Return a shuffled copy of the array using the Fisher-Yates algorithm.
   *
   * The original array is not modified.
   */
  shuffle<T>(array: readonly T[]): T[] {
    const result = [...array];
    for (let i = result.length - 1; i > 0; i--) {
      const j = this.nextInt(0, i);
      const tmp = result[i];
      result[i] = result[j];
      result[j] = tmp;
    }
    return result;
  }

  /**
   * Pick a random element from the array.
   *
   * @throws {Error} If the array is empty.
   */
  pick<T>(array: readonly T[]): T {
    if (array.length === 0) {
      throw new Error('Cannot pick from empty array');
    }
    return array[this.nextInt(0, array.length - 1)];
  }

  /**
   * Pick an item from a weighted collection using linear scan.
   *
   * Negative or zero weights are treated as weight = 0 (the item can never
   * be selected).
   *
   * Time complexity: O(n). Intentionally simple — typical item pools are
   * small (< 20 items).
   *
   * @throws {Error} If total weight is <= 0 (all items have weight <= 0).
   */
  weightedPick<T>(items: WeightedItem<T>[]): T {
    if (items.length === 0) {
      throw new Error('Cannot pick from empty array');
    }

    let totalWeight = 0;
    for (const entry of items) {
      totalWeight += Math.max(0, entry.weight);
    }

    if (totalWeight <= 0) {
      throw new Error('No valid items to pick from');
    }

    const roll = this.nextFloat() * totalWeight;
    let cumulative = 0;

    for (const entry of items) {
      cumulative += Math.max(0, entry.weight);
      if (roll < cumulative) {
        return entry.item;
      }
    }

    // Fallback for floating-point edge case — return last item
    return items[items.length - 1].item;
  }

  // -- Probability ----------------------------------------------------------

  /**
   * Return `true` with the given probability (0 to 1).
   *
   * @param probability - Chance of returning `true`. Clamped to [0, 1].
   */
  chance(probability: number): boolean {
    const clamped = Math.max(0, Math.min(1, probability));
    return this.nextFloat() < clamped;
  }

  // -- Serialization --------------------------------------------------------

  /**
   * Number of values consumed from this stream since creation or last restore.
   * Informational only — not used in restoration.
   */
  get consumed(): number {
    return this._consumed;
  }

  /**
   * Capture the current state of this stream for later restoration.
   */
  serialize(): StreamSnapshot {
    return {
      state: this.stateHolder.state >>> 0,
      consumed: this._consumed,
    };
  }

  /**
   * Restore this stream from a previously captured snapshot.
   */
  static deserialize(snapshot: StreamSnapshot): RNGStream {
    const stream = new RNGStream(0);
    stream.stateHolder.state = snapshot.state >>> 0;
    stream._consumed = snapshot.consumed;
    return stream;
  }
}

// ---------------------------------------------------------------------------
// GameRNG — top-level RNG manager
// ---------------------------------------------------------------------------

/**
 * Master RNG manager for the entire game run.
 *
 * Holds the master seed and provides access to independent sub-streams for
 * each game subsystem. Supports serialization for save/load and seed hex
 * encoding for sharing.
 */
export class GameRNG {
  private masterSeed: number;
  private streams: Map<RNGStreamId, RNGStream>;

  /**
   * Create a new RNG system from a master seed.
   *
   * @param masterSeed - A 32-bit unsigned integer seed.
   */
  constructor(masterSeed: number) {
    this.masterSeed = masterSeed >>> 0;
    this.streams = new Map();
  }

  // -- Sub-stream access ----------------------------------------------------

  /**
   * Get the RNG stream for the given subsystem.
   *
   * Streams are lazy-initialized on first access. Once created, the same
   * instance is returned on subsequent calls so that consumption state is
   * preserved.
   */
  getStream(id: RNGStreamId): RNGStream {
    let stream = this.streams.get(id);
    if (!stream) {
      const index = STREAM_INDICES[id];
      const subSeed = deriveSubSeed(this.masterSeed, index);
      stream = new RNGStream(subSeed);
      this.streams.set(id, stream);
    }
    return stream;
  }

  // -- Seed sharing ---------------------------------------------------------

  /**
   * Return the master seed as a hex string like `#A3F7B2C1`.
   */
  getSeedHex(): string {
    return '#' + this.masterSeed.toString(16).toUpperCase().padStart(8, '0');
  }

  /**
   * Create a GameRNG from a hex seed string like `#A3F7B2C1`.
   */
  static fromHex(hex: string): GameRNG {
    const value = parseInt(hex.replace('#', ''), 16);
    return new GameRNG(value);
  }

  /**
   * Generate a random master seed using `Date.now()` and `Math.random()`.
   *
   * This is the ONLY place in game code where `Math.random()` is allowed
   * (per GDD acceptance criterion #6).
   */
  static generateSeed(): number {
    return ((Date.now() ^ (Math.random() * 0x100000000)) >>> 0);
  }

  // -- Serialization --------------------------------------------------------

  /**
   * Capture the full state of the RNG system for save/load.
   *
   * If a stream has never been accessed, it is still captured (initialized
   * freshly from the derived sub-seed) so that deserialization is complete.
   */
  serialize(): RNGSnapshot {
    const streams: Record<RNGStreamId, StreamSnapshot> =
      {} as Record<RNGStreamId, StreamSnapshot>;
    for (const id of ALL_STREAM_IDS) {
      streams[id] = this.getStream(id).serialize();
    }
    return { masterSeed: this.masterSeed, streams };
  }

  /**
   * Restore an RNG system from a previously captured snapshot.
   */
  static deserialize(snapshot: RNGSnapshot): GameRNG {
    const rng = new GameRNG(snapshot.masterSeed);
    for (const id of ALL_STREAM_IDS) {
      const streamSnapshot = snapshot.streams[id];
      if (streamSnapshot) {
        rng.streams.set(id, RNGStream.deserialize(streamSnapshot));
      }
    }
    return rng;
  }
}
