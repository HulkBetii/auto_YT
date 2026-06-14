/**
 * ChatGPT often wraps JSON in prose or ```json fences despite "output: JSON"
 * instructions. Pull out the first {...} or [...] block and parse it.
 */
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
  for (let i = start; i < candidate.length; i++) {
    if (candidate[i] === opening) depth++;
    else if (candidate[i] === closing) {
      depth--;
      if (depth === 0) {
        return JSON.parse(candidate.slice(start, i + 1)) as T;
      }
    }
  }
  throw new Error("Unbalanced JSON in model output.");
}
