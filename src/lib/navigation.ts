type SearchParamsLike =
  | Pick<URLSearchParams, "toString">
  | null
  | undefined;

const SCROLL_RESTORE_KEY_PREFIX = "wig:scroll-restore:";

export function sanitizeReturnTo(returnTo: string | null | undefined) {
  if (!returnTo) return null;
  if (!returnTo.startsWith("/")) return null;
  if (returnTo.startsWith("//")) return null;
  return returnTo;
}

export function resolveBackHref({
  returnTo,
  fallbackHref,
}: {
  returnTo?: string | null;
  fallbackHref: string;
}) {
  return sanitizeReturnTo(returnTo) ?? fallbackHref;
}

export function buildReturnTo(
  pathname: string,
  searchParams?: SearchParamsLike
) {
  const query = searchParams?.toString();
  return query ? `${pathname}?${query}` : pathname;
}

export function withReturnTo(href: string, returnTo?: string | null) {
  const safeReturnTo = sanitizeReturnTo(returnTo);
  if (!safeReturnTo) return href;

  const [hrefWithoutHash, hash = ""] = href.split("#");
  const [pathname, query = ""] = hrefWithoutHash.split("?");
  const params = new URLSearchParams(query);
  params.set("returnTo", safeReturnTo);
  const nextQuery = params.toString();

  return `${pathname}${nextQuery ? `?${nextQuery}` : ""}${hash ? `#${hash}` : ""}`;
}

export function getScrollRestoreKey(path: string) {
  return `${SCROLL_RESTORE_KEY_PREFIX}${path}`;
}
