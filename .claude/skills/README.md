# .claude/skills (generated)

Regenerate the mirrors with `pnpm run sync:agents` after editing `.agents/skills/`.
Run `pnpm run sync:agents --check` to check mirror drift on demand.

Add Claude-only skills directly in `.claude/skills/`. Sync preserves them and any skills listed
in `skills-lock.json`.

Why a copy: Claude Code reads skills only from `.claude/skills/`, most other agents read
`.agents/skills/`. Real files instead of symlinks keep the mirror intact after ZIP extraction.
