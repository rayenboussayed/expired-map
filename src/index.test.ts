import { test, mock, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { ExpiredMap } from "./index.ts";

beforeEach(() =>
  mock.timers.enable({ apis: ["Date", "setInterval"], now: 1_000 }),
);
afterEach(() => mock.timers.reset());
const tick = (ms: number) => mock.timers.tick(ms);

test("finite ttl expires based on insertedAt", () => {
  const m = new ExpiredMap<string, number>({ defaultTtl: 100 });
  m.set("a", 1);
  tick(99);
  assert.equal(m.get("a"), 1);
  tick(1);
  assert.equal(m.get("a"), undefined);
  assert.equal(m.size, 0);
});

test("Infinity defaultTtl never expires", () => {
  const m = new ExpiredMap<string, number>({ defaultTtl: Infinity });
  m.set("a", 1);
  tick(1e12);
  assert.equal(m.has("a"), true);
  assert.equal(m.get("a"), 1);
});

test("per-call Infinity ttl overrides finite default", () => {
  const m = new ExpiredMap<string, number>({ defaultTtl: 100 });
  m.set("forever", 1, Infinity);
  m.set("temp", 2);
  tick(1000);
  assert.equal(m.get("forever"), 1);
  assert.equal(m.get("temp"), undefined);
});

test("per-call finite ttl overrides Infinity default (purge must still run)", () => {
  const m = new ExpiredMap<string, number>({
    defaultTtl: Infinity,
    checkInterval: 50,
  });
  m.start();
  m.set("temp", 1, 100);
  m.set("keep", 2);
  tick(150);
  assert.equal(m.size, 1); // purged by interval, not just lazily
  assert.equal(m.get("keep"), 2);
  m.stop();
});

test("overwriting resets insertedAt and ttl", () => {
  const m = new ExpiredMap<string, number>({ defaultTtl: 100 });
  m.set("a", 1);
  tick(80);
  m.set("a", 2);
  tick(80);
  assert.equal(m.get("a"), 2);
  tick(20);
  assert.equal(m.get("a"), undefined);
});

test("set over an expired key replaces it as new", () => {
  const m = new ExpiredMap<string, number>({ defaultTtl: 100 });
  m.set("a", 1);
  tick(100);
  m.set("a", 2);
  assert.equal(m.get("a"), 2);
  assert.equal(m.size, 1);
});

test("background purge removes expired entries", () => {
  const m = new ExpiredMap<string, number>({
    defaultTtl: 100,
    checkInterval: 40,
  });
  m.start();
  m.set("a", 1);
  tick(120);
  assert.equal(m.size, 0);
  m.stop();
});

test("start() is a no-op when checkInterval is Infinity; stop() is safe", () => {
  const m = new ExpiredMap<string, number>({ defaultTtl: Infinity });
  m.start();
  m.stop();
  assert.equal(m.set("a", 1).get("a"), 1);
});

test("LRU eviction", () => {
  const m = new ExpiredMap<string, number>({
    maxSize: 2,
    strategy: "lru",
    defaultTtl: Infinity,
  });
  m.set("a", 1);
  m.set("b", 2);
  m.get("a");
  m.set("c", 3);
  assert.deepEqual([...m.keys()], ["a", "c"]);
});

test("LFU eviction with Infinity ttl; ties go to oldest", () => {
  const m = new ExpiredMap<string, number>({
    maxSize: 2,
    strategy: "lfu",
    defaultTtl: Infinity,
  });
  m.set("a", 1);
  m.set("b", 2);
  m.get("b");
  m.set("c", 3);
  assert.deepEqual([...m.keys()].sort(), ["b", "c"]);
});

test("eviction drops expired entries before live ones", () => {
  const m = new ExpiredMap<string, number>({
    maxSize: 2,
    strategy: "lru",
    defaultTtl: Infinity,
  });
  m.set("old", 1, 50);
  m.set("live", 2);
  tick(60);
  m.set("new", 3);
  assert.deepEqual([...m.keys()].sort(), ["live", "new"]);
});

test("falsy keys (0, undefined) can be evicted", () => {
  const m = new ExpiredMap<number | undefined, string>({
    maxSize: 1,
    strategy: "lru",
    defaultTtl: Infinity,
  });
  m.set(undefined, "u");
  m.set(0, "z");
  assert.equal(m.size, 1);
  assert.equal(m.has(undefined), false);
  assert.equal(m.get(0), "z");
});

test("constructor entries + validation", () => {
  const m = new ExpiredMap<string, number>({
    entries: [
      ["a", 1],
      ["b", 2],
    ],
    defaultTtl: Infinity,
  });
  assert.equal(m.size, 2);
  assert.throws(() => new ExpiredMap({ maxSize: 0 }), RangeError);
});

test("FIFO is the default when maxSize is set without a strategy", () => {
  const m = new ExpiredMap<string, number>({
    maxSize: 2,
    defaultTtl: Infinity,
  });
  m.set("a", 1);
  tick(1);
  m.set("b", 2);
  tick(1);
  m.get("a");
  m.get("a"); // reads must NOT save "a" under FIFO
  m.set("c", 3);
  assert.deepEqual([...m.keys()].sort(), ["b", "c"]);
});

test("explicit fifo evicts lowest insertedAt, ignoring Map order", () => {
  const m = new ExpiredMap<string, number>({
    maxSize: 2,
    strategy: "fifo",
    defaultTtl: Infinity,
  });
  m.set("a", 1);
  tick(5);
  m.set("b", 2);
  tick(5);
  m.set("a", 10); // rewrite refreshes insertedAt -> "b" is now oldest
  tick(5);
  m.set("c", 3);
  assert.deepEqual([...m.keys()].sort(), ["a", "c"]);
});

test("LFU ties break on oldest insertedAt", () => {
  const m = new ExpiredMap<string, number>({
    maxSize: 2,
    strategy: "lfu",
    defaultTtl: Infinity,
  });
  m.set("a", 1);
  tick(5);
  m.set("b", 2);
  tick(5);
  m.set("c", 3); // a and b tie at freq 1 -> a is older
  assert.deepEqual([...m.keys()].sort(), ["b", "c"]);
});

test("ttl 0 expires immediately (no truthiness bug)", () => {
  const m = new ExpiredMap<string, number>({ defaultTtl: Infinity });
  m.set("a", 1, 0);
  assert.equal(m.get("a"), undefined);
});

test("Infinity ttl stores no ttl and never expires; overwrite w/ Infinity too", () => {
  const m = new ExpiredMap<string, number>({ defaultTtl: 100 });
  m.set("a", 1);
  m.set("a", 2, Infinity);
  tick(1e9);
  assert.equal(m.get("a"), 2);
});

test("set() rejects NaN or negative ttl", () => {
  const m = new ExpiredMap<string, number>({ defaultTtl: 100 });
  assert.throws(() => m.set("a", 1, NaN), RangeError);
  assert.throws(() => m.set("a", 1, -1), RangeError);
  assert.equal(m.size, 0); // rejected write stores nothing
});

test("has() deletes an expired entry and returns false", () => {
  const m = new ExpiredMap<string, number>({ defaultTtl: 100 });
  m.set("a", 1);
  tick(100);
  assert.equal(m.has("a"), false);
  assert.equal(m.size, 0);
});

test("clear() empties values and metadata", () => {
  const m = new ExpiredMap<string, number>({ defaultTtl: 100 });
  m.set("a", 1);
  m.set("b", 2);
  m.clear();
  assert.equal(m.size, 0);
  assert.equal(m.has("a"), false);
  assert.equal(m.get("a"), undefined);
});

test("checkInterval below 1 throws RangeError", () => {
  assert.throws(() => new ExpiredMap({ checkInterval: 0 }), RangeError);
  assert.throws(() => new ExpiredMap({ checkInterval: -5 }), RangeError);
});

test("lfu overwrite bumps frequency so the overwritten key is not evicted", () => {
  const m = new ExpiredMap<string, number>({ maxSize: 2, strategy: "lfu" });
  m.set("a", 1);
  m.set("b", 1);
  m.set("a", 2); // a frequency = 2
  m.set("c", 1); // evicts b (frequency 1), not a
  assert.equal(m.has("a"), true);
  assert.equal(m.has("b"), false);
  assert.equal(m.has("c"), true);
});

test("lru set-overwrite moves the key to the most-recent position", () => {
  const m = new ExpiredMap<string, number>({ maxSize: 2, strategy: "lru" });
  m.set("a", 1);
  m.set("b", 1);
  m.set("a", 2); // a now most-recently-used
  m.set("c", 1); // evicts b
  assert.equal(m.has("a"), true);
  assert.equal(m.has("b"), false);
  assert.equal(m.has("c"), true);
});
