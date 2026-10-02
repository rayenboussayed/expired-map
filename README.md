# expired-map

A `Map` with per-entry TTL expiration and optional bounded-size eviction (`fifo` / `lru` / `lfu`). Drop-in replacement for `Map` that auto-deletes stale keys.

Repository: https://github.com/rayenboussayed/expired-map

## Features

- `Map`-compatible `get` / `set` / `has` / `delete` / `clear`
- Per-entry TTL (absolute, set at `set()` time)
- Lazy expiry on `get()` / `has()` + optional background sweep via `start()`
- Bounded cache with `maxSize` + `fifo` / `lru` / `lfu` eviction
- `unref()`ed timer so it never keeps Node alive on its own

## Install

```bash
npm install expired-map
```

Requires Node 18+ (uses `setInterval(...).unref?.()`).

## Usage

### Basic (default 5 min TTL)

```ts
import { ExpiredMap } from 'expired-map';

const cache = new ExpiredMap<string, string>(); // defaultTtl = 300_000 (5 min)
// or: new ExpiredMap<string, string>({ defaultTtl: 60_000 });

cache.set('session', 'abc');
cache.get('session'); // 'abc'
cache.has('session'); // true

// after TTL (5 min by default):
cache.get('session'); // undefined (auto-deleted)
cache.has('session'); // false
```

### Per-key TTL override

`set(key, value, ttl?)` defaults to `defaultTtl` (ms). Re-setting a live key refreshes its TTL:

```ts
const cache = new ExpiredMap<string, number>({ defaultTtl: 60_000 });

cache.set('fast', 1, 1_000);   // expires in 1s
cache.set('slow', 2);          // expires in 60s
cache.set('slow', 2, 120_000); // reset value + expiry to 120s
cache.set('forever', 3, Infinity); // never expires
```

### Bounded cache with eviction

`maxSize` defaults to `Infinity` (unbounded). When full, one entry is evicted to make room. Expired entries are purged first, so they never force out live data:

```ts
const fifo = new ExpiredMap<string, number>({ maxSize: 2 }); // fifo is the default
fifo.set('a', 1);
fifo.set('b', 2);
fifo.get('a');    // reads don't affect fifo order
fifo.set('c', 3); // evicts 'a' (oldest inserted)
fifo.has('a'); // false

const lru = new ExpiredMap<string, number>({ maxSize: 2, strategy: 'lru' });
lru.set('a', 1);
lru.set('b', 2);
lru.get('a');    // 'a' is now most-recently-used
lru.set('c', 3); // evicts 'b'
lru.has('b'); // false

const lfu = new ExpiredMap<string, number>({ maxSize: 2, strategy: 'lfu' });
lfu.set('a', 1);
lfu.set('b', 2);
lfu.get('a');
lfu.get('a');    // 'a' frequency = 3, 'b' = 1
lfu.set('c', 3); // evicts 'b' (lowest frequency, ties break oldest-first)
```

`maxSize < 1` throws `RangeError`.

### Background sweep with `start()` / `stop()`

No timer runs by default — expiry is lazy (`get()` / `has()` delete on access). Call `start()` to also sweep in the background:

```ts
const cache = new ExpiredMap<string, number>({
  defaultTtl: 10_000,
  checkInterval: 1_000, // sweep every 1s (default: defaultTtl)
});

cache.start(); // idempotent, chainable; timer is unref'ed
// ... expired keys are purged even without reads
cache.stop(); // use on shutdown / in tests to clear the interval
```

### Seed entries

```ts
const cache = new ExpiredMap<string, number>({
  defaultTtl: 10_000,
  entries: [['a', 1], ['b', 2]], // each seeded with defaultTtl (eviction applies if over maxSize)
});

// a Map works too — handy for cloning with a fresh TTL:
const source = new Map<string, number>([['a', 1], ['b', 2]]);
const cloned = new ExpiredMap<string, number>({ defaultTtl: 10_000, entries: source });
```

## Examples

Runnable demos live in [`examples/`](./examples) (run from the package root, imports from `dist/`):

```bash
node examples/basic.mjs
node examples/per-key-ttl.mjs
node examples/eviction.mjs
node examples/sweep.mjs
node examples/entries.mjs
```

## API

### `new ExpiredMap({ defaultTtl?, entries?, checkInterval?, maxSize?, strategy? } = {})`

All options optional — `new ExpiredMap()` uses 5 min TTL, unbounded (no eviction tracking). When bounded via `maxSize`, `strategy` defaults to `'fifo'`; pass `'lru'` or `'lfu'` explicitly for recency/frequency tracking. `defaultTtl: Infinity` means entries never expire (background purge is skipped).

| Option | Type | Default | Description |
| --- | --- | --- | --- |
| `defaultTtl` | `number` | `300_000` (5 min) | Default TTL in ms applied by `set()`; `Infinity` = never expires |
| `entries` | `Iterable<readonly [K, V]> \| Map<K, V>` | — | Initial entries, each set with `defaultTtl` |
| `checkInterval` | `number` | `defaultTtl` | Background sweep period in ms (used by `start()`); must be `>= 1`, else `RangeError`; `start()` is a no-op when it is `Infinity` |
| `maxSize` | `number` | `Infinity` | Max live entries; must be `>= 1`, else `RangeError`; `Infinity` = unbounded (strategy tracking skipped) |
| `strategy` | `'fifo' \| 'lru' \| 'lfu'` | `'fifo'` (when bounded; `undefined` when unbounded) | Eviction policy when bounded |

### Methods

| Method | Behavior |
| --- | --- |
| `set(key, value, ttl = defaultTtl)` | Store value, expiry = `Date.now() + ttl`; live-key overwrite refreshes TTL (expired-key overwrite replaces it with frequency reset); evicts if full |
| `get(key)` | Returns `undefined` + deletes if expired/missing; on hit, `lru` re-inserts as MRU, `lfu` bumps frequency (both skipped when unbounded) |
| `has(key)` | Returns `false` + deletes if expired, else `Map.has` (does not affect `lru`/`lfu` recency) |
| `delete(key)` | Removes value + its metadata |
| `clear()` | Removes all values + metadata (timer keeps running) |
| `start()` | Starts background `purgeExpired()` sweep; no-op if running; returns `this` |
| `stop()` | Stops background sweep; no-op if not running |

Expiry is absolute from `set()` — `get()` does not extend TTL (it only affects eviction order/frequency).

Eviction order: `fifo` evicts oldest-inserted (reads don't affect it); `lru` moves a key to the end on `get()` and on `set()`-overwrite; `lfu` counts `set()`-overwrite and `get()` as uses, ties break oldest-first.

## How expiration and eviction work

1. Lazy: `get()` / `has()` check expiry on access (`src/index.ts`).
2. Sweep: `start()` runs `purgeExpired()` every `checkInterval`.
3. Eviction: `set()` on a full cache calls `purgeExpired()` first, then evicts one victim per `strategy`.

## Caveats

- `size`, `keys()`, `values()`, `entries()`, `forEach`, `for...of` do **not** filter expired keys — an expired but unswept/unaccessed key still shows up until the sweep, a `get()`/`has()`, or the next evicting `set()`.
- No remaining-TTL getter, no expire callback.
- `clear()` does not stop the timer — call `stop()` explicitly.
