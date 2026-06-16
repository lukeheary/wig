import { sql, type SQL, type SQLWrapper } from "drizzle-orm";

export function accentInsensitiveLike(
  value: SQLWrapper,
  query: string,
  {
    coalesceToEmpty = false,
  }: {
    coalesceToEmpty?: boolean;
  } = {}
): SQL {
  const pattern = `%${query.trim()}%`;
  const expression = coalesceToEmpty ? sql`COALESCE(${value}, '')` : sql`${value}`;

  return sql`unaccent(LOWER(${expression})) LIKE unaccent(LOWER(${pattern}))`;
}
