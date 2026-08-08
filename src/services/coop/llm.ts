import { generateStructured as anthropic } from "~/helper/adapter/anthropic";
import { generateStructured as openai } from "~/helper/adapter/openai";
import type { StructuredGenerationRequest } from "~/helper/adapter/structured";

export function generateCoopStructured<T>(request: StructuredGenerationRequest): Promise<T> {
  const provider = import.meta.env.COOP_LLM_PROVIDER;
  if (provider === "openai") return openai<T>(request);
  if (provider === "anthropic") return anthropic<T>(request);

  if (import.meta.env.OPENAI_API_KEY) return openai<T>(request);
  if (import.meta.env.ANTHROPIC_API_KEY) return anthropic<T>(request);

  throw new Error("OPENAI_API_KEY 또는 ANTHROPIC_API_KEY 중 하나가 필요합니다.");
}

export function hasCoopLlmCredentials(): boolean {
  return Boolean(import.meta.env.OPENAI_API_KEY || import.meta.env.ANTHROPIC_API_KEY);
}
