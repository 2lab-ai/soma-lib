# soma-lib

Shared hexagonal core for [soma](https://github.com/2lab-ai/soma) (Telegram/Slack
personal bot) and [soma-work](https://github.com/2lab-ai/soma-work) (Slack work
harness). Common code is extracted here **one module at a time** until both apps
are glue code assembling this library. The step-by-step plan lives in
[docs/ROADMAP.md](docs/ROADMAP.md).

## Layering (hexagonal)

| Layer | Path | Rule |
|---|---|---|
| Domain | `src/domain/*` | Pure logic. No I/O, no framework imports, no env access. Fully unit-testable. |
| Ports | `src/ports/*` | Interfaces the domain needs from the outside world (storage, clock, messenger…). *(none yet)* |
| Adapters | `src/adapters/*` | Shared implementations of ports (fs storage, Slack/Telegram messengers…). *(none yet — they live in the apps until extracted)* |

Application policy (what to DO with a domain verdict — deny vs ask vs log) stays
in the consuming apps.

## Modules

- **`domain/command-safety`** — dangerous-shell-command rule catalog + pure
  matching engine. Canonical catalog `DANGEROUS_RULES` (from soma-work) plus
  `createRuleSet()` for project-specific catalogs (soma). Standalone lockdown
  matchers `isCrossUserAccess` / `isSshCommand`.

## Consuming

Consumers install the **release tarball over plain HTTPS** — deliberately not a
`git:` dependency: deploy runners carry a global gitconfig `insteadOf` token
rewrite that can go stale and break git-protocol fetches even for public repos.

```jsonc
// package.json (npm — soma-work, or bun — soma)
"dependencies": {
  "soma-lib": "https://github.com/2lab-ai/soma-lib/releases/download/v0.1.0/soma-lib-0.1.0.tgz"
}
```

- **npm / node (soma-work)**: resolves `main`/`types` → committed `dist/`
  (CommonJS + `.d.ts`). No install-time build, no lifecycle scripts.
- **bun (soma)**: the `bun` export condition points at `src/index.ts` — bun runs
  the TypeScript source directly.

`dist/` is committed and shipped in the tarball; CI verifies it is in sync with
`src/`.

### Local development against an unreleased soma-lib

```bash
# in the consumer repo
npm install /path/to/soma-lib          # npm: installs by pack, includes dist
bun add file:/path/to/soma-lib         # bun
```

Rebuild `dist/` (`npm run build`) after editing `src/` when testing the npm path.

## Releasing

```bash
npm run check          # tsc --noEmit + vitest
npm run build          # refresh dist/ — commit the result
git tag vX.Y.Z && git push --tags
npm pack               # soma-lib-X.Y.Z.tgz
gh release create vX.Y.Z soma-lib-X.Y.Z.tgz --title "vX.Y.Z" --notes "..."
```

Then bump the tarball URL in each consumer and let their gates verify.
