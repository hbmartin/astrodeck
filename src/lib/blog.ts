import { getCollection } from 'astro:content';

/**
 * All blog posts that should be visible: drafts (`draft: true` in the front
 * matter) are shown in dev but left out of production builds.
 */
export async function getPublishedPosts() {
  return getCollection('blog', ({ data }) => import.meta.env.DEV || !data.draft);
}

export function formatDate(date: Date) {
  return new Date(date).toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
}
