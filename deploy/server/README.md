# Current server deployment

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
