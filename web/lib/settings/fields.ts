import { z } from "zod";

const intString = (min: number, max: number) =>
  z.string().regex(/^\d+$/, "Phải là một số nguyên").refine((v) => {
    const n = Number.parseInt(v, 10);
    return n >= min && n <= max;
  }, `Phải nằm trong khoảng từ ${min} đến ${max}`);

/**
 * Editable `channel_config` key/value rows, with per-field zod validation run
 * both client- and server-side before save. `worker_heartbeat` is intentionally
 * excluded — it's written by the worker process, not edited here.
 */
export const SETTINGS_FIELDS = [
  {
    key: "channel_name",
    label: "Tên kênh",
    description: "Dùng để điền vào [CHANNEL_NAME] trong các mẫu prompt.",
    schema: z.string().trim().min(1).max(200),
  },
  {
    key: "p1_topics_per_batch",
    label: "Số chủ đề P1 mỗi lô",
    description: "Số lượng chủ đề ứng viên mà P1 tạo ra mỗi lần chạy.",
    schema: intString(1, 50),
  },
  {
    key: "score_threshold",
    label: "Ngưỡng điểm",
    description: "Điểm P_score tối thiểu (0-100) để đánh dấu video ready_to_publish; thấp hơn ngưỡng này sẽ quay lại P3 để thử lại.",
    schema: intString(0, 100),
  },
  {
    key: "max_content_retries",
    label: "Số lần thử lại tối đa",
    description: "Số lần tối đa một video có thể lặp qua chu trình thử lại P3 trước khi bị gắn cờ needs_attention.",
    schema: intString(0, 10),
  },
  {
    key: "p6_batch_size",
    label: "Kích thước lô P6",
    description: "Số video vừa được phân tích cần tích lũy trước khi kích hoạt đánh giá chiến lược prompt P6.",
    schema: intString(1, 100),
  },
  {
    key: "rollback_min_views",
    label: "Lượt xem tối thiểu để rollback",
    description: "Ngưỡng lượt xem tối thiểu mà một video phải đạt được trước khi dữ liệu analytics của nó được tính vào so sánh rollback.",
    schema: intString(1, 1_000_000),
  },
  {
    key: "rollback_threshold_pct",
    label: "Ngưỡng suy giảm để rollback (%)",
    description: "Nếu CTR trung bình của lô mới giảm nhiều hơn tỷ lệ này so với lô trước, prompt sẽ tự động được khôi phục về phiên bản cũ.",
    schema: intString(1, 100),
  },
  {
    key: "anti_dup_person_lookback",
    label: "Chống lặp: lookback người (video)",
    description: "Số video gần nhất để kiểm tra xem featured_person có bị lặp không. Mặc định: 3.",
    schema: intString(1, 20),
  },
  {
    key: "anti_dup_pain_lookback",
    label: "Chống lặp: lookback người+pain (video)",
    description: "Số video gần nhất để kiểm tra combo người × pain type. Mặc định: 6.",
    schema: intString(1, 50),
  },
  {
    key: "anti_dup_semantic_days",
    label: "Chống lặp: cửa sổ ngữ nghĩa (ngày)",
    description: "Số ngày nhìn lại khi kiểm tra tương đồng ngữ nghĩa qua pgvector. Mặc định: 90.",
    schema: intString(1, 3650),
  },
  {
    key: "anti_dup_similarity_threshold",
    label: "Chống lặp: ngưỡng tương đồng (0-100)",
    description: "Ngưỡng cosine similarity (0-100) để coi là trùng chủ đề. Mặc định: 85 (= 0.85).",
    schema: intString(50, 99),
  },
  {
    key: "tts_voice_map",
    label: "Bản đồ giọng TTS (JSON)",
    description: 'Ánh xạ tên nhân vật (tiếng Anh) sang clone voice ID của AI33.PRO. Ví dụ: {"Kazuo Inamori":"clone_2574216","Tenpu Nakamura":"clone_2572202"}. Khớp không phân biệt hoa thường và cho phép khớp một phần.',
    schema: z.string().trim().refine((v) => {
      try { JSON.parse(v); return true; } catch { return false; }
    }, "Phải là JSON hợp lệ"),
  },
  {
    key: "tts_default_voice",
    label: "Giọng TTS mặc định (clone voice ID)",
    description: "Clone voice ID dùng khi tên nhân vật không có trong bản đồ giọng. Mặc định: clone_2572202 (Tenpu Nakamura).",
    schema: z.string().trim().min(1).max(100),
  },
] as const;

export type SettingsFieldKey = (typeof SETTINGS_FIELDS)[number]["key"];
