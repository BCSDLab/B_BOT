import { createStructuredGenerator } from "~/infra/llm";

export { hasLlmCredentials } from "~/infra/llm";

export const generateStructured = createStructuredGenerator(() => import.meta.env.LECTURE_LLM_PROVIDER);
