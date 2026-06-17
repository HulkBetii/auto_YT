import OpenAI from "openai";
import { getAhConfigValue } from "@/lib/db/repo/channel-config";
import { formatRecentAhTopicsForPrompt, type RecentAhTopicSummary } from "@/lib/db/repo/videos";
import { extractJson } from "@/lib/utils/json";

export interface AhTopic {
  title: string;
  angle: string;
  hook: string;
  viral_type: string;
  key_questions: string[];
}

export async function rankTopics(
  candidates: AhTopic[],
  recentTopics: RecentAhTopicSummary[] = [],
): Promise<AhTopic> {
  if (candidates.length === 0) {
    throw new Error("[rank] No topic candidates to rank.");
  }

  const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  const model = (await getAhConfigValue("openai_model")) ?? "gpt-4o-mini";

  const prompt = `You are a YouTube content strategist. Choose the BEST topic from the list below for a doodle-animation channel about ancient humans, prehistory, evolution, anthropology, survival, and daily life.

Angle preference:
- Keep the core niche unchanged: ancient humans and prehistoric life.
- Prefer a Psychology × Ancient Humans angle when the candidate naturally connects ancient life to a modern behavior, body signal, craving, fear, habit, social instinct, or emotional pattern.
- Do not force psychology if a classic ancient-humans candidate is clearly stronger.
- Useful psychology-leaning areas: sleep, fear, sugar craving, parenting, status, anxiety, boredom, pain, cooperation, jealousy, habit, attention, and body signals.

Recent topics to avoid repeating:
${formatRecentAhTopicsForPrompt(recentTopics)}

Topics:
${candidates.map((t, i) => `${i + 1}. Title: "${t.title}"\n   Angle: ${t.angle}\n   Viral type: ${t.viral_type}`).join("\n\n")}

Selection criteria (in order of importance):
1. Different core behavior and angle from recent topics. If every candidate overlaps, choose the least repetitive one.
2. Strong ancient-humans / prehistory fit.
3. Psychology × Ancient Humans lean when natural and evidence-friendly.
4. Strongest curiosity gap / click-through potential.
5. Most surprising or counter-intuitive angle.
6. Easiest to visualise as doodle animation.
7. Broadest audience appeal.

Return a JSON object with a single field "index" (1-based integer) indicating your choice.`;

  const completion = await client.chat.completions.create({
    model,
    messages: [{ role: "user", content: prompt }],
    response_format: { type: "json_object" },
    temperature: 0.3,
  });

  const text = completion.choices[0]?.message?.content ?? "{}";
  const parsed = extractJson<{ index?: number }>(text);
  const idx = (parsed.index ?? 1) - 1;
  const chosen = candidates[Math.max(0, Math.min(idx, candidates.length - 1))];
  if (!chosen?.title || !chosen.angle || !chosen.hook || !Array.isArray(chosen.key_questions)) {
    throw new Error("[rank] Chosen topic is missing required fields.");
  }
  return chosen;
}
