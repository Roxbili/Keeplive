# macOS support

The user requested Mac adaptation after a compatibility audit. Keep the existing folder-based album, account database, indexed assets and recoverable trash. Do not install login or boot startup.

## Approach

Extend the existing native picker with a macOS AppKit implementation launched through `/usr/bin/osascript` using JavaScript for Automation. This reuses authentication, local-only access, cancellation and web fallback. Pass initial paths through environment data, never generated executable text. A browser-only picker would leave the main platform difference unresolved; direct PhotoKit integration would be a different product and is outside this change.

Protect managed `.photoslibrary` packages rather than pretending to integrate Apple Photos: reject package roots and descendants as sources/permission grants, hide them in the browser, skip them during recursive scans, and prevent original-file access/deletion through existing indexed records or links. Explain how to export unmodified originals.

Keep filesystem paths canonical at API boundaries. Compare canonical source paths with platform path semantics rather than unconditional lowercasing. Canonicalize the test runner's macOS temporary directory so normal `npm test` works without manual environment overrides; keep production root-replacement protections intact.

Add an executable `start-keeplive.command` which selects Node >=24, supports an explicit `KEEPLIVE_NODE` override, finds this installation's dedicated runtime, installs locked dependencies only if absent, builds and starts in the repository directory. Do not register background startup. Preserve Windows launchers and the existing Windows native picker.

## Validation

Test macOS picker command routing, cancellation, failure recovery, Unicode/hostile paths and Cocoa panel configuration without interactive dialogs. Keep local-only and session revocation route tests. Test package exclusion and mutation protection with synthetic media, including old indexes and symlink aliases. Exercise the launcher in a disposable directory with real Node/npm and fixture scripts. Run the ordinary full suite, typecheck, build, and an isolated Mac media smoke test, then restart the already-authorized local service with existing state preserved.

## Scope decisions

The implementation choices above are defaults selected from the audit and current architecture. Native Apple Photos synchronization and integration with the system Trash are excluded; the application's existing recoverable trash remains the supported behavior. No external deployment or automatic login startup is included.
