// TypeScript Types for 10-Stage Deterministic Layered Thumbnail Pipeline ('Sâm Kể Chuyện')

export type IntegrityStatus = 'clean' | 'minor_warning' | 'major_warning';

export interface StoryCharacter {
  canonical_name: string;
  aliases: string[];
  role: string;
  relationships: string[];
  age_if_known?: number | string | null;
  gender_if_known?: 'male' | 'female' | string | null;
}

export interface SingleStoryIntegrityData {
  integrity_status: IntegrityStatus;
  characters: StoryCharacter[];
  timeline_summary: string[];
  warnings: string[];
  story_summary: string;
  prompt_version?: string;
  model_used?: string;
}

export interface ThumbnailDNA {
  story_core: string;
  victim: {
    description: string;
    visual_traits?: string;
  };
  aggressor: {
    description: string;
    visual_traits?: string;
  };
  relationship: string;
  desire: 'money' | 'inheritance' | 'property' | 'status' | 'relationship' | 'revenge' | 'secret' | 'control' | string;
  main_hook_type?: string;
  high_emotion_moment: string;
  key_prop: string;
  mystery_element?: string;
  visual_question: string;
  what_not_to_reveal: string[];
  setting: string;
  vietnamese_context?: string[];
  prompt_version?: string;
  model_used?: string;
}

export interface AttentionMarkerConfig {
  enabled: boolean;
  type: 'arrow' | 'circle' | 'zoom' | 'none';
  target: string | null;
}

export interface ThumbnailConcept {
  concept_id: 'A' | 'B' | 'C' | string;
  concept_type: 'confrontation' | 'mystery' | 'emotional_shock' | string;
  concept_name: string;
  story_moment: string;
  visual_question: string;
  main_subject: string;
  secondary_subject: string;
  optional_supporting_subject?: string | null;
  key_prop: string;
  setting: string;
  host_emotion: 'shock' | 'grief' | 'anger' | 'disbelief' | 'suspicious' | 'serious' | string;
  host_position: 'left' | 'right';
  host_gaze_direction: string;
  text_zone: 'left' | 'right' | 'top-left' | 'top-right' | 'bottom-left' | 'bottom-center' | string;
  suggested_hook: string;
  attention_marker?: AttentionMarkerConfig;
  what_is_hidden: string;
}

export interface TextHook {
  id: string;
  text: string;
  category: 'mystery' | 'shock' | 'emotional';
  lines?: string[];
  primary_keywords?: string[];
  yellow_words: string[];
  red_words: string[];
  white_words?: string[];
  typography_style?: 'bold_shock' | 'mystery' | 'emotional' | string;
  text_alignment?: 'left' | 'center' | 'right' | string;
  preferred_text_zone?: 'left' | 'right' | 'top-left' | 'top-right' | 'bottom-left' | 'bottom-center' | string;
  hidden_information?: string;
}

export interface ThumbnailFitSelectionData {
  recommended_concept_id: 'A' | 'B' | 'C' | string;
  heuristic_fit_score?: number;
  selection_rationale: string;
  host_emotion: 'shock' | 'grief' | 'anger' | 'disbelief' | 'suspicious' | 'serious';
  host_emotion_rationale: string;
  recommended_hook_id: string;
  recommended_title_text: string;
  recommended_badge_text: string;
  host_position?: 'left' | 'right' | string;
  text_zone?: string;
  text_alignment?: string;
  visual_balance_notes?: string;
  prompt_version?: string;
  model_used?: string;
}

export interface ImagePromptData {
  scene_prompt?: string;
  final_prompt: string;
  condensed_prompt: string;
  concept_id: string;
  headline?: string;
  headline_lines?: string[];
  yellow_words?: string[];
  red_words?: string[];
  white_words?: string[];
  text_zone: string;
  host_position: string;
  host_emotion: string;
  aspect_ratio: string;
  has_host_ref?: boolean;
  layout_zones?: {
    host_box: number[];
    headline_zone: number[];
    drama_zone: number[];
    badge_zone: number[];
  };
}

export interface AIQCIssue {
  type: string;
  severity: 'low' | 'medium' | 'high';
  description: string;
  suggested_fix: string;
}

export interface AIQCResult {
  passed: boolean;
  visual_passed?: boolean;
  host_passed?: boolean;
  text_passed?: boolean;
  detected_headline?: string;
  expected_headline?: string;
  text_match?: 'exact' | 'minor_error' | 'major_error';
  issues: AIQCIssue[];
  recommended_action?: 'accept' | 'regenerate' | 'regenerate_scene' | 'typography_repair' | 'recomposite_host';
  prompt_version?: string;
  model_used?: string;
  error?: string;
}

export interface ThumbnailPipelineState {
  story_id: string;
  status: 'not_started' | 'in_progress' | 'ready' | 'error';
  pipeline_mode?: 'deterministic_layered' | 'experimental_one_shot';
  stages_completed: string[];
  selected_concept_id?: string;
  selected_hook_id?: string;
  prompt_versions?: Record<string, string>;
  stage0_input?: {
    story_id: string;
    srt_path: string;
    srt_hash: string;
    total_lines: number;
    total_words: number;
    speakers_detected: string[];
    host_profile: any;
  };
  stage1_consistency?: SingleStoryIntegrityData;
  stage2_dna?: ThumbnailDNA;
  stage3_concepts?: {
    concepts: ThumbnailConcept[];
    model_used?: string;
  };
  stage4_hooks?: {
    hooks: TextHook[];
    model_used?: string;
  };
  stage5_selection?: ThumbnailFitSelectionData;
  stage6_prompt?: ImagePromptData;
  stage7_image?: {
    provider: string;
    drama_scene_raw_path?: string;
    generated_image_path?: string;
    raw_image_path?: string;
    generated_at: number;
    exists: boolean;
  };
  stage7c_composite?: {
    final_thumbnail_path: string;
    title_used: string;
    badge_used: string;
    host_emotion_used?: string;
    host_position_used?: string;
    text_zone_used?: string;
    is_composited: boolean;
    exists: boolean;
    file_size: number;
  };
  stage8_qc?: AIQCResult;
  stage9_repair?: {
    final_thumbnail_path: string;
    title_used: string;
    badge_used: string;
    text_zone_used?: string;
    is_repaired?: boolean;
    exists: boolean;
    file_size: number;
  };
  final_output?: {
    path: string;
    source: string;
    qc_passed: boolean;
  };
  updated_at?: number;
}
