# Keeplive Implementation Plan

> Execution: native implementation in the directory explicitly requested by the user. Use test-driven-development and verification-before-completion.

**Goal:** A working private local photo gallery with Live Photo support, mobile layout and a documented remote gateway.
**Architecture:** React SPA + Express local service + SQLite index; read-only sources, separate cache; domain gateway proxies the same API.
**Tech Stack:** Node 24, React, Vite, SQLite, ExifTool, Sharp, HEIC decoder, FFmpeg.
**Spec:** docs/design.md

## Constraints
- Originals remain at home; source files never modified.
- Account required for media; source paths never returned in photo API.
- Stable IDs across root relocation; offline roots never treated as deleted.
- No automatic deployment or public listener by default.

## Review focus
- Conflicting ContentIdentifier / same names across folders must not mispair.
- Partially unreadable folders must not delete old indexed entries.
- Replaced files must invalidate metadata and derived caches.
- Media paths must remain confined even with symlinks and Range requests.
- Playback / rapid navigation must not leave audio playing after closing.

## Task 1: Index and scan
Files: server/store.js, server/library.js, server/paths.js, tests/library.test.js.
Produces: pairMedia(files), Library.scan(), Store source/asset queries.
- [x] Write tests for stable IDs, safe pairing, offline/partial scan preservation.
- [x] Run tests and observe expected missing-function failures.
- [x] Implement SQLite persistence, traversal, metadata cache and background scanning.
- [x] Run tests to green.

## Task 2: Authenticated API and media
Files: server/app.js, server/auth.js, server/media.js, server/index.js, tests/api.test.js.
Consumes: source/asset queries; produces /api/auth, /sources, /scan, /photos, /folders, /media.
- [x] Write tests for setup-code protection, login, Origin, path escapes and media Range.
- [x] Observe failing tests, implement cookie sessions, API and derived media.
- [x] Run full tests; generated real image/video checks.

## Task 3: Responsive gallery
Files: src/App.tsx, src/Viewer.tsx, src/Settings.tsx, src/styles.css, src/api.ts.
Consumes: same-origin API; produces time/folder/favorite views, authenticated settings and viewer.
- [x] Implement against verified service contracts.
- [x] Typecheck and production build.
- [x] Browser verification at desktop and 390px widths, authenticated gallery, playback, favorites and directory form. First-use/empty production screen remains for user initialization.

## Task 4: Packaging and remote deployment
Files: README.md, .env.example, start-keeplive.cmd, deploy/Caddyfile.
- [x] Explain initialization code, source paths and startup.
- [x] Prepare private-network proxy configuration, no media persistent caching.
- [x] Independent review completed; regression fixes tested. Final test/typecheck/build/audit recorded in docs/validation.md.
