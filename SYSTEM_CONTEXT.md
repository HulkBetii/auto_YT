# auto_YT — System Context for Claude Sessions

Đây là tài liệu mô tả toàn bộ hệ thống `auto_YT` dành cho Claude session mới.
Mục tiêu: Claude đọc file này và hiểu đầy đủ công cụ mà không cần hỏi thêm.

---

## 1. Tổng quan hệ thống

**auto_YT** là pipeline tự động tạo nội dung YouTube tiếng Nhật cho kênh **「哲人の刻」** (Phút Suy Tư Của Triết Nhân). Hệ thống chạy hoàn toàn tự động từ khâu sinh đề tài đến khi có audio sẵn sàng đăng.

### Kiến trúc monorepo

```
/Users/sangspm/Downloads/VibeCoding/auto_YT/
├── web/                    ← Next.js App Router (Vercel) — orchestrator & UI
│   ├── app/                ← Next.js routes
│   │   ├── (dashboard)/    ← Dashboard UI (layout, videos, settings)
│   │   └── api/            ← API endpoints
│   ├── lib/
│   │   ├── db/             ← Drizzle ORM (schema + repo helpers)
│   │   ├── pipeline/       ← Chain logic, job creation, TTS, description builder
│   │   ├── notifications/  ← Telegram bot alerts
│   │   └── openai/         ← Embeddings (anti-duplication)
│   └── scripts/            ← One-off diagnostic/fix scripts (.mts)
└── src/auto_yt/            ← Python Playwright worker (chạy trên Mac cá nhân)
    ├── worker.py           ← Main loop: poll jobs → ChatGPT → save result
    ├── job_queue.py        ← DB interface (asyncpg, SELECT FOR UPDATE SKIP LOCKED)
    ├── services/           ← Playwright ChatGPT automation
    └── app.py              ← macOS system tray UI
```

**Giao tiếp giữa hai phần**: chỉ qua bảng `jobs` trong Neon Postgres. Worker Python poll mỗi 15 giây, nhận job `pending` → gửi vào ChatGPT → lưu kết quả → đặt `status=done`. Next.js cron `/api/cron/process-jobs` (cron-job.org, mỗi phút) chuyển tiếp job `done` sang bước tiếp theo.

### URL production
- Dashboard: `https://web-three-eta-70.vercel.app` (cần cookie `dashboard_auth=1234f09ce079762c5ed48f927cbb03133222b654116f4fdb`)
- Trigger pipeline thủ công: `POST /api/jobs/process-now` (cùng auth)
- Cron endpoint: `GET /api/cron/process-jobs`

---

## 2. Pipeline — 7 giai đoạn

```
P1 → P2 → P3 → P4 → P_score → P_desc (code-only) → TTS
                  ↑                    ↓
              needs_retry  ←  score < 80 (tối đa max_content_retries lần)
                                        ↓
                           needs_attention (hết budget hoặc lỗi cứng)
```

### Video status state machine (videos.status)
```
topic → outline → scripted → seo_done → scoring → ready_to_publish → published → analyzed
                    ↑                                     ↑
               needs_retry ──────────────────────────────┘
        any → needs_attention (failure terminal)
```

### P1 — Sinh đề tài (Topic Generation)
- **Input**: prompt P1 với `[RECENT_VIDEOS]` placeholder (danh sách video gần đây để tránh trùng)
- **Output**: JSON array 12 đề tài, mỗi đề tài có: `topic, title, title_pattern, pain_type, temperature, featured_person, self_address, reference_book, viewer_inner_voice, competition`
- **Sau P1**: `handleP1Done()` trong `chain.ts` duyệt từng đề tài:
  1. Gọi OpenAI Embeddings API (text-embedding-3-small, 1536-dim) để embed topic+title
  2. Kiểm tra anti-duplication: rule check (không trùng `featured_person` trong 3 video gần nhất) + semantic check (cosine similarity > 0.85 qua pgvector)
  3. Tạo video record (`videos` table) + enqueue P2 job

**Kênh + nhân vật cho phép (9 người)**:
- 松下幸之助 / 稲盛和夫 / 中村天風 / 小林正観 / 田中角栄 / 本田宗一郎 / 西郷隆盛 / 美輪明宏 / 渋沢栄一

**Pain Matrix (5 loại)**:
- A: 人間関係 (quan hệ con người)
- B: 老後・孤独 (tuổi già, cô đơn)
- C: 感情の重荷 (gánh nặng cảm xúc)
- D: 社会不満 (bất mãn xã hội)
- E: 美輪明宏専用民族誇り (chỉ dùng cho 美輪明宏)

**Nhiệt độ cảm xúc**: 40° (nhẹ nhàng), 65° (trung bình), 70° (mạnh)
- P1 xuất: 40°=4件, 65-70°=8件

### P2 — Dàn bài (Outline)
- **Input**: `[TITLE], [TOPIC], [PAIN_TYPE], [TEMP], [INNER_VOICE], [REFERENCE_BOOK], [PERSON], [SELF_ADDRESS]`
- **Output**: 6-section outline (S1-S6), markdown, target 3000-3500 chars (v2)
- **Lưu**: `video_content` với stage=P2, video status → `outline`

### P3 — Kịch bản (Narration Script)
- **Input**: `[DANYI]` (= P2 output), `[TEMP]`, `[REFERENCE_BOOK]`, `[PERSON]`
- **Output**: PURE narration text + `<#X.X#>` pause tags (10-15 cái)
  - KHÔNG có headers, labels, section markers, character count lines
  - Bắt buộc 3000-3500 chars; ChatGPT PHẢI từ chối output nếu < 3000
  - Cấu trúc cảm xúc: S1≈200 chars, S2≈600, S3≈500, S4≈700, S5≈450, S6≈150
  - Midpoint hook bắt buộc ở đầu S4 (ví dụ: "ここからが、本当に大切な話だ。")
  - Cuối bài có チャプター設計 (chapter design, timestamps theo 80% actual)
- **Lưu**: video_content stage=P3, status → `scripted`
- **Phiên bản hiện tại**: P3 v9

### P4 — SEO Package
- **Input**: `[SCRIPT]` (P3 output), `[PAIN_TYPE]`, `[REFERENCE_BOOK]`, `[COMMENT_QUESTION]` (P2 output)
- **Output**: Nhiều sections — KHÔNG có prefix `■`:
  - `タイトル候補 四個` — 4 title candidates
  - `サムネイルテキスト 二個` — 2 thumbnail texts
  - `概要欄テキスト` — description text
  - `タグリスト 二十五個` — 25 SEO tags
  - `Shortsスクリプト 三個` — 3 Shorts scripts
  - `コメント返信テンプレート 三個` — 3 comment reply templates
  - `投稿戦略` — posting strategy
  - `チャプター設計` — chapter design
- **LƯU Ý QUAN TRỌNG**: ChatGPT P4 output KHÔNG có prefix `■` và CÓ hậu tố漢数字 số lượng (ví dụ: `タグリスト 二十五個`, KHÔNG phải `■ タグリスト`)
- **Lưu**: video_content stage=P4, status → `seo_done`
- **Phiên bản hiện tại**: P4 v3

### P_score — Chấm điểm
- **Input**: `[CONTENT]` = P2 + P3 + P4 ghép lại
- **Output**: JSON với `total_score` (0-100) và `verdict`
- **4 tiêu chí**: Hook (25đ), Emotion (30đ), TTS (25đ), SEO (20đ)
- **Ngưỡng**: `score_threshold` config (mặc định 80)
  - ≥80: status → `ready_to_publish`, trigger P_desc + TTS
  - <80 và còn budget: status → `needs_retry`, enqueue P3 lại
  - <80 hết budget: status → `needs_attention`
- **Phiên bản hiện tại**: P_score v1

### P_desc — Mô tả YouTube (Code-only, không cần LLM)
- **File**: `web/lib/pipeline/descriptionBuilder.ts`
- **Chạy**: tự động sau P_score khi score ≥ 80, không phải Playwright job
- **Lấy data từ**: P2 output, P3 output, P4 output + `related_videos` query
- **Sections build**:
  - Hook 1 & 2: lấy từ P4 section `概要欄テキスト`
  - Content (video description): từ P4 section `概要欄テキスト`
  - Tags: từ P4 section `タグリスト 二十五個` (flexible match, handle漢数字)
  - Chapters: từ P4 section `チャプター設計`
  - Comment question: câu cuối ending `か。` trong P3 narration
  - Related videos: query các video cùng `featuredPerson` hoặc `painType`
- **`extractSection()` helper**: dùng để parse P4 headers — handles cả có và không có `■` prefix, và hậu tố漢数字

### TTS — Text-to-Speech Audio
- **File**: `web/lib/pipeline/tts.ts`
- **API**: AI33.PRO Vivoo V3 (`https://api.ai33.pro`)
  - Auth: `Authorization: <VIVOO_API_KEY>` (KHÔNG có "Bearer")
  - POST `/v3/text-to-speech` (FormData: `text`, `voice_id`, `speed=1`)
  - GET `/v3/task/<task_id>` để poll (mỗi 5s, tối đa 4 phút)
- **Voice routing**: lookup `tts_voice_map` JSON từ `channel_config` theo `featured_person`
  - Default fallback: `clone_2572202` (Tenpu Nakamura)
- **P3 → TTS parsing** (parseP3ForTTS):
  1. Strip preamble lines (总文字数行, 【X】 headers, "承知しました", "Edit", v.v.)
  2. Bỏ từ `チャプター設計` trở đi
  3. Strip `{calm}`, `{/calm}`, `{serious}` emotion tags (giữ text bên trong)
  4. Giữ nguyên `<#N.N#>` pause markers (API hỗ trợ native)
- **Trigger**: chạy trong `/api/jobs/process-now` và `/api/cron/process-jobs` sau `runChainCycle()`
- **Lưu**: `videos.audio_url` (CDN URL)

---

## 3. Database Schema (Neon Postgres + Drizzle ORM)

### Bảng `videos`
| Column | Type | Mô tả |
|--------|------|--------|
| id | serial PK | |
| title | text | Tiêu đề JP |
| title_pattern | text | Pattern kiểu A/B/C/D/E |
| pain_type | text | A/B/C/D/E |
| temperature | integer | 40/65/70 |
| featured_person | text | Tên nhân vật (Latin) |
| reference_book | text | Tên sách tham khảo |
| format | enum | standard/comparison |
| status | enum | Xem state machine bên trên |
| score | integer | P_score kết quả |
| retry_count | integer | Số lần retry P3 (content quality) |
| topic_embedding | vector(1536) | pgvector cho anti-dup |
| youtube_video_id | text | Điền tay sau upload |
| published_at | timestamp | |
| audio_url | text | CDN URL từ AI33.PRO TTS |
| created_at | timestamp | |

### Bảng `jobs`
| Column | Type | Mô tả |
|--------|------|--------|
| id | serial PK | |
| video_id | integer FK | NULL cho P1 và P6 |
| stage | enum | P1/P2/P3/P4/P_score/P5/P6 |
| status | enum | pending/running/done/failed |
| prompt_text | text | Prompt đã interpolate (snapshot) |
| prompt_version_id | integer FK | |
| result | text | ChatGPT response |
| error_message | text | Cleared on success |
| retry_count | integer | Transient Playwright errors (max 3) |
| metadata | jsonb | Stage-specific payload (e.g. batchVideoIds cho P6) |
| consumed_at | timestamp | Set khi orchestrator đã xử lý |
| caused_by_job_id | integer | Idempotency: tránh double-create downstream |
| created_at / started_at / finished_at | timestamp | |

### Bảng `video_content`
- Lưu output của mỗi stage theo video (lịch sử đầy đủ)
- Unique dedup: `(videoId, stage, output)` — tránh duplicate khi handler crash-retry

### Bảng `prompt_versions`
- Mỗi row = 1 phiên bản prompt, `is_active=true` = đang dùng
- `change_reason` lưu báo cáo P6

### Bảng `channel_config`
- Key-value store cho config: `score_threshold`, `max_content_retries`, `p1_topics_per_batch`, `tts_voice_map`, `tts_default_voice`, `recent_videos_limit`, v.v.

### Bảng `video_analytics`
- YouTube analytics data (manual input): views, CTR, AVD, likes, comments

---

## 4. File chính cần biết

| File | Chức năng |
|------|-----------|
| `web/lib/pipeline/chain.ts` | State machine: `processDoneJob()`, handlers P1-P6, `runChainCycle()` |
| `web/lib/pipeline/createJob.ts` | `enqueueStage()` với `causedByJobId` idempotency guard |
| `web/lib/pipeline/tts.ts` | TTS: parse P3, submit, poll, save audio_url |
| `web/lib/pipeline/descriptionBuilder.ts` | Build YouTube description từ P2/P3/P4 |
| `web/lib/pipeline/antiDuplication.ts` | 2-layer anti-dup: person rule + pgvector cosine |
| `web/lib/db/schema/*.ts` | Drizzle schema cho tất cả bảng |
| `web/lib/db/repo/*.ts` | DB helpers (videos, jobs, video-content, channel-config, prompt-versions) |
| `web/app/api/cron/process-jobs/route.ts` | Cron entry: `runChainCycle()` + TTS + notify failed |
| `web/app/api/jobs/process-now/route.ts` | Manual trigger (Dashboard button) |
| `src/auto_yt/worker.py` | Python worker: poll DB → ChatGPT → save result |
| `src/auto_yt/job_queue.py` | `claim_job()`, `complete_job()`, `fail_job()` (asyncpg) |

---

## 5. Idempotency & Retry — Những điều cần nhớ

### `causedByJobId` guard
`enqueueStage({ causedByJobId: X, stage: "P4", videoId: Y })` sẽ:
1. Gọi `findJobByCause(X, "P4", Y)` — tìm job đã tồn tại với cùng bộ (cause, stage, video)
2. Nếu tìm thấy → return job cũ, KHÔNG tạo mới
3. Nếu không → tạo job mới

**HỆ QUẢ**: Khi muốn retry P3 thủ công (ví dụ video chất lượng kém), PHẢI tạo job MỚI mà KHÔNG có `causedByJobId`. Nếu dùng lại job P3 cũ với `causedByJobId`, `handleP3Done` sẽ gọi `enqueueStage({causedByJobId: oldP3jobId, stage:"P4"})` và tìm được P4 job cũ → pipeline stall.

Script đúng để retry P3: `web/scripts/retry_p3_v86.mts` (pattern tham khảo).

### Worker retry logic
- `ChatGPTResponseError` (ChatGPT trả lời không hợp lệ) → transient retry, tối đa `MAX_TRANSIENT_RETRIES=3`
- Generic `Exception` (kể cả Playwright `TimeoutError`) → hard fail ngay lập tức, không retry
- **Lưu ý**: Playwright timeouts hiện tại bị treat như hard fail — đây là known limitation

### Worker auto-advance
Sau khi `complete_job()`, Python worker gọi `GET /api/cron/process-jobs` → pipeline tự advance mà không cần cron trigger (5 phút) hay manual button press.

---

## 6. Prompt hiện tại (active versions)

### P1 v3 (2508 chars)
- Topic generation cho 9 nhân vật
- Pain Matrix A-E + title patterns ⑥⑦⑧⑨
- Output: JSON array 12 topics (4件 nhiệt độ 40°, 8件 nhiệt độ 65-70°)
- Placeholder: `[RECENT_VIDEOS]`

### P2 v2 (1110 chars)
- 6-section outline (S1-S6), target 3000-3500 chars, 一人称スタイル
- 共感弧 4 steps: 共鳴 → 正当化 → 解放 → 再生/対立
- 感情温度ルール riêng cho 40°/65°/70°
- Placeholders: `[TITLE]`, `[TOPIC]`, `[PAIN_TYPE]`, `[TEMP]`, `[INNER_VOICE]`, `[REFERENCE_BOOK]`, `[PERSON]`, `[SELF_ADDRESS]`

### P3 v10
- Pure narration, NO section headers/labels
- Cấu trúc cảm xúc có section char budgets (S1≈200, S2≈600, S3≈500, S4≈700, S5≈450, S6≈150)
- **S3 bắt buộc có 視点の反転 (twist)**: "失敗・屈辱・孤独だと思っていた経験が、実は◯◯だった" — không có → phải viết lại
- Midpoint hook bắt buộc ở đầu S4 (1 trong 3 câu mẫu) + `<#1.5#>`
- 10-15 pause tags `<#X.X#>`, chỉ dùng ở cuối câu, không dùng tag đơn độc
- Tự refusal nếu output < 3000 chars
- Placeholders: `[DANYI]`, `[TEMP]`, `[REFERENCE_BOOK]`, `[PERSON]`

### P4 v3 (769 chars)
- SEO package đầy đủ
- Output KHÔNG có `■` prefix, CÓ漢数字 count suffix
- Chapters ở timestamp 75% thực tế
- Placeholders: `[SCRIPT]`, `[PAIN_TYPE]`, `[REFERENCE_BOOK]`, `[COMMENT_QUESTION]`

### P_score v2
- JSON output: `{total_score, breakdown: {hook, emotion, tts, seo}, issues, verdict}`
- **D-1 fix**: chấp nhận Pattern A〜E và ⑥〜⑨ (v1 chỉ nhận A〜E → sai với P1 thực tế)
- **C fix**: ngưỡng pause tag 15-20 → 10-15 (match P3 v10)

### P5 v2
- Analytics analysis sau 48h publish, ≥100 views
- **Graceful degrade**: `[LENGTH]`, `[DROP_TIME]`, `[DROP_SEC]`, `[SOURCE_1-3]` đang rỗng (chưa có YouTube Analytics API) → AI bỏ qua và ghi "データなし — 省略"
- Item 3 (AVD低): dùng DROP_TIME nếu có, nếu không thì phân tích cấu trúc P3

### P6 v1 (440 chars)
- Batch analysis 10 videos → rewrite P1 prompt tự động
- `[VIDEO_BATCH_DATA]` = bảng `formatBatchTable()` với title, pattern, pain, temp, person, CTR, AVD, comment/like rate

---

## 7. Dashboard UI

Tech stack: Next.js App Router, Tailwind CSS v4, shadcn/ui, Drizzle ORM.

### Các trang
- `/` — Dashboard: stats, job activity, "Chạy pipeline" button (`RunPipelineButton`)
- `/videos` — Danh sách video với filter theo status
- `/videos/[id]` — Chi tiết video: timeline P1→P_score, audio player, metadata (score, retry count, YouTube ID)
- `/settings` — channel_config editor

### Bảo mật
Cookie middleware: `dashboard_auth` cookie phải match `DASHBOARD_SECRET` env var.

---

## 8. Môi trường & Secrets

```bash
# web/.env.local
DATABASE_URL=postgresql://...@neon...  # Neon Postgres
OPENAI_API_KEY=sk-...                  # OpenAI Embeddings
TELEGRAM_BOT_TOKEN=...                 # Telegram notifications
TELEGRAM_CHAT_ID=...
VIVOO_API_KEY=sk_8075b49el90qhu5jqsjsfgbyczg23xmqm2sk4fyp050jh82q   # AI33.PRO TTS
YOUTUBE_API_KEY=AIzaSyAAzeIUSmcDZM4OtrRlBfDheQQDzjVnOe4
DASHBOARD_SECRET=1234f09ce079762c5ed48f927cbb03133222b654116f4fdb
```

**KHÔNG commit secrets vào git.**

---

## 9. Scripts tiện ích (`web/scripts/*.mts`)

Chạy bằng: `cd web && node_modules/.pnpm/node_modules/.bin/tsx scripts/<tên>.mts`

| Script | Chức năng |
|--------|-----------|
| `check_e2e.mts` | Xem recent jobs, video counts, running jobs, unconsumed done jobs |
| `check_pipeline.mts` | Tổng quan pipeline status |
| `check_video86.mts` | Inspect video cụ thể (thay số) |
| `check_tts.mts` | TTS status cho tất cả ready/published videos |
| `check_orphans.mts` | Phát hiện orphaned jobs/video_content sau delete |
| `retry_p3_v86.mts` | Tạo fresh P3 job (không `causedByJobId`) để retry |
| `read_all_prompts.mts` | Đọc tất cả active prompts từ DB |
| `read_p3_prompt.mts` | Đọc P3 prompt hiện tại |
| `update_p3_v3.mts`, `update_p3_v4.mts` | Scripts update prompt P3 |
| `regen_pdesc.mts` | Tái tạo P_desc cho video cụ thể |
| `reset_audio_url.mts` | Reset audio_url để TTS chạy lại |

**Pattern viết script**:
```typescript
import { config } from "dotenv";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
const __dirname = dirname(fileURLToPath(import.meta.url));
config({ path: resolve(__dirname, "../.env.local") });
// Dùng dynamic import với .js extension (không phải .ts):
const { someFunc } = await import("../lib/db/repo/videos.js");
```

---

## 10. Quy trình commit & deploy

```bash
# TypeScript check trước khi commit
cd web && node_modules/.bin/tsc --noEmit

# Commit message format
git commit -m "fix: mô tả ngắn

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"

# Deploy lên production Vercel
npx vercel --prod --yes
```

---

## 11. Trạng thái hiện tại (tính đến 2026-06-12)

### Videos hiện có
- #48, #51, #52, #54: `published` (có audio_url)
- #83: `ready_to_publish` (có audio_url)
- #86: `scripted` — P3 job #345 FAILED (Playwright TimeoutError trên `#prompt-te` locator)
  → Cần retry bằng script `retry_p3_v86.mts` sau khi worker/ChatGPT hoạt động bình thường

### Known issues
1. **Video #86 cần retry P3**: `retry_p3_v86.mts` đã viết sẵn, chỉ cần chạy
2. **Playwright timeouts → hard fail**: Generic exceptions không được transient-retry như `ChatGPTResponseError`
3. **handleP1Done crash-dup**: Nếu P1 handler crash giữa chừng khi đang tạo videos, loop có thể tạo duplicate videos (mitigated bởi anti-dup check, không phải full solution)

---

## 12. Kênh YouTube「哲人の刻」

- **Concept**: Các triết nhân vĩ đại Nhật Bản (9 người được phép) chia sẻ trí tuệ theo góc nhìn người xem hiện đại
- **Style**: Một ngôi kể (第一人称), triết nhân tự nói chuyện, KHÔNG dùng ba ngôi
- **Tự xưng**: わたし / わし / わたくし (tùy nhân vật)
- **Video length target**: 10-13 phút (P3 v9: 3000-3500 chars)
- **TTS Voice**: Clone voice riêng cho từng nhân vật trên AI33.PRO Vivoo V3
- **Cấu trúc cảm xúc**: Phải có S1 hook sắc bén, S4 midpoint hook, S6 comment question kết thúc

---

---

## 13. Lịch sử thay đổi prompt

| Ngày | Prompt | Version | Thay đổi |
|------|--------|---------|---------|
| 2026-06-12 | P5 | v1→v2 | Graceful degrade: các placeholder rỗng (LENGTH, DROP_TIME, SOURCE*) → "データなし — 省略" |
| 2026-06-12 | P_score | v1→v2 | D-1: Pattern A〜E → A〜E・⑥〜⑨いずれも可; C: pause tag 15-20 → 10-15 |
| 2026-06-12 | P3 | v9→v10 | S3: thêm 視点の反転 bắt buộc — fix P_score B-2 (10pt) từ may rủi thành có chủ đích |

*File này được tạo 2026-06-12 bởi Claude Sonnet 4.6. Cập nhật khi có thay đổi lớn trong hệ thống.*
