export function buildGamePublicPath(slug: string): string {
  return `/promo/${slug.trim().toLowerCase()}`;
}

export function buildGamePublicUrl(slug: string, origin?: string | null): string {
  const path = buildGamePublicPath(slug);
  if (origin) {
    return `${origin.replace(/\/$/, "")}${path}`;
  }
  return path;
}

export function normalizeGameSlug(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export const GAME_SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
