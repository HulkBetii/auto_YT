import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PoolClient } from "pg";

import { pool } from "@/lib/db";

const describeIntegration = process.env.KO_DB_INTEGRATION === "1" ? describe : describe.skip;

describeIntegration("Korean database queue contract", () => {
  let client: PoolClient;

  beforeAll(async () => {
    client = await pool.connect();
    await client.query("BEGIN");
  });

  afterAll(async () => {
    await client.query("ROLLBACK");
    client.release();
    await pool.end();
  });

  it("pins prompts, preserves ordered sections, transitions jobs, and prevents duplicate work", async () => {
    const outlinePrompt = await client.query<{ id: number }>(
      "INSERT INTO ko_prompt_versions (prompt_key, version, template, is_active) VALUES ('outline', 91, 'x', false) RETURNING id",
    );
    const sectionPrompt = await client.query<{ id: number }>(
      "INSERT INTO ko_prompt_versions (prompt_key, version, template, is_active) VALUES ('section', 91, 'x', false) RETURNING id",
    );
    const video = await client.query<{ id: number }>(
      "INSERT INTO ko_videos (source_url, outline_prompt_version_id, section_prompt_version_id) VALUES ('https://www.youtube.com/watch?v=dQw4w9WgXcQ', $1, $2) RETURNING id",
      [outlinePrompt.rows[0].id, sectionPrompt.rows[0].id],
    );
    const values = [
      video.rows[0].id,
      outlinePrompt.rows[0].id,
      "GPT-5.6 Sol",
      "High",
    ];
    const job = await client.query<{ id: number }>(
      "INSERT INTO ko_jobs (video_id, kind, model_label, effort, prompt_text, prompt_version_id, prompt_snapshot) VALUES ($1, 'outline', $3, $4, 'prompt', $2, 'snapshot') RETURNING id",
      values,
    );
    const pinned = await client.query<{ prompt_version_id: number; prompt_snapshot: string }>(
      "SELECT prompt_version_id, prompt_snapshot FROM ko_jobs WHERE id = $1",
      [job.rows[0].id],
    );
    expect(pinned.rows[0]).toEqual({
      prompt_version_id: outlinePrompt.rows[0].id,
      prompt_snapshot: "snapshot",
    });

    await client.query(
      "UPDATE ko_jobs SET status = 'running', started_at = NOW() WHERE id = $1",
      [job.rows[0].id],
    );
    await client.query(
      "UPDATE ko_jobs SET status = 'failed', finished_at = NOW() WHERE id = $1",
      [job.rows[0].id],
    );
    await client.query(
      "UPDATE ko_jobs SET status = 'pending', started_at = NULL, finished_at = NULL WHERE id = $1",
      [job.rows[0].id],
    );
    const transitioned = await client.query<{ status: string }>(
      "SELECT status FROM ko_jobs WHERE id = $1",
      [job.rows[0].id],
    );
    expect(transitioned.rows[0].status).toBe("pending");

    await client.query(
      "INSERT INTO ko_sections (video_id, section_index, kind, outline_data, body, status) VALUES ($1, 2, 'closing', '{}', '둘째 부분입니다', 'ready'), ($1, 1, 'hook', '{}', '첫째 부분입니다', 'ready')",
      [video.rows[0].id],
    );
    const orderedSections = await client.query<{ body: string }>(
      "SELECT body FROM ko_sections WHERE video_id = $1 ORDER BY section_index",
      [video.rows[0].id],
    );
    expect(orderedSections.rows.map((row) => row.body).join("\n\n")).toBe(
      "첫째 부분입니다\n\n둘째 부분입니다",
    );

    await client.query("SAVEPOINT duplicate_job");
    await expect(
      client.query(
        "INSERT INTO ko_jobs (video_id, kind, model_label, effort, prompt_text, prompt_version_id, prompt_snapshot) VALUES ($1, 'outline', $3, $4, 'prompt', $2, 'snapshot')",
        values,
      ),
    ).rejects.toMatchObject({ code: "23505" });
    await client.query("ROLLBACK TO SAVEPOINT duplicate_job");

    await client.query("SAVEPOINT duplicate_section");
    await expect(
      client.query(
        "INSERT INTO ko_sections (video_id, section_index, kind, outline_data) VALUES ($1, 1, 'hook', '{}')",
        [video.rows[0].id],
      ),
    ).rejects.toMatchObject({ code: "23505" });
    await client.query("ROLLBACK TO SAVEPOINT duplicate_section");
  });

  it("moves through source audit and final review without duplicating targeted repairs", async () => {
    const prompts: Array<{ id: number }> = [];
    for (const [offset, key] of ["source_audit", "outline", "section", "fidelity_review"].entries()) {
      const result = await client.query<{ id: number }>(
          "INSERT INTO ko_prompt_versions (prompt_key, version, template, is_active) VALUES ($1, $2, 'snapshot', false) RETURNING id",
          [key, 200 + offset],
        );
      prompts.push(result.rows[0]);
    }
    const [sourceAuditPrompt, outlinePrompt, sectionPrompt, fidelityPrompt] = prompts.map((row) => row.id);
    const video = await client.query<{ id: number }>(
      `INSERT INTO ko_videos (
        source_url, source_audit_prompt_version_id, outline_prompt_version_id,
        section_prompt_version_id, fidelity_prompt_version_id, status
      ) VALUES ('https://www.youtube.com/watch?v=1FR9vF54BOk', $1, $2, $3, $4, 'source_audit_pending') RETURNING id`,
      [sourceAuditPrompt, outlinePrompt, sectionPrompt, fidelityPrompt],
    );
    const videoId = video.rows[0].id;
    await client.query(
      "INSERT INTO ko_jobs (video_id, kind, model_label, effort, prompt_text, prompt_version_id, prompt_snapshot) VALUES ($1, 'source_audit', 'GPT-5.6 Sol', 'High', 'audit', $2, 'snapshot')",
      [videoId, sourceAuditPrompt],
    );
    await client.query(
      "UPDATE ko_videos SET status = 'outline_pending', source_audit = '{\"required_facts\":[]}'::jsonb WHERE id = $1",
      [videoId],
    );
    await client.query(
      "INSERT INTO ko_sections (video_id, section_index, kind, outline_data, body, status) VALUES ($1, 6, 'secret', '{}', '여섯째입니다', 'ready'), ($1, 7, 'secret', '{}', '일곱째입니다', 'pending')",
      [videoId],
    );
    await client.query(
      "INSERT INTO ko_jobs (video_id, section_id, kind, model_label, effort, prompt_text, prompt_version_id, prompt_snapshot) SELECT $1, id, 'section', 'GPT-5.6 Sol', 'High', 'repair', $2, 'snapshot' FROM ko_sections WHERE video_id = $1 AND section_index = 7",
      [videoId, sectionPrompt],
    );
    await client.query("UPDATE ko_videos SET status = 'final_review_pending' WHERE id = $1", [videoId]);
    await client.query(
      "INSERT INTO ko_jobs (video_id, kind, model_label, effort, prompt_text, prompt_version_id, prompt_snapshot) VALUES ($1, 'fidelity_review', 'GPT-5.6 Sol', 'High', 'review', $2, 'snapshot')",
      [videoId, fidelityPrompt],
    );
    const state = await client.query<{ status: string; total: string }>(
      "SELECT v.status, COUNT(j.id)::text AS total FROM ko_videos v JOIN ko_jobs j ON j.video_id = v.id WHERE v.id = $1 GROUP BY v.status",
      [videoId],
    );
    expect(state.rows[0]).toEqual({ status: "final_review_pending", total: "3" });

    await client.query("SAVEPOINT duplicate_repair");
    await expect(
      client.query(
        "INSERT INTO ko_jobs (video_id, section_id, kind, model_label, effort, prompt_text, prompt_version_id, prompt_snapshot) SELECT $1, id, 'section', 'GPT-5.6 Sol', 'High', 'duplicate', $2, 'snapshot' FROM ko_sections WHERE video_id = $1 AND section_index = 7",
        [videoId, sectionPrompt],
      ),
    ).rejects.toMatchObject({ code: "23505" });
    await client.query("ROLLBACK TO SAVEPOINT duplicate_repair");
  });
});
