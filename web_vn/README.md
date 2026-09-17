# auto_YT — Sâm Kể Chuyện Audio Drama Engine (`web_vn`)

Phân hệ tự động hóa sản xuất video truyện tâm sự / drama gia đình dài 2–3 giờ phong cách **Sâm kể chuyện** (`@Samkechuyen01`).

## 1. Cấu hình Runtime & Cổng (Port Mapping)

| Dịch vụ | Cổng (Port) | Ghi chú |
| :--- | :--- | :--- |
| **Next.js Web App** | `3005` | Dashboard & API Orchestration |
| **PostgreSQL (Docker)** | `5438` | Container: `auto_yt_web_vn_postgres`, DB: `auto_yt_vn` |
| **OmniVoice Engine** | `8000` | Local Voice Cloning Server (Bac Sam & Characters) |

*(So sánh: `web` :3000 / DB: 5434 | `web_2` :3001 / DB: 5435 | `web_3` :3002 / DB: 5433 | `web_ko` :3003 / DB: 5436 | `web_ko_jp` :3004 / DB: 5437)*

## 2. Khởi động nhanh (Quick Start)

Trong thư mục `web_vn`:

```powershell
# 1. Cài đặt dependencies
pnpm install

# 2. Khởi động database PostgreSQL cục bộ
pnpm db:up

# 3. Chạy migration schema
pnpm db:migrate

# 4. Khởi động Dashboard Next.js
pnpm local:dev
```

Truy cập: `http://localhost:3005`

## 3. Kiến trúc Core Pipeline (`web_vn/scripts/`)

- `story_generator.py`: Sinh kịch bản 5 hồi & 10 chương theo ma trận hoán vị 5 biến số.
- `omnivoice_client.py`: Phân tách speaker tags `[SPEAKER:bac_sam]`, `[SPEAKER:nhan_vat]` và gửi đến OmniVoice.
- `audio_master.py`: Auto-ducking BGM Piano (-20dB) và chuẩn hóa EBU R128 (-16 LUFS).
- `video_renderer.py`: Render video 1080p bằng GPU NVENC (NVIDIA accelerated).
