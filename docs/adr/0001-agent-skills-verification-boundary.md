# Keep agent skill maintenance separate from project verification

AstroDeck ships skills and can carry skills installed by external tools. Repository-wide format,
lint, type, and link checks exclude `.agents/` and `.claude/skills/` so tool-specific metadata and
installer-managed symlinks can remain intact. Verification still tests the starter brief and
recipe contracts. Maintainers check the first-party Claude mirror on demand with
`pnpm run sync:agents --check`.
