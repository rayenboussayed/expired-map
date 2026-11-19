# Changelog

All notable changes to `expired-map` are documented here. The package has no
git tags yet; release dates below are taken from the commit history (UTC).

## [1.0.0] - 2026-10-02..2026-11-18

Initial release span, from the first commit (`1b22ba7`) to the last review
polish (`f9acb3a`). No tags have been cut yet.

### Added

- Map-seeded entries support (`new ExpiredMap(entries)`), synced with README and
  examples (`1b22ba7`).
- `ExpiredMap` with per-entry TTL (default 5 minutes), lazy expiry on access and
  an optional background sweep (`checkInterval`, validated) with an `unref()`ed
  timer so it never keeps Node alive on its own.
- Bounded-size eviction with `maxSize` and selectable strategy `fifo` / `lru` /
  `lfu`.
- `node:test` unit tests (`src/index.test.ts`); coverage for `has`, `clear`,
  `checkInterval` validation and `lfu`/`lru` overwrites (`b9dff82`).
- Generated API docs via mdaics (`d296682`, `ba90afc`) plus
  `npm run docs`; JSDoc on the public API (`c6d6a5f`); docs link from README
  (`d409324`).
- Publish metadata, MIT license and entry points (`b35cb55`).

### Fixed

- README and docblock wording from the final review (`262be3c`, `5e0ec15`,
  `aa29621`, `f9acb3a`); TTL behavior hardened and enforced in the implementation
  (`2fe21b4`).

### Changed

- Renamed the package to `expired-map` and adopted the FIFO strategy with the
  TTL hardening (`2fe21b4`).
