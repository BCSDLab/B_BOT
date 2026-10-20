import { createStructuredGenerator } from "~/infra/llm";

export const generateCoopStructured = createStructuredGenerator(() => import.meta.env.COOP_LLM_PROVIDER);
