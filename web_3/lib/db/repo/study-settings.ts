import { eq } from "drizzle-orm";

import { db } from "../index";
import {
  STUDY_SETTING_KEYS,
  studySettings,
  type StudySettingKey,
} from "../schema/study-settings";

export { STUDY_SETTING_KEYS };

export async function getStudySettingValue(key: StudySettingKey): Promise<string | null> {
  const [row] = await db
    .select({ value: studySettings.value })
    .from(studySettings)
    .where(eq(studySettings.key, key))
    .limit(1);
  return row?.value ?? null;
}

export async function setStudySettingValue(key: StudySettingKey, value: string): Promise<void> {
  const normalizedValue = value.trim();
  if (!normalizedValue) {
    throw new Error("Study setting value cannot be empty.");
  }

  const now = new Date();
  await db
    .insert(studySettings)
    .values({ key, value: normalizedValue, updatedAt: now })
    .onConflictDoUpdate({
      target: studySettings.key,
      set: { value: normalizedValue, updatedAt: now },
    });
}

export async function hasStudySettingValue(key: StudySettingKey): Promise<boolean> {
  return Boolean((await getStudySettingValue(key))?.trim());
}

export async function getStudyAi33ApiKey(): Promise<string | null> {
  return getStudySettingValue(STUDY_SETTING_KEYS.ai33ApiKey);
}

export async function setStudyAi33ApiKey(value: string): Promise<void> {
  await setStudySettingValue(STUDY_SETTING_KEYS.ai33ApiKey, value);
}

export async function hasStudyAi33ApiKey(): Promise<boolean> {
  return hasStudySettingValue(STUDY_SETTING_KEYS.ai33ApiKey);
}
