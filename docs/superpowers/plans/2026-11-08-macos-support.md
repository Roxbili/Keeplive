# macOS Support Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the existing folder-based Keeplive app convenient and safe to run on macOS without enabling login startup.

**Architecture:** Extend the existing platform picker and retain its request lifecycle. Add shared Photos-library boundary checks, platform-correct canonical path comparison and a standalone Mac launcher. Keep the current database and account model.

**Tech Stack:** Node.js >=24, Express, JavaScript for Automation/AppKit, zsh, node:test, React/TypeScript/Vite.

**Spec:** `docs/superpowers/specs/2026-11-08-macos-support-design.md`

## Global Constraints

- Node.js >=24; no new runtime dependencies.
- Preserve Windows behavior and local-only native-picker authorization.
- Preserve existing accounts, indexes and application-managed recoverable trash.
- Do not install login or boot startup.
- Use only generated fixtures for automated filesystem mutations.

## Review Focus

- Quotes, newlines, Unicode and shell syntax in selected folder paths must remain data.
- Cancel, abort, timeout and shutdown must release a native picker and permit a later attempt.
- Existing indexed assets and filesystem links must not bypass Photos-library mutation protection.
- Canonical Mac paths must retain root-replacement protection and distinguish case-sensitive directories.
- A launcher opened from Finder must use Node >=24 and its matching npm in the correct directory, including paths containing spaces.

### Task 1: Mac native picker

**Files:** `server/native-directory.js`, new `server/native-directory-macos.js`, `tests/native-picker-process.test.js`, new `tests/macos-picker.test.js`.
**Interface:** `NativeDirectoryPicker({platform?,supported?,run?})` keeps `pick(initial,{signal}) -> path|null`; macOS invokes a fixed JXA script with the initial path in `KEEPLIVE_PICKER_INITIAL`.

- [x] Add failing tests for Mac availability, platform command routing, cancellation and unusual paths; keep the Windows branch explicit.
- [x] Run focused tests and confirm missing Mac behavior fails.
- [x] Implement AppKit folder panel and platform routing with existing abort/timeout handling.
- [x] Verify focused tests and real macOS AppKit panel configuration without showing an interactive window.

### Task 2: Filesystem compatibility and managed-library protection

**Files:** `server/paths.js`, `server/users.js`, `server/directories.js`, `server/library.js`, `server/app.js`, new `tests/photos-library.test.js`, `tests/library.test.js`, new `tests/setup.js`, `package.json`.
**Interfaces:** Shared Photos-library path guard and canonical path equality; source/grant validation and media confinement use the same package boundary.

- [x] Add failing tests for nested package scans, direct/descendant/grant/link rejection and old indexed asset deletion; use generated media only.
- [x] Add a failing canonical-path equality test that distinguishes case on POSIX.
- [x] Run tests and confirm the unprotected behavior fails.
- [x] Implement package protections and platform path comparison; normalize only the test runner's Mac temporary directory.
- [x] Run ordinary `npm test` without an external TMPDIR override and confirm all applicable tests pass.

### Task 3: Mac launch and documentation

**Files:** new executable `start-keeplive.command`, new `tests/macos-start.test.js`, `README.md`, `.env.example`.
**Interface:** Finder or `./start-keeplive.command` runs from the project with a validated Node >=24 and matching npm; `KEEPLIVE_NODE` optionally selects a runtime.

- [x] Add failing launcher integration tests in temporary projects using real Node/npm and harmless build/start fixture scripts.
- [x] Implement the launcher, including explicit old-Node rejection and quoted paths.
- [x] Document Mac launch, folder permissions, `/Users` and `/Volumes`, Photos export and application-managed trash.
- [x] Run full tests, typecheck, production build and isolated Mac smoke validation.
- [x] Review the final diff and restart/verify the existing local service with preserved state; leave the changes available for review without pushing or committing automatically.

## Execution notes

Work in the existing deployed checkout on `codex/macos-support`, leaving `main` unchanged. The checkout was clean before branching and shares the installed runtime and local data with the running service. Implementation proceeds inline under the user's adaptation request; no additional design or execution approval is needed for these reversible changes. Record test evidence and scope decisions here as work proceeds.

## Evidence

- Native picker RED: missing Mac availability/routing/script; GREEN: six process/AppKit configuration tests passed.
- Photos protection RED: packages were scanned/accepted and indexed originals were accessible; GREEN: package, grant, browser, alias, original and move checks passed.
- Mac launcher RED: entry point absent; GREEN: real Node/npm install-build-start, invalid override and existing-instance tests passed.
- Ordinary `npm test` now works on macOS without an external TMPDIR override: initial whole-suite run 78 passed, 7 Windows-only skipped. TypeScript and production build passed.
- Isolated Mac smoke test passed native capability, canonical paths, JPEG/MOV pairing, thumbnail worker, FFmpeg Range, favorite/trash/restore and native filesystem watch.
- Independent read-only review found one Important legacy-trash restore bypass. Reproduced with a generated legacy recovery record (RED), then added destination guards before optional ENOENT handling and directory creation (GREEN); recovery bytes and journal are preserved. No other concrete review findings.
- Desktop interaction with the native picker, Finder and macOS permission prompts remains manual acceptance; tests execute real AppKit panel configuration without opening a modal window.

- Additional migration regression RED→GREEN: an old Windows initial path now resets the native/web picker to local positions; ordinary relative paths remain invalid and choosing a folder does not save a source.
- Final ordinary suite: 87 tests, 80 passed, 7 Windows-only skipped, zero failures. TypeScript check, production build, zsh syntax and git whitespace checks passed.
- Existing local service restarted gracefully on 127.0.0.1:3210; homepage and newly built JS/CSS returned 200. Database quick_check passed; 1 user, 4 sources, 3,073 assets and 2 shares preserved. Error log empty. Backup: `.data/backups/macos-support-20261108-164724/`.
- No login startup was installed, no repository changes were committed or pushed, and the feature remains reviewable on `codex/macos-support`.
