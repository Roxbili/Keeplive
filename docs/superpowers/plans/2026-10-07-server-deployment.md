# Keeplive server deployment

Goal: host the existing frontend on the user's server while the authenticated album, photos and originals remain on the home Windows PC.

Architecture: HTTPS browser → Caddy on the server → loopback-only reverse SSH tunnel → home Keeplive at 127.0.0.1:3210. Caddy runs as a dedicated systemd service with DynamicUser and restricted write paths. The official Docker registry timed out, so the official Caddy 2.11.7 Linux binary was downloaded on the home PC and uploaded, with matching SHA-256 verified. The existing Windows SSH identity authenticates the tunnel; no SSH passwords enter project files. A Windows logon task supervises the tunnel independently of Codex.

Constraints:
- Preserve existing server applications, SSH configuration and account authorization.
- Do not transfer the home database, photo directories, private keys or password to the server.
- Confirm the web domain before publishing and setting PUBLIC_ORIGIN.
- Bind the forwarded backend exclusively to server loopback; access is through the HTTPS gateway.
- Keep API Host and client Origin aligned; forwarded headers must prevent remote requests from appearing to be local setup/native-directory requests.
- Retain secure cookies, no-store for API/share responses, and Range support for media.

Steps:
- [x] Inspect server and home runtime; verify passwordless existing SSH authentication.
- [x] Build frontend and upload into an isolated staging directory.
- [x] Probe a temporary reverse tunnel and test server-side reachability.
- [x] Install a persistent Windows tunnel task with restart and process ownership.
- [x] Confirm photos.cxzzzz.top/DNS, prepare and validate static-certificate Caddy config and rollback files.
- [x] Publish static frontend and HTTPS gateway; persist restricted certificate files and systemd startup/restart policy.
- [x] Configure home PUBLIC_ORIGIN, COOKIE_SECURE=1 and TRUST_PROXY=127.0.0.1 (the exact reverse-tunnel socket address), then restart the home task. Confirm Caddy discards spoofed incoming client-IP headers.
- [x] Verify trusted HTTPS, static assets, redirects, unauthenticated API boundaries and public browser login-page rendering.
- [ ] User acceptance: actual account login, private video Range/playback, real share links and home offline behavior. No production test account or public share is created automatically.

Rollback: stop/disable the new keeplive-web service and tunnel task, restore any pre-deployment home .env, and restart the home task. No existing server web application or photo file is overwritten.

Deployment: /srv/keeplive/releases/20261007-preview (static frontend), /srv/keeplive/current (release link), /etc/keeplive/Caddyfile (public photos.cxzzzz.top HTTPS), /etc/systemd/system/keeplive-web.service. The loopback preview is closed; the encrypted home backend still listens only on 127.0.0.1:13210. Supplied certificate expires 2026-12-13 07:59:59 Asia/Shanghai and requires manual renewal. Temporary uploaded certificate/key copies are removed after installation.
