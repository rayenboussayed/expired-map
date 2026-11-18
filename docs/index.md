<a name="ExpiredMap"></a>

## ExpiredMap
`ExpiredMap<K, V>` extends `Map<K, V>` with per-entry TTL expiration and optional bounded-size
eviction (`fifo` | `lru` | `lfu`). Expired entries are dropped lazily by `get`/`has`, or swept
in the background after `start()` is called. A new instance never arms a timer; call `start()`
to sweep in the background.

**Kind**: global class  
src: src/index.ts:40  
dist: dist/index.js:19

* [ExpiredMap](#ExpiredMap)
    * [new ExpiredMap([options])](#new_ExpiredMap_new)
    * [.start()](#ExpiredMap+start) ⇒ <code>this</code>
    * [.set(key, value, [ttl])](#ExpiredMap+set) ⇒ <code>this</code>
    * [.get(key)](#ExpiredMap+get) ⇒ <code>V</code>
    * [.has(key)](#ExpiredMap+has) ⇒ <code>boolean</code>
    * [.delete(key)](#ExpiredMap+delete) ⇒ <code>boolean</code>
    * [.clear()](#ExpiredMap+clear)
    * [.stop()](#ExpiredMap+stop) ⇒ <code>this</code>

<a name="new_ExpiredMap_new"></a>

### new ExpiredMap([options])

| Param | Type | Default | Description |
| --- | --- | --- | --- |
| [options] | <code>Options.&lt;K, V&gt;</code> |  | Construction options. Omitted means a default 5 minute TTL, unbounded size, and no timer armed. |
| [options.defaultTtl] | <code>number</code> | <code>300000</code> | Default TTL in ms applied by set(). Infinity means entries never expire. |
| [options.entries] | <code>Iterable.&lt;Array.&lt;K, V&gt;&gt;</code> \| <code>Map.&lt;K, V&gt;</code> |  | Initial entries (iterable of `[key, value]` pairs, or a `Map`), each set with defaultTtl. |
| [options.checkInterval] | <code>number</code> | <code>defaultTtl</code> | How often the background sweep runs (ms). Defaults to defaultTtl. Must be >= 1, else RangeError. start() is a no-op when Infinity. |
| [options.maxSize] | <code>number</code> | <code>Infinity</code> | Max live entries. Must be >= 1, else RangeError. Infinity means unbounded: no eviction happens, although `lru` hits still move keys to the end of iteration order and `lfu` still counts them. |
| [options.strategy] | <code>string</code> | <code>&quot;fifo&quot;</code> | Eviction policy once maxSize is reached: must be one of `fifo`, `lru`, `lfu`. `fifo` evicts the entry with the oldest insertedAt (set() refreshes it), `lru` evicts the least recently used, `lfu` evicts the least frequently used (ties break oldest-first). |

**Example**  
```ts
import { ExpiredMap } from "expired-map";
const cache = new ExpiredMap<string, string>();
cache.set("session", "abc");
cache.get("session"); // "abc"
```
<a name="ExpiredMap+start"></a>

### expiredMap.start() ⇒ <code>this</code>
Starts the background sweep; it is idempotent, its timer is unref'd so it does not keep the Node process alive, and it is a no-op when checkInterval is Infinity.

**Kind**: instance method of [<code>ExpiredMap</code>](#ExpiredMap)  
**Returns**: <code>this</code> - The instance, for chaining.  
src: src/index.ts:79  
dist: dist/index.js:42
<a name="ExpiredMap+set"></a>

### expiredMap.set(key, value, [ttl]) ⇒ <code>this</code>
Stores a value with a TTL, replacing any live entry at the key and evicting when the map is full.

**Kind**: instance method of [<code>ExpiredMap</code>](#ExpiredMap)  
**Returns**: <code>this</code> - The instance, for chaining.  
**Throws**:

- <code>RangeError</code> - When ttl is negative or NaN.


| Param | Type | Description |
| --- | --- | --- |
| key | <code>K</code> | The key to set. |
| value | <code>V</code> | The value to store. |
| [ttl] | <code>number</code> | Per-entry TTL in ms. Defaults to defaultTtl; Infinity never expires. Must be a non-negative number, else RangeError. Re-setting a live key refreshes insertedAt; setting an expired key replaces it. |

src: src/index.ts:96  
dist: dist/index.js:60
<a name="ExpiredMap+get"></a>

### expiredMap.get(key) ⇒ <code>V</code>
Returns the stored value, deleting the entry first if it has expired.

On a hit, `lru` moves the key to the end of Map iteration order and `lfu` increments its frequency; the order shift is visible in iteration even when unbounded, and it only matters for eviction once `maxSize` is reached. A read never extends a TTL.

**Kind**: instance method of [<code>ExpiredMap</code>](#ExpiredMap)  
**Returns**: <code>V</code> - The stored value, or undefined when the key is missing or expired.  

| Param | Type | Description |
| --- | --- | --- |
| key | <code>K</code> | The key to read. |

src: src/index.ts:135  
dist: dist/index.js:98
<a name="ExpiredMap+has"></a>

### expiredMap.has(key) ⇒ <code>boolean</code>
Returns whether a live entry exists; an expired entry is deleted and counts as missing.

Does not affect `lru` or `lfu` order.

**Kind**: instance method of [<code>ExpiredMap</code>](#ExpiredMap)  
**Returns**: <code>boolean</code> - True when a live entry exists.  

| Param | Type | Description |
| --- | --- | --- |
| key | <code>K</code> | The key to check. |

src: src/index.ts:164  
dist: dist/index.js:124
<a name="ExpiredMap+delete"></a>

### expiredMap.delete(key) ⇒ <code>boolean</code>
Removes the value and its metadata.

**Kind**: instance method of [<code>ExpiredMap</code>](#ExpiredMap)  
**Returns**: <code>boolean</code> - True when an entry was removed.  

| Param | Type | Description |
| --- | --- | --- |
| key | <code>K</code> | The key to delete. |

src: src/index.ts:178  
dist: dist/index.js:137
<a name="ExpiredMap+clear"></a>

### expiredMap.clear()
Removes all values and metadata; the background timer, if running, keeps running.

**Kind**: instance method of [<code>ExpiredMap</code>](#ExpiredMap)  
src: src/index.ts:186  
dist: dist/index.js:144
<a name="ExpiredMap+stop"></a>

### expiredMap.stop() ⇒ <code>this</code>
Stops the background sweep; no-op if it is not running.

**Kind**: instance method of [<code>ExpiredMap</code>](#ExpiredMap)  
**Returns**: <code>this</code> - The instance, for chaining.  
src: src/index.ts:196  
dist: dist/index.js:153
