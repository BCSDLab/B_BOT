import OpenAI from "openai";
import {
  toDataUrl,
  validateStructuredImages,
  type StructuredGenerationRequest,
} from "./structured";

// 강의 편람처럼 학기마다 형식이 바뀌는 입력을 읽어낼 때만 쓴다.
// RAG 응답 생성은 계속 로컬 모델(ollama.ts) 담당이다.
const DEFAULT_MODEL = "gpt-5.4-mini";

let client: OpenAI | null = null;

function getClient(): OpenAI {
  if (!import.meta.env.OPENAI_API_KEY) {
    throw new Error("OPENAI_API_KEY가 없습니다. .env를 확인하세요.");
  }
  client ??= new OpenAI({ apiKey: import.meta.env.OPENAI_API_KEY });
  return client;
}

/**
 * JSON 스키마에 맞는 객체를 받아온다.
 * strict 모드라 스키마를 벗어난 응답이 아예 생성되지 않는다.
 */
export async function generateStructured<T>({
  system,
  prompt,
  schema,
  images = [],
  maxTokens = 4096,
}: StructuredGenerationRequest): Promise<T> {
  const checkedImages = validateStructuredImages(images);
  const userContent = checkedImages.length === 0
    ? prompt
    : [
        { type: "text" as const, text: prompt },
        ...checkedImages.map((image) => ({
          type: "image_url" as const,
          image_url: { url: toDataUrl(image) },
        })),
      ];

  const response = await getClient().chat.completions.create({
    model: import.meta.env.OPENAI_MODEL || DEFAULT_MODEL,
    max_completion_tokens: maxTokens,
    messages: [
      { role: "system", content: system },
      { role: "user", content: userContent },
    ],
    response_format: {
      type: "json_schema",
      json_schema: { name: "result", strict: true, schema },
    },
  });

  const choice = response.choices[0];
  if (choice?.finish_reason === "length") {
    throw new Error("응답이 토큰 한도에서 잘렸습니다.");
  }
  if (choice?.message.refusal) {
    throw new Error(`모델이 응답을 거부했습니다: ${choice.message.refusal}`);
  }

  const content = choice?.message.content;
  if (!content) {
    throw new Error("모델 응답이 비어 있습니다.");
  }

  return JSON.parse(content) as T;
}
