import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { MapTtl } from './index.ts';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe('constructor', () => {
  it('works with no options (5 min default, unbounded, lru)', () => {
    const cache = new MapTtl<string, string>();
    cache.set('k', 'v');
    assert.equal(cache.get('k'), 'v');
    assert.equal(cache.has('k'), true);
    assert.equal(cache.size, 1);
    cache.stop();
  });

  it('throws RangeError for maxSize < 1', () => {
    assert.throws(() => new MapTtl({ maxSize: 0 }), RangeError);
    assert.throws(() => new MapTtl({ maxSize: -5 }), RangeError);
  });

  it('seeds entries from an array', () => {
    const cache = new MapTtl<string, number>({
      defaultTtl: 10_000,
      entries: [
        ['a', 1],
        ['b', 2],
      ],
    });
    assert.deepEqual([...cache.keys()], ['a', 'b']);
    cache.stop();
  });

  it('seeds entries from a Map', () => {
    const source = new Map<string, number>([
      ['x', 10],
      ['y', 20],
    ]);
    const cache = new MapTtl<string, number>({ defaultTtl: 10_000, entries: source });
    assert.equal(cache.get('x'), 10);
    assert.equal(cache.get('y'), 20);
    cache.stop();
  });

  it('applies eviction while seeding over maxSize', () => {
    const cache = new MapTtl<string, number>({
      defaultTtl: 10_000,
      maxSize: 2,
      entries: [
        ['a', 1],
        ['b', 2],
        ['c', 3],
      ],
    });
    assert.equal(cache.has('a'), false);
    assert.deepEqual([...cache.keys()], ['b', 'c']);
    cache.stop();
  });
});

describe('ttl expiry', () => {
  it('expires entries after defaultTtl (lazy, no start needed)', async () => {
    const cache = new MapTtl<string, number>({ defaultTtl: 50 });
    cache.set('x', 1);
    assert.equal(cache.get('x'), 1);
    await sleep(120);
    assert.equal(cache.get('x'), undefined);
    assert.equal(cache.has('x'), false);
    assert.equal(cache.size, 0);
    cache.stop();
  });

  it('supports per-key ttl override', async () => {
    const cache = new MapTtl<string, number>({ defaultTtl: 500 });
    cache.set('fast', 1, 50);
    cache.set('slow', 2);
    await sleep(150);
    assert.equal(cache.get('fast'), undefined);
    assert.equal(cache.get('slow'), 2);
    cache.stop();
  });

  it('refreshes ttl on overwrite of a live key', async () => {
    const cache = new MapTtl<string, number>({ defaultTtl: 120 });
    cache.set('k', 1);
    await sleep(80);
    cache.set('k', 2); // refresh
    await sleep(80);
    assert.equal(cache.get('k'), 2);
    await sleep(120);
    assert.equal(cache.get('k'), undefined);
    cache.stop();
  });

  it('get on missing key returns undefined', () => {
    const cache = new MapTtl<string, number>();
    assert.equal(cache.get('missing'), undefined);
    assert.equal(cache.has('missing'), false);
    cache.stop();
  });
});

describe('delete / clear', () => {
  it('delete removes value and metadata', () => {
    const cache = new MapTtl<string, number>({ defaultTtl: 10_000 });
    cache.set('k', 1);
    assert.equal(cache.delete('k'), true);
    assert.equal(cache.has('k'), false);
    assert.equal(cache.size, 0);
    cache.stop();
  });

  it('clear empties the map', () => {
    const cache = new MapTtl<string, number>({ defaultTtl: 10_000 });
    cache.set('a', 1);
    cache.set('b', 2);
    cache.clear();
    assert.equal(cache.size, 0);
    cache.stop();
  });
});

describe('eviction', () => {
  it('lru evicts least recently used', () => {
    const cache = new MapTtl<string, number>({ maxSize: 2, strategy: 'lru' });
    cache.set('a', 1);
    cache.set('b', 2);
    cache.get('a'); // 'a' is now MRU
    cache.set('c', 3); // evicts 'b'
    assert.equal(cache.has('b'), false);
    assert.equal(cache.has('a'), true);
    assert.equal(cache.has('c'), true);
    cache.stop();
  });

  it('lfu evicts lowest frequency, ties break oldest-first', () => {
    const cache = new MapTtl<string, number>({ maxSize: 2, strategy: 'lfu' });
    cache.set('a', 1);
    cache.set('b', 2);
    cache.get('a');
    cache.get('a'); // a:3, b:1
    cache.set('c', 3); // evicts 'b'
    assert.equal(cache.has('b'), false);
    assert.equal(cache.has('a'), true);
    cache.stop();
  });

  it('has() does not affect lru recency', () => {
    const cache = new MapTtl<string, number>({ maxSize: 2, strategy: 'lru' });
    cache.set('a', 1);
    cache.set('b', 2);
    cache.has('a'); // must not refresh
    cache.set('c', 3); // evicts 'a'
    assert.equal(cache.has('a'), false);
    cache.stop();
  });

  it('purges expired entries before evicting live ones', async () => {
    const cache = new MapTtl<string, number>({ defaultTtl: 10_000, maxSize: 2 });
    cache.set('stale', 1, 40);
    cache.set('live', 2);
    await sleep(100);
    cache.set('new', 3); // 'stale' purged first, no live eviction
    assert.equal(cache.has('live'), true);
    assert.equal(cache.has('new'), true);
    assert.equal(cache.size, 2);
    cache.stop();
  });
});

describe('background sweep', () => {
  it('does not sweep without start()', async () => {
    const cache = new MapTtl<string, number>({ defaultTtl: 40 });
    cache.set('z', 1);
    await sleep(100);
    assert.equal(cache.size, 1); // expired but unswept
    assert.equal(cache.get('z'), undefined); // deleted on access
    cache.stop();
  });

  it('start() purges expired keys without reads; stop() halts it', async () => {
    const cache = new MapTtl<string, number>({ defaultTtl: 50, checkInterval: 20 });
    cache.set('t', 1);
    const returned = cache.start();
    assert.equal(returned, cache); // chainable
    await sleep(150);
    assert.equal(cache.size, 0);
    cache.stop();
  });

  it('start() is idempotent', () => {
    const cache = new MapTtl<string, number>({ defaultTtl: 10_000 });
    assert.equal(cache.start(), cache);
    assert.equal(cache.start(), cache);
    cache.stop();
  });
});
