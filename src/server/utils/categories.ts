import { and, asc, eq, inArray } from "drizzle-orm";
import {
  categories,
  eventCategories,
  eventSeriesCategories,
  placeCategories,
} from "@/server/db/schema";

export interface CategoryOption {
  id: string;
  key: string;
  label: string;
  sortOrder: number;
  isActive: boolean;
}

function normalizeCategoryKey(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export async function listCategoryOptions(
  db: any,
  options: { includeInactive?: boolean } = {}
): Promise<CategoryOption[]> {
  const conditions = [];
  if (!options.includeInactive) {
    conditions.push(eq(categories.isActive, true));
  }

  return await db
    .select({
      id: categories.id,
      key: categories.key,
      label: categories.label,
      sortOrder: categories.sortOrder,
      isActive: categories.isActive,
    })
    .from(categories)
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .orderBy(asc(categories.sortOrder), asc(categories.label));
}

export async function filterExistingCategoryKeys(
  db: any,
  categoryKeys: string[],
  options: { activeOnly?: boolean } = {}
) {
  const normalized = Array.from(
    new Set(
      categoryKeys
        .map((value) => normalizeCategoryKey(value))
        .filter((value) => value.length > 0)
    )
  );

  if (normalized.length === 0) return [];

  const conditions = [inArray(categories.key, normalized)];
  if (options.activeOnly) {
    conditions.push(eq(categories.isActive, true));
  }

  const rows = await db
    .select({ key: categories.key })
    .from(categories)
    .where(and(...conditions));

  const valid = new Set(rows.map((row: { key: string }) => row.key));
  return normalized.filter((key) => valid.has(key));
}

export async function setPlaceCategoryKeys(
  db: any,
  placeId: string,
  categoryKeys: string[],
  options: { activeOnly?: boolean } = {}
) {
  const validKeys = await filterExistingCategoryKeys(db, categoryKeys, options);

  await db.delete(placeCategories).where(eq(placeCategories.placeId, placeId));

  if (validKeys.length > 0) {
    const categoryRows = await db
      .select({ id: categories.id })
      .from(categories)
      .where(inArray(categories.key, validKeys));

    if (categoryRows.length > 0) {
      await db
        .insert(placeCategories)
        .values(
          categoryRows.map((row: { id: string }) => ({
            placeId,
            categoryId: row.id,
          }))
        )
        .onConflictDoNothing();
    }
  }

  return validKeys;
}

export function mapPlaceCategoryData<T extends { categoryLinks?: any[] }>(place: T) {
  const categoryDetails = (place.categoryLinks ?? [])
    .map((link) => link?.category)
    .filter(Boolean)
    .sort((a, b) => {
      if (a.sortOrder !== b.sortOrder) return a.sortOrder - b.sortOrder;
      return a.label.localeCompare(b.label);
    });

  const categoryLabels = Object.fromEntries(
    categoryDetails.map((category) => [category.key, category.label])
  );

  return {
    ...place,
    categories: categoryDetails.map((category) => category.key),
    categoryLabels,
  };
}

export async function setEventCategoryKeys(
  db: any,
  eventId: string,
  categoryKeys: string[],
  options: { activeOnly?: boolean } = {}
) {
  const validKeys = await filterExistingCategoryKeys(db, categoryKeys, options);

  await db.delete(eventCategories).where(eq(eventCategories.eventId, eventId));

  if (validKeys.length > 0) {
    const categoryRows = await db
      .select({ id: categories.id })
      .from(categories)
      .where(inArray(categories.key, validKeys));

    if (categoryRows.length > 0) {
      await db
        .insert(eventCategories)
        .values(
          categoryRows.map((row: { id: string }) => ({
            eventId,
            categoryId: row.id,
          }))
        )
        .onConflictDoNothing();
    }
  }

  return validKeys;
}

export async function setEventSeriesCategoryKeys(
  db: any,
  seriesId: string,
  categoryKeys: string[],
  options: { activeOnly?: boolean } = {}
) {
  const validKeys = await filterExistingCategoryKeys(db, categoryKeys, options);

  await db
    .delete(eventSeriesCategories)
    .where(eq(eventSeriesCategories.seriesId, seriesId));

  if (validKeys.length > 0) {
    const categoryRows = await db
      .select({ id: categories.id })
      .from(categories)
      .where(inArray(categories.key, validKeys));

    if (categoryRows.length > 0) {
      await db
        .insert(eventSeriesCategories)
        .values(
          categoryRows.map((row: { id: string }) => ({
            seriesId,
            categoryId: row.id,
          }))
        )
        .onConflictDoNothing();
    }
  }

  return validKeys;
}

export function mapEventCategoryData<T extends { categoryLinks?: any[] }>(event: T) {
  const categoryDetails = (event.categoryLinks ?? [])
    .map((link) => link?.category)
    .filter(Boolean)
    .sort((a, b) => {
      if (a.sortOrder !== b.sortOrder) return a.sortOrder - b.sortOrder;
      return a.label.localeCompare(b.label);
    });

  const categoryLabels = Object.fromEntries(
    categoryDetails.map((category) => [category.key, category.label])
  );

  return {
    ...event,
    categories: categoryDetails.map((category) => category.key),
    categoryLabels,
  };
}

export function mapEventSeriesCategoryData<T extends { categoryLinks?: any[] }>(
  series: T
) {
  const categoryDetails = (series.categoryLinks ?? [])
    .map((link) => link?.category)
    .filter(Boolean)
    .sort((a, b) => {
      if (a.sortOrder !== b.sortOrder) return a.sortOrder - b.sortOrder;
      return a.label.localeCompare(b.label);
    });

  const categoryLabels = Object.fromEntries(
    categoryDetails.map((category) => [category.key, category.label])
  );

  return {
    ...series,
    categories: categoryDetails.map((category) => category.key),
    categoryLabels,
  };
}
