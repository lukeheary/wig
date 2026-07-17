import { and, count, eq, sql } from "drizzle-orm";
import { db } from "@/server/db";
import {
  userActivationTaskActions,
  userActivationTasks,
} from "@/server/db/schema";

export const ACTIVATION_TASKS = {
  add_friends: 3,
  follow_places: 2,
  add_profile_photo: 1,
} as const;

export type ActivationTaskKey = keyof typeof ACTIVATION_TASKS;

export async function recordActivationAction(
  userId: string,
  taskKey: ActivationTaskKey,
  subjectId: string
) {
  const existingTask = await db.query.userActivationTasks.findFirst({
    where: and(
      eq(userActivationTasks.userId, userId),
      eq(userActivationTasks.taskKey, taskKey)
    ),
  });

  if (existingTask?.completedAt) return;

  await db
    .insert(userActivationTaskActions)
    .values({ userId, taskKey, subjectId })
    .onConflictDoNothing({
      target: [
        userActivationTaskActions.userId,
        userActivationTaskActions.taskKey,
        userActivationTaskActions.subjectId,
      ],
    });

  const [result] = await db
    .select({ value: count() })
    .from(userActivationTaskActions)
    .where(
      and(
        eq(userActivationTaskActions.userId, userId),
        eq(userActivationTaskActions.taskKey, taskKey)
      )
    );
  const progress = result?.value ?? 0;
  const completedAt = progress >= ACTIVATION_TASKS[taskKey] ? new Date() : null;

  await db
    .insert(userActivationTasks)
    .values({ userId, taskKey, progress, completedAt })
    .onConflictDoUpdate({
      target: [userActivationTasks.userId, userActivationTasks.taskKey],
      set: {
        progress: sql`greatest(${userActivationTasks.progress}, ${progress})`,
        completedAt: completedAt
          ? sql`coalesce(${userActivationTasks.completedAt}, ${completedAt})`
          : userActivationTasks.completedAt,
        updatedAt: new Date(),
      },
    });
}

export async function recordActivationActionBestEffort(
  userId: string,
  taskKey: ActivationTaskKey,
  subjectId: string
) {
  try {
    await recordActivationAction(userId, taskKey, subjectId);
  } catch (error) {
    // Activation progress must never turn an otherwise successful user action
    // into an error. The activation GET endpoint can recover missed progress
    // from the primary relationship/profile state on its next load.
    console.error("Failed to record activation action", {
      error,
      userId,
      taskKey,
      subjectId,
    });
  }
}

export async function activationState(userId: string) {
  const rows = await db.query.userActivationTasks.findMany({
    where: eq(userActivationTasks.userId, userId),
  });
  const byKey = new Map(rows.map((row) => [row.taskKey, row]));

  const tasks = (Object.entries(ACTIVATION_TASKS) as [ActivationTaskKey, number][])
    .map(([key, target]) => {
      const row = byKey.get(key);
      return {
        key,
        progress: Math.min(row?.progress ?? 0, target),
        target,
        isComplete: Boolean(row?.completedAt),
      };
    });

  return { tasks, isComplete: tasks.every((task) => task.isComplete) };
}
