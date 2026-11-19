# AGENTS.md — expired-map

## What this is

`expired-map` — a `Map` with per-entry TTL expiration and optional bounded-size
eviction (`fifo` / `lru` / `lfu`). Drop-in `Map` replacement that drops stale
keys lazily on access or via a background sweep. Published on npm (v1.0.0, MIT).

Repository: https://github.com/rayenboussayed/expired-map

## Commands

```bash
npm test            # node --experimental-strip-types --test src/index.test.ts
npm run build       # tsc -> dist/
npm run docs        # tsc + mdaics -> docs/
```

No husky hooks; `prepublishOnly` rebuilds. Keep `npm test` green before
committing; there is no other gate.

## Layout

- `src/index.ts` — the whole library (`ExpiredMap`); `src/index.test.ts` — tests
  (`node:test`, no framework).
- `examples/*.mjs` — runnable examples (basic, entries, eviction, per-key-ttl,
  sweep).
- `docs/index.md` — generated API reference (mdaics); do not hand-edit.

## Invariants — do not break

- **`Map` semantics.** `get` / `set` / `has` / `delete` / `clear` behave like
  `Map`, plus expiry. Respecting this lets it be a drop-in replacement.
- Lazy expiry on read paths (`get`/`has`) plus an optional `start()` background
  sweep; the sweep timer is `unref()`ed so the process can always exit.
- `set(key, value, ttl?)` refreshes the TTL of a live key.
- Eviction only applies when `maxSize` is set; eviction order is `fifo` (default),
  `lru` or `lfu` — check the constructor table in the README before changing
  defaults.
- Node `>=18` (uses `setInterval(...).unref?.()`).
- TypeScript strict; no `any` without a comment; single-file public surface.

## Conventions

- Zero runtime dependencies — keep it that way.
- mdaics renders docs from JSDoc in `src/index.ts`; change the source, not the
  generated pages.
