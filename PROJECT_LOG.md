# PROJECT_LOG — 哲人の刻 Auto-Pipeline

Nhật ký theo dõi tiến độ / trạng thái / vận hành cho hệ thống sản xuất nội dung YouTube tự động (kênh "哲人の刻" — triết lý/trí tuệ sống cho khán giả Nhật 40-70 tuổi).

Kiến trúc: monorepo — `web/` (Next.js/Vercel/Drizzle, sở hữu DB + điều phối) + `src/auto_yt/` (Python/Playwright worker), giao tiếp DUY NHẤT qua bảng `jobs` trong Neon Postgres chung.

Kế hoạch gốc: `~/.claude/plans/t-t-t-c-c-c-scalable-pebble-agent-aa00d898b31b628f6.md`

---

## Trạng thái tổng quan

**Tất cả 8 phase đã hoàn thành và verify trực tiếp trên Neon DB thật (2026-06-08).**

| Phase | Nội dung | Trạng thái |
|---|---|---|
| 0 | Scaffold Next.js + Vercel + pgvector | ✅ Done |
| 1 | DB schema (Drizzle) — 6 bảng + index đặc biệt | ✅ Done |
| 2 | Mở rộng worker: job queue (SKIP LOCKED) + worker loop | ✅ Done |
| 3 | Điều phối pipeline: chaining P1→P2→P3→P4→P_score qua cron | ✅ Done |
| 4 | Chống trùng (rule + semantic/pgvector) + scoring + retry | ✅ Done |
| 5 | P5/P6, prompt versioning, auto-rollback | ✅ Done |
| 6 | UI dashboard (videos/prompts/needs-attention/settings) | ✅ Done |
| 7 | Quan sát & cảnh báo (Telegram + structured logs + worker-stall detection) | ✅ Done |

---

## ✅ Tài nguyên / credentials — TRẠNG THÁI (cập nhật 2026-06-08)

Tất cả secrets đã được set ở cả `web/.env.local` (local dev) **và** Vercel project env vars (production):

| Biến | Trạng thái | Mục đích |
|---|---|---|
| `DATABASE_URL` | ✅ set | Neon Postgres |
| `OPENAI_API_KEY` | ✅ set | Embeddings — chống trùng nội dung (Phase 4) |
| `YOUTUBE_API_KEY` | ✅ set | Theo dõi view-count → trigger P5/P6 (Phase 5) |
| `TELEGRAM_BOT_TOKEN` | ✅ set (bot `@rp_yt_bot`) | Gửi cảnh báo |
| `TELEGRAM_CHAT_ID` | ✅ set (`5145120612`, chat riêng @HulkBeotii) | Đích nhận cảnh báo |
| `DASHBOARD_SECRET` | ✅ set (`openssl rand -hex 24`) | Auth dashboard + Bearer cho cron routes |

→ Đã gửi tin nhắn test thật qua Telegram và xác nhận `notify()` hoạt động end-to-end trên production credentials.

## ✅ Deploy & Cron — TRẠNG THÁI (cập nhật 2026-06-08)

- **Deployed lên Vercel production**: `https://web-three-eta-70.vercel.app`
- **Phát hiện giới hạn quan trọng**: Vercel Hobby plan chỉ cho phép cron chạy **tối đa 1 lần/ngày** — không đủ cho `process-jobs` (cần mỗi phút), `check-worker` (10 phút), `check-analytics` (6 giờ).
- **Giải pháp đã triển khai** (theo lựa chọn của user — dùng dịch vụ cron miễn phí bên ngoài thay vì nâng cấp Pro):
  - `web/vercel.json` chỉ còn giữ `evaluate-rollback` (chạy hàng ngày — Hobby cho phép native)
  - 3 cron còn lại chuyển sang **GitHub Actions scheduled workflows** tại `.github/workflows/`:
    - `cron-process-jobs.yml` — mỗi 5 phút (GitHub Actions không đảm bảo chính xác mỗi phút; 5 phút là mức thực tế đáng tin cậy nhất)
    - `cron-check-worker.yml` — mỗi 10 phút
    - `cron-check-analytics.yml` — mỗi 6 giờ
  - Mỗi workflow gọi endpoint tương ứng qua `curl` với header `Authorization: Bearer ${{ secrets.DASHBOARD_SECRET }}`
  - Đã set GitHub repo secret `DASHBOARD_SECRET` + repo variable `PIPELINE_BASE_URL=https://web-three-eta-70.vercel.app`
  - Có thể trigger thủ công qua tab Actions (mỗi workflow đều có `workflow_dispatch`)

## ✅ Worker & Kickoff cron — TRẠNG THÁI (cập nhật 2026-06-08)

- **Worker đang chạy** trên Mac (nohup, ghi log vào `worker.log`), heartbeat OK, đã login ChatGPT, **đã xác nhận luôn dùng Thinking mode** (xem mục bug bên dưới).
- **Phát hiện bug nghiêm trọng**: dashboard production trống (0 video, 0 job) vì **chưa từng có gì khởi động lô P1 đầu tiên**. Đã sửa — xem mục Bug bên dưới (`generate-topics` cron).
- Job #23 (P1 — tạo chủ đề lô đầu tiên) đã được tạo thủ công và đang chờ worker xử lý.

## ⚠️ Việc còn lại trước khi go-live hoàn toàn

1. Theo dõi vài giờ đầu để xác nhận chuỗi P1→P2→P3→P4→P_score chạy hết và video đầu tiên đạt `ready_to_publish`.
2. Theo dõi tab **Actions** trên GitHub để xác nhận 3 workflow cron chạy đúng lịch (GitHub có thể trễ vài phút dưới tải cao — giới hạn đã biết, không phải lỗi).
3. *(Tùy chọn)* Nếu muốn polling chính xác hơn (đúng mỗi phút như thiết kế gốc), cân nhắc nâng cấp Vercel Pro (~$20/tháng) — đã loại bỏ phương án này theo lựa chọn ban đầu của user (ưu tiên miễn phí).
4. Worker sẽ dừng khi Mac tắt/ngủ — khởi động lại bằng: `cd /Users/sangspm/Documents/auto_YT && nohup python3 -m src.auto_yt.worker > worker.log 2>&1 &`

---

## Bug thật đã phát hiện & sửa trong quá trình build

- **`db.transaction()` không được neon-http driver hỗ trợ** (Phase 5): `activateNewPromptVersion` lẽ ra sẽ fail mọi lần ghi đè prompt P6/rollback trong production. Đã sửa bằng cách chạy 2 statement tuần tự, dựa vào partial unique index `prompt_versions_one_active_per_key` làm cơ chế đảm bảo tính nhất quán.
- **`DASHBOARD_SECRET=""` placeholder rỗng** (Phase 6): vô hiệu hóa hoàn toàn cổng xác thực dashboard VÀ Bearer auth cho cron routes. Đã tạo secret thật bằng `openssl rand -hex 24`.
- **Thiếu cron khởi động lô P1 đầu tiên** (phát hiện sau khi deploy production — dashboard trống hoàn toàn, 0 video/0 job): plan gốc gọi rõ một cron riêng `generate-topics` để tự tạo lô chủ đề mới khi pipeline rảnh, nhưng cron này chưa từng được build trong Phase 3 — `processDoneJob` chỉ biết "nối tiếp" job đã tồn tại, không có gì "khởi động" job đầu tiên. Đã tạo `web/app/api/cron/generate-topics/route.ts` (kiểm tra "có lô đang chạy dở không" rồi mới tạo job P1 mới kèm ngữ cảnh chống trùng), lên lịch hàng tuần (thứ Hai) trong `vercel.json`, và **kích hoạt thủ công ngay sau khi deploy** để bắt đầu lô đầu tiên (job #23) thay vì chờ tới thứ Hai tuần sau.

---

## Cơ chế vận hành chính cần nhớ

- **Worker-stall detection**: chỉ cảnh báo khi `worker_last_status='running'` NHƯNG không có heartbeat > 30 phút (worker chạy trên Mac cá nhân nên việc tắt máy/ngủ là bình thường — KHÔNG cảnh báo khi `status='stopped'`). Idempotent qua flag `worker_stall_alerted`.
- **Auto-rollback prompt**: so sánh CTR batch mới/cũ (≥10 video, view ≥100), lệch >25% → revert + giới hạn 1 lần/30 ngày → vượt giới hạn thì `auto_update_paused=true` + cảnh báo + hiện trên trang Needs Attention.
- **Logging**: structured JSON một dòng qua `console.log(JSON.stringify({event, ...}))`, Vercel tự thu thập — KHÔNG có bảng logs riêng (YAGNI).
- **Thông báo Telegram** là kênh cảnh báo chính cho: job lỗi cứng, prompt rollback, auto-update bị tạm dừng, worker bị stall.

---

## Lịch sử cập nhật log này

- **2026-06-08**: Tạo file. Hoàn thành toàn bộ 8 phase, verify live trên Neon DB, dọn dẹp stub data, restore baseline. Pipeline sẵn sàng deploy — chỉ còn thiếu Telegram bot credentials thật.
- **2026-06-08 (cập nhật)**: Người dùng cung cấp đủ `OPENAI_API_KEY`, `YOUTUBE_API_KEY`, `TELEGRAM_BOT_TOKEN`; lấy `TELEGRAM_CHAT_ID` qua `getUpdates`. Đã set toàn bộ 6 secrets vào `.env.local` + Vercel production env vars, gửi tin nhắn test Telegram thành công. **Tất cả tài nguyên/credentials đã sẵn sàng** — chỉ còn bước deploy + khởi chạy worker để go-live.
- **2026-06-08 (go-live + sửa bug resilience của worker)**: User hỏi "sao dashboard trống?" → phát hiện & sửa bug thiếu cron khởi động (`generate-topics`, xem mục Bug ở trên), trigger thủ công job #23. Job #23 fail ngay với `TargetClosedError` (tab ChatGPT chết giữa chừng) — phát hiện **lỗ hổng resilience nghiêm trọng**: vòng lặp `run()` trong `worker.py` tái sử dụng `page` mãi mãi, không kiểm tra "còn sống" — một khi tab/context chết, MỌI job sau đó sẽ fail tức thì theo cùng kiểu lỗi, trong khi heartbeat vẫn báo `running` bình thường (false-positive mà `check-worker` không bắt được vì nó chỉ phát hiện heartbeat *biến mất*, không phát hiện heartbeat *còn nhưng vô dụng*).
  - **Đã sửa**: thêm `_page_alive(page)` (probe rẻ qua `page.evaluate("1")`, bắt cả trường hợp `is_closed()` chưa kịp cập nhật) và `ensure_session(pw, ctx, page, account)` (khôi phục bằng cách mở tab mới trong cùng context — cách rẻ; nếu thất bại thì relaunch toàn bộ persistent context — fallback) vào `worker.py`. Gọi `ctx, page = await ensure_session(...)` ở đầu MỖI vòng lặp `while True`, trước khi claim job, để dọn session chết trước khi xử lý job tiếp theo. Thêm thêm 1 nhánh `except Exception` bắt-tất-cả ở cuối để vòng lặp không bao giờ crash hẳn vì lỗi bất ngờ.
  - Restart worker → requeue job #23 thủ công qua `/api/jobs/23/retry` (reset `status=pending, retry_count=0`) → worker claim lại, chạy thành công (`status=done`), `process-jobs` cron consume và **chain tự động tạo ra 5 video mới (id 15-19) + 5 job P2 (id 24-28)**. Pipeline chính thức "sống" và tự chạy auto 100% từ đây.

- **2026-06-08 (re-verify P5/P6/rollback + kiến trúc tab riêng theo topic)**:
  - **Re-verify P5→P6→rollback**: chạy lại lô kiểm thử stub (script tạm `web/scripts/test-p5p6-rollback-stub.py`, đã xoá sau khi xong — theo đúng convention "stub rồi dọn") nhắm thẳng vào các cron endpoint production thật. 2 kịch bản: (A) flow tự nhiên P5 trigger/chain + P6 trigger/chain trên 1 video stub; (B) test rollback/revert biệt lập bằng chuỗi `prompt_versions` tổng hợp + 3 video stub với CTR có kiểm soát. Kết quả **18/19 check pass** (1 "fail" duy nhất — "P5 job is pending" — chỉ là race vô hại: worker thật đã claim job stub trước khi script kịp kiểm tra status).
    - Phát hiện 1 bug trong chính script dọn dẹp (không phải trong code production): thứ tự xoá vi phạm FK — xoá `videos` trước khi gỡ tham chiếu `prompt_versions.effective_from_video_id`, gây `ForeignKeyViolationError`. Đã xin phép user (vì hệ thống auto-mode chặn thao tác DELETE/UPDATE trực tiếp lên DB production không có uỷ quyền tường minh — user trả lời "được") rồi dọn thủ công đúng thứ tự: deactivate/khôi phục `prompt_versions` trước → xoá `prompt_versions` stub → xoá `jobs`/`video_content`/`video_analytics`/`videos` stub → xoá 3 key `channel_config` tạm. Verify sạch: P1 active đúng bản gốc (id=1), 0 video/`prompt_versions` còn sót `ZZ_STUB`, `auto_update_paused=false` không đổi.
  - **Kiến trúc tab riêng theo topic (TabManager)**: theo yêu cầu của user — P1 chạy trong 1 "tab/luồng hội thoại reservoir" cố định, dùng lại xuyên suốt để ChatGPT tự nhớ các topic đã đề xuất trước đó (lớp chống trùng thứ 2, bổ trợ embedding); P2→P_score (và sau này P5/P6) mỗi video có tab/cuộc hội thoại RIÊNG, mở lười khi cần và đóng ngay khi video đạt trạng thái cuối (`ready_to_publish`/`needs_attention` — theo lựa chọn của user khi được hỏi). Đã viết lại `worker.py`: bỏ `ensure_session` toàn cục, thay bằng class `TabManager` quản lý 1 `topic_page` (tự phát hiện & mở lại nếu chết — vd đổi tài khoản GPT) + dict `video_pages` theo `video_id` (cũng tự phục hồi qua `_page_alive`). `run()` giờ gọi `tabs.get_page_for(job)` để định tuyến mỗi job tới đúng tab, và `tabs.close_if_finished(...)` để dọn tab xong việc.
    - Lưu ý quan trọng: "ghim tab" (pin) là hành vi UI thuần tuý của Chrome tab-strip, KHÔNG có hook CDP/Playwright nào — `_try_pin` cố tình để no-op kèm docstring giải thích, thay vì giả vờ làm được; điều thực sự quan trọng (tái sử dụng đúng object `Page`) đã được đảm bảo đầy đủ.
    - Verify: restart worker → log xác nhận `tabs.bootstrap()` mở & login thành công vào tab reservoir P1 ngay khi khởi động (`Opening dedicated 'topic reservoir' tab for P1...` → `New ChatGPT tab ready`). Hàng đợi job hiện đã rỗng (tất cả 23 job cũ đã `done`, video #15-19 đã lên `ready_to_publish`/`scripted`) nên chưa quan sát trực tiếp được lúc mở tab riêng cho video; logic định tuyến dùng lại nguyên `_new_logged_in_page`/`_page_alive` đã verify trong bản vá resilience trước, nên độ tin cậy cao — sẽ tiếp tục theo dõi `worker.log` khi cron tạo job mới để xác nhận `Opening dedicated tab for video #X...` / `... closing its dedicated tab.`
