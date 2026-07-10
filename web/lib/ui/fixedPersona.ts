import {
  FIXED_PERSONA_NAME,
  FIXED_PERSONA_VOICE_ID,
} from "@/lib/pipeline/fixedPersona";

export { FIXED_PERSONA_NAME, FIXED_PERSONA_VOICE_ID };

export type PersonaUiStatus = "fixed" | "legacy" | "missing";

export function getPersonaUiStatus(person: string | null | undefined): PersonaUiStatus {
  const normalized = person?.trim();
  if (!normalized) return "missing";
  return normalized === FIXED_PERSONA_NAME ? "fixed" : "legacy";
}

export function formatPersonaName(person: string | null | undefined): string {
  return person?.trim() || "—";
}

export function getPersonaStatusLabel(status: PersonaUiStatus): string {
  if (status === "fixed") return "fixed";
  if (status === "legacy") return "legacy";
  return "missing";
}
