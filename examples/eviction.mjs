import { ExpiredMap } from '../dist/index.js';

// FIFO is the default: evicts oldest inserted, reads don't affect order.
const fifo = new ExpiredMap({ maxSize: 2 });
fifo.set('a', 1);
fifo.set('b', 2);
fifo.get('a'); // no effect under fifo
fifo.set('c', 3); // evicts 'a'
console.log('fifo has(a):', fifo.has('a')); // false
console.log('fifo keys:', [...fifo.keys()]); // ['b', 'c']
fifo.stop();

// LRU: get() marks a key most-recently-used.
const lru = new ExpiredMap({ maxSize: 2, strategy: 'lru' });
lru.set('a', 1);
lru.set('b', 2);
lru.get('a'); // 'a' is now MRU
lru.set('c', 3); // evicts 'b'
console.log('lru has(b):', lru.has('b')); // false
console.log('lru keys:', [...lru.keys()]); // ['a', 'c']
lru.stop();

// LFU: evicts lowest frequency, ties break oldest-first.
const lfu = new ExpiredMap({ maxSize: 2, strategy: 'lfu' });
lfu.set('a', 1);
lfu.set('b', 2);
lfu.get('a');
lfu.get('a'); // 'a' frequency = 3, 'b' = 1
lfu.set('c', 3); // evicts 'b'
console.log('lfu has(b):', lfu.has('b')); // false
console.log('lfu keys:', [...lfu.keys()]); // ['a', 'c']
lfu.stop();

// maxSize < 1 throws.
try {
  new ExpiredMap({ maxSize: 0 });
  console.log('maxSize validation: NOT THROWN (unexpected)');
} catch (e) {
  console.log('maxSize validation:', e instanceof RangeError); // true
}
