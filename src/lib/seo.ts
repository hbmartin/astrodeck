export type SocialImage = {
  path: string;
  alt: string;
  width: number;
  height: number;
};

function sameOriginImage(path: string, siteUrl: URL): URL {
  const url = new URL(path, siteUrl);
  if (!path.trim() || url.origin !== siteUrl.origin || [url.username, url.password].some(Boolean)) {
    throw new Error('Social image must have a same-origin path.');
  }
  return url;
}

function explicitSocialImage(image: SocialImage, siteUrl: URL) {
  const { path, alt, width, height } = image;
  if (!alt.trim() || ![width, height].every((n) => Number.isSafeInteger(n) && n > 0)) {
    throw new Error('Social image requires alt text and positive integer dimensions.');
  }
  return { url: sameOriginImage(path, siteUrl), alt, width, height };
}

export function resolveSocialImage(
  image: string | SocialImage,
  siteUrl: URL,
  title: string
): { url: URL; alt: string; width?: number; height?: number } | undefined {
  if (typeof image !== 'string') return explicitSocialImage(image, siteUrl);
  if (image) return { url: new URL(image, siteUrl), alt: title };
}
