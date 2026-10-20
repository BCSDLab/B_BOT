import { createStructuredGenerator } from "~/helper/adapter/llm";

export { hasLlmCredentials } from "~/helper/adapter/llm";

export const generateStructured = createStructuredGenerator(() => import.meta.env.LECTURE_LLM_PROVIDER);
