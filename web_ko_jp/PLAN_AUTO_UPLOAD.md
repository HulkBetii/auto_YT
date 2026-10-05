# Plan: Auto upload YouTube cho `web_ko_jp` (kênh 人生の真理), dùng lại uploader của Nexus

> Plan này dành cho Antigravity code. Mọi code, comment và commit message viết bằng tiếng Anh.
> Phạm vi: `D:\VibeCoding\auto_YT\web_ko_jp`. Nexus (`D:\VibeCoding\auto_upload\Nexus`) **chỉ được đọc**.
> Ngoại lệ duy nhất: nếu bắt buộc thì được thêm tối đa 1 entry `"ja"` vào `YOUTUBE_LANGUAGE_LABELS` (xem bước 4).

## Context

`web_ko_jp` hiện tạo ra: kịch bản, audio TTS, file SRT, thumbnail và **upload kit** (metadata đã qua gate PASS/WARN/FAIL). Việc upload lên YouTube Studio vẫn làm tay.

Nexus đã có một uploader YouTube Studio chạy thật:
- Đường browser: `browser_youtube_uploader.upload_video_via_browser`, chạy qua profile GPM bằng CDP.
- Có workflow checkpoint, chống upload trùng, xác minh đúng kênh trước khi upload, và lịch đăng theo slot.

Quyết định đã chốt với user:
1. **MP4 do user tự render** vào một thư mục do tool quy định.
2. Kênh đăng nhập trong **một profile GPM**. Hiện chưa có OAuth/API.
3. **Upload thành bản nháp PRIVATE, user duyệt xong mới đặt lịch hoặc công khai.**
4. Không đổi voice. Không đụng pipeline TTS.

Vì sao chọn đường **browser (GPM)** mà không dùng API ở giai đoạn này:
- Chưa có OAuth.
- Video upload qua API từ Google Cloud project **chưa qua audit** sẽ bị khóa private vĩnh viễn, không công khai được. Cách 2 cuối cùng vẫn phải công khai.
- Đường browser không cần audit và không tốn quota.

**Nguyên tắc chính: adapter, không fork.**
- `web_ko_jp` không sao chép hơn 4.000 dòng uploader.
- Thay vào đó, `web_ko_jp` gọi trực tiếp hàm của Nexus qua một script "bridge" chạy bằng venv của Nexus.
- Nexus sửa uploader (mỗi khi YouTube Studio đổi UI) thì `web_ko_jp` hưởng luôn.
- Rủi ro Nexus đổi chữ ký hàm được chặn bằng contract check ở preflight và bằng test.

## Luồng tổng thể

```
run_pipeline.py (đã có) → output/v{id}_*/ : wav, srt, thumb, data json, youtube_upload_kit_v{id}.txt
        │  user render MP4 → output/v{id}_*/render/final_v{id}.mp4
        ▼
youtube_upload.py upload --video_id N          (uv env, web_ko_jp)
  1. preflight: gate ≠ FAIL; WARN cần --ack-warn; MP4/SRT/thumb hợp lệ; GPM profile sống; contract Nexus
  2. ghi bản ghi ko_jp_youtube_uploads (stage=preflight_ok), snapshot + sha256 MP4
  3. gọi youtube_upload_bridge.py (venv Nexus) → upload_video_via_browser(publish_mode="private",
     existing_video_id=<nếu đã có>) ; checkpoint/Video ID trả về qua file JSONL → DB
  4. kết thúc: stage=draft_private (review_pending) | needs_review | failed
        │  user xem bản nháp trên Studio, nghe lại các mốc VOICE QA, làm checklist trong kit
        ▼
youtube_upload.py approve --video_id N [--at "2026-10-10T20:00" | --next-slot | --public-now]
  → tính slot (Asia/Tokyo) → bridge: mở lại bản nháp qua existing_video_id rồi đặt lịch (hoặc public)
  → stage=scheduled | published ; ghi vào channel_registry (video_id thật)
```

---

## Bước 0. Điều kiện tiên quyết

**Phía Claude** (đã xong trong worktree, cần merge trước):
- Commit và merge bản sửa giọng đọc (`prepare_tts_text`, `cut1`, `voice_qa.py`, các check giọng trong gate) vào `drama-han`.
- Antigravity bắt đầu từ `drama-han` đã có commit này.

**Phía user** (xem phần Hướng dẫn ở cuối):
- Có một profile GPM đang đăng nhập đúng kênh 人生の真理, kèm proxy.
- Lấy được `profile_id` và Channel ID (`UCTNErIRz8xR8-HQxNbq-bNA`).

## Bước 1. Cấu hình kênh và thư mục render

Sửa `scripts/channel_profile.py`, thêm hằng số (không hardcode rải rác):

```python
YOUTUBE_CHANNEL_ID = "UCTNErIRz8xR8-HQxNbq-bNA"
PUBLISH_TIMEZONE = "Asia/Tokyo"
PUBLISH_SLOTS = [{"day": d, "time": "20:00"} for d in range(7)]   # dữ liệu cũ: 4 video đều đăng 20:00 JST
PUBLISH_DAILY_LIMIT = 1
PUBLISH_LEAD_MINUTES = 120
YOUTUBE_CATEGORY_ID = "27"          # Education (khớp Studio upload defaults)
VIDEO_LANGUAGE = "ja"
CONTAINS_SYNTHETIC_MEDIA = True     # AI voice: must be declared
MADE_FOR_KIDS = False
RENDER_SUBDIR = "render"            # user drops final_v{id}.mp4 here
```

**Bí mật và cấu hình theo máy** không vào git:
- File `web_ko_jp/data/upload_config.json` (thêm vào `.gitignore`), gồm:
  - `gpm_profile_id`
  - `nexus_root` (mặc định `D:\VibeCoding\auto_upload\Nexus`)
  - `nexus_python` (mặc định `<nexus_root>\.venv\Scripts\python.exe`)
- Có file mẫu `upload_config.example.json`.

Quy ước file MP4: `output/v{id}_*/render/final_v{id}.mp4`.
- `run_pipeline.py` tạo sẵn thư mục `render/` và in đường dẫn này ở cuối.
- Upload kit có thêm 1 dòng chỉ chỗ đặt MP4.

## Bước 2. Lưu trạng thái upload (Postgres, cùng DB của `web_ko_jp`)

`lib/db/schema.ts`: thêm bảng `ko_jp_youtube_uploads`, theo cách bảng `youtube_publish_workflows` của Nexus:

| Cột | Ghi chú |
|---|---|
| `id` serial, `video_id` FK → `ko_jp_videos` | |
| `stage` text | `preflight_ok` → `uploading` → `draft_created` → `draft_private` → `approved` → `scheduled`/`published`; hoặc `needs_review`/`failed` |
| `youtube_video_id` text | **Ghi ngay khi bridge báo `draft_created`** (chống upload trùng) |
| `artifact_sha256` text, `snapshot` jsonb | Snapshot metadata đúng như lúc upload (title, mô tả, tags, đường dẫn file, gate status, ack WARN) |
| `gate_status` text, `warn_acknowledged_at` timestamptz | |
| `scheduled_at` timestamptz, `error` text, `created_at`, `updated_at` | |

- Thêm partial unique index: mỗi `video_id` chỉ có 1 bản ghi đang chạy (stage không phải `failed`).
- Chạy `pnpm db:generate` và `pnpm db:migrate`.
- Python truy cập bằng psycopg2, cùng pattern `get_db_connection()` trong `scripts/build_metadata_kit.py`.
- Đặt trong module mới `scripts/upload_store.py`, gồm các hàm `create_or_resume`, `update_stage`, `get_active`.

## Bước 3. Preflight: `scripts/upload_preflight.py` (hàm thuần, test được)

Dùng lại `build_metadata_kit.collect_kit_inputs()`, `load_voice_qa()` và `metadata_gate.run_gate()`. Không tự dựng lại metadata.

Preflight FAIL (dừng, in lý do) khi gặp một trong các trường hợp:
- **Gate:**
  - Gate báo `FAIL`.
  - Gate báo `WARN` mà không có `--ack-warn`. Khi có ack thì lưu vào `warn_acknowledged_at` cùng danh sách các WARN.
- **MP4:**
  - Thiếu MP4.
  - Thời lượng MP4 lệch quá ±2s so với `audio_duration`.
  - Độ phân giải dưới 1280x720, hoặc tỉ lệ khác 16:9.
  - Lấy thông số bằng `imageio_ffmpeg` (đã có trong `.venv` của auto_YT) qua `ffmpeg -i` hoặc ffprobe.
- **Thumbnail:** thiếu file, không phải 16:9, hoặc lớn hơn 2MB. Studio cho tối đa 50MB, nhưng chọn 2MB cho an toàn. Đặt thành hằng số.
- **SRT:** thiếu file SRT.
- **Môi trường:**
  - `upload_config.json` thiếu `gpm_profile_id`, hoặc không tìm thấy venv Nexus.
  - **Contract check:** chạy `nexus_python -c "import inspect, auto_yt.services.browser_youtube_uploader as m; print(list(inspect.signature(m.upload_video_via_browser).parameters))"`, rồi so với danh sách tham số mà bridge cần.
  - Kiểm tra GPM API sống bằng `gpm_service.check_gpm_connection()` (gọi qua bridge ở chế độ `--check`).
- **Trạng thái:** đã có bản ghi ở stage `scheduled` hoặc `published` thì từ chối. Muốn upload lại phải dùng `--force-new` có xác nhận.

## Bước 4. Bridge: `scripts/youtube_upload_bridge.py` (chạy bằng `nexus_python`)

- Thêm `nexus_root/src` vào `sys.path`, rồi import `upload_video_via_browser` và `make_video_public_via_browser` từ `auto_yt.services.browser_youtube_uploader`.
  - Đã kiểm tra: `database.py` của Nexus khi import chỉ khai báo hằng số và không tạo DB. Uploader không gọi DB của Nexus.
- Input là 1 file JSON job do `youtube_upload.py` ghi. Output là các dòng JSONL (`{"type":"progress"|"video_id"|"checkpoint"|"result"|"error", ...}`) ghi ra file trạng thái. Không dùng stdout để tránh log của Nexus lẫn vào.
- Map tham số:

| Tham số Nexus | Giá trị |
|---|---|
| `profile_id` | `gpm_profile_id` |
| `video_path` / `thumbnail_path` / `caption_path` | MP4, PNG, SRT |
| `title` | title A của kit (đã validated) |
| `description` | mô tả đã qua gate (có chương và hashtag) |
| `tags` | tách `tags_flat` theo dấu phẩy |
| `category_id`, `made_for_kids`, `contains_synthetic_media` | lấy từ `channel_profile` |
| `notify_subscribers` | `True` |
| `publish_mode` | `"private"`; `schedule_at=None` |
| `language` | `"ja"`, và `publishing_settings={"language":"ja","title_description_language":"ja","monetization_mode":"auto"}` |
| `publication_timezone` | `Asia/Tokyo` |
| `expected_channel_id` | `YOUTUBE_CHANNEL_ID` (Nexus dừng nếu Studio mở sai kênh) |
| `existing_video_id` | `youtube_video_id` trong DB nếu có, để mở lại bản nháp và không upload trùng |
| `persist_video_id` / `persist_checkpoint` | ghi dòng JSONL tương ứng, flush ngay |

- **Kiểm tra ngôn ngữ:** đọc `YOUTUBE_LANGUAGE_LABELS` trong uploader của Nexus.
  - Nếu không có key `"ja"`, ưu tiên bỏ qua bước chọn ngôn ngữ, vì upload defaults của kênh đã là Japanese.
  - Chỉ khi cách đó không được mới thêm 1 entry `"ja": ["Japanese", "Tiếng Nhật", "日本語"]` vào Nexus. Ghi rõ việc này trong commit message.
- Lỗi `BrowserUploadNeedsReview` thì ghi kết quả `needs_review`, **không retry tự động**.

## Bước 5. Orchestrator CLI: `scripts/youtube_upload.py` (uv env)

| Lệnh | Việc làm |
|---|---|
| `upload --video_id N [--ack-warn] [--force-new]` | preflight → ghi DB → chạy bridge → đọc JSONL theo thời gian thực, ghi DB ngay ở từng checkpoint. `video_id` được ghi trước mọi bước khác. Kết thúc ở `draft_private`. In link `https://studio.youtube.com/video/{id}/edit` |
| `status --video_id N` | stage, Video ID, lỗi gần nhất, link Studio |
| `approve --video_id N (--next-slot \| --at ISO \| --public-now)` | Chỉ chạy được khi stage là `draft_private`. Các bước tiếp theo nằm ngay dưới bảng này. |
| `resume --video_id N` | Chạy lại từ checkpoint (dùng `existing_video_id`) |

Chi tiết lệnh `approve`:
- `--next-slot`: tính slot bằng `find_next_publication_slot`, **chép nguyên** từ `Nexus/src/auto_yt/services/publication_scheduler.py` vào `scripts/publication_scheduler.py`. Hàm này thuần, khoảng 130 dòng, không phụ thuộc UI. Giờ đã bị chiếm lấy từ các bản ghi `scheduled` trong DB.
- Gọi bridge ở chế độ schedule: `upload_video_via_browser(existing_video_id=..., schedule_at=slot, publish_mode="schedule")`. Nexus có nhánh mở lại bản nháp: đọc `upload_video_via_browser` từ khoảng dòng 2723 đến 2930. Hoặc gọi `make_video_public_via_browser` nếu dùng `--public-now`.
- Xác nhận xong thì cập nhật stage, rồi gọi `channel_registry.record_kit`. Thêm cập nhật `video_id` thật, để lần import CSV Studio sau khớp được.

- Mọi exception đều ghi `error` vào DB và log đủ ngữ cảnh. Không nuốt lỗi.
- `run_pipeline.py`: **không tự upload**, vì MP4 render ngoài. Cuối pipeline chỉ in 2 lệnh kế tiếp: đặt MP4 vào đâu và lệnh `upload`.

## Bước 6. Upload kit và checklist duyệt (`build_metadata_kit.py`)

Thêm mục `[9. UPLOAD]` vào kit:
- Đường dẫn MP4 chờ render.
- Trạng thái upload hiện tại.
- **Checklist duyệt trước lệnh approve** (Nexus không tự làm các việc này):
  1. Xem bản nháp, nghe lại các mốc trong mục VOICE QA.
  2. Sửa chương nếu gate báo `chapters_interpolated`.
  3. Bật Test & Compare với title A/B/C (kit có sẵn).
  4. Sau khi công khai: ghim bình luận (kit mục 4) và gắn end screen.

## Bước 7. Dashboard (tối thiểu, có thể làm sau bước 1–6)

- Thêm API route `app/api/youtube-upload/route.ts`, theo pattern spawn Python của `app/api/youtube-rewrite/route.ts`, với 3 action: `upload`, `approve`, `status`.
- `YouTubeDramaCard.tsx`: hiện stage, link Studio, nút "Upload nháp" và nút "Duyệt & đặt lịch".
  - Nút upload bị khóa khi gate FAIL.
  - Khi gate WARN thì hiện hộp xác nhận ack.
- Giao diện theo DESIGN hiện có. Kiểm bằng `npx tsc --noEmit` và `pnpm lint`.

## Bước 8. Test (`web_ko_jp/tests/`, chạy bằng `uv run python -m pytest web_ko_jp/tests -q`)

- `test_upload_preflight.py`:
  - Gate FAIL → chặn. WARN không ack → chặn. WARN có ack → qua.
  - MP4 thiếu, sai thời lượng, sai tỉ lệ → chặn. Dùng MP4 giả tạo bằng ffmpeg trong `tmp_path`.
  - Thumbnail quá 2MB → chặn.
- `test_publication_scheduler.py`: chép các case từ Nexus `test_youtube_publish_pipeline.py` liên quan slot, chạy với Asia/Tokyo. Gồm: giới hạn mỗi ngày, slot đã bị chiếm, thời gian đệm, không đặt lịch vào quá khứ.
- `test_upload_bridge_contract.py`: map tham số bridge so với danh sách tham số kỳ vọng (dùng `inspect`). Đánh dấu skip nếu không có venv Nexus.
- `test_upload_orchestrator.py`:
  - Giả lập bridge ghi JSONL: có `video_id` thì DB lưu trước `draft_private`.
  - Lỗi giữa chừng thì `resume` truyền đúng `existing_video_id`.
  - `needs_review` thì không retry.

## Verification end-to-end

1. Bộ test pass: dùng lệnh pytest như ở Bước 8. Kèm `npx tsc --noEmit` cho dashboard.
2. `youtube_upload.py upload --video_id 8 --ack-warn` với MP4 thật của v8:
   - GPM mở Studio đúng kênh.
   - Bản nháp **PRIVATE** có đủ title, mô tả, tags, thumbnail, phụ đề ja, cờ nội dung tổng hợp.
   - DB ở `draft_private`, `youtube_video_id` khớp với Studio.
3. Chạy lại `upload` lần nữa: không tạo video thứ hai. Phải mở lại đúng bản nháp, hoặc báo đã upload.
4. Kill tiến trình giữa lúc upload rồi `resume`: không trùng video.
5. `approve --next-slot`: Studio hiện "Đã lên lịch" đúng 20:00 JST của slot trống gần nhất. DB ở `scheduled`.
6. Gate FAIL (ví dụ v6): `upload` bị từ chối và in lý do.

---

## Hướng dẫn cho user

### A. Chuẩn bị profile GPM (bắt buộc cho giai đoạn này)

1. Mở GPM-Login. Tạo profile riêng cho kênh, hoặc dùng profile đang có. Gán proxy đang dùng cho kênh.
2. Trong profile đó: đăng nhập Google của kênh, mở `studio.youtube.com`, kiểm tra đúng kênh 人生の真理.
3. Lấy `profile_id` trong GPM, điền vào `web_ko_jp/data/upload_config.json`.
4. Bật GPM Local API (Nexus mặc định gọi `http://127.0.0.1:19995`, xem `gpm_service.DEFAULT_GPM_API_URL`).
5. Không mở profile này bằng tay trong lúc tool đang upload.

### B. OAuth và YouTube Data API (chưa cần cho giai đoạn này; làm nếu muốn chuyển sang API sau)

1. Vào https://console.cloud.google.com, tạo project (ví dụ `jinsei-shinri-upload`).
2. Vào APIs & Services → Library, bật **YouTube Data API v3**.
3. Vào OAuth consent screen: chọn External, điền tên app và email, thêm scope `.../auth/youtube.upload` và `.../auth/youtube`, thêm chính tài khoản kênh vào Test users.
4. Vào Credentials → Create credentials → OAuth client ID, loại **Desktop app**. Tải file `client_secret.json` về và **không commit** file này.
5. **Quan trọng:** khi chưa qua audit, mọi video upload qua API đều **bị khóa private**. Muốn công khai phải nộp **YouTube API Services Audit and Quota Extension Form** (mất vài tuần, cần privacy policy và mô tả cách dùng). Quota mặc định 10.000 đơn vị mỗi ngày, mỗi lần upload khoảng 1.600, tức khoảng 6 video mỗi ngày.
6. Khi đã có OAuth và audit, có thể làm giai đoạn 2: chép `Nexus/.../youtube_publisher.py` (upload nối tiếp được, schedule qua `publishAt`) thành một backend khác trong orchestrator. Giữ nguyên workflow, DB và preflight.

## File đụng tới

- **Mới:** `scripts/youtube_upload.py`, `scripts/youtube_upload_bridge.py`, `scripts/upload_preflight.py`, `scripts/upload_store.py`, `scripts/publication_scheduler.py` (chép từ Nexus), `data/upload_config.example.json`, `app/api/youtube-upload/route.ts`, các test ở Bước 8.
- **Sửa:** `scripts/channel_profile.py`, `scripts/build_metadata_kit.py` (mục 9), `scripts/run_pipeline.py` (tạo `render/` và in lệnh kế tiếp), `lib/db/schema.ts` cùng migration, `app/(dashboard)/YouTubeDramaCard.tsx`, `.gitignore`.
- **Dùng lại, không sửa:** Nexus `browser_youtube_uploader.py`, `gpm_service.py`, `channel_scanner_service.channel_browser_session`, cùng `metadata_gate` và `build_metadata_kit` của `web_ko_jp`.
