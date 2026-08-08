import regularPrompt from "./prompts/regular-timetable.md?raw";
import { generateCoopStructured } from "./llm";
import type { RawRegularCoopTimetable } from "./types";
import type { StructuredImageMimeType } from "~/helper/adapter/structured";

const RAW_TIMETABLE_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["title", "semesterLabel", "fromDate", "toDate", "shops"],
  properties: {
    title: { type: "string" },
    semesterLabel: { type: "string" },
    fromDate: { type: "string" },
    toDate: { type: "string" },
    shops: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["groupLabel", "shopLabel", "phone", "remark", "operationHours"],
        properties: {
          groupLabel: { type: "string" },
          shopLabel: { type: "string" },
          phone: { type: "string" },
          remark: { type: "string" },
          operationHours: {
            type: "array",
            items: {
              type: "object",
              additionalProperties: false,
              required: ["dayLabel", "type", "openTime", "closeTime", "rawText"],
              properties: {
                dayLabel: { type: "string" },
                type: { type: "string" },
                openTime: { type: "string" },
                closeTime: { type: "string" },
                rawText: { type: "string" },
              },
            },
          },
        },
      },
    },
  },
} as const;

export const isRegularSemesterLabel = (label: string): boolean =>
  /^\s*(?:20)?\d{2}\s*[-.]?\s*[12]학기\s*$/.test(label);

export async function extractRegularTimetable({
  imageBase64,
  mimeType,
  fileName,
}: {
  imageBase64: string;
  mimeType: StructuredImageMimeType;
  fileName: string;
}): Promise<RawRegularCoopTimetable> {
  const extracted = await generateCoopStructured<RawRegularCoopTimetable>({
    system: regularPrompt,
    prompt: `첨부한 생협 운영시간 이미지를 읽어주세요. 파일명: ${fileName}`,
    schema: RAW_TIMETABLE_SCHEMA,
    images: [{ data: imageBase64, mimeType }],
    maxTokens: 8192,
  });

  if (!isRegularSemesterLabel(extracted.semesterLabel)) {
    throw new Error("정규학기(1학기 또는 2학기) 시간표가 아닙니다.");
  }
  return extracted;
}
