import { ExpiredMap } from '../dist/index.js';

// Seeded entries each get defaultTtl; eviction applies if over maxSize.
const cache = new ExpiredMap({
  defaultTtl: 10_000,
  entries: [
    ['a', 1],
    ['b', 2],
  ],
});
console.log('seeded keys:', [...cache.keys()]); // ['a', 'b']

const bounded = new ExpiredMap({
  defaultTtl: 10_000,
  maxSize: 2,
  entries: [
    ['a', 1],
    ['b', 2],
    ['c', 3], // evicts 'a' (default lru, no reads yet => insertion order)
  ],
});
console.log('bounded has(a):', bounded.has('a')); // false
console.log('bounded keys:', [...bounded.keys()]); // ['b', 'c']

// A Map instance is accepted too — handy for cloning with a fresh TTL.
const source = new Map([
  ['x', 10],
  ['y', 20],
]);
const cloned = new ExpiredMap({ defaultTtl: 10_000, entries: source });
console.log('cloned keys:', [...cloned.keys()]); // ['x', 'y']
console.log('cloned get(x):', cloned.get('x')); // 10

cache.stop();
bounded.stop();
cloned.stop();
