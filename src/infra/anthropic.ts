import Anthropic from "@anthropic-ai/sdk";
import {
  validateStructuredImages,
  type StructuredGenerationRequest,
} from "./structured";

// 운영 입력 해석과 Superset 자연어 질의·대시보드 구성에 쓰는 구조화 생성.
// RAG 응답 생성은 계속 로컬 모델(ollama.ts) 담당이다.
const MODEL = "claude-opus-5";

// Claude API rejects these keywords in `output_config.format` schemas (400), so they are
// moved into each field's description instead. Callers still validate the parsed value.
const UNSUPPORTED_SCHEMA_KEYWORDS: Record<string, true> = {
  maxItems: true,
  minLength: true,
  maxLength: true,
  minimum: true,
  maximum: true,
  multipleOf: true,
  maxProperties: true,
  minProperties: true,
};
const NESTED_SCHEMA_MAPS: Record<string, true> = { properties: true, $defs: true, definitions: true };

export function sanitizeSchema(schema: Record<string, unknown>): Record<string, unknown> {
  return sanitizeSchemaNode(schema) as Record<string, unknown>;
}

/** JSON type of a schema literal, for splitting union types without losing their `enum`. */
function literalType(value: unknown): string | null {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  return typeof value === "object" ? "object" : typeof value;
}

/**
 * Claude rejects `enum` on a multi-type field ("Enum value 'PT1H' does not match declared
 * type '['string', 'null']'"), so a union becomes one `anyOf` branch per type.
 */
function splitUnionTypes(source: Record<string, unknown>, types: unknown[]): Record<string, unknown> {
  const variants = types.map((type) => {
    const variant: Record<string, unknown> = { ...source, type };
    if (Array.isArray(source.enum)) {
      const allowed = source.enum.filter((value) => literalType(value) === type);
      // A null-only enum adds nothing to a `null` branch.
      if (allowed.length && type !== "null") variant.enum = allowed;
      else delete variant.enum;
    }
    return variant;
  });
  return { anyOf: variants };
}

function sanitizeSchemaNode(node: unknown): unknown {
  if (Array.isArray(node)) return node.map(sanitizeSchemaNode);
  if (!node || typeof node !== "object") return node;
  const source = node as Record<string, unknown>;
  if (Array.isArray(source.type) && source.type.length > 1) {
    return sanitizeSchemaNode(splitUnionTypes(source, source.type));
  }
  const sanitized: Record<string, unknown> = {};
  const constraints: string[] = [];
  for (const [key, value] of Object.entries(source)) {
    if (UNSUPPORTED_SCHEMA_KEYWORDS[key]) {
      constraints.push(`${key}: ${JSON.stringify(value)}`);
    } else if (NESTED_SCHEMA_MAPS[key] && value && typeof value === "object") {
      sanitized[key] = Object.fromEntries(
        Object.entries(value as Record<string, unknown>).map(([name, child]) => [name, sanitizeSchemaNode(child)]),
      );
    } else {
      sanitized[key] = sanitizeSchemaNode(value);
    }
  }
  if (constraints.length) {
    sanitized.description = [sanitized.description, `Constraints: ${constraints.join(", ")}`]
      .filter((part): part is string => typeof part === "string" && part.length > 0)
      .join("\n");
  }
  return sanitized;
}

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
  images = [],
  maxTokens = 4096,
}: StructuredGenerationRequest): Promise<T> {
  const checkedImages = validateStructuredImages(images);
  const content: Anthropic.MessageCreateParams["messages"][number]["content"] =
    checkedImages.length === 0
      ? prompt
      : [
          ...checkedImages.map((image) => ({
            type: "image" as const,
            source: {
              type: "base64" as const,
              media_type: image.mimeType,
              data: image.data,
            },
          })),
          { type: "text" as const, text: prompt },
        ];

  const response = await getClient().messages.create({
    model: MODEL,
    max_tokens: maxTokens,
    system,
    messages: [{ role: "user", content }],
    // Claude Opus 5 thinks by default and thinking tokens count toward `max_tokens`, which
    // truncates short structured calls (intent classification) before any JSON is emitted.
    thinking: { type: "disabled" },
    output_config: { format: { type: "json_schema", schema: sanitizeSchema(schema) } },
  });

  if (response.stop_reason === "refusal") {
    throw new Error("모델이 응답을 거부했습니다.");
  }
  if (response.stop_reason === "max_tokens") {
    throw new Error("모델 응답이 출력 한도에서 잘렸습니다.");
  }

  const text = response.content.find((block) => block.type === "text");
  if (!text || text.type !== "text") {
    throw new Error("모델 응답에 텍스트가 없습니다.");
  }

  return JSON.parse(text.text) as T;
}
