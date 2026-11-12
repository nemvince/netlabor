# netlabor

Browser-first network lab control plane, AGPL-3.0-or-later. Architecture and
operations live in `apps/docs/src/content/docs/` (the Astro site in `apps/docs`).

## Development

```bash
bun install
bun run dev                # controller + agent + Vite (see scripts/dev.ts)
bun run typecheck          # tsc -b
bun run lint               # Biome checks; Bun ships no built-in lint command
bun fmt                    # Bun's built-in formatter (options in bunfig.toml)
bun test                   # unit tests
bun run test:integration   # needs NB_TEST_DATABASE_URL and a test database
bun run test:agent         # needs root and the dataplane tools
bun run test:e2e           # Playwright against a running stack
bun run build              # compiled controller/agent binaries and web bundle
bun run db:migrate         # apply migrations to NB_DATABASE_URL
bun run smoke              # login/project/node checks against a running stack
bun run scripts/load.ts    # 100-VPCS start/stop and orphan check
bun run scripts/fetch-test-assets.ts   # Alpine qcow2 into e2e/assets
```

Formatting is Bun's built-in `bun fmt` (Prettier-compatible; `[fmt]` section in
`bunfig.toml`). Linting remains Biome (`bun run lint`); Biome's formatter is
disabled so the two tools never fight over whitespace.
