# Batch sharing implementation plan

> For agentic workers: use superpowers:executing-plans inline, preserving the existing workspace and approved user design.

**Goal:** Implement the approved private owner/public guest sharing flow.
**Architecture:** SQLite Shares service and separated public API, existing media conversion with authorization before and after conversion, independent guest React entry and shared readonly Viewer.
**Tech Stack:** Existing Node/Express/SQLite/React/TypeScript, node:crypto, no new dependencies.
**Spec:** sharing-design.md

## Constraints
Default expiry 7 days, choices 1/7/30/0 days; downloads default false; existing accounts/photos untouched; guest token not sent in URL query; owner checks and no-store on all media. Windows background processes stay hidden; no deployment or real public photo sharing during QA.

## Review focus
Guest cookies scoped to each share; two tabs sharing different collections; permission recheck after asynchronous media work; expired credential/account-switch UI races; paginated whole-filter selection; malformed/large inputs; revocation cannot recall already transmitted bytes.

- [x] Write failing share API tests using isolated DB and generated media.
- [x] Add server/shares.js for storage, encryption, lists, authorization, expiry, mutation and public payloads; server/share-routes.js for public/owner endpoints. Register in server/app.js around existing login barrier.
- [x] Add lightweight filtered photo-ID selection to Store/API and verify its owner isolation.
- [x] Add selection UI and ShareDialog, MyShares management, shared Viewer options and PublicShare standalone entry.
- [x] Run type/build/tests; browser QA owner create and anonymous view, download off/on, revoke/rotate, desktop/mobile; no actual personal share creation.
- [x] Independent security review through requesting-code-review skill; repair findings, update README/deploy headers/validation and restart actual local service.
