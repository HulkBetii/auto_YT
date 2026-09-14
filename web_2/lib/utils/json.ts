/**
 * ChatGPT often wraps JSON in prose or ```json fences despite "output: JSON"
 * instructions. Pull out the first {...} or [...] block and parse it.
 */
function escapeControlCharactersInStrings(value: string): string {
  let result = "";
  let inString = false;
  let escaped = false;

  for (const character of value) {
    if (!inString) {
      result += character;
      if (character === '"') inString = true;
      continue;
    }

    if (escaped) {
      result += character;
      escaped = false;
      continue;
    }
    if (character === "\\") {
      result += character;
      escaped = true;
      continue;
    }
    if (character === '"') {
      result += character;
      inString = false;
      continue;
    }

    const code = character.charCodeAt(0);
    if (code >= 0x20) {
      result += character;
      continue;
    }

    const escapedControl =
      character === "\b"
        ? "\\b"
        : character === "\f"
          ? "\\f"
          : character === "\n"
            ? "\\n"
            : character === "\r"
              ? "\\r"
              : character === "\t"
                ? "\\t"
                : `\\u${code.toString(16).padStart(4, "0")}`;
    result += escapedControl;
  }

  return result;
}

function parseJsonWithControlCharacterRepair<T>(value: string): T {
  try {
    return JSON.parse(value) as T;
  } catch (error) {
    const repaired = escapeControlCharactersInStrings(value);
    if (repaired === value) throw error;
    return JSON.parse(repaired) as T;
  }
}

export function extractJson<T = unknown>(text: string): T {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenced ? fenced[1] : text;

  const objectStart = candidate.indexOf("{");
  const arrayStart = candidate.indexOf("[");
  const starts = [objectStart, arrayStart].filter((i) => i >= 0);
  if (starts.length === 0) {
    throw new Error("No JSON object/array found in model output.");
  }
  const start = Math.min(...starts);
  const opening = candidate[start];
  const closing = opening === "{" ? "}" : "]";

  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < candidate.length; i++) {
    const character = candidate[i];
    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (character === "\\") {
        escaped = true;
      } else if (character === '"') {
        inString = false;
      }
      continue;
    }
    if (character === '"') {
      inString = true;
      continue;
    }
    if (character === opening) depth++;
    else if (character === closing) {
      depth--;
      if (depth === 0) {
        return parseJsonWithControlCharacterRepair<T>(candidate.slice(start, i + 1));
      }
    }
  }
  throw new Error("Unbalanced JSON in model output.");
}
