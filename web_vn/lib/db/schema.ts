import { pgTable, serial, text, integer, timestamp, jsonb, numeric } from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm';

export const stories = pgTable('stories', {
  id: serial('id').primaryKey(),
  title: text('title').notNull(),
  slug: text('slug').notNull(),
  status: text('status').notNull().default('draft'), // draft, outline_ready, script_drafting, script_completed, audio_ready, video_ready
  targetDurationMinutes: integer('target_duration_minutes').default(150),
  totalWords: integer('total_words').default(0),
  topicMatrix: jsonb('topic_matrix').$type<{
    archetype?: string;
    sacrifice?: string;
    oppression?: string;
    plotSecret?: string;
    retribution?: string;
    moral?: string;
  }>(),
  masterBlueprint: jsonb('master_blueprint').$type<{
    hook: string;
    act1: string;
    act2: string;
    act3: string;
    act4: string;
    act5: string;
    moralSummary: string;
  }>(),
  thumbnailPrompt: text('thumbnail_prompt'),
  thumbnailUrl: text('thumbnail_url'),
  finalAudioUrl: text('final_audio_url'),
  finalVideoUrl: text('final_video_url'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
});

export const chapters = pgTable('chapters', {
  id: serial('id').primaryKey(),
  storyId: integer('story_id').references(() => stories.id, { onDelete: 'cascade' }).notNull(),
  chapterNumber: integer('chapter_number').notNull(),
  actName: text('act_name').notNull(), // Hồi 1, Hồi 2, etc.
  title: text('title').notNull(),
  goal: text('goal'),
  content: text('content'),
  wordCount: integer('word_count').default(0),
  speakerTags: jsonb('speaker_tags').$type<string[]>(),
  audioUrl: text('audio_url'),
  audioDurationSec: numeric('audio_duration_sec'),
  status: text('status').notNull().default('pending'), // pending, generating, ready, failed
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
});

export const speakers = pgTable('speakers', {
  id: serial('id').primaryKey(),
  code: text('code').notNull().unique(), // bac_sam, nhan_vat_chinh, me_chong, etc.
  name: text('name').notNull(),
  provider: text('provider').notNull().default('omnivoice'), // omnivoice, edge_tts
  voiceId: text('voice_id'),
  refAudioPath: text('ref_audio_path'),
  promptText: text('prompt_text'),
  settings: jsonb('settings').$type<Record<string, unknown>>(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
});

export const jobs = pgTable('jobs', {
  id: serial('id').primaryKey(),
  storyId: integer('story_id').references(() => stories.id, { onDelete: 'cascade' }),
  chapterId: integer('chapter_id'),
  jobType: text('job_type').notNull(), // generate_blueprint, generate_chapter, synthesize_tts, master_audio, render_video
  status: text('status').notNull().default('queued'), // queued, processing, completed, failed
  payload: jsonb('payload').$type<Record<string, unknown>>(),
  result: jsonb('result').$type<Record<string, unknown>>(),
  errorMessage: text('error_message'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
});

export const storiesRelations = relations(stories, ({ many }) => ({
  chapters: many(chapters),
  jobs: many(jobs),
}));

export const chaptersRelations = relations(chapters, ({ one }) => ({
  story: one(stories, {
    fields: [chapters.storyId],
    references: [stories.id],
  }),
}));
