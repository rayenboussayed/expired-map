import { ExpiredMap } from '../dist/index.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const cache = new ExpiredMap({ defaultTtl: 500 });

cache.set('fast', 1, 60); // expires in 60ms
cache.set('slow', 2); // expires in 500ms (defaultTtl)

await sleep(150);

console.log('fast (expired):', cache.get('fast')); // undefined
console.log('slow (alive):', cache.get('slow')); // 2

// Re-setting a live key refreshes its TTL.
cache.set('slow', 2, 500);
await sleep(150);
console.log('slow after refresh (alive):', cache.get('slow')); // 2

cache.stop();
