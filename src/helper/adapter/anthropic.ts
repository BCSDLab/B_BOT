import Anthropic from "@anthropic-ai/sdk";

// 강의 편람처럼 학기마다 형식이 바뀌는 입력을 읽어낼 때만 쓴다.
// RAG 응답 생성은 계속 로컬 모델(ollama.ts) 담당이다.
const MODEL = "claude-opus-5";

let client: Anthropic | null = null;

function getClient(): Anthropic {
  if (!import.meta.env.ANTHROPIC_API_KEY) {
    throw new Error("ANTHROPIC_API_KEY가 없습니다. .env를 확인하세요.");
  }
  client ??= new Anthropic({ apiKey: import.meta.env.ANTHROPIC_API_KEY });
  return client;
}

/**
 * JSON 스키마에 맞는 객체를 받아온다.
 * 스키마를 API가 강제하므로 응답을 파싱하다 깨질 일이 없다.
 */
export async function generateStructured<T>({
  system,
  prompt,
  schema,
  maxTokens = 4096,
}: {
  system: string;
  prompt: string;
  schema: Record<string, unknown>;
  maxTokens?: number;
}): Promise<T> {
  const response = await getClient().messages.create({
    model: MODEL,
    max_tokens: maxTokens,
    system,
    messages: [{ role: "user", content: prompt }],
    output_config: { format: { type: "json_schema", schema } },
  });

  if (response.stop_reason === "refusal") {
    throw new Error("모델이 응답을 거부했습니다.");
  }

  const text = response.content.find((block) => block.type === "text");
  if (!text || text.type !== "text") {
    throw new Error("모델 응답에 텍스트가 없습니다.");
  }

  return JSON.parse(text.text) as T;
}
