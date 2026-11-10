# Server deployment

## Current deployment · 2026-11-11

- Public address: **https://photos.cxzzzz.top:7443/**. This is the existing working HTTPS entry point. The public 443 entry currently fails its TLS handshake from the Mac; its configuration and other hosted applications were left unchanged.
- Application source: commit `1f87d01d0cc19fae1e0ad8b832c93830bdde744b` on the pushed `codex/macos-support` branch.
- Frontend: `/srv/keeplive/releases/20261111-macos-1f87d01`, selected by `/srv/keeplive/current`. Four build files were individually checked against SHA-256 hashes both on the server and through public HTTPS. The three old release directories were removed at the user’s request after this deployment; the server now retains only the active release.
- Gateway: the existing `keeplive-web` Caddy service remains active. Publishing used an atomic symlink replacement, without changing the live Caddy configuration, TLS files or other applications, and without restarting the shared gateway.
- Backend: the current Mac serves `127.0.0.1:3210`. A background OpenSSH connection forwards **server `127.0.0.1:13210` → Mac `127.0.0.1:3210`**. The server-side listener is restricted to loopback. No photo files, account database or share encryption key were copied to Linux.
- Mac `.env`: `PUBLIC_ORIGIN=https://photos.cxzzzz.top:7443`, `COOKIE_SECURE=1`, `TRUST_PROXY=127.0.0.1`, with the backend still bound to loopback. Local HTTP use remains supported by the application's local-request handling.
- The tunnel was authenticated interactively and forked into the background. No server password was written to a script or configuration file, and no SSH authorized keys were added. Control socket: project-local `.data/deploy-ssh.sock`.
- No Mac login/boot startup was installed. The Mac and backend must stay running. The current tunnel has SSH keepalives but does not automatically reconnect after a network loss or reboot; reconnect it manually as below.
- Current build manifest: `~/keeplive-deploy/records/20261111-macos-1f87d01.json`; health probe: `~/keeplive-deploy/probe.py`; cleanup audit: `~/keeplive-deploy/records/cleanup-20261111.json`. All four server staging directories, duplicated build archives and the obsolete staged Caddy binary were removed, reclaiming 55,519,711 bytes (about 53 MiB). Mac pre-deployment configuration/database/key backup remains `.data/backups/gateway-deploy-20261111-010503/`.

From the Mac project root, inspect the current background connection:

```sh
ssh -S .data/deploy-ssh.sock -O check roxbili@tx.cxzzzz.top
```

If the connection has stopped, reconnect interactively; SSH will request authentication without storing a password:

```sh
ssh -fNT -M -S .data/deploy-ssh.sock -o ControlPersist=yes \
  -o ExitOnForwardFailure=yes -o ServerAliveInterval=30 -o ServerAliveCountMax=3 \
  -R 127.0.0.1:13210:127.0.0.1:3210 roxbili@tx.cxzzzz.top
```

Validation on the Mac and server passed: trusted HTTPS, current frontend/assets, anonymous auth status with `setupAllowed=false`, private API 401, share SPA/no-store/noindex, same-origin login reaching password verification using an impossible username, and cross-origin login 403. Full local suite before committing: 80 passed, 7 Windows-specific tests skipped; typecheck and production build passed. Actual account login and private media playback over the public gateway still require the user's album credentials; no production account or share was created for deployment checks. The four old Windows source paths still require relocation to the user's actual Mac photo directories.

```sh
python3 deploy/server/probe.py --url https://photos.cxzzzz.top:7443
```

Old server-local releases were explicitly deleted during cleanup on 2026-11-11, so rollback by linking to an old release directory is no longer available. To roll back, build the chosen source revision from Git into a new release directory, verify its files, and atomically replace `/srv/keeplive/current`. Do not alter the Mac database or photo directories for a frontend rollback. Current gateway configuration, TLS files, photo sources and data backups were retained.

To stop the newly established tunnel from the Mac, use `ssh -S .data/deploy-ssh.sock -O exit roxbili@tx.cxzzzz.top`. Restore `.env` from the Mac backup and restart the backend only if reverting the gateway configuration as well.

## Historical Windows deployment · 2026-10-07

Production deployment on 2026-10-07:

- Server SSH: `roxbili@tx.cxzzzz.top`; use the existing SSH identity. No password is saved in deployment files.
- Frontend: `/srv/keeplive/releases/20261007-share-playback`, linked from `/srv/keeplive/current`. Only the contents of `dist/` are copied. After SCP from Windows, set release directories to 755 and static files to 644 so the dedicated web-service user can read them.
- Caddy: official Linux amd64 binary 2.11.7 at `/usr/local/bin/keeplive-caddy`; downloaded from the official HTTPS download endpoint, SHA-256 `7c446252fa0b1410187f5a22ff14c59269a95c78afc6a02ba64a4fb55b7ce462` matched after transfer.
- Web service: `/etc/systemd/system/keeplive-web.service`, enabled for server startup. Config: `/etc/keeplive/Caddyfile`. Persistent state: `/var/lib/keeplive-web`; DynamicUser, limited writable paths, no public Caddy administration endpoint.
- Public address: **https://photos.cxzzzz.top/**. HTTP redirects to HTTPS. Config is based on `Caddyfile.production`; the initial loopback preview is no longer listening. Its backup remains `/etc/keeplive/Caddyfile.preview-backup-20261007`.
- TLS uses the user's supplied wildcard leaf certificate and its matching key. Files are `/etc/keeplive/tls/fullchain.pem` and `privkey.pem`, root-owned mode 0640 in a root-owned mode-0750 directory; only the `keeplive-tls` service group can read them. The web service has that supplementary group. No private key is included in project source or deployment documentation.
- The full chain includes the supplied intermediate and Sectigo's cross-signed Root R46 issued by USERTrust, obtained from the intermediate's official AIA repository. Cross-certificate trust/signature and intermediate signature were validated before use. This supports the server's older CA trust store without disabling HTTPS verification. The leaf SHA-256 fingerprint is `15:0B:BE:17:B9:26:19:A0:97:3E:D0:B9:B4:FC:BE:8A:F8:5B:D7:55:59:CA:72:C2:3E:B1:F7:EA:CD:9B:D8:63`.
- **Certificate expires 2026-12-13 07:59:59 Asia/Shanghai.** This supplied certificate is manually managed; Caddy does not automatically renew it. Replace the certificate/key as appropriate and restart the service before expiry.
- Backend tunnel: **127.0.0.1:13210 on the server only** → home `127.0.0.1:3210`. Current Windows logon task name begins `Keeplive-Tunnel-`; the existing `.ssh/faretrace_deploy_ed25519` identity stays on the home PC. It automatically reconnects every 5 seconds after SSH exits, with encrypted SSH keepalives and host-key checking. Stopping the task also stops its SSH process.
- Home `.env` sets `PUBLIC_ORIGIN=https://photos.cxzzzz.top`, `COOKIE_SECURE=1`, and `TRUST_PROXY=127.0.0.1`; the home album remains bound to `127.0.0.1:3210`. Existing accounts and all photo files remain on the home PC.

Read-only validation on the server:

```sh
python3 ~/keeplive-deploy/staging-20261007/probe.py --url https://photos.cxzzzz.top
systemctl is-active keeplive-web
```

The probe checks the static app/assets, anonymous auth status, private API 401, share routing/no-store/noindex and login Origin handling with an intentionally nonexistent username. It never logs in to a real album account.

Verified: trusted public HTTPS, static assets, HTTP redirect, private API 401, anonymous auth status with local setup denied, share SPA/no-store/noindex, valid-origin login reaching password verification (using an impossible username), cross-origin login rejection, and incoming spoofed X-Forwarded-For values sharing the actual client's rate-limit bucket. The public login page rendered in the browser. Real-account login, private video Range and real share links still need acceptance with the user's existing album account; no production account was created or altered for testing. Never use wildcard proxy trust. Retain the loopback-only SSH backend and original Host header.

Rollback: stop and disable `keeplive-web` on the server and the `Keeplive-Tunnel-` Windows task; restore any prior home `.env` before restarting the album (there was no .env before this deployment). If reverting to the internal preview, restore its Caddyfile backup too. Allow the old scheduled-task process to exit before starting its replacement; immediate stop/start can race with the old runner's mutex release. Existing server services are separate and were not modified. Temporary certificate upload copies were removed after installation; retain the installed restricted TLS files for service operation.
