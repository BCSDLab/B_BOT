import { createStructuredGenerator } from "~/helper/adapter/llm";

/** 버스는 따로 provider 설정을 두지 않고 강의와 같은 값을 쓴다(기존 동작). */
export const generateStructured = createStructuredGenerator(() => import.meta.env.LECTURE_LLM_PROVIDER);
