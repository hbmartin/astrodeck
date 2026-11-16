# Copilot instructions — AstroDeck

Read `AGENTS.md` at the repository root. For site changes, read the brief in `PROJECT.md`.

Skills for common tasks are in `.agents/skills/<name>/SKILL.md`:

- `astrodeck-build-site`: build a complete website from the user's brief
- `astrodeck-new-page`, `astrodeck-new-section`: add pages and sections
- `astrodeck-theme`: brand colors, fonts, radius
- `astrodeck-cleanup`: remove the demo content

Key rules (details in `AGENTS.md`): semantic color tokens only, content only from the brief
(never invented), and brand and navigation only in `src/config/site.ts`. Follow the verification
command in `AGENTS.md`.
