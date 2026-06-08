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

## ⚠️ Việc còn lại trước khi chạy production thật

1. Khởi chạy worker (`src/auto_yt/worker.py`) trên máy Mac cá nhân — heartbeat ghi vào `channel_config.worker_heartbeat`.
2. Theo dõi tab **Actions** trên GitHub vài giờ đầu để xác nhận 3 workflow cron chạy đúng lịch (GitHub có thể trễ vài phút so với lịch khai báo dưới tải cao — đây là giới hạn đã biết của GitHub Actions scheduled workflows, không phải lỗi).
3. *(Tùy chọn)* Nếu muốn polling chính xác hơn (đúng mỗi phút như thiết kế gốc), cân nhắc nâng cấp Vercel Pro (~$20/tháng) để dùng cron native — đã loại bỏ phương án này theo lựa chọn ban đầu của user (ưu tiên miễn phí).

---

## Bug thật đã phát hiện & sửa trong quá trình build

- **`db.transaction()` không được neon-http driver hỗ trợ** (Phase 5): `activateNewPromptVersion` lẽ ra sẽ fail mọi lần ghi đè prompt P6/rollback trong production. Đã sửa bằng cách chạy 2 statement tuần tự, dựa vào partial unique index `prompt_versions_one_active_per_key` làm cơ chế đảm bảo tính nhất quán.
- **`DASHBOARD_SECRET=""` placeholder rỗng** (Phase 6): vô hiệu hóa hoàn toàn cổng xác thực dashboard VÀ Bearer auth cho cron routes. Đã tạo secret thật bằng `openssl rand -hex 24`.

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
