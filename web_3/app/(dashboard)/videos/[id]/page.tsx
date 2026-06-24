import { notFound } from "next/navigation";
import Link from "next/link";

import { getDrEpisode } from "@/lib/db/repo/episodes";
import { listDrJobsByEpisode } from "@/lib/db/repo/jobs";
import type {
  AmbientSoundMap,
  EpisodeTrackAudio,
  SceneInput,
  TrackSpec,
} from "@/lib/db/schema";
import { statusBadgeClass, VIDEO_STATUS_LABELS, formatDateTime } from "@/lib/ui/format";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { CopyButton } from "./CopyButton";
import { DeleteVideoButton } from "./DeleteVideoButton";
import { RetryVideoButton } from "./RetryVideoButton";
import { PublishToggle } from "./PublishToggle";
import { TrackClips } from "./TrackClips";
import { OpenFolderButton } from "./OpenFolderButton";
import { getManualEpisodeProjectInfo } from "@/lib/manual-image-project";

export const dynamic = "force-dynamic";

function Section({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <section>
      <p className="mb-2 text-[11px] font-medium uppercase tracking-[0.04em] text-[#AEAEB2]">{label}</p>
      <Card className="border-black/[.08] bg-white shadow-none rounded-xl dark:border-white/[.10] dark:bg-[#1C1C1E]">
        <CardContent className="p-5 space-y-3">{children}</CardContent>
      </Card>
    </section>
  );
}

function Field({ label, value }: { label: string; value: string | null | undefined }) {
  if (!value) return null;
  return (
    <div>
      <p className="text-[11px] font-medium uppercase tracking-[0.04em] text-[#AEAEB2]">{label}</p>
      <p className="mt-0.5 whitespace-pre-wrap text-[14px] text-[#1C1C1E] dark:text-white">{value}</p>
    </div>
  );
}

function PromptBlock({ label, value }: { label: string; value: string | null | undefined }) {
  if (!value) return null;
  return (
    <div>
      <div className="flex items-center justify-between">
        <p className="text-[11px] font-medium uppercase tracking-[0.04em] text-[#AEAEB2]">{label}</p>
        <CopyButton text={value} />
      </div>
      <pre className="mt-1 max-h-64 overflow-auto whitespace-pre-wrap rounded-lg bg-[#F2F2F7] p-3 text-[12px] text-[#1C1C1E] dark:bg-[#2C2C2E] dark:text-white">
        {value}
      </pre>
    </div>
  );
}

export default async function EpisodeDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const episodeId = parseInt(id, 10);
  if (isNaN(episodeId)) notFound();

  const episode = await getDrEpisode(episodeId);
  if (!episode) notFound();

  const jobs = await listDrJobsByEpisode(episodeId);
  const scene = episode.sceneInput as SceneInput | null;
  const visual = episode.visualFoundation as
    | { scene_analysis?: string; image_prompt?: string; veo_prompt?: string; intro_text?: string }
    | null;
  const ambient = episode.ambientSoundMap as AmbientSoundMap | null;
  const specs = (episode.trackSpecs as TrackSpec[] | null) ?? [];
  const audio = (episode.audio as EpisodeTrackAudio[] | null) ?? [];
  const thumbnail = episode.thumbnail as { nano_banana_prompt?: string } | null;
  const chapters = (episode.ytChapters as Array<{ time: string; title: string }> | null) ?? [];
  const playlists = (episode.ytPlaylists as string[] | null) ?? [];

  const title = episode.ytTitle ?? scene?.scene_name ?? `Episode #${episode.id}`;
  const projectInfo = getManualEpisodeProjectInfo({ id: episode.id, trackCount: audio.length });

  return (
    <>
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <Link href="/videos" className="text-[13px] text-[#007AFF] hover:underline">
            ← Episodes
          </Link>
          <h1 className="mt-1 text-[28px] font-semibold tracking-tight text-[#1C1C1E] dark:text-white">
            {title}
          </h1>
          <div className="mt-1 flex items-center gap-2">
            <span className="font-mono text-[13px] text-[#AEAEB2]">#{episode.id}</span>
            <Badge className={`text-[11px] ${statusBadgeClass(episode.status)}`}>
              {VIDEO_STATUS_LABELS[episode.status] ?? episode.status}
            </Badge>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <OpenFolderButton
            folderPath={projectInfo.imageOutputDir}
            label="Image Folder"
            title="Open image prompt output folder"
          />
          <OpenFolderButton
            folderPath={projectInfo.videoOutputDir}
            label="Video Folder"
            title="Open loop video folder"
          />
          <RetryVideoButton videoId={episode.id} />
          <DeleteVideoButton videoId={episode.id} />
        </div>
      </div>

      {scene && (
        <Section label="SCENE">
          <Field label="Scene name" value={scene.scene_name} />
          <Field label="Visual highlights" value={scene.visual_highlights} />
          <Field label="Atmosphere / mood" value={scene.atmosphere_mood} />
          <Field label="Accent color" value={scene.accent_color} />
          <Field label="Music role" value={scene.music_role} />
        </Section>
      )}

      {ambient && (
        <Section label="AMBIENT SOUND MAP">
          <Field label="Ambient bed" value={ambient.ambient_bed} />
          <Field label="Tonal hum" value={ambient.tonal_hum} />
          <Field label="Rhythmic texture" value={ambient.rhythmic_texture} />
          <Field label="Human trace" value={ambient.human_trace} />
          <Field label="Silence gap" value={ambient.silence_gap} />
        </Section>
      )}

      {visual && (
        <Section label="VISUAL FOUNDATION">
          <Field label="Scene analysis" value={visual.scene_analysis} />
          <Field label="Intro text" value={visual.intro_text} />
          <PromptBlock label="Image prompt (Nano Banana)" value={visual.image_prompt} />
          <PromptBlock label="Veo loop prompt" value={visual.veo_prompt} />
        </Section>
      )}

      {specs.length > 0 && (
        <Section label={`TRACKS (${specs.length})`}>
          <div className="divide-y divide-black/[.06] dark:divide-white/[.08]">
            {specs.map((spec, i) => {
              const track = audio.find((a) => a.specIndex === i);
              return (
                <div key={i} className="py-3 first:pt-0 last:pb-0 space-y-2">
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-[12px] text-[#AEAEB2]">{i + 1}</span>
                    <span className="text-[14px] font-medium text-[#1C1C1E] dark:text-white">{spec.title}</span>
                    <Badge className="text-[10px] bg-[#E5E5EA] text-[#3C3C43] border-0 dark:bg-white/[.10] dark:text-[#AEAEB2]">
                      {spec.role}
                    </Badge>
                    {track && (
                      <Badge className={`text-[10px] ${statusBadgeClass(track.status)}`}>{track.status}</Badge>
                    )}
                  </div>
                  {track && track.clips.length > 0 && (
                    <TrackClips episodeId={episode.id} specIndex={i} track={track} />
                  )}
                </div>
              );
            })}
          </div>
        </Section>
      )}

      {thumbnail?.nano_banana_prompt && (
        <Section label="THUMBNAIL">
          <PromptBlock label="Nano Banana thumbnail prompt" value={thumbnail.nano_banana_prompt} />
        </Section>
      )}

      {(episode.ytTitle || episode.ytDescription) && (
        <Section label="SEO PACKAGE">
          <Field label="Title" value={episode.ytTitle} />
          <Field label="Slug" value={episode.ytSlug} />
          <PromptBlock label="Description" value={episode.ytDescription} />
          <Field label="Tags" value={episode.ytTags} />
          {chapters.length > 0 && (
            <div>
              <p className="text-[11px] font-medium uppercase tracking-[0.04em] text-[#AEAEB2]">Chapters</p>
              <pre className="mt-1 max-h-64 overflow-auto whitespace-pre-wrap rounded-lg bg-[#F2F2F7] p-3 text-[12px] text-[#1C1C1E] dark:bg-[#2C2C2E] dark:text-white">
                {chapters.map((c) => `${c.time} ${c.title}`).join("\n")}
              </pre>
            </div>
          )}
          <Field label="Pinned comment" value={episode.ytPinnedComment} />
          {playlists.length > 0 && <Field label="Playlists" value={playlists.join("\n")} />}
        </Section>
      )}

      {episode.status === "ready" || episode.status === "assembly_done" || episode.publishedAt ? (
        <PublishToggle
          videoId={episode.id}
          publishedAt={episode.publishedAt ? episode.publishedAt.toISOString() : null}
          youtubeUrl={episode.youtubeUrl}
        />
      ) : null}

      <Section label="JOB TIMELINE">
        <div className="divide-y divide-black/[.06] dark:divide-white/[.08]">
          {jobs.map((j) => (
            <div key={j.id} className="flex items-center gap-3 py-2 first:pt-0 last:pb-0">
              <Badge className="shrink-0 font-mono text-[11px] bg-[#E5E5EA] text-[#3C3C43] border-0 dark:bg-white/[.10] dark:text-[#AEAEB2]">
                {j.stage}
              </Badge>
              <Badge className={`shrink-0 text-[11px] ${statusBadgeClass(j.status)}`}>{j.status}</Badge>
              <span className="min-w-0 flex-1 truncate text-[12px] text-[#FF3B30]">{j.errorMessage ?? ""}</span>
              <span className="shrink-0 text-[12px] text-[#AEAEB2]">{formatDateTime(j.finishedAt ?? j.createdAt)}</span>
            </div>
          ))}
          {jobs.length === 0 && <p className="text-[13px] text-[#AEAEB2]">No jobs yet.</p>}
        </div>
      </Section>
    </>
  );
}
