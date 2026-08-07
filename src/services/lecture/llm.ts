import { generateStructured as anthropic } from "~/helper/adapter/anthropic";
import { generateStructured as openai } from "~/helper/adapter/openai";

export interface StructuredRequest {
  system: string;
  prompt: string;
  schema: Record<string, unknown>;
  maxTokens?: number;
}

/**
 * 어느 모델을 쓸지는 .env에 어떤 키가 있는지로 정한다.
 * 스펙 생성 쪽은 provider를 몰라야 나중에 갈아끼울 때 손댈 곳이 없다.
 * 둘 다 있으면 LECTURE_LLM_PROVIDER로 고른다.
 */
export function generateStructured<T>(request: StructuredRequest): Promise<T> {
  const provider = import.meta.env.LECTURE_LLM_PROVIDER;
  if (provider === "openai") return openai<T>(request);
  if (provider === "anthropic") return anthropic<T>(request);

  if (import.meta.env.OPENAI_API_KEY) return openai<T>(request);
  if (import.meta.env.ANTHROPIC_API_KEY) return anthropic<T>(request);

  throw new Error("OPENAI_API_KEY 또는 ANTHROPIC_API_KEY 중 하나가 필요합니다.");
}

/** 키가 하나도 없으면 스펙 생성을 시도조차 하지 않는다. 테스트 skip 판단에도 쓴다. */
export function hasLlmCredentials(): boolean {
  return Boolean(import.meta.env.OPENAI_API_KEY || import.meta.env.ANTHROPIC_API_KEY);
}
