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

## ⚠️ Việc còn lại trước khi chạy production thật

1. **Tạo Telegram bot thật** — `TELEGRAM_BOT_TOKEN` và `TELEGRAM_CHAT_ID` trong `web/.env.local` hiện vẫn là chuỗi rỗng (placeholder). Cần:
   - Tạo bot qua [@BotFather](https://t.me/BotFather) → lấy token
   - Lấy `chat_id` (gửi tin nhắn cho bot rồi gọi `getUpdates`)
   - Điền vào `.env.local` (local) **và** Vercel project env vars (production)
   - Logic dispatch đã được test bằng stub fetch — chỉ thiếu credentials thật.
2. Deploy `web/` lên Vercel (nếu chưa) + đảm bảo 4 cron jobs trong `vercel.json` hoạt động (`process-jobs` mỗi phút, `check-analytics` 6h, `evaluate-rollback` hàng ngày, `check-worker` mỗi 10 phút).
3. Khởi chạy worker (`src/auto_yt/worker.py`) trên máy Mac cá nhân — heartbeat ghi vào `channel_config.worker_heartbeat`.

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
