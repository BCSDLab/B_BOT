import { createStructuredGenerator } from "~/helper/adapter/llm";

export const generateCoopStructured = createStructuredGenerator(() => import.meta.env.COOP_LLM_PROVIDER);
