import { and, asc, eq, inArray, isNull, lt, ne, or, sql } from "drizzle-orm";

import { db } from "../index";
import {
  studyAudioWeeks,
  studyDailyVideos,
  type StudyAudioTrackManifest,
  type StudyFootageManifest,
  type StudyMusicGenerationManifest,
} from "../schema";
import {
  STUDY_ASSEMBLY_STALE_MS,
  studyAudioWeekStatusForRights,
} from "@/lib/study/project";

export async function createStudyAudioWeek(weekNumber: number) {
  const [created] = await db.insert(studyAudioWeeks).values({ weekNumber }).returning();
  return created;
}

export async function getStudyAudioWeek(id: number) {
  const [row] = await db.select().from(studyAudioWeeks).where(eq(studyAudioWeeks.id, id)).limit(1);
  return row ?? null;
}

export async function getStudyAudioWeekByNumber(weekNumber: number) {
  const [row] = await db
    .select()
    .from(studyAudioWeeks)
    .where(eq(studyAudioWeeks.weekNumber, weekNumber))
    .limit(1);
  return row ?? null;
}

export async function listStudyAudioWeeks() {
  return db.select().from(studyAudioWeeks).orderBy(asc(studyAudioWeeks.weekNumber));
}

export async function updateStudyAudioWeekScan(input: {
  id: number;
  trackManifest: StudyAudioTrackManifest;
  totalDurationSec: number;
  rightsVerifiedAt: Date | null;
}) {
  const [updated] = await db
    .update(studyAudioWeeks)
    .set({
      status: studyAudioWeekStatusForRights(input.rightsVerifiedAt),
      trackManifest: input.trackManifest,
      totalDurationSec: input.totalDurationSec,
      rightsVerifiedAt: input.rightsVerifiedAt,
      errorMessage: null,
      updatedAt: new Date(),
    })
    .where(eq(studyAudioWeeks.id, input.id))
    .returning();
  return updated ?? null;
}

export async function claimStudyAudioWeekForGeneration(input: {
  id: number;
  runId: string;
  generationManifest: StudyMusicGenerationManifest;
  staleBefore: Date;
}) {
  const now = new Date();
  const [claimed] = await db
    .update(studyAudioWeeks)
    .set({
      status: "generating",
      generationManifest: input.generationManifest,
      generationRunId: input.runId,
      generationStartedAt: now,
      generationHeartbeatAt: now,
      generationFinishedAt: null,
      trackManifest: null,
      totalDurationSec: null,
      rightsVerifiedAt: null,
      errorMessage: null,
      updatedAt: now,
    })
    .where(
      and(
        eq(studyAudioWeeks.id, input.id),
        or(
          inArray(studyAudioWeeks.status, ["draft", "failed"]),
          and(
            eq(studyAudioWeeks.status, "generating"),
            or(
              isNull(studyAudioWeeks.generationHeartbeatAt),
              lt(studyAudioWeeks.generationHeartbeatAt, input.staleBefore),
            ),
          ),
        ),
      ),
    )
    .returning();
  return claimed ?? null;
}

export async function claimStudyAudioWeekTrackRegeneration(input: {
  id: number;
  runId: string;
  generationManifest: StudyMusicGenerationManifest;
  expectedUpdatedAt: Date;
  staleBefore: Date;
}) {
  return db.transaction(async (tx) => {
    const [current] = await tx
      .select({
        status: studyAudioWeeks.status,
        updatedAt: studyAudioWeeks.updatedAt,
        generationHeartbeatAt: studyAudioWeeks.generationHeartbeatAt,
      })
      .from(studyAudioWeeks)
      .where(eq(studyAudioWeeks.id, input.id))
      .limit(1)
      .for("update");
    if (!current || current.updatedAt.getTime() !== input.expectedUpdatedAt.getTime()) return null;

    const canClaimCompletedAlbum = inArray(
      studyAudioWeeks.status,
      ["ready", "awaiting_rights"],
    );
    const canResumeStaleRegeneration = and(
      eq(studyAudioWeeks.status, "generating"),
      or(
        isNull(studyAudioWeeks.generationHeartbeatAt),
        lt(studyAudioWeeks.generationHeartbeatAt, input.staleBefore),
      ),
    );
    const now = new Date();
    const [claimed] = await tx
      .update(studyAudioWeeks)
      .set({
        status: "generating",
        generationManifest: input.generationManifest,
        generationRunId: input.runId,
        generationStartedAt: now,
        generationHeartbeatAt: now,
        generationFinishedAt: null,
        errorMessage: null,
        updatedAt: now,
      })
      .where(
        and(
          eq(studyAudioWeeks.id, input.id),
          eq(studyAudioWeeks.updatedAt, input.expectedUpdatedAt),
          or(canClaimCompletedAlbum, canResumeStaleRegeneration),
        ),
      )
      .returning();
    return claimed ?? null;
  });
}

export async function restoreStudyAudioWeekAfterRegenerationLaunchFailure(input: {
  id: number;
  runId: string;
  status: "ready" | "awaiting_rights";
  rightsVerifiedAt: Date | null;
  generationManifest: StudyMusicGenerationManifest;
  errorMessage: string;
}) {
  const now = new Date();
  const [updated] = await db
    .update(studyAudioWeeks)
    .set({
      status: input.status,
      rightsVerifiedAt: input.rightsVerifiedAt,
      generationManifest: input.generationManifest,
      generationFinishedAt: now,
      errorMessage: input.errorMessage,
      updatedAt: now,
    })
    .where(
      and(
        eq(studyAudioWeeks.id, input.id),
        eq(studyAudioWeeks.status, "generating"),
        eq(studyAudioWeeks.generationRunId, input.runId),
      ),
    )
    .returning();
  return updated ?? null;
}

export async function markStudyAudioWeekGenerationFailed(input: {
  id: number;
  runId: string;
  errorMessage: string;
}) {
  const now = new Date();
  const [updated] = await db
    .update(studyAudioWeeks)
    .set({
      status: "failed",
      errorMessage: input.errorMessage,
      generationFinishedAt: now,
      updatedAt: now,
    })
    .where(
      and(
        eq(studyAudioWeeks.id, input.id),
        eq(studyAudioWeeks.status, "generating"),
        eq(studyAudioWeeks.generationRunId, input.runId),
      ),
    )
    .returning();
  return updated ?? null;
}

export async function markStudyAudioWeekFailed(id: number, errorMessage: string) {
  const [updated] = await db
    .update(studyAudioWeeks)
    .set({ status: "failed", errorMessage, updatedAt: new Date() })
    .where(eq(studyAudioWeeks.id, id))
    .returning();
  return updated ?? null;
}

export async function createStudyDailyVideo(dayNumber: number, weekId: number) {
  const [created] = await db
    .insert(studyDailyVideos)
    .values({ dayNumber, weekId })
    .returning();
  return created;
}

export async function getStudyDailyVideo(id: number) {
  const [row] = await db
    .select()
    .from(studyDailyVideos)
    .where(eq(studyDailyVideos.id, id))
    .limit(1);
  return row ?? null;
}

export async function listStudyDailyVideos() {
  return db.select().from(studyDailyVideos).orderBy(asc(studyDailyVideos.dayNumber));
}

export async function findDuplicateStudyFootageHashes(
  hashes: string[],
  excludeVideoId: number,
): Promise<Array<{ sha256: string; dayNumber: number }>> {
  if (hashes.length === 0) return [];
  const wanted = new Set(hashes);
  const rows = await db
    .select({
      id: studyDailyVideos.id,
      dayNumber: studyDailyVideos.dayNumber,
      footageManifest: studyDailyVideos.footageManifest,
    })
    .from(studyDailyVideos);

  return rows.flatMap((row) => {
    if (row.id === excludeVideoId) return [];
    const files = row.footageManifest?.files ?? [];
    return files
      .filter((file) => wanted.has(file.sha256))
      .map((file) => ({ sha256: file.sha256, dayNumber: row.dayNumber }));
  });
}

export async function claimStudyDailyVideoForAssembly(input: {
  id: number;
  footageManifest: StudyFootageManifest;
  durationSec: number;
  inputSignature: string;
  staleBefore: Date;
  previewStaleBefore?: Date;
}): Promise<Date | null> {
  return db.transaction(async (tx) => {
    // Serialize manifest claims so two days cannot reserve the same footage.
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext('study-footage-claim'))`);
    const wantedHashes = new Set(input.footageManifest.files.map((file) => file.sha256));
    const existing = await tx
      .select({
        dayNumber: studyDailyVideos.dayNumber,
        footageManifest: studyDailyVideos.footageManifest,
      })
      .from(studyDailyVideos)
      .where(ne(studyDailyVideos.id, input.id));
    const duplicateDays = new Set<number>();
    for (const row of existing) {
      for (const file of row.footageManifest?.files ?? []) {
        if (wantedHashes.has(file.sha256)) duplicateDays.add(row.dayNumber);
      }
    }
    if (duplicateDays.size > 0) {
      throw new Error(
        `Footage was already used on day(s): ${[...duplicateDays].sort((a, b) => a - b).join(", ")}`,
      );
    }

    const now = new Date();
    const previewStaleBefore = input.previewStaleBefore ?? new Date(0);
    const claimed = await tx
      .update(studyDailyVideos)
      .set({
        status: "assembling",
        footageManifest: input.footageManifest,
        durationSec: input.durationSec,
        inputSignature: input.inputSignature,
        finalVideoPath: null,
        errorMessage: null,
        assemblyStartedAt: now,
        assemblyFinishedAt: null,
        updatedAt: now,
      })
      .where(
        and(
          eq(studyDailyVideos.id, input.id),
          or(
            ne(studyDailyVideos.status, "assembling"),
            isNull(studyDailyVideos.assemblyStartedAt),
            lt(studyDailyVideos.assemblyStartedAt, input.staleBefore),
          ),
          or(
            ne(studyDailyVideos.previewStatus, "rendering"),
            isNull(studyDailyVideos.previewHeartbeatAt),
            lt(studyDailyVideos.previewHeartbeatAt, previewStaleBefore),
          ),
        ),
      )
      .returning({ assemblyStartedAt: studyDailyVideos.assemblyStartedAt });
    return claimed[0]?.assemblyStartedAt ?? null;
  });
}

export async function claimStudyDailyVideoForPreview(input: {
  id: number;
  runId: string;
  requestedOffsetSec: number;
  actualOffsetSec: number;
  assemblyStaleBefore: Date;
  previewStaleBefore: Date;
}): Promise<Date | null> {
  const now = new Date();
  const claimed = await db
    .update(studyDailyVideos)
    .set({
      previewStatus: "rendering",
      previewRunId: input.runId,
      previewHeartbeatAt: now,
      previewRequestedOffsetSec: input.requestedOffsetSec,
      previewActualOffsetSec: input.actualOffsetSec,
      previewStartedAt: now,
      previewFinishedAt: null,
      previewErrorMessage: null,
      updatedAt: now,
    })
    .where(
      and(
        eq(studyDailyVideos.id, input.id),
        or(
          ne(studyDailyVideos.status, "assembling"),
          isNull(studyDailyVideos.assemblyStartedAt),
          lt(studyDailyVideos.assemblyStartedAt, input.assemblyStaleBefore),
        ),
        or(
          ne(studyDailyVideos.previewStatus, "rendering"),
          isNull(studyDailyVideos.previewHeartbeatAt),
          lt(studyDailyVideos.previewHeartbeatAt, input.previewStaleBefore),
        ),
      ),
    )
    .returning({ previewStartedAt: studyDailyVideos.previewStartedAt });
  return claimed[0]?.previewStartedAt ?? null;
}

export async function touchStudyDailyVideoPreviewHeartbeat(input: {
  id: number;
  runId: string;
}): Promise<boolean> {
  const result = await db
    .update(studyDailyVideos)
    .set({ previewHeartbeatAt: new Date(), updatedAt: new Date() })
    .where(
      and(
        eq(studyDailyVideos.id, input.id),
        eq(studyDailyVideos.previewStatus, "rendering"),
        eq(studyDailyVideos.previewRunId, input.runId),
      ),
    );
  return result.rowCount === 1;
}

export async function markStudyDailyVideoPreviewFailed(input: {
  id: number;
  runId: string;
  errorMessage: string;
}): Promise<boolean> {
  const now = new Date();
  const result = await db
    .update(studyDailyVideos)
    .set({
      previewStatus: "failed",
      previewErrorMessage: input.errorMessage.slice(0, 4000),
      previewFinishedAt: now,
      updatedAt: now,
    })
    .where(
      and(
        eq(studyDailyVideos.id, input.id),
        eq(studyDailyVideos.previewStatus, "rendering"),
        eq(studyDailyVideos.previewRunId, input.runId),
      ),
    );
  return result.rowCount === 1;
}

export async function markStudyDailyVideoFailed(
  id: number,
  errorMessage: string,
  expectedAssemblyStartedAt?: Date | null,
) {
  const staleBefore = new Date(Date.now() - STUDY_ASSEMBLY_STALE_MS);
  const failureGuard = expectedAssemblyStartedAt
    ? and(
        eq(studyDailyVideos.status, "assembling"),
        eq(studyDailyVideos.assemblyStartedAt, expectedAssemblyStartedAt),
      )
    : or(
        inArray(studyDailyVideos.status, ["draft", "failed"]),
        and(
          eq(studyDailyVideos.status, "assembling"),
          or(
            isNull(studyDailyVideos.assemblyStartedAt),
            lt(studyDailyVideos.assemblyStartedAt, staleBefore),
          ),
        ),
      );
  const [updated] = await db
    .update(studyDailyVideos)
    .set({
      status: "failed",
      errorMessage,
      assemblyFinishedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(and(eq(studyDailyVideos.id, id), failureGuard))
    .returning();
  return updated ?? null;
}
