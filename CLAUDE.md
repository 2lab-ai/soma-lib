# soma-lib

Shared hexagonal core for soma + soma-work. Layering and consumption rules:
README.md. Step-by-step convergence plan: docs/ROADMAP.md.

## Extraction protocol — update-vs-new gate (MANDATORY)

Every "add something to soma-lib" task starts with a dedup decision. Similar
code has been duplicated before when this was skipped; the gate exists to make
that impossible to skip silently.

1. **Read [MODULES.md](MODULES.md) first** — the full inventory, with
   Covers / Does NOT cover per module.
2. **Search before you write**: grep `src/` for the concepts and keywords of
   what you're about to add (each inventory entry lists its keywords). Also
   check both consumers for a counterpart implementation — an extraction that
   ignores one side creates the next duplicate.
3. **Decide**: extend an existing module (default when the purpose overlaps
   even partially — prefer generalizing, like `createRuleSet` did for
   per-project catalogs) or create a new one (only when Covers/Does-NOT-cover
   shows a genuinely disjoint purpose).
4. **Record**: write/update the MODULES.md entry, including the
   **Overlap decision** field: what you compared against and why
   extend-or-new. CI (`scripts/check-module-inventory.sh`) fails without it.
5. New modules also get a ROADMAP.md step-log line.

## Gates

`npm run check` (tsc + vitest) · `npm run build` then commit dist/ (CI verifies
freshness) · `./scripts/smoke-pack.sh` (package boundary) ·
`./scripts/check-module-inventory.sh` (this gate). All four run in CI.

## Releasing

See README.md §Releasing — tag + `npm pack` tarball as a GitHub Release asset;
consumers pin the asset URL.
