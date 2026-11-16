# Astro 7 and Tailwind 4 conventions

Check current Astro documentation when working with framework APIs. The optional Astro Docs
MCP server is described in [MCP setup](mcp-setup.md).

## Astro templates and configuration

- Close and nest tags correctly. The Astro compiler rejects malformed markup.
- The default `compressHTML: 'jsx'` can remove whitespace between elements. Use `{" "}` where
  inline elements on separate lines need a separating space.
- Use explicit string expressions such as `{'Label'}` when exact component slot text matters.
  The format command checks slot text before writing Astro source.
- Use `{/* */}` for comments inside `.map()` expressions.
- Reserve `fetch.ts` in `src/` for the Astro fetch entrypoint (`fetchFile`).
- Use `ClientRouter` from `astro:transitions` for client routing.
- Keep `@astrojs/db` out of AstroDeck's dependencies.

## Markdown and content collections

- Astro defaults to Sätteri for Markdown. To use remark or rehype plugins, set
  `markdown.processor` to `unified()` from `@astrojs/markdown-remark`.
- Define collections in `src/content.config.ts` with the `glob()` loader and use entries' `id`
  field. Import `z` from `astro/zod`.

## Tailwind

- Configure Tailwind with `@import 'tailwindcss'`, `@theme` and the `@tailwindcss/vite` plugin.
  Keep `tailwind.config.*` and `@astrojs/tailwind` out of the project.
  Tailwind's `container` has no built-in padding, so apply `px-6` to the section.
- Dark mode uses the `.dark` class and the custom variant in `src/styles/globals.css`.
