# Independent User Accounts Implementation Plan

**Goal:** Replace initialization-code/single-password access with isolated personal accounts.
**Spec:** docs/user-system-design.md
**Execution:** Native implementation in the user-requested project; test-first service changes, then responsive UI, independent review and verification.

## Tasks
1. [x] Add failing tests for account setup, sessions, roles, personal sources, media isolation, favorites, root permissions and migration.
2. [x] Implement users/schema migration, per-user favorites and authenticated user identity. API interfaces: /auth/status, /auth/setup, /auth/login, /auth/me, /auth/password, /users, /users/:id, /users/:id/password. Existing gallery routes always derive ownership from session.
3. [x] Scope background/manual scanner state, source validation and gallery queries to user ownership. Enforce assigned physical roots and cross-owner overlap.
4. [x] Replace initialization form with administrator signup/login, add account settings and administrator user management, preserve mobile layout and brand punctuation preference.
5. [x] Run tests, typecheck, build, independent review; browser QA in isolated environment. Restart actual service with existing state preserved and leave first-admin creation to user.

## Review focus
- Foreign asset/source IDs, query parameters and forged owner fields must not disclose or modify another account.
- Symbolic links, ancestor roots, case differences and changing roles must not widen disk access.
- Concurrent initial setup / password operations must not retain invalidated credentials or remove last admin.
- Legacy passwords, favorites and photo ownership must migrate once and not bleed across users.
- Switching users must clear old photos and reject stale in-flight responses in the UI.

## Completion evidence
- 30 tests passed, TypeScript check passed, production build passed; production dependency audit reports 0 vulnerabilities.
- Desktop and 390 × 844 mobile browser QA used separate generated photo libraries and dummy accounts. Owner saw 15 photos, member saw 2 and no user-management tab; member favorite did not appear in owner account. Cross-tab account switching refreshed the old tab to the current owner identity and inventory.
- Independent review findings addressed: canonical root replacement, member grant links, revoked asynchronous administrator requests, Windows path casing, local setup with a configured domain, and stale browser/session responses.
- Actual service restarted at port 3210 with first-admin creation still pending for the user. Prior SQLite database backed up to .data/keeplive.before-users.sqlite. No actual user credentials were created.

