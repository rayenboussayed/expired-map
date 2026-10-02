import { ExpiredMap } from '../dist/index.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// No timer runs by default: expired keys linger until get()/has()/evict.
const lazy = new ExpiredMap({ defaultTtl: 50 });
lazy.set('z', 1);
await sleep(100);
console.log('no-start size (expired, unswept):', lazy.size); // 1
console.log('lazy get(z):', lazy.get('z')); // undefined (deleted on access)
console.log('size after get:', lazy.size); // 0
lazy.stop();

// start() purges expired keys even without reads.
const swept = new ExpiredMap({ defaultTtl: 50, checkInterval: 20 });
swept.set('t', 1);
swept.start(); // idempotent, chainable; timer is unref'ed
await sleep(120);
console.log('swept size (no reads needed):', swept.size); // 0
swept.stop();
