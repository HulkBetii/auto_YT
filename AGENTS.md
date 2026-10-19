# CLAUDE.md
Behavioral guidelines to reduce common LLM coding mistakes. Merge with project-specific instructions as needed.
**Tradeoff:** These guidelines bias toward caution over speed. For trivial tasks, use judgment.

## 0. Communication
- Answer concisely. NO apologies, NO long-winded explanations, NO robotic greetings.
- All variable names, functions, classes, and inline comments MUST be in English. Use Vietnamese only when chatting and explaining concepts.
- When suggesting improvements beyond the original request, flag explicitly as an optional suggestion — never mix into the main deliverable.

## 1. Think Before Coding
**Don't assume. Don't hide confusion. Surface tradeoffs.**

Before implementing:
- State your assumptions explicitly. If uncertain, ask.
- If multiple interpretations exist, present them — don't pick silently.
- If a simpler approach exists, say so. Push back when warranted.
- If a task is ambiguous or involves >3 steps, outline a brief plan and wait for confirmation before writing code.

## 2. Simplicity First
**Minimum code that solves the problem. Nothing speculative.**

- No features beyond what was asked.
- No abstractions for single-use code.
- No "flexibility" or "configurability" that wasn't requested.
- No error handling for impossible scenarios.
- No magic numbers or hardcoded strings — extract into well-named constants, enums, or config files.
- If you write 200 lines and it could be 50, rewrite it.

Ask yourself: "Would a senior engineer say this is overcomplicated?" If yes, simplify.

## 3. Surgical Changes
**Touch only what you must. Clean up only your own mess.**

When editing existing code:
- Only output snippets that need to be added or modified. DO NOT output the entire file unless >50% has changed.
- Don't "improve" adjacent code, comments, or formatting.
- Don't refactor things that aren't broken.
- Match existing style, even if you'd do it differently.
- If you notice unrelated dead code, mention it — don't delete it.

When your changes create orphans:
- Remove imports/variables/functions that YOUR changes made unused.
- Don't remove pre-existing dead code unless asked.

The test: Every changed line should trace directly to the user's request.

## 4. Code Quality
**Clean, defensive, self-documenting.**

- Follow DRY. Prioritize performance and security.
- Use meaningful names to explain WHAT. Use comments only to explain WHY (business logic or non-obvious decisions).
- Apply Defensive Programming: validate inputs early, Fail Fast, never trust external data.
- Never silently swallow exceptions. Log errors with sufficient context.
- When fixing bugs, resolve the Root Cause. No temporary patches or hacky workarounds.

## 5. Goal-Driven Execution
**Define success criteria. Loop until verified.**

Transform tasks into verifiable goals:
- "Add validation" → "Write tests for invalid inputs, then make them pass"
- "Fix the bug" → "Write a test that reproduces it, then make it pass"
- "Refactor X" → "Ensure tests pass before and after"

For multi-step tasks, state a brief plan:
```
1. [Step] → verify: [check]
2. [Step] → verify: [check]
3. [Step] → verify: [check]
```

Strong success criteria let you loop independently. Weak criteria ("make it work") require constant clarification.

## 6. Finish The Plan First
**Complete the agreed plan before proposing upgrades.**

- If a PLAN already exists, prioritize finishing it before suggesting enhancements.
- Verify the PLAN is complete and stable before proposing optimizations, extensions, or refactors outside its scope.
- Don't mix upgrade work into unfinished PLAN items unless the user explicitly asks to change the plan.

---

## 7. MCP: Memory
- Before starting any task involving creating/modifying >2 files or implementing a new feature, use the `memory` MCP to read saved project context first.
- After completing a significant task (new feature, major refactor, key architectural decision), proactively save relevant context to the `memory` MCP for future sessions.

## 8. MCP: Puppeteer
Use Puppeteer to search Official Docs or StackOverflow ONLY when:
1. Encountering a cryptic runtime error
2. Working with a library released or updated after your knowledge cutoff
3. Explicitly asked to research something

---
**These guidelines are working if:** fewer unnecessary changes in diffs, fewer rewrites due to overcomplication, and clarifying questions come before implementation rather than after mistakes.

## 9. Project Runtime Context
- `web`, `web_2`, and `web_3` have all been moved to local-first runtime on this machine.
- Daily dashboard usage should use local Next.js apps plus local Postgres via Docker, not Vercel/Neon.
- Local ports: `web` app `3000` + DB `5434`, `web_2` app `3001` + DB `5435`, `web_3` app `3002` + DB `5433`.
- Start an app from its folder with `pnpm db:up`, `pnpm db:migrate`, then `pnpm local:dev`.
- `DASHBOARD_SECRET` is intentionally blank in local `.env.local` files so local dashboards open without password.
- Neon/Vercel are fallback/reference only; old Neon data can be recovered later only when Neon quota allows backup/export.

## 10. Playwright Chrome Profile
- Every Playwright persistent Chromium context MUST use `D:\VibeCoding\auto_YT\data\chrome_user_data\PROFILE_GPT_1` via `auto_yt.paths.gpt_profile_dir()`.
- Do not create temporary profiles, select another profile, or add environment/config overrides for this path.
- If the profile is locked, report the conflict or clear stale singleton locks; never fall back to a different profile.

## 11. AI Generation Engines Policy
- Primary Engine: 9Router API Gateway (`http://localhost:20128/v1`, `ag/gemini-3.8-flash-high` via `GeminiApiEngine`).
- Secondary/Fallback Models: `ag/gemini-pro-agent` -> `ag/gemini-3.8-flash-medium` -> `ag/gemini-3.7-flash-high` (auto-failover in `GeminiApiEngine`).
- Playwright Fallback: Playwright ChatGPT Automation using `PROFILE_GPT_1`.
- OpenAI Direct API usage is allowed only for semantic embeddings and Whisper transcription with timestamps.

## 12. Output Review & Continuous System Improvement Philosophy (MANDATORY)
- **Mục đích cốt lõi của việc Review output**: KHÔNG PHẢI chỉ để sửa lỗi (patch) cho tập/episode cụ thể đó rồi xong.
- **Mục đích chính**: Rút ra bài học (pattern lỗi, điểm yếu logic, cơ hội tối ưu) → Đề xuất và cập nhật trực tiếp vào logic/config/prompt chung của pipeline, để **TẤT CẢ các lần chạy sau của mọi tập đều được hưởng lợi**.
- **Quy chuẩn bắt buộc khi thực hiện Review**:
  1. **Xác định Nguyên nhân gốc (Root Cause)**: Truy vết tận gốc cơ chế gây lỗi (regex, prompt thiếu ràng buộc, context drift, parser heuristic...), tuyệt đối không fix triệu chứng tạm thời.
  2. **Đề xuất thay đổi mang tính hệ thống**: Sửa đổi trực tiếp vào code parser, prompt template, quality gate hoặc validation schema dùng chung.
  3. **Cấu trúc trình bày Review**:
     - **Bài học rút ra**: Mô tả lỗi/điểm yếu và nguyên nhân cốt lõi.
     - **Thay đổi đề xuất cho hệ thống**: Giải pháp nâng cấp toàn diện cho pipeline.
     - **File / Logic cần update**: Danh sách file, hàm, regex cụ thể cần được sửa đổi.

