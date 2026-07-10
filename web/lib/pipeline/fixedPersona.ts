export const FIXED_PERSONA_NAME = "美輪明宏";
export const FIXED_PERSONA_TITLE_PREFIX = `【${FIXED_PERSONA_NAME}】`;
export const FIXED_PERSONA_VOICE_ID = "clone_2222532";

export const FORBIDDEN_PERSONA_NAMES = [
  "松下幸之助",
  "稲盛和夫",
  "中村天風",
  "小林正観",
  "田中角栄",
  "本田宗一郎",
  "西郷隆盛",
  "渋沢栄一",
  "Konosuke Matsushita",
  "Matsushita Konosuke",
  "Kazuo Inamori",
  "Inamori Kazuo",
  "Tenpu Nakamura",
  "Nakamura Tempu",
  "Seikan Kobayashi",
  "Kobayashi Seikan",
  "Kakuei Tanaka",
  "Tanaka Kakuei",
  "Soichiro Honda",
  "Honda Soichiro",
  "Takamori Saigo",
  "Saigo Takamori",
  "Eiichi Shibusawa",
  "Shibusawa Eiichi",
] as const;

const ANY_TITLE_PREFIX_RE = /^【[^】]+】\s*/;

export function normalizeFixedPersonaTitle(title: string | null | undefined): string {
  const normalized = (title ?? "").trim();
  const withoutPrefix = normalized.replace(ANY_TITLE_PREFIX_RE, "").trim();
  return `${FIXED_PERSONA_TITLE_PREFIX}${withoutPrefix}`;
}

export function normalizeFixedPersonaTopic<T extends { title: string; featured_person: string }>(topic: T): T {
  return {
    ...topic,
    title: normalizeFixedPersonaTitle(topic.title),
    featured_person: FIXED_PERSONA_NAME,
  };
}

export function validateFixedPersonaP1Template(template: string): { ok: true } | { ok: false; reason: string } {
  if (!template.includes(FIXED_PERSONA_NAME)) {
    return { ok: false, reason: `missing fixed persona ${FIXED_PERSONA_NAME}` };
  }
  if (!template.includes(FIXED_PERSONA_TITLE_PREFIX)) {
    return { ok: false, reason: `missing title prefix ${FIXED_PERSONA_TITLE_PREFIX}` };
  }
  if (!/featured_person[\s\S]{0,120}美輪明宏/.test(template)) {
    return { ok: false, reason: "missing featured_person fixed-persona rule" };
  }
  const forbidden = FORBIDDEN_PERSONA_NAMES.find((name) => template.includes(name));
  if (forbidden) {
    return { ok: false, reason: `contains forbidden persona ${forbidden}` };
  }
  return { ok: true };
}
