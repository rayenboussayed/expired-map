type Strategy = "lru" | "lfu";

type Options<K, V> = {
  defaultTtl?: number;
  entries?: Iterable<readonly [K, V]> | Map<K, V>;
  checkInterval?: number;
  maxSize?: number;
  strategy?: Strategy;
};

type Metadata = {
  expiresAt: number;
  frequency: number;
};

export class MapTtl<K, V> extends Map<K, V> {
  private interval: ReturnType<typeof setInterval> | undefined;
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
    strategy = "lru",
  }: Options<K, V> = {}) {
    super();
    if (!(maxSize >= 1)) throw new RangeError("maxSize must be >= 1");

    this.defaultTtl = defaultTtl;
    this.maxSize = maxSize;
    this.strategy = strategy;
    this.checkInterval = checkInterval ?? defaultTtl;

    if (entries) {
      for (const [key, value] of entries) {
        this.set(key, value);
      }
    }
  }

  start() {
    if (this.interval) return this;

    this.interval = setInterval(() => this.purgeExpired(), this.checkInterval);
    // Don't keep the Node process alive just for this timer
    this.interval.unref?.();
    return this;
  }

  set(key: K, value: V, ttl = this.defaultTtl) {
    const existing = this.metadata.get(key);

    if (existing && !this.isExpired(key)) {
      // Overwrite: refresh TTL and move to the end (most recently used).
      // An overwrite counts as a use for LFU.
      existing.expiresAt = Date.now() + ttl;
      if (this.strategy === "lfu") existing.frequency++;
      if (this.strategy === "lru") super.delete(key);
      return super.set(key, value);
    }

    // New key (or expired one being replaced)
    if (existing) this.delete(key);
    if (this.size >= this.maxSize) this.evict();

    this.metadata.set(key, { expiresAt: Date.now() + ttl, frequency: 1 });
    return super.set(key, value);
  }

  get(key: K) {
    const meta = this.metadata.get(key);
    if (!meta) return;

    if (Date.now() >= meta.expiresAt) {
      this.delete(key);
      return;
    }

    const value = super.get(key);

    if (this.strategy === "lru") {
      // Move to the end of the iteration order (most recently used)
      super.delete(key);
      super.set(key, value as V);
    } else if (this.strategy === "lfu") {
      meta.frequency++;
    }

    return value;
  }

  has(key: K) {
    if (this.isExpired(key)) {
      this.delete(key);
      return false;
    }
    return super.has(key);
  }

  delete(key: K) {
    this.metadata.delete(key);
    return super.delete(key);
  }

  clear() {
    this.metadata.clear();
    super.clear();
  }

  stop() {
    if (this.interval) {
      clearInterval(this.interval);
      this.interval = undefined;
    }
  }

  private isExpired(key: K) {
    const meta = this.metadata.get(key);
    return meta && Date.now() >= meta.expiresAt;
  }

  private purgeExpired() {
    const now = Date.now();
    for (const [key, { expiresAt }] of this.metadata) {
      if (now >= expiresAt) this.delete(key);
    }
  }

  /** Make room for one new entry. */
  private evict() {
    // Expired entries are free to drop, so clear those first
    this.purgeExpired();
    if (this.size < this.maxSize) return;

    // Map iterates in insertion order, which we maintain as:
    //   lru  -> least recently used first (get/set re-inserts at the end)
    //   lfu  -> ties on frequency are broken by oldest first
    let victim: K | undefined;

    if (this.strategy === "lfu") {
      let min = Infinity;
      for (const [key, { frequency }] of this.metadata) {
        if (frequency < min) {
          min = frequency;
          victim = key;
        }
      }
    } else {
      victim = super.keys().next().value;
    }

    if (victim || super.has(victim as K)) {
      this.delete(victim as K);
    }
  }
}
