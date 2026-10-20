import { generateStructured as anthropic } from "./anthropic";
import { generateStructured as openai } from "./openai";
import type { StructuredGenerationRequest } from "./structured";

/**
 * 어느 모델을 쓸지는 .env에 어떤 키가 있는지로 정한다.
 * 둘 다 있으면 도메인마다 `*_LLM_PROVIDER`로 고른다. 호출하는 쪽은 provider를 몰라야
 * 나중에 갈아끼울 때 손댈 곳이 없다.
 */
export function createStructuredGenerator(readProvider: () => string | undefined) {
  return function generateStructured<T>(request: StructuredGenerationRequest): Promise<T> {
    const provider = readProvider();
    if (provider === "openai") return openai<T>(request);
    if (provider === "anthropic") return anthropic<T>(request);

    if (import.meta.env.OPENAI_API_KEY) return openai<T>(request);
    if (import.meta.env.ANTHROPIC_API_KEY) return anthropic<T>(request);

    throw new Error("OPENAI_API_KEY 또는 ANTHROPIC_API_KEY 중 하나가 필요합니다.");
  };
}

/** 키가 하나도 없으면 생성을 시도조차 하지 않는다. 테스트 skip 판단에도 쓴다. */
export function hasLlmCredentials(): boolean {
  return Boolean(import.meta.env.OPENAI_API_KEY || import.meta.env.ANTHROPIC_API_KEY);
}
