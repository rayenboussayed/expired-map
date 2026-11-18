type Strategy = "lru" | "lfu" | "fifo";

type Options<K, V> = {
  /** Default TTL in ms. `Infinity` means entries never expire. */
  defaultTtl?: number;
  entries?: Iterable<readonly [K, V]> | Map<K, V>;
  /** How often the background purge runs (ms). Defaults to defaultTtl. */
  checkInterval?: number;
  maxSize?: number;
  /** Eviction strategy once maxSize is reached. Defaults to "fifo". */
  strategy?: Strategy;
};

type Metadata = {
  /** Time of the last write (ms since epoch). Expiry = insertedAt + ttl. */
  insertedAt: number;
  /** Lifetime in ms, measured from insertedAt. Undefined/Infinity = never expires. */
  ttl?: number;
  frequency?: number;
};

/**
 * `ExpiredMap<K, V>` extends `Map<K, V>` with per-entry TTL expiration and optional bounded-size
 * eviction (`fifo` | `lru` | `lfu`). Expired entries are dropped lazily by `get`/`has`, or swept
 * in the background after `start()` is called. A new instance never arms a timer; call `start()`
 * to sweep in the background.
 *
 * @param {Options<K, V>} [options] - Construction options. Omitted means a default 5 minute TTL, unbounded size, and no timer armed.
 * @param {number} [options.defaultTtl=300000] - Default TTL in ms applied by set(). Infinity means entries never expire.
 * @param {Iterable<Array<K, V>> | Map<K, V>} [options.entries] - Initial entries (iterable of `[key, value]` pairs, or a `Map`), each set with defaultTtl.
 * @param {number} [options.checkInterval] - How often the background sweep runs (ms). Defaults to defaultTtl. Must be >= 1, else RangeError. start() is a no-op when Infinity.
 * @param {number} [options.maxSize=Infinity] - Max live entries. Must be >= 1, else RangeError. Infinity means unbounded: no eviction happens, although `lru` hits still move keys to the end of iteration order and `lfu` still counts them.
 * @param {string} [options.strategy='fifo'] - Eviction policy once maxSize is reached: `fifo` evicts the entry with the oldest insertedAt (set() refreshes it), `lru` evicts the least recently used, `lfu` evicts the least frequently used (ties break oldest-first).
 * @example @lang ts
 * import { ExpiredMap } from "expired-map";
 * const cache = new ExpiredMap<string, string>();
 * cache.set("session", "abc");
 * cache.get("session"); // "abc"
 */
export class ExpiredMap<K, V> extends Map<K, V> {
  private interval: ReturnType<typeof setInterval> | undefined;
  private isPurgingExpired = false;

  private readonly metadata = new Map<K, Metadata>();
  private readonly defaultTtl: number;
  private readonly checkInterval: number;
  private readonly maxSize: number;
  private readonly strategy: Strategy;

  constructor({
    defaultTtl = 300000,
    entries,
    checkInterval,
    maxSize = Infinity,
    strategy = "fifo",
  }: Options<K, V> = {}) {
    super();
    if (Number.isNaN(maxSize) || maxSize < 1)
      throw new RangeError("maxSize must be >= 1");

    this.checkInterval = checkInterval ?? defaultTtl;
    if (Number.isNaN(this.checkInterval) || this.checkInterval < 1)
      throw new RangeError("checkInterval must be >= 1");

    this.defaultTtl = defaultTtl;
    this.maxSize = maxSize;
    this.strategy = strategy;

    if (entries) {
      for (const [key, value] of entries) this.set(key, value);
    }
  }

  /**
   * Starts the background sweep; it is idempotent, its timer is unref'd so it does not keep the Node process alive, and it is a no-op when checkInterval is Infinity.
   *
   * @returns {this} The instance, for chaining.
   */
  start() {
    if (this.interval || this.checkInterval === Infinity) return this;
    this.interval = setInterval(() => this.purgeExpired(), this.checkInterval);
    // Don't keep the Node process alive just for this timer
    this.interval.unref?.();
    return this;
  }

  /**
   * Stores a value with a TTL, replacing any live entry at the key and evicting when the map is full.
   *
   * @param key - The key to set.
   * @param value - The value to store.
   * @param [ttl] - Per-entry TTL in ms. Defaults to defaultTtl; Infinity never expires. Must be a non-negative number, else RangeError. Re-setting a live key refreshes insertedAt; setting an expired key replaces it.
   * @returns {this} The instance, for chaining.
   * @throws {RangeError} - When ttl is negative or NaN.
   */
  override set(key: K, value: V, ttl = this.defaultTtl) {
    if (Number.isNaN(ttl) || ttl < 0)
      throw new RangeError("ttl must be a non-negative number");

    const now = Date.now();
    const existing = this.metadata.get(key);

    if (existing && !this.isExpired(key, now)) {
      // Overwriting restarts the entry's lifetime
      existing.insertedAt = now;
      existing.ttl = ttl === Infinity ? undefined : ttl;
      if (this.strategy === "lfu") {
        existing.frequency = existing.frequency! + 1;
      } else if (this.strategy === "lru") {
        super.delete(key);
      }
      return super.set(key, value);
    }

    if (existing) this.delete(key);
    if (this.maxSize !== Infinity && this.size >= this.maxSize) this.evict();

    const newMetadata: Metadata = { insertedAt: now };
    if (this.strategy === "lfu") newMetadata.frequency = 1;
    if (ttl !== Infinity) newMetadata.ttl = ttl;

    this.metadata.set(key, newMetadata);
    super.set(key, value);
    return this;
  }

  /**
   * Returns the stored value, deleting the entry first if it has expired.
   *
   * On a hit, `lru` moves the key to the end of Map iteration order and `lfu` increments its frequency; the order shift is visible in iteration even when unbounded, and it only matters for eviction once `maxSize` is reached. A read never extends a TTL.
   *
   * @param key - The key to read.
   * @returns {V | undefined} The stored value, or undefined when the key is missing or expired.
   */
  override get(key: K) {
    const meta = this.metadata.get(key);
    if (!meta) return;

    if (this.isExpired(key)) {
      this.delete(key);
      return;
    }

    const value = super.get(key);

    if (this.strategy === "lru") {
      super.delete(key);
      super.set(key, value as V);
    } else if (this.strategy === "lfu") {
      meta.frequency = meta.frequency! + 1;
    }

    return value;
  }

  /**
   * Returns whether a live entry exists; an expired entry is deleted and counts as missing.
   *
   * Does not affect `lru` or `lfu` order.
   *
   * @param key - The key to check.
   * @returns {boolean} True when a live entry exists.
   */
  override has(key: K) {
    if (this.isExpired(key)) {
      this.delete(key);
      return false;
    }
    return super.has(key);
  }

  /**
   * Removes the value and its metadata.
   *
   * @param key - The key to delete.
   * @returns {boolean} True when an entry was removed.
   */
  override delete(key: K) {
    this.metadata.delete(key);
    return super.delete(key);
  }

  /**
   * Removes all values and metadata; the background timer, if running, keeps running.
   */
  override clear() {
    this.metadata.clear();
    super.clear();
  }

  /**
   * Stops the background sweep; no-op if it is not running.
   *
   * @returns {this} The instance, for chaining.
   */
  stop() {
    if (this.interval) {
      clearInterval(this.interval);
      this.interval = undefined;
    }
    return this;
  }

  private isExpired(key: K, now = Date.now()) {
    const meta = this.metadata.get(key);
    // NB: ttl 0 must expire immediately, so compare against undefined
    // instead of relying on truthiness.
    return meta?.ttl !== undefined && now - meta.insertedAt >= meta.ttl;
  }

  private purgeExpired() {
    if (this.isPurgingExpired) return;

    this.isPurgingExpired = true;
    try {
      const now = Date.now();
      for (const [key, { insertedAt, ttl }] of this.metadata) {
        if (ttl !== undefined && now - insertedAt >= ttl) this.delete(key);
      }
    } finally {
      this.isPurgingExpired = false;
    }
  }

  /**
   * Make room for one new entry.
   * @private
   */
  private evict() {
    // Expired entries are free to drop, so clear those first
    this.purgeExpired();
    if (this.size < this.maxSize) return;

    let victim: K | undefined;

    if (this.strategy === "lru") {
      // Map order is least recently used first (get/set re-inserts at the end)
      const first = super.keys().next();
      if (!first.done) victim = first.value;
    } else {
      // lfu: lowest frequency, ties broken by oldest insertedAt
      // fifo: oldest insertedAt
      const lfu = this.strategy === "lfu";
      let minFreq = Infinity;
      let minInserted = Infinity;
      for (const [key, { frequency, insertedAt }] of this.metadata) {
        const freq = lfu ? frequency! : 0;
        if (freq < minFreq || (freq === minFreq && insertedAt < minInserted)) {
          minFreq = freq;
          minInserted = insertedAt;
          victim = key;
        }
      }
    }

    if (victim || super.has(victim as K)) this.delete(victim as K);
  }
}
