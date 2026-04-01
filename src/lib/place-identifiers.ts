export const PLACE_SLUG_REGEX = /^[a-z0-9._-]+$/;
export const INSTAGRAM_HANDLE_REGEX = /^[A-Za-z0-9._]+$/;

export const PLACE_SLUG_ERROR =
  "Slug must be lowercase alphanumeric and may include periods, hyphens, or underscores";

export const INSTAGRAM_HANDLE_ERROR =
  "Instagram handle may only include letters, numbers, periods, and underscores";

export function slugToInstagramHandle(slug: string) {
  return slug.replace(/-/g, "");
}
