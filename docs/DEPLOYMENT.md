# Deploying Vaultisse with Docker

Vaultisse ships as one Docker image (`ghcr.io/albertamat/vaultisse`) containing the
compiled server and the built client, plus a `docker-compose.yml` that adds a
PostgreSQL container next to it. This guide covers five ways to run it, depending on
who should be able to reach it and what's managing your containers:

| # | Scenario | Reachable from | TLS handled by | Extra container |
|---|----------|-----------------|-----------------|------------------|
| [A](#a-self-hosted-local-only--no-public-access) | Self-hosted, local only | this machine / your LAN | — (none needed) | none |
| [B](#b-production-with-your-own-reverse-proxy--dns) | Production, your own proxy/DNS | the public internet | your proxy (Caddy/Nginx/Traefik) | none (proxy runs on the host, outside Compose) |
| [C](#c-production-with-cloudflare-tunnel) | Production, Cloudflare Tunnel | the public internet | Cloudflare | `cloudflared` |
| [D](#d-unraid-one-click-add-container) | Unraid, via its Docker UI | your LAN, or the internet if you add your own proxy/tunnel on top | up to you (same choices as B/C) | none — uses Unraid's own container manager instead of Compose |
| [E](#e-public-read-only-demo) | Public read-only demo | the public internet | Cloudflare (reuses C) | `cloudflared` + a second, separate stack |

If you're not sure which one you want: **A** if this never leaves your home network,
**C** if your domain's DNS already lives on Cloudflare and you'd rather not manage
certificates, **B** for everything else (your own domain/DNS/server, full control),
**D** if you're running Unraid and would rather use its Docker tab than Compose,
**E** if you want a public demo visitors can click around read-only, separate from
any real deployment.

---

## Prerequisites (all scenarios)

- Docker Engine with the Compose plugin (`docker compose version` should work).
- The files this repo publishes for deployment — note `docker-compose.yml` mounts
  the schema file by its relative path, so it must land at
  `assets/db/databaseSchema.sql` next to the compose file, not just exist somewhere:

  ```bash
  mkdir -p assets/db
  curl -O https://raw.githubusercontent.com/AlbertAmat/vaultisse/main/docker-compose.yml
  curl -O https://raw.githubusercontent.com/AlbertAmat/vaultisse/main/.env.example
  curl -o assets/db/databaseSchema.sql https://raw.githubusercontent.com/AlbertAmat/vaultisse/main/assets/db/databaseSchema.sql
  cp .env.example .env
  ```
- A generated JWT secret: `openssl rand -hex 32` → `JWT_SECRET` in `.env`.
- A real `DB_PASSWORD` in `.env` (not the example's blank value).
- `ALLOW_DEV_AUTH=false` — always, in every scenario below. It bypasses login
  entirely and exists only for local development without Docker. It has no effect
  on registration — see [Creating the first user](#creating-the-first-user) below.

Everything past this point is scenario-specific `.env` values and, for B, a small
amount of host configuration outside of Docker.

---

## Creating the first user

There's no separate admin setup step and no seeded default account. Once the `app`
container is up (any scenario below), open `FRONT_END_URL` + `/register` (e.g.
`https://your-domain.com/register`) and create an account the normal way — it's a
plain, always-available page and works regardless of `ALLOW_DEV_AUTH`, which has
nothing to do with registration and should stay `false` as noted above. There's no
separate admin role; every account has the same access to the whole catalog.

If `REGISTRATION_REQUIRES_APPROVAL=true` (see `.env.example`), the account is created
disabled and can't log in until approved (see "Approving a new registration" under
[Common operations](#common-operations-all-scenarios)) — for the first account on a
fresh instance you almost always want this left `false`.

---

## A. Self-hosted, local only — no public access

Use this when Vaultisse should only ever be reached from the machine it runs on, or
at most your home LAN — never the public internet.

1. In `.env`:
   ```
   FRONT_END_URL=http://localhost:3000
   TRUST_PROXY=false
   CLOUDFLARE_TUNNEL_TOKEN=
   ```
   (If you want other devices on your LAN to reach it too, e.g. from a tablet, use
   your machine's LAN IP instead: `FRONT_END_URL=http://192.168.1.50:3000`.)

2. **If you want it reachable only from this machine** (not even your LAN), restrict
   the published port to loopback by editing the `app` service's `ports:` entry in
   `docker-compose.yml`:
   ```yaml
   ports:
     - "127.0.0.1:${API_PORT:-3000}:${API_PORT:-3000}"
   ```
   Leave it as the default (`"${API_PORT:-3000}:${API_PORT:-3000}"`) if LAN access is
   fine — just be aware that binds to all interfaces, so anyone who can reach your LAN
   can reach it too.

3. Start it — no profile flag:
   ```bash
   docker compose up -d
   ```

4. Open `FRONT_END_URL` in a browser and go to `/register` to create your first
   account (see [Creating the first user](#creating-the-first-user) above).

Don't forward this port on your router. There's nothing else to configure — no
reverse proxy, no certificate, no `cloudflared`.

---

## B. Production with your own reverse proxy / DNS

Use this when you manage your own domain, DNS, and server, and would rather run your
own TLS termination than depend on Cloudflare.

**Prerequisites:** a domain with an A (and AAAA, if you have IPv6) record pointing at
your server's public IP, and a reverse proxy installed on the host (outside Docker
Compose) — Caddy is shown below because it handles TLS automatically; Nginx + certbot
works the same way with more manual steps.

1. In `.env`:
   ```
   FRONT_END_URL=https://your-domain.com
   TRUST_PROXY=true
   CLOUDFLARE_TUNNEL_TOKEN=
   ```
   `TRUST_PROXY=true` matters here: without it, the login rate limiter sees every
   visitor as coming from your reverse proxy's IP instead of their real one.

2. Recommended: bind the app's port to loopback only, so the only way in is through
   your reverse proxy, not by hitting the app's port directly. Edit `docker-compose.yml`:
   ```yaml
   ports:
     - "127.0.0.1:${API_PORT:-3000}:${API_PORT:-3000}"
   ```

3. Start the stack — no profile flag:
   ```bash
   docker compose up -d
   ```

4. Configure your reverse proxy. With Caddy, this is the entire config
   (`/etc/caddy/Caddyfile`):
   ```
   your-domain.com {
       reverse_proxy localhost:3000
   }
   ```
   ```bash
   sudo systemctl reload caddy
   ```
   Caddy requests and renews the certificate automatically — nothing else to do.

   With Nginx + certbot instead: proxy_pass to `http://127.0.0.1:3000` in your server
   block, then run `certbot --nginx -d your-domain.com` to provision the certificate.

5. Firewall: open 80 (HTTP→HTTPS redirect / ACME challenge) and 443. Nothing else
   needs to be reachable from outside — `3000` is already loopback-only from step 2.

---

## C. Production with Cloudflare Tunnel

Use this when your domain's DNS is already on Cloudflare and you'd rather not manage
inbound ports or certificates at all.

**Prerequisites:** the domain added to a Cloudflare account (free plan is fine), DNS
managed there.

1. In the Cloudflare dashboard: **Zero Trust → Networks → Tunnels → Create a tunnel**.
   Add a public hostname (e.g. `books.your-domain.com`) routing to service
   `http://app:3000` — that's the Compose service name, not `localhost`. Copy the
   tunnel token it gives you.

2. In `.env`:
   ```
   FRONT_END_URL=https://books.your-domain.com
   TRUST_PROXY=true
   CLOUDFLARE_TUNNEL_TOKEN=<the token from step 1>
   ```

3. Start the stack with the `cloudflare` profile so the tunnel container runs too:
   ```bash
   docker compose --profile cloudflare up -d
   ```

4. Optional hardening: `cloudflared` reaches `app` over the internal Compose network
   (`app:3000`), not through the published host port — so once this is working, you
   can remove the `app` service's `ports:` entry from `docker-compose.yml` entirely
   for a setup with **zero inbound ports** on the host. (Do this only after step 3
   works, since removing it also blocks direct `http://server-ip:3000` access, which
   you're using to test.)

5. Firewall: nothing to open. `cloudflared` only makes outbound connections to
   Cloudflare.

---

## D. Unraid (one-click Add Container)

Use this if you run Unraid and would rather add the app through its Docker tab than
write a Compose file by hand.

**Prerequisites:** a reachable PostgreSQL server — either an existing one (many
Unraid boxes already run one for other apps), or add Postgres as its own container
first (the official `postgres` Community Applications template works). Either way,
the schema in `assets/db/databaseSchema.sql` needs to be imported into it once —
there's nothing in the template that does this for you.

1. **Load the template.** From a browser on your LAN, visit (swap in your Tower's
   actual address):
   ```
   http://<TOWER-IP>/Docker/AddContainer?xmlTemplate=https://raw.githubusercontent.com/AlbertAmat/vaultisse/main/assets/unraid/vaultisse.xml
   ```
   This opens Unraid's "Add Container" page pre-filled with the image, port, path,
   and all the env vars below — that's the one-click part.

   Prefer to install it through Unraid's UI instead of a typed URL? Docker tab →
   gear icon → **Template Repositories** → add `https://github.com/AlbertAmat/vaultisse`,
   save. The template then shows up under **Add Container → Template** going forward,
   and stays in sync if the template is ever updated.

2. Fill in the required fields — same meaning as their `.env` counterparts elsewhere
   in this guide:
   - `DB_HOST`, `DB_PORT`, `DB_NAME`, `DB_USER`, `DB_PASSWORD` — pointing at the
     Postgres server from the prerequisites step.
   - `FRONT_END_URL` — e.g. `http://<TOWER-IP>:3000`, or your public HTTPS URL if
     you're putting a proxy/tunnel in front (see below).
   - `JWT_SECRET` — generate with `openssl rand -hex 32`.
   - `ALLOW_DEV_AUTH` — leave `false`.
   - `TRUST_PROXY` — `false` if you're only reaching it via `TOWER-IP:3000` on your
     LAN; `true` if you add SWAG, Nginx Proxy Manager, or Cloudflare Tunnel in front
     of it, same reasoning as scenarios B and C.

3. Click **Apply**. Unraid pulls the image and starts the container; the "WebUI"
   link on its Docker tab entry opens straight to the login page.

By default this is only reachable on your LAN at `TOWER-IP:3000` — most Unraid users
stop here. The rest of this section is for the minority who want it reachable from
the internet, and covers the part that matters most once you do that: not letting a
compromise of this one app become a compromise of everything else you self-host on
the same box.

### Making it reachable from the internet

Same two choices as scenarios B and C, just running as ordinary Unraid containers
instead of Compose services:

- **Your own reverse proxy**: the [SWAG](https://docs.linuxserver.io/general/swag/)
  or **Nginx Proxy Manager** Community Applications templates both work — point them
  at `http://<TOWER-IP>:3000` (or the container's name/IP if it's on the custom
  network from below) the same way you would in [scenario B](#b-production-with-your-own-reverse-proxy--dns).
- **Cloudflare Tunnel**: add the official `cloudflare/cloudflared:latest` image as
  its own container — Add Container → Repository `cloudflare/cloudflared:latest`,
  **Network Type** set to the same custom network as Vaultisse (see below) so it can
  reach it by container name without publishing any port, and **Extra Parameters** /
  **Post Arguments** set to `tunnel run --token <your-tunnel-token>` (the same token
  from Cloudflare's Zero Trust → Tunnels dashboard used in [scenario C](#c-production-with-cloudflare-tunnel)).
  In the Cloudflare dashboard, point the tunnel's public hostname at
  `http://<Vaultisse-container-name>:3000` — the exact name you gave the Vaultisse
  container, resolvable over Docker's internal DNS since they share a network.

Either way, once traffic reaches it through a proxy/tunnel, flip `TRUST_PROXY` to
`true` in the Vaultisse container's settings — otherwise its rate limiter can't
tell your visitors apart from the proxy.

### Keeping it from becoming a way into your other containers

A typical Unraid box runs many unrelated containers, often all on the same network —
either the default `bridge` (where, by default, every container on it can reach every
other container's internal ports directly, regardless of what's published to the
host) or `br0`/macvlan (where each container gets its own real LAN IP, making it just
another device on your network as far as anything else on the LAN is concerned). The
moment one of those containers is reachable from the internet, it's the one most
likely to get compromised — and either networking mode above hands an attacker inside
it a free path to everything else you're running, published ports or not.

To contain that:

1. **Give this app its own custom Docker network**, separate from whatever your other
   containers use:
   ```
   docker network create vaultisse-net
   ```
   (Unraid persists custom networks created this way; some versions also expose an
   "Add a Custom Network" option under the Docker tab's settings.) Set **Network
   Type** to this custom network — not `bridge`, not `br0` — for the Vaultisse
   container, its reverse proxy/tunnel container, and, ideally, a Postgres container
   dedicated to it.
2. **Don't use `br0`/macvlan for anything internet-facing.** It puts the container
   directly on your LAN with its own IP, which means a compromise is no longer
   contained by Docker at all — the attacker is now positioned like any other device
   on your network.
3. **Never use `Host` networking for it.** That removes container network isolation
   entirely.
4. **Use a Postgres dedicated to this app, not one shared with unrelated services**,
   if you're exposing it publicly. A custom network only isolates Vaultisse from
   containers that *aren't* on it — a database that's also reachable from your other
   apps' network becomes the bridge between the two, undoing the isolation from
   point 1.

The result: Vaultisse and only what it needs (its proxy/tunnel, its own database)
share a network that nothing else you self-host is on — so if it's ever compromised,
the attacker's reach stops there instead of extending to every other service on the
box.

---

## E. Public read-only demo

Use this to run a public demo (e.g. `demo.your-domain.com`) that anyone can click
around in, without risking your real data or letting visitors leave junk behind.
It's a second, fully separate stack — its own database, its own `.env`, its own
Cloudflare Tunnel hostname — sharing nothing with a production instance beyond the
same Docker image.

1. Check out a second directory (or just a second `.env` + compose project name —
   the compose file itself doesn't change) so the demo has its own named volumes:
   ```bash
   mkdir vaultisse-demo && cd vaultisse-demo
   curl -O https://raw.githubusercontent.com/AlbertAmat/vaultisse/main/docker-compose.yml
   curl -O https://raw.githubusercontent.com/AlbertAmat/vaultisse/main/.env.example
   cp .env.example .env
   ```

2. In this `.env`, on top of the usual `JWT_SECRET`/`DB_PASSWORD`:
   ```
   FRONT_END_URL=https://demo.your-domain.com
   TRUST_PROXY=true
   DEMO_MODE=true
   CLOUDFLARE_TUNNEL_TOKEN=<a second tunnel, separate from any production one>
   ```
   `DEMO_MODE=true` makes the server reject every request except `GET`/`HEAD`/
   `OPTIONS` and the login endpoints with `403` (see `blockWritesInDemo` in
   `server/src/middlewares/DemoModeMiddleware.ts`) — visitors can log in and browse,
   but can't add, edit, delete, or register a new account.

3. Follow scenario C above to add the Cloudflare public hostname
   (`demo.your-domain.com` → `http://app:3000`) and start with
   `docker compose -p vaultisse-demo --profile cloudflare up -d`. The `-p` flag
   keeps this stack's volumes/network namespaced separately from any production
   `vaultisse` stack on the same host.

4. Seed it with sample data and a fixed demo login instead of real records. There's
   no seed script in the repo yet — the simplest options are a `pg_dump` of scrubbed
   sample data restored into the `db` container, or a hand-written SQL file applied
   the same way. Load it once with:
   ```bash
   docker compose -p vaultisse-demo exec -T db psql -U "$DB_USER" -d "$DB_NAME" < demo-seed.sql
   ```

5. Reset it on a schedule so it doesn't visibly degrade between visitors — e.g. a
   host cron entry that re-applies the seed file hourly:
   ```
   0 * * * * cd /path/to/vaultisse-demo && docker compose -p vaultisse-demo exec -T db psql -U "$DB_USER" -d "$DB_NAME" < demo-seed.sql
   ```
   `DEMO_MODE` only blocks writes over HTTP - it doesn't stop the reseed script,
   which talks to Postgres directly.

`DEMO_MODE` is an HTTP-layer guard, not a substitute for `ALLOW_DEV_AUTH=false` or a
real `JWT_SECRET` — every other production hardening step above still applies.

---

## Common operations, all scenarios

- **Upgrading**: set `APP_TAG` in `.env` to a newer released version (see the
  repo's [Releases](https://github.com/AlbertAmat/vaultisse/releases)), then:
  ```bash
  docker compose pull
  docker compose up -d
  ```
  Pin `APP_TAG` to a specific version rather than `latest` so upgrades are a
  deliberate step, not a surprise on container restart.
- **A new `APP_TAG` sometimes needs a database upgrade first.** `assets/db/`
  contains `databaseSchema.sql` (always current — only used for brand-new installs)
  plus an `upgrade/` directory with files (or, for versions with more than one,
  a folder) named after the version they ship in — e.g. `1.1.0/1.sql` — for a
  database that's already running an older schema; each one's header comment
  explains what it does (see `assets/db/upgrade/README.md` for the full
  convention). Check the release notes for the version you're upgrading to, and
  apply every version's file(s) up through that version, in order, to the
  running `db` container *before* switching `APP_TAG` and restarting `app`:
  ```bash
  docker compose exec -T db psql -U <DB_USER> -d <DB_NAME> < assets/db/upgrade/1.1.0/1.sql
  ```
- **Postgres major-version bumps are not the same kind of upgrade.** The app-version
  upgrade above is a drop-in restart because the same Postgres major version keeps
  reading the same data files. Bumping `docker-compose.yml`'s `postgres:XX-alpine`
  tag to a new *major* version is not — Postgres's on-disk format changes between
  majors, so an existing `db-data` volume won't just start under a newer major. Back
  it up (`docker compose exec db pg_dump -U <DB_USER> <DB_NAME>`), then either use
  `pg_upgrade` or restore the dump into a fresh volume on the new version, before
  changing the image tag on a database that already has data in it.
- **Confirming what's actually running**:
  `curl http://<host>:<port>/api/rest/app/version` (adjust for your setup — through
  your proxy/tunnel URL if the port isn't published).
- **Logs**: `docker compose logs -f app`, or the `app-logs` volume, which holds
  `bookStorage.log` as written by the app itself.
- **Backups**: everything that matters lives in the `db-data` volume. Either back up
  the volume directly or run `docker compose exec db pg_dump -U <DB_USER> <DB_NAME>`
  on a schedule.
- **OIDC / Authentik**: optional SSO next to password login. Set all four of
  `OIDC_ISSUER`, `OIDC_CLIENT_ID`, `OIDC_CLIENT_SECRET`, and `OIDC_REDIRECT_URI`
  in `.env`, then recreate the `app` container. Create a **confidential** OIDC
  provider on the IdP (Authentik: Applications → Create with OpenID Provider):

  - Redirect URI: `https://<public-host>/auth/oidc/callback` (must match
    `OIDC_REDIRECT_URI` exactly — do not derive it from the `Host` header)
  - Launch URL / origin: the same public origin as `FRONT_END_URL`
  - Scopes: `openid profile email` (or whatever you put in `OIDC_SCOPES`)
  - Issuer: Authentik shows this on the provider as
    `https://auth.example.com/application/o/<slug>/` — copy it into `OIDC_ISSUER`

  Vaultisse sends `prompt=login` on every SSO start so Authentik cannot
  silently reuse an existing IdP session (implicit-consent flows otherwise
  always return the same user). Who can open the Authentik application is
  who can sign in (and, on first visit, get a new isolated Vaultisse
  catalog). Restrict that in Authentik
  rather than relying on `REGISTRATION_REQUIRES_APPROVAL` (SSO JIT ignores
  it). Bind the app to `127.0.0.1` and set `TRUST_PROXY=true` when a reverse
  proxy sits in front — same as scenarios B/C. Local-dev redirect is
  `http://localhost:3000/auth/oidc/callback` (the API origin that serves
  `/login`, not the Vite port). Leave the four vars blank to keep
  password-only login. See [AUTHENTICATION.md](AUTHENTICATION.md#oidc--sso).

- **Approving a new registration**: with `REGISTRATION_REQUIRES_APPROVAL=true` (see
  `.env.example`), new accounts are created disabled and can't log in until you
  enable them - there's no admin UI for this, run:
  ```bash
  docker compose exec -T db psql -U <DB_USER> -d <DB_NAME> \
    -c "UPDATE users SET disabled = FALSE WHERE code = '<their username>';"
  ```
  See [AUTHENTICATION.md](AUTHENTICATION.md#registration-approval) for why this
  exists.

## Security checklist

- [ ] `ALLOW_DEV_AUTH=false`
- [ ] `JWT_SECRET` generated with `openssl rand -hex 32`, not left blank or default
- [ ] `DB_PASSWORD` is a real generated password
- [ ] `TRUST_PROXY=true` for scenarios B/C/D-public, `false` for A and LAN-only D
- [ ] `APP_TAG` pinned to a version, not tracking `latest` unattended
- [ ] Scenario A: port not forwarded on your router
- [ ] Scenario B: app port bound to `127.0.0.1`, only 80/443 open on the firewall
- [ ] Scenario C: `TRUST_PROXY=true` is set (easy to forget since Cloudflare "just
      works" even without it — but rate limiting silently degrades without it)
- [ ] Scenario D, if exposed publicly: Vaultisse (+ its proxy/tunnel + its own
      Postgres) on a dedicated custom Docker network, not `bridge` or `br0`/macvlan,
      and not sharing that network or its database with unrelated containers
