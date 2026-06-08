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
    - **Verify e2e thật (2026-06-08, theo yêu cầu user "test e2e sau khi update worker")**: video #15 đang ở giữa vòng "needs_retry" (đã chấm điểm lần đầu dưới ngưỡng → tự động lặp lại P3→P4→P_score). Trigger thủ công `process-jobs` để đẩy chuỗi này tiến — quan sát trực tiếp trong `worker.log`:
      ```
      INFO:auto_yt.services.job_queue:Claimed job id=48 stage=P_score video_id=15
      INFO:__main__:Opening dedicated tab for video #15...
      INFO:__main__:New ChatGPT tab ready. Logged in user: {...}
      INFO:__main__:Running job id=48 stage=P_score (prompt 7794 chars)
      ...
      INFO:auto_yt.services.job_queue:Completed job id=48
      ```
      → xác nhận **TabManager mở đúng tab riêng cho video #15** khi job P_score được claim. Sau khi `process-jobs` consume job #48: video #15 đạt điểm 90 (≥ ngưỡng) → tự động chuyển `ready_to_publish`, retry_count dừng ở 1 — **đúng chính xác cơ chế "chấm lại điểm cho đến khi đạt tiêu chuẩn" đã có sẵn trong `handlePScoreDone`** (lặp P3→P4→P_score tối đa `max_content_retries`, vượt giới hạn mới chuyển `needs_attention`); không cần thêm code gì cho phần này — nó đã hoạt động đúng thiết kế.
    - **Bug phát hiện & sửa qua chính lần verify e2e này**: `close_if_finished` (cũ) kiểm tra trạng thái video NGAY SAU khi worker hoàn thành job — nhưng việc ghi `status='ready_to_publish'` chỉ xảy ra SAU ĐÓ, bất đồng bộ, do cron `process-jobs` của Next.js orchestrator thực hiện khi nó tiêu thụ job `done`. Vì vậy với job CUỐI CÙNG của 1 video, lần kiểm tra luôn "sớm hơn 1 nhịp" và tab không bao giờ được đóng (không có job tiếp theo để kích hoạt kiểm tra lại). **Đã sửa**: thay bằng `sweep_terminal_tabs(dsn)` — quét toàn bộ `video_pages` đang mở mỗi vòng lặp poll (kể cả khi không có job mới), đóng bất kỳ tab nào có video đã đạt trạng thái cuối — bắt được thời điểm chuyển trạng thái bất kể nó xảy ra lúc nào. Đã compile + restart worker thành công với bản vá này.

- **2026-06-08 (lô e2e thứ 2 — "chạy tiếp 3 topic, e2e để bắt lỗi" — chạy live 5 video #24-28 qua toàn bộ pipeline)**:
  - User yêu cầu chạy thêm topic mới qua pipeline thật (production), mục đích rõ ràng là **bắt lỗi**. `generate-topics` tạo ra lô chuẩn 5 video (#24-28) thay vì đúng 3 — chấp nhận vì lớn hơn yêu cầu, phủ test tốt hơn. Đẩy cả 5 video tuần tự qua P1→P2→P3→P4→P_score bằng cách lặp lại: chờ worker hoàn thành job → gọi `process-jobs` để chain tiếp → kiểm tra DB.
  - **Bug nghiêm trọng thứ 2 phát hiện & sửa — `MAX_TRANSIENT_RETRIES` là dead code, KHÔNG BAO GIỜ được dùng**: job #56 (P3, video #25) gặp lỗi thoáng qua hoàn toàn bình thường của ChatGPT (`ChatGPTResponseError: "No new assistant message appeared within 240s"` — xảy ra thường xuyên dưới tải bình thường) và bị **fail cứng ngay lập tức** thay vì tự động thử lại. Điều tra phát hiện:
    - Hằng số `MAX_TRANSIENT_RETRIES = 3` đã được khai báo trong `worker.py` từ trước nhưng **không nơi nào tham chiếu tới nó** — mọi lỗi thoáng qua đều đi thẳng tới `fail_job` (trạng thái cuối `failed`, cảnh báo Telegram, cần can thiệp thủ công qua `/api/jobs/:id/retry`).
    - Docstring cũ của `fail_job` còn ghi sai rằng "Next.js orchestrator quyết định có requeue hay không dựa trên retry_count" — nhưng đọc kỹ `chain.ts` xác nhận **không hề có cơ chế requeue tự động nào** ở phía Next.js; con đường hồi sinh job fail cứng DUY NHẤT là endpoint thủ công `/api/jobs/:id/retry`.
    - **Tác động thực tế trong production**: mỗi lần ChatGPT "khựng" thoáng qua (vốn xảy ra đều đặn) sẽ làm job fail vĩnh viễn + bắn cảnh báo Telegram + cần vào dashboard retry tay — lẽ ra phải tự phục hồi êm thấm.
    - **Đã sửa**: thêm `retry_transient_job()` vào `job_queue.py` (đưa job về `pending`, lưu `retry_count` đã tăng + nội dung lỗi để hiện trên dashboard) và nối logic kiểm tra ngân sách retry vào nhánh bắt `ChatGPTResponseError` trong `process_job` (`worker.py`): lỗi thoáng qua trong ngân sách (≤3 lần) tự động requeue với log `"transient failure (attempt N/3) — requeuing for retry"`; chỉ khi vượt ngân sách mới fail cứng với log `"exhausted N transient retries — hard-failing"`. Sửa luôn docstring sai của `fail_job`.
    - **Verify trực tiếp trên production**: restart worker với bản vá, dùng đúng endpoint uỷ quyền `POST /api/jobs/56/retry` (KHÔNG ghi DB thô — tôn trọng giới hạn "cần xin phép trước khi UPDATE/DELETE trực tiếp lên DB production") để hồi sinh job #56 → worker claim lại → hoàn thành sạch sẽ ngay lần thử tiếp theo, không lặp lại lỗi. Đã commit (`98ee230`) + push.
  - **Xác nhận sống `sweep_terminal_tabs` (mảnh ghép cuối cùng còn thiếu của kiến trúc TabManager, từ bản vá `f799b7f`)**: quan sát trực tiếp trong `worker2.log` — cả 5/5 video đều có dòng log đóng tab đúng thời điểm chuyển trạng thái cuối:
    ```
    INFO:__main__:Video #24 reached 'ready_to_publish' — closing its dedicated tab.
    INFO:__main__:Video #26 reached 'ready_to_publish' — closing its dedicated tab.
    INFO:__main__:Video #28 reached 'ready_to_publish' — closing its dedicated tab.
    INFO:__main__:Video #25 reached 'ready_to_publish' — closing its dedicated tab.
    INFO:__main__:Video #27 reached 'ready_to_publish' — closing its dedicated tab.
    ```
    → bản vá `sweep_terminal_tabs` hoạt động chính xác như thiết kế: phát hiện đúng nhịp chuyển trạng thái bất đồng bộ (do cron Next.js ghi sau khi worker hoàn thành job cuối) và giải phóng tab ngay khi video đạt trạng thái cuối, không để lại tab "mồ côi".
  - **Kết quả tổng thể lô e2e thứ 2**: cả **5/5 video (#24-28) đạt `ready_to_publish`** — chuỗi P1→P2→P3→P4→P_score (kể cả vòng lặp tự chấm điểm lại của `handlePScoreDone` khi cần) chạy hoàn toàn tự động, định tuyến tab đúng (mỗi video 1 tab riêng, P1 dùng tab reservoir chung), xen kẽ đúng thứ tự hàng đợi giữa nhiều video độc lập, và dọn tab đúng lúc. Một lần `socket.gaierror` (DNS thoáng qua) xảy ra giữa lô — xác nhận bị bắt đúng bởi handler `except Exception` rộng đã có từ trước, vòng lặp tiếp tục bình thường (không phải bug mới — xác nhận lại bản vá resilience trước đó vẫn hoạt động tốt dưới tải thật). **Tổng kết: phát hiện & sửa 1 bug sản xuất nghiêm trọng (`MAX_TRANSIENT_RETRIES` dead code) + xác nhận sống mảnh ghép cuối cùng còn thiếu của TabManager — đúng mục tiêu "chạy e2e để bắt lỗi" mà user yêu cầu.**

- **2026-06-08 (review code lần 3 — "review lại code xem có bug hay lỗi logic nào nữa không") — phát hiện & sửa 2 lỗi điều phối job**:
  - **Bug #1 (đã sửa, đã deploy production)**: `consumed_at` mang 2 ý nghĩa chồng chéo — "đã chain tiếp" cho job `done` (set bởi `markJobConsumed`) vs "đã cảnh báo Telegram" cho job `failed` (set bởi `notifyNewlyFailedJobs`). Endpoint `/api/jobs/:id/retry` reset job thất bại về `pending` nhưng **quên xoá `consumed_at`** — nếu job đã từng bị `notifyNewlyFailedJobs` đóng dấu (gửi cảnh báo Telegram) trước khi được retry, dấu thời gian cũ tồn tại qua lần reset; job hoàn thành lại thành `done` nhưng vẫn mang `consumed_at` cũ → guard `if (... || job.consumedAt) return` trong `processDoneJob` bỏ qua **vĩnh viễn**, không bao giờ tạo job bước kế tiếp, không cảnh báo gì — job "kẹt" âm thầm giữa pipeline. Đã verify job #56 KHÔNG dính (chỉ vì may mắn về thời điểm retry trước khi cron kịp đóng dấu). **Đã sửa**: thêm `consumedAt: null` vào reset trong `retry/route.ts` + đồng bộ `requeue_job` (Python, dead code nhưng giữ làm khuôn mẫu) kèm docstring giải thích. Commit `997b480`, đã deploy production.
  - **Bug #2 (đã sửa, đã deploy production)**: `processDoneJob` không thực sự idempotent — các handler (`handleP2Done`...`handleP6Done`) thực hiện side-effect nhiều bước (ghi `video_content`, `enqueueStage` tạo job mới, gửi Telegram) TRƯỚC KHI `consumed_at` được đóng dấu ở cuối. Nếu handler crash giữa chừng, cron's try/catch chỉ log lỗi, `consumed_at` vẫn NULL → job được xử lý lại từ đầu ở lượt cron kế tiếp → `enqueueStage` (vốn insert vô điều kiện, không dedup) tạo **job trùng lặp ở stage kế tiếp** (vd 2 job `P_score` cho cùng video) → chấm điểm trùng + cảnh báo "sẵn sàng đăng" trùng.
    - **Đã sửa bằng guard `causedByJobId`**: `enqueueStage` giờ nhận thêm `causedByJobId` (= id của job đang chạy handler), đóng dấu vào `metadata.causedByJobId` của job mới tạo, và trước khi insert sẽ gọi `findJobByCause(causeJobId, stage, videoId)` (jsonb query mới trong `jobs.ts`) — nếu đã tồn tại job với đúng bộ ba (cause job, stage, video) thì trả về job đã có thay vì tạo bản sao. Phân biệt rõ "lặp lại hợp lệ" (vd vòng `needs_retry` P_score→P3, mỗi lần có `causedByJobId` khác nhau vì job nguồn khác nhau) với "trùng do crash re-run" (cùng `causedByJobId` → bị chặn). Đã thêm `causedByJobId: job.id` vào cả 5 lệnh gọi `enqueueStage` trong `chain.ts`.
    - **Giới hạn còn lại đã ghi chú trong docstring `processDoneJob`**: `saveVideoContent` chưa có guard tương tự (chỉ tạo dòng `video_content` trùng — vô hại vì `getLatestVideoContent` luôn đọc bản mới nhất, nhưng nên dọn sau); `handleP1Done`'s vòng lặp tạo `videos` mới mỗi lần chạy lại nên `causedByJobId` không khớp được (video id luôn khác) — chỉ được giảm thiểu một phần bởi `isDuplicateTopic`. Một bản vá triệt để cho P1 cần làm `createVideo` idempotent theo topic gốc — để lại như việc cần làm sau, không vá vội.
    - `tsc --noEmit` sạch. Commit + deploy production.
  - Các điểm nhỏ khác ghi nhận nhưng chưa cần sửa: retry thủ công reset `retryCount` về 0 (có thể cho job lỗi vặt lặp vô hạn — là quyết định sản phẩm); `fail_job` ghi `retry_count` hơi gây hiểu nhầm cho lỗi không mong đợi; rollback evaluator có giả định ranh giới batch hơi mong manh.
