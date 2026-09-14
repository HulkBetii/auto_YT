# auto_YT — KO-JP Content Localization Pipeline (`web_ko_jp`)

Hệ thống tự động hoá biên dịch, bản địa hoá và chuyển thể nội dung YouTube giữa Hàn Quốc (KO) và Nhật Bản (JP), kết hợp các thế mạnh từ phân hệ `web` (哲人の刻) và `web_ko` (복이피는길).

## 1. Cấu hình Runtime & Cổng (Port Mapping)

Để đảm bảo chạy song song độc lập với các dashboard khác trong hệ thống `auto_YT`:

| Dịch vụ | Cổng (Port) | Ghi chú |
| :--- | :--- | :--- |
| **Next.js Web App** | `3004` | Dashboard & API Orchestration |
| **PostgreSQL (Docker)** | `5437` | Container: `auto_yt_web_ko_jp_postgres`, DB: `auto_yt_ko_jp` |

*(So sánh: `web` :3000 / DB: 5434 | `web_2` :3001 / DB: 5435 | `web_3` :3002 / DB: 5433 | `web_ko` :3003 / DB: 5436)*

## 2. Khởi động nhanh (Quick Start)

Trong thư mục `web_ko_jp`:

```powershell
# 1. Cài đặt dependencies
pnpm install

# 2. Khởi động database PostgreSQL cục bộ
pnpm db:up

# 3. Tạo và đồng bộ migration Drizzle ORM
pnpm db:generate
pnpm db:migrate

# 4. (Tuỳ chọn) Seed các prompt mẫu ban đầu
npx tsx scripts/init_prompts.mts

# 5. Khởi động Dashboard Next.js
pnpm local:dev
```

Truy cập: `http://localhost:3004`

## 3. Kiến trúc Pipeline 5 Giai đoạn

```
[YouTube / Source Video]
          │
          ▼
    1. Source Audit (Trích xuất luận điểm, fact & cảm xúc cốt lõi từ nguồn Hàn/Nhật)
          │
          ▼
    2. Outline Adaptation (Lập dàn ý 6 phần S1–S6 theo phong cách YouTube Nhật Bản)
          │
          ▼
    3. Script Drafting (Viết lời thoại tự nhiên, nhúng pause tags <#X.X#>, twist ở S3)
          │
          ▼
    4. Fidelity Review (Thẩm định chất lượng ngôn ngữ, độ trung thực và tính hấp dẫn)
          │
          ▼
    5. Ready / TTS Export (Sẵn sàng xuất file hoặc chuyển sang TTS & Render video)
```

## 4. Cấu trúc thư mục

```
web_ko_jp/
├── app/
│   ├── (dashboard)/        # Giao diện quản lý video, hàng đợi và prompt
│   ├── api/                # Endpoints cho pipeline & videos
│   ├── globals.css         # UI Tokens (Drifter 2077 theme)
│   └── layout.tsx
├── lib/
│   ├── db/
│   │   ├── schema.ts       # Bảng videos, sections, jobs, prompt versions, config
│   │   ├── index.ts        # Kết nối pg Pool & Drizzle
│   │   └── repo/           # DB access methods (videos, jobs, prompts, config)
│   └── pipeline/
│       ├── default-prompts.ts # Các prompt mẫu chuẩn hóa
│       └── chain.ts        # Bộ điều phối state machine chuyển trạng thái
├── scripts/
│   └── init_prompts.mts    # Script nạp prompt ban đầu
├── docker-compose.yml      # Postgres container (:5437)
├── drizzle.config.ts
├── package.json
└── tsconfig.json
```
