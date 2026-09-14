import { pool } from "@/lib/db";
import {
  createKoJob,
  listUnconsumedDoneKoJobs,
  listUnconsumedFailedKoJobs,
  markKoJobConsumed,
  markKoJobHandlerFailed,
  resetStaleRunningKoJobs,
} from "@/lib/db/repo/jobs";
import { setKoConfigValue, KO_CONFIG_KEYS } from "@/lib/db/repo/config";
import { getPromptVersionById } from "@/lib/db/repo/prompts";
import {
  getFirstIncompleteKoSection,
  getKoSection,
  getKoVideo,
  initializeKoSections,
  listKoSections,
  listVideosAwaitingTranscript,
  markKoVideoNeedsAttention,
  updateKoSection,
  updateKoVideo,
} from "@/lib/db/repo/videos";
import type { KoJob, KoSection, KoVideo } from "@/lib/db/schema";
import {
  AUDIT_EFFORT,
  OUTLINE_EFFORT,
  REQUIRED_MODEL,
  SECTION_EFFORT,
} from "@/lib/pipeline/default-prompts";
import {
  buildFidelityReviewPrompt,
  buildFidelitySectionRepairPrompt,
  buildOutlinePrompt,
  buildRepairPrompt,
  buildSectionPrompt,
  buildSourceAuditPrompt,
} from "@/lib/pipeline/prompts";
import {
  readRawTranscriptArtifact,
  writeFinalScript,
  writeRawTranscript,
  writeSourceTranscript,
} from "@/lib/pipeline/storage";
import {
  assertKoreanTranscript,
  downloadTranscriptArtifact,
  downloadTranscriptJsonArtifact,
  getTranscriptJob,
  parseTranscriptText,
  selectTranscriptSegments,
} from "@/lib/pipeline/yt-pro-max";
import {
  validateFidelityReview,
  validateOutline,
  validateSectionText,
  validateSourceAudit,
  type FidelityReview,
  type KoOutlineSection,
  type SourceAudit,
  type SourceFact,
} from "@/lib/pipeline/validators";

const MAX_VALIDATION_REPAIRS = 2;
const MAX_FIDELITY_REPAIR_CYCLES = 2;
const CHAIN_LOCK_KEY = "auto_yt_ko_chain_cycle";

function getSourceAudit(video: KoVideo): SourceAudit {
  if (!video.sourceAudit) throw new Error("Video source audit is missing.");
  return video.sourceAudit as SourceAudit;
}

function getSourceFacts(video: KoVideo): SourceFact[] {
  return getSourceAudit(video).required_facts;
}

function getFidelityRepairForSection(video: KoVideo, sectionIndex: number) {
  const review = video.fidelityReview as FidelityReview & { review_cycle?: number } | null;
  if (!review || review.verdict !== "repair") return null;
  const repairs = review.repairs.filter((repair) => repair.section_index === sectionIndex);
  if (repairs.length === 0) return null;
  return {
    instructionsKo: repairs.map((repair) => repair.instructions_ko).join(" "),
    requiredFactIds: [...new Set(repairs.flatMap((repair) => repair.required_fact_ids))],
    reviewCycle: review.review_cycle ?? 0,
  };
}

export async function enqueueSourceAuditForVideo(
  video: KoVideo,
  input: {
    repairErrors?: string[];
    invalidResult?: string;
    validationAttempt?: number;
    retrofitExisting?: boolean;
  } = {},
) {
  if (!video.sourceAuditPromptVersionId) throw new Error("Video source audit prompt is not pinned.");
  const promptVersion = await getPromptVersionById(video.sourceAuditPromptVersionId);
  if (!promptVersion) throw new Error(`Source audit prompt version ${video.sourceAuditPromptVersionId} was not found.`);
  if (!video.sourceTitle || !video.rawTranscriptPath) throw new Error("Raw transcript is not ready for source audit.");

  const isRepair = !!input.repairErrors && input.invalidResult != null;
  const promptText = isRepair
    ? buildRepairPrompt({
        kind: "source_audit",
        errors: input.repairErrors ?? [],
        invalidResult: input.invalidResult ?? "",
      })
    : buildSourceAuditPrompt(promptVersion.template, video.sourceTitle);

  return createKoJob({
    videoId: video.id,
    kind: "source_audit",
    modelLabel: REQUIRED_MODEL,
    effort: AUDIT_EFFORT,
    promptText,
    promptVersionId: promptVersion.id,
    promptSnapshot: promptVersion.template,
    attachmentPath: isRepair ? null : video.rawTranscriptPath,
    validationAttempt: input.validationAttempt ?? 0,
    metadata: { repair: isRepair, retrofitExisting: input.retrofitExisting ?? false },
  });
}

export async function enqueueOutlineForVideo(
  video: KoVideo,
  input: { repairErrors?: string[]; invalidResult?: string; validationAttempt?: number } = {},
) {
  const promptVersion = await getPromptVersionById(video.outlinePromptVersionId);
  if (!promptVersion) throw new Error(`Outline prompt version ${video.outlinePromptVersionId} was not found.`);
  if (!video.sourceTitle || !video.transcriptPath) throw new Error("Video transcript is not ready for outlining.");

  const isRepair = !!input.repairErrors && input.invalidResult != null;
  const promptText = isRepair
    ? buildRepairPrompt({
        kind: "outline",
        errors: input.repairErrors ?? [],
        invalidResult: input.invalidResult ?? "",
      })
    : buildOutlinePrompt(promptVersion.template, video.sourceTitle, getSourceFacts(video));

  return createKoJob({
    videoId: video.id,
    kind: "outline",
    modelLabel: REQUIRED_MODEL,
    effort: OUTLINE_EFFORT,
    promptText,
    promptVersionId: promptVersion.id,
    promptSnapshot: promptVersion.template,
    attachmentPath: isRepair ? null : video.transcriptPath,
    validationAttempt: input.validationAttempt ?? 0,
    metadata: { repair: isRepair },
  });
}

export async function enqueueSectionForVideo(
  video: KoVideo,
  section: KoSection,
  input: {
    repairErrors?: string[];
    invalidResult?: string;
    validationAttempt?: number;
    fidelityRepair?: {
      instructionsKo: string;
      requiredFactIds: string[];
      reviewCycle: number;
    };
  } = {},
) {
  const promptVersion = await getPromptVersionById(video.sectionPromptVersionId);
  if (!promptVersion) throw new Error(`Section prompt version ${video.sectionPromptVersionId} was not found.`);
  if (!video.outline) throw new Error("Video outline is missing.");

  const isValidationRepair = !!input.repairErrors && input.invalidResult != null;
  const isFidelityRepair = !!input.fidelityRepair;
  const promptText = isFidelityRepair
    ? buildFidelitySectionRepairPrompt({
        section,
        currentBody: section.body ?? "",
        instructionsKo: input.fidelityRepair!.instructionsKo,
        requiredFacts: getSourceFacts(video).filter((fact) =>
          input.fidelityRepair!.requiredFactIds.includes(fact.id),
        ),
      })
    : isValidationRepair
    ? buildRepairPrompt({
        kind: "section",
        errors: input.repairErrors ?? [],
        invalidResult: input.invalidResult ?? "",
      })
    : buildSectionPrompt({
        template: promptVersion.template,
        section,
        sourceFacts: getSourceFacts(video),
      });

  await updateKoSection(section.id, { status: "pending", validationErrors: null });
  await updateKoVideo(video.id, {
    status: "sections_pending",
    currentSectionIndex: section.sectionIndex,
    errorCode: null,
    errorMessage: null,
  });

  return createKoJob({
    videoId: video.id,
    sectionId: section.id,
    kind: "section",
    modelLabel: REQUIRED_MODEL,
    effort: SECTION_EFFORT,
    promptText,
    promptVersionId: promptVersion.id,
    promptSnapshot: promptVersion.template,
    validationAttempt: input.validationAttempt ?? 0,
    metadata: {
      sectionIndex: section.sectionIndex,
      repair: isValidationRepair || isFidelityRepair,
      fidelityRepair: input.fidelityRepair ?? null,
    },
  });
}

export async function enqueueFidelityReviewForVideo(
  video: KoVideo,
  input: {
    reviewCycle?: number;
    repairErrors?: string[];
    invalidResult?: string;
    validationAttempt?: number;
  } = {},
) {
  if (!video.fidelityPromptVersionId) throw new Error("Video fidelity prompt is not pinned.");
  const promptVersion = await getPromptVersionById(video.fidelityPromptVersionId);
  if (!promptVersion) throw new Error(`Fidelity prompt version ${video.fidelityPromptVersionId} was not found.`);
  if (!video.sourceTitle || !video.outline) throw new Error("Video is not ready for fidelity review.");
  const sections = await listKoSections(video.id);
  if (sections.length === 0 || sections.some((section) => section.status !== "ready" || !section.body?.trim())) {
    throw new Error("Fidelity review requires every section to be ready.");
  }
  const finalScript = sections.map((section) => section.body!.trim()).join("\n\n");
  const isRepair = !!input.repairErrors && input.invalidResult != null;
  const promptText = isRepair
    ? buildRepairPrompt({
        kind: "fidelity_review",
        errors: input.repairErrors ?? [],
        invalidResult: input.invalidResult ?? "",
      })
    : buildFidelityReviewPrompt({
        template: promptVersion.template,
        sourceTitle: video.sourceTitle,
        sourceFacts: getSourceFacts(video),
        outline: video.outline as never,
        finalScript,
      });
  await updateKoVideo(video.id, {
    status: "final_review_pending",
    currentSectionIndex: null,
    errorCode: null,
    errorMessage: null,
  });
  return createKoJob({
    videoId: video.id,
    kind: "fidelity_review",
    modelLabel: REQUIRED_MODEL,
    effort: AUDIT_EFFORT,
    promptText,
    promptVersionId: promptVersion.id,
    promptSnapshot: promptVersion.template,
    validationAttempt: input.validationAttempt ?? 0,
    metadata: { reviewCycle: input.reviewCycle ?? 0, repair: isRepair },
  });
}

export async function enqueueFidelityRepairsForVideo(
  video: KoVideo,
  review: FidelityReview & { review_cycle?: number },
  input: { reviewCycle?: number } = {},
) {
  const sections = await listKoSections(video.id);
  const repairsBySection = new Map<
    number,
    { instructionsKo: string[]; requiredFactIds: Set<string> }
  >();
  for (const repair of review.repairs) {
    const current = repairsBySection.get(repair.section_index) ?? {
      instructionsKo: [],
      requiredFactIds: new Set<string>(),
    };
    current.instructionsKo.push(repair.instructions_ko);
    repair.required_fact_ids.forEach((factId) => current.requiredFactIds.add(factId));
    repairsBySection.set(repair.section_index, current);
  }

  const orderedRepairs = [...repairsBySection.entries()].sort((a, b) => a[0] - b[0]);
  const firstRepair = orderedRepairs[0];
  if (!firstRepair) throw new Error("Fidelity review requested repair without a target section.");
  const reviewCycle = input.reviewCycle ?? review.review_cycle ?? 0;
  const storedReview = { ...review, review_cycle: reviewCycle };

  for (const [sectionIndex, repair] of orderedRepairs) {
    const section = sections.find((item) => item.sectionIndex === sectionIndex);
    if (!section) throw new Error(`Fidelity repair section ${sectionIndex} was not found.`);
    await updateKoSection(section.id, {
      status: "pending",
      validationErrors: [repair.instructionsKo.join(" ")],
    });
  }

  const updatedVideo = await updateKoVideo(video.id, {
    status: "sections_pending",
    currentSectionIndex: firstRepair[0],
    fidelityReview: storedReview,
    finalScript: null,
    finalScriptPath: null,
    errorCode: null,
    errorMessage: null,
  });
  if (!updatedVideo) throw new Error("Video disappeared while scheduling fidelity repairs.");
  const firstSection = sections.find((item) => item.sectionIndex === firstRepair[0]);
  if (!firstSection) throw new Error(`Fidelity repair section ${firstRepair[0]} was not found.`);
  await enqueueSectionForVideo(updatedVideo, firstSection, {
    fidelityRepair: {
      instructionsKo: firstRepair[1].instructionsKo.join(" "),
      requiredFactIds: [...firstRepair[1].requiredFactIds],
      reviewCycle,
    },
  });

  return { sectionIndexes: orderedRepairs.map(([sectionIndex]) => sectionIndex), reviewCycle };
}

async function advanceTranscript(video: KoVideo): Promise<"pending" | "completed" | "failed"> {
  if (!video.transcriptJobId) return "pending";
  let job;
  try {
    job = await getTranscriptJob(video.transcriptJobId);
  } catch (error) {
    await markKoVideoNeedsAttention(
      video.id,
      "YT_PRO_MAX_UNAVAILABLE",
      error instanceof Error ? error.message : String(error),
    );
    return "failed";
  }

  if (job.status === "queued" || job.status === "running") {
    await updateKoVideo(video.id, { status: "transcribing", errorCode: null, errorMessage: null });
    return "pending";
  }
  if (job.status === "failed") {
    await markKoVideoNeedsAttention(
      video.id,
      job.error?.code ?? "TRANSCRIPT_FAILED",
      job.error?.message ?? "YT_Pro_Max transcript job failed.",
    );
    return "failed";
  }

  try {
    if (!job.artifacts?.txt || !job.artifacts.json) {
      throw new Error("Completed transcript job must provide TXT and JSON artifacts.");
    }
    const [artifactText, artifactJson] = await Promise.all([
      downloadTranscriptArtifact(job.artifacts.txt),
      downloadTranscriptJsonArtifact(job.artifacts.json),
    ]);
    const parsed = parseTranscriptText(artifactText);
    assertKoreanTranscript(job, parsed.body);
    const stored = await writeRawTranscript(video.id, parsed.title, parsed.body, artifactJson);
    const updated = await updateKoVideo(video.id, {
      status: "source_audit_pending",
      sourceTitle: parsed.title,
      sourceVideoId: job.video?.id ?? video.sourceVideoId,
      transcriptLanguage: job.language ?? "ko",
      transcriptLanguageConfidence:
        job.language_confidence == null ? null : String(job.language_confidence),
      rawTranscriptText: parsed.body,
      rawTranscriptPath: stored.txtPath,
      rawTranscriptJsonPath: stored.jsonPath,
      transcriptText: null,
      transcriptPath: null,
      transcriptHash: null,
      sourceAudit: null,
      errorCode: null,
      errorMessage: null,
    });
    if (!updated) throw new Error("Video disappeared while saving the transcript.");
    await enqueueSourceAuditForVideo(updated);
    return "completed";
  } catch (error) {
    await markKoVideoNeedsAttention(
      video.id,
      "TRANSCRIPT_INVALID",
      error instanceof Error ? error.message : String(error),
    );
    return "failed";
  }
}

async function handleSourceAuditJob(job: KoJob, video: KoVideo): Promise<void> {
  if (!video.rawTranscriptJsonPath || !video.sourceTitle) {
    throw new Error("Raw transcript artifacts are missing for source audit.");
  }
  const artifact = await readRawTranscriptArtifact(video.rawTranscriptJsonPath);
  const segments = artifact.segments.map((segment) => ({
    index: segment.index,
    startMs: segment.start_ms,
    endMs: segment.end_ms,
    text: segment.text,
  }));
  const result = job.result?.trim() ?? "";
  const validation = validateSourceAudit(result, segments);
  if (!validation.ok) {
    if (validation.errors.includes("Source topic boundary is ambiguous.")) {
      await markKoVideoNeedsAttention(
        video.id,
        "SOURCE_BOUNDARY_AMBIGUOUS",
        validation.errors.join(" | "),
      );
      return;
    }
    if (job.validationAttempt < MAX_VALIDATION_REPAIRS) {
      await enqueueSourceAuditForVideo(video, {
        repairErrors: validation.errors,
        invalidResult: result,
        validationAttempt: job.validationAttempt + 1,
        retrofitExisting: Boolean(
          (job.metadata as { retrofitExisting?: boolean } | null)?.retrofitExisting,
        ),
      });
      await updateKoVideo(video.id, {
        status: "source_audit_pending",
        errorCode: "SOURCE_AUDIT_VALIDATION_RETRY",
        errorMessage: validation.errors.join(" | ").slice(0, 4000),
      });
      return;
    }
    await markKoVideoNeedsAttention(
      video.id,
      "SOURCE_AUDIT_VALIDATION_FAILED",
      validation.errors.join(" | "),
    );
    return;
  }

  const keptSegments = selectTranscriptSegments(
    artifact,
    validation.value.keep_start_segment,
    validation.value.keep_end_segment,
  );
  const cleanedBody = keptSegments.map((segment) => segment.text.trim()).join(" ").trim();
  const stored = await writeSourceTranscript(video.id, video.sourceTitle, cleanedBody);
  const sourceAudit = {
    ...validation.value,
    original_segment_count: artifact.segments.length,
    kept_segment_count: keptSegments.length,
    kept_start_ms: keptSegments[0].start_ms,
    kept_end_ms: keptSegments[keptSegments.length - 1].end_ms,
  };
  const updated = await updateKoVideo(video.id, {
    status: "outline_pending",
    transcriptText: cleanedBody,
    transcriptPath: stored.filePath,
    transcriptHash: stored.hash,
    sourceAudit,
    errorCode: null,
    errorMessage: null,
  });
  if (!updated) throw new Error("Video disappeared while saving the cleaned transcript.");
  const retrofitExisting = Boolean(
    (job.metadata as { retrofitExisting?: boolean } | null)?.retrofitExisting,
  );
  if (retrofitExisting) {
    const directionFact = validation.value.required_facts.find(
      (fact) => fact.category === "direction" && /남서/.test(fact.meaning_ko),
    );
    const disposalFact = validation.value.required_facts.find(
      (fact) =>
        fact.category === "disposal" &&
        /(변기|싱크대|배수구|물로|흘려)/.test(fact.meaning_ko),
    );
    if (!directionFact || !disposalFact) {
      await markKoVideoNeedsAttention(
        video.id,
        "RETROFIT_FACTS_MISSING",
        "Source audit did not identify both the southwest direction rule and old-salt disposal procedure.",
      );
      return;
    }
    const sections = await listKoSections(video.id);
    const sectionSix = sections.find((section) => section.sectionIndex === 6);
    const sectionSeven = sections.find((section) => section.sectionIndex === 7);
    if (!sectionSix || !sectionSeven) {
      throw new Error("Project retrofit requires existing sections 6 and 7.");
    }
    const repairs = [
      {
        section_index: 6,
        instructions_ko:
          "창고나 다용도실이 남서쪽에 있으면 문서운, 계약운, 부동산 매매운이 강해진다는 원문 규칙을 자연스럽게 복원하십시오.",
        required_fact_ids: [directionFact.id],
      },
      {
        section_index: 7,
        instructions_ko:
          "묵은 소금은 음식에 재사용하지 말고 변기나 싱크대 배수구에 넣은 뒤 물을 흘려 묵은 기를 보내며 정성을 다한다는 원문 처리법을 복원하십시오.",
        required_fact_ids: [disposalFact.id],
      },
    ];
    for (const [section, factId] of [
      [sectionSix, directionFact.id],
      [sectionSeven, disposalFact.id],
    ] as const) {
      const outlineData = section.outlineData as KoOutlineSection;
      await updateKoSection(section.id, {
        status: "pending",
        outlineData: {
          ...outlineData,
          source_fact_ids: [...new Set([...(outlineData.source_fact_ids ?? []), factId])],
        },
        validationErrors: [repairs.find((repair) => repair.section_index === section.sectionIndex)!.instructions_ko],
      });
    }
    const retrofitReview = {
      verdict: "repair" as const,
      summary_ko: "원문에서 빠진 남서쪽 방향 규칙과 묵은 소금 처리법을 복원해야 합니다.",
      missing_fact_ids: [directionFact.id, disposalFact.id],
      contradictions: [],
      unrelated_topic_intrusions: [],
      repairs,
      review_cycle: -1,
    };
    const retrofitVideo = await updateKoVideo(video.id, {
      status: "sections_pending",
      currentSectionIndex: 6,
      fidelityReview: retrofitReview,
      finalScript: null,
      finalScriptPath: null,
      errorCode: null,
      errorMessage: null,
    });
    if (!retrofitVideo) throw new Error("Video disappeared while scheduling retrofit repairs.");
    await enqueueSectionForVideo(retrofitVideo, sectionSix, {
      fidelityRepair: {
        instructionsKo: repairs[0].instructions_ko,
        requiredFactIds: repairs[0].required_fact_ids,
        reviewCycle: -1,
      },
    });
    return;
  }
  await enqueueOutlineForVideo(updated);
}

async function handleOutlineJob(job: KoJob, video: KoVideo): Promise<void> {
  const result = job.result?.trim() ?? "";
  const validation = validateOutline(result, getSourceFacts(video));
  if (!validation.ok) {
    if (job.validationAttempt < MAX_VALIDATION_REPAIRS) {
      await enqueueOutlineForVideo(video, {
        repairErrors: validation.errors,
        invalidResult: result,
        validationAttempt: job.validationAttempt + 1,
      });
      await updateKoVideo(video.id, {
        status: "outline_pending",
        errorCode: "OUTLINE_VALIDATION_RETRY",
        errorMessage: validation.errors.join(" | ").slice(0, 4000),
      });
      return;
    }
    await markKoVideoNeedsAttention(
      video.id,
      "OUTLINE_VALIDATION_FAILED",
      validation.errors.join(" | "),
    );
    return;
  }

  const sections = await initializeKoSections(
    video.id,
    validation.value.sections.map((section) => ({
      index: section.index,
      kind: section.kind,
      outlineData: section,
    })),
  );
  const updated = await updateKoVideo(video.id, {
    outline: validation.value,
    status: "sections_pending",
    currentSectionIndex: 1,
    errorCode: null,
    errorMessage: null,
  });
  if (!updated || sections.length === 0) throw new Error("Outline produced no persisted sections.");
  await enqueueSectionForVideo(updated, sections[0]);
}

async function handleSectionJob(job: KoJob, video: KoVideo): Promise<void> {
  if (!job.sectionId) throw new Error("Section job has no section_id.");
  const section = await getKoSection(job.sectionId);
  if (!section || section.videoId !== video.id) throw new Error("Section job points to an invalid section.");
  const sectionOutline = section.outlineData as KoOutlineSection;
  const result = job.result?.trim() ?? "";
  const validation = validateSectionText(result, sectionOutline);

  if (!validation.ok) {
    await updateKoSection(section.id, {
      status: job.validationAttempt < MAX_VALIDATION_REPAIRS ? "pending" : "failed",
      validationErrors: validation.errors,
    });
    if (job.validationAttempt < MAX_VALIDATION_REPAIRS) {
      await enqueueSectionForVideo(video, section, {
        repairErrors: validation.errors,
        invalidResult: result,
        validationAttempt: job.validationAttempt + 1,
      });
      return;
    }
    await markKoVideoNeedsAttention(
      video.id,
      "SECTION_VALIDATION_FAILED",
      `Section ${section.sectionIndex}: ${validation.errors.join(" | ")}`,
    );
    return;
  }

  await updateKoSection(section.id, {
    body: validation.value,
    status: "ready",
    validationErrors: null,
  });
  const next = await getFirstIncompleteKoSection(video.id);
  if (next) {
    const refreshedVideo = await getKoVideo(video.id);
    if (!refreshedVideo) throw new Error("Video disappeared before the next section was queued.");
    const fidelityRepair = getFidelityRepairForSection(refreshedVideo, next.sectionIndex);
    await enqueueSectionForVideo(
      refreshedVideo,
      next,
      fidelityRepair ? { fidelityRepair } : undefined,
    );
    return;
  }

  const sections = await listKoSections(video.id);
  if (sections.length === 0 || sections.some((item) => item.status !== "ready" || !item.body?.trim())) {
    throw new Error("Cannot assemble final script before every section is ready.");
  }
  const refreshedVideo = await getKoVideo(video.id);
  if (!refreshedVideo) throw new Error("Video disappeared before fidelity review.");
  const previousReview = refreshedVideo.fidelityReview as { review_cycle?: number } | null;
  await enqueueFidelityReviewForVideo(refreshedVideo, {
    reviewCycle: previousReview ? (previousReview.review_cycle ?? 0) + 1 : 0,
  });
}

async function handleFidelityReviewJob(job: KoJob, video: KoVideo): Promise<void> {
  const sections = await listKoSections(video.id);
  const result = job.result?.trim() ?? "";
  const validation = validateFidelityReview(
    result,
    getSourceFacts(video),
    sections.map((section) => section.sectionIndex),
  );
  const reviewCycle = Number((job.metadata as { reviewCycle?: number } | null)?.reviewCycle ?? 0);
  if (!validation.ok) {
    if (job.validationAttempt < MAX_VALIDATION_REPAIRS) {
      await enqueueFidelityReviewForVideo(video, {
        reviewCycle,
        repairErrors: validation.errors,
        invalidResult: result,
        validationAttempt: job.validationAttempt + 1,
      });
      await updateKoVideo(video.id, {
        status: "final_review_pending",
        errorCode: "FIDELITY_REVIEW_VALIDATION_RETRY",
        errorMessage: validation.errors.join(" | ").slice(0, 4000),
      });
      return;
    }
    await markKoVideoNeedsAttention(
      video.id,
      "FIDELITY_REVIEW_VALIDATION_FAILED",
      validation.errors.join(" | "),
    );
    return;
  }

  const storedReview = { ...validation.value, review_cycle: reviewCycle };
  if (validation.value.verdict === "pass") {
    const finalScript = sections.map((section) => section.body!.trim()).join("\n\n");
    const finalScriptPath = await writeFinalScript(video.id, finalScript);
    await updateKoVideo(video.id, {
      status: "ready",
      currentSectionIndex: null,
      finalScript,
      finalScriptPath,
      fidelityReview: storedReview,
      errorCode: null,
      errorMessage: null,
    });
    return;
  }

  if (reviewCycle >= MAX_FIDELITY_REPAIR_CYCLES) {
    await updateKoVideo(video.id, { fidelityReview: storedReview });
    await markKoVideoNeedsAttention(
      video.id,
      "FIDELITY_REVIEW_FAILED",
      validation.value.summary_ko,
    );
    return;
  }

  await enqueueFidelityRepairsForVideo(video, storedReview, { reviewCycle });
}

async function handleDoneJob(job: KoJob): Promise<void> {
  const video = await getKoVideo(job.videoId);
  if (!video) throw new Error(`Video ${job.videoId} was not found.`);
  if (job.kind === "source_audit") return handleSourceAuditJob(job, video);
  if (job.kind === "outline") return handleOutlineJob(job, video);
  if (job.kind === "section") return handleSectionJob(job, video);
  if (job.kind === "fidelity_review") return handleFidelityReviewJob(job, video);
  throw new Error(`Unknown ko_job kind '${job.kind}'.`);
}

async function consumeCompletedJobs() {
  const jobs = await listUnconsumedDoneKoJobs();
  const results: Array<{ jobId: number; ok: boolean; error?: string }> = [];
  for (const job of jobs) {
    try {
      await handleDoneJob(job);
      await markKoJobConsumed(job.id);
      results.push({ jobId: job.id, ok: true });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await markKoJobHandlerFailed(job.id, message);
      results.push({ jobId: job.id, ok: false, error: message });
    }
  }
  return results;
}

async function consumeFailedJobs() {
  const jobs = await listUnconsumedFailedKoJobs();
  for (const job of jobs) {
    if (job.sectionId) {
      await updateKoSection(job.sectionId, {
        status: "failed",
        validationErrors: [job.errorMessage ?? "AI job failed."],
      });
    }
    await markKoVideoNeedsAttention(
      job.videoId,
      "AI_JOB_FAILED",
      `${job.modelLabel}/${job.effort}: ${job.errorMessage ?? "AI job failed."}`,
    );
    await markKoJobConsumed(job.id);
  }
  return jobs.length;
}

async function runUnlockedChainCycle() {
  const staleReset = await resetStaleRunningKoJobs(20);
  const completedJobs = await consumeCompletedJobs();
  const failedJobs = await consumeFailedJobs();
  const transcriptVideos = await listVideosAwaitingTranscript();
  let transcriptsCompleted = 0;
  let transcriptsFailed = 0;
  for (const video of transcriptVideos) {
    const result = await advanceTranscript(video);
    if (result === "completed") transcriptsCompleted += 1;
    if (result === "failed") transcriptsFailed += 1;
  }
  await setKoConfigValue(KO_CONFIG_KEYS.chainLastRunAt, new Date().toISOString());
  return { staleReset, completedJobs, failedJobs, transcriptsCompleted, transcriptsFailed };
}

export async function runKoChainCycle() {
  const client = await pool.connect();
  try {
    const lock = await client.query<{ locked: boolean }>(
      "SELECT pg_try_advisory_lock(hashtext($1)) AS locked",
      [CHAIN_LOCK_KEY],
    );
    if (!lock.rows[0]?.locked) return { skipped: true, reason: "chain_cycle_already_running" };
    try {
      return { skipped: false, ...(await runUnlockedChainCycle()) };
    } finally {
      await client.query("SELECT pg_advisory_unlock(hashtext($1))", [CHAIN_LOCK_KEY]);
    }
  } finally {
    client.release();
  }
}
