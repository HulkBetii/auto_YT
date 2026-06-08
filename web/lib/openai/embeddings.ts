import OpenAI from "openai";

const EMBEDDING_MODEL = "text-embedding-3-small";
const EMBEDDING_DIMENSIONS = 1536;

let client: OpenAI | null = null;

function getClient(): OpenAI {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error("Missing OPENAI_API_KEY — required for anti-duplication embeddings.");
  }
  client ??= new OpenAI({ apiKey });
  return client;
}

/** Embeds `topic + title` synchronously inside the P1 handler — see chain.ts selectTopics. */
export async function embedTopic(topic: string, title: string): Promise<number[]> {
  const response = await getClient().embeddings.create({
    model: EMBEDDING_MODEL,
    input: `${topic}\n${title}`,
    dimensions: EMBEDDING_DIMENSIONS,
  });
  return response.data[0].embedding;
}
