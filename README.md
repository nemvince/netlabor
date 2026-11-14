# netlabor

Browser-first network lab control plane, AGPL-3.0-or-later. Architecture and
operations live in `apps/docs/src/content/docs/` (the Astro site in `apps/docs`).

## Quick start (fresh clone)

```bash
bun install
bun run dev
```

`bun run dev` provisions everything a first run needs, idempotently:

- writes `.env` if it is missing (generated secret, local paths under `.dev/`);
- starts a local PostgreSQL cluster in `.dev/postgres` when no server is reachable
  (needs `pg_ctl`/`initdb` on `PATH` or via mise);
- creates and migrates the `netlabor` database;
- registers the local agent as a compute named `dev`;
- starts the controller, the agent, and Vite.

Runtime state lives in `/var/tmp/netlabor-dev` (state and run dirs), not in the
checkout: emulators drop to an unprivileged uid and must be able to traverse
every parent directory, which a `0750` home directory prevents. Images and
staging keep their `/var/lib/netlabor` defaults so replicas survive restarts.

Open `http://localhost:5173` and finish the first-run setup wizard to create the
admin account. The agent runs under `sudo` when passwordless sudo is available
(it needs root for namespaces); otherwise it starts unprivileged, the UI works,
and starting nodes fails with a warning printed at boot.

## Development

```bash
bun install
bun run dev                # provisions + controller + agent + Vite (see scripts/dev.ts)
bun run typecheck          # bun check
bun fmt                    # Bun's built-in formatter (options in bunfig.toml)
bun test                   # unit tests
bun run test:integration   # needs NB_TEST_DATABASE_URL and a test database
bun run test:agent         # needs root and the dataplane tools
bun run test:e2e           # Playwright against a running stack
bun run build              # compiled controller (UI embedded) and agent binaries
bun run docs:dev           # Astro docs site with live reload
bun run docs:check         # astro check over the docs site
bun run docs:build         # static docs site into apps/docs/dist
bun run db:migrate         # apply migrations to NB_DATABASE_URL
bun run smoke              # login/project/node checks against a running stack
bun run scripts/load.ts    # 100-VPCS start/stop and orphan check
bun run scripts/fetch-test-assets.ts   # Alpine qcow2 into e2e/assets
```

Formatting and type checking are Bun's built-in `bun fmt` and `bun check`
(`[fmt]` section in `bunfig.toml`).

## Updates

Controllers installed from a release build update themselves from GitHub. Set
the release channel under **Settings → Controller → Controller updates**: stable
follows tagged releases, nightly follows every commit on `main`. The updater
verifies `SHA256SUMS` and replaces the binary in `/opt/netlabor`, then restarts
through systemd. The UI ships inside the binary, so a binary update also updates
the frontend.

## Installing from a release

One script installs either or both roles on Debian/Ubuntu, without cloning the
repository:

```sh
curl -fsSL https://raw.githubusercontent.com/nemvince/netlabor/main/scripts/install.sh | sudo bash
```

It asks which roles to install and prompts for the settings it needs (public URL,
admin password, compute token, underlay). For scripted installs, pass flags:
`--controller`, `--agent`, `--all`, `--yes`, `--skip-deps`, `--public-url`,
`--admin-password`, `--database-url`, `--token`, `--with-docker`, `--with-nat`,
`--version <tag|nightly>`; `scripts/install.sh --help` lists them all.
