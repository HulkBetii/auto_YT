import OpenAI from "openai";
import { getAhConfigValue } from "@/lib/db/repo/channel-config";
import { extractJson } from "@/lib/utils/json";

export interface AhTopic {
  title: string;
  angle: string;
  hook: string;
  viral_type: string;
  key_questions: string[];
}

export async function rankTopics(candidates: AhTopic[]): Promise<AhTopic> {
  const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  const model = (await getAhConfigValue("openai_model")) ?? "gpt-4o-mini";

  const prompt = `You are a YouTube content strategist. Choose the BEST topic from the list below for a doodle-animation channel about ancient humans.

Topics:
${candidates.map((t, i) => `${i + 1}. Title: "${t.title}"\n   Angle: ${t.angle}\n   Viral type: ${t.viral_type}`).join("\n\n")}

Selection criteria (in order of importance):
1. Strongest curiosity gap / click-through potential
2. Most surprising or counter-intuitive angle
3. Easiest to visualise as doodle animation
4. Broadest audience appeal

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
  return chosen;
}
