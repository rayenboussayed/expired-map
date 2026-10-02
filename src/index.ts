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

  start() {
    if (this.interval || this.checkInterval === Infinity) return this;
    this.interval = setInterval(() => this.purgeExpired(), this.checkInterval);
    // Don't keep the Node process alive just for this timer
    this.interval.unref?.();
    return this;
  }

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

  override has(key: K) {
    if (this.isExpired(key)) {
      this.delete(key);
      return false;
    }
    return super.has(key);
  }

  override delete(key: K) {
    this.metadata.delete(key);
    return super.delete(key);
  }

  override clear() {
    this.metadata.clear();
    super.clear();
  }

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

  /** Make room for one new entry. */
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
