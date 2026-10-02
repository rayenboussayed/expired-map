import { MapTtl } from '../dist/index.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Default TTL is 300_000 (5 min); use a short one so the demo runs fast.
const cache = new MapTtl({ defaultTtl: 120 });

cache.set('session', 'abc');
console.log('get(session):', cache.get('session')); // 'abc'
console.log('has(session):', cache.has('session')); // true

await sleep(200);

console.log('after TTL get(session):', cache.get('session')); // undefined
console.log('after TTL has(session):', cache.has('session')); // false

cache.stop();
