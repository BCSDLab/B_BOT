import { ClassTimeParseError, parsePeriodFormat, parseRangeFormat } from "./classTime";
import { describeClassTime } from "./describeTime";
import { generateStructured } from "./llm";
import type { Lecture, TimeFormat } from "./types";

/** 계절학기는 요일이 없어 월~금으로 전개한다. 변환 때와 같은 규칙이다. */
const SEASONAL_DAYS = [0, 1, 2, 3, 4];

const FIELDS = {
  name: { label: "교과목명", limit: 50 },
  professor: { label: "담당교수", limit: 30 },
  grades: { label: "학점", limit: 2 },
  regular_number: { label: "정원", limit: 4 },
  department: { label: "개설학과", limit: 30 },
  target: { label: "수강대상", limit: 200 },
  design_score: { label: "설계학점", limit: 2 },
  is_english: { label: "영어강의", limit: 2 },
  is_elearning: { label: "이러닝", limit: 2 },
  class_time: { label: "강의시간", limit: 0 },
  code: { label: "과목코드", limit: 10 },
  lecture_class: { label: "분반", limit: 3 },
} as const;

type FieldKey = keyof typeof FIELDS;

const PATCH_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["patches", "unclear"],
  properties: {
    patches: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["identifier", "lectureClass", "field", "value"],
        properties: {
          identifier: { type: "string", description: "과목코드 또는 교과목명. 사용자가 부른 대로." },
          lectureClass: { type: "string", description: "분반. 말하지 않았으면 빈 문자열." },
          field: { type: "string", enum: Object.keys(FIELDS), description: "바꿀 항목" },
          value: { type: "string", description: "바꿀 값. 강의시간은 `월07A~09B` 또는 `09:00~12:00` 형태 그대로." },
        },
      },
    },
    unclear: {
      type: "array",
      items: { type: "string" },
      description: "무슨 뜻인지 확실하지 않아 손대지 않은 부분. 추측하지 말고 여기 적는다.",
    },
  },
} as const;

const SYSTEM_PROMPT = `너는 강의 데이터 수정 요청을 구조화하는 도구다.

사용자가 자연어로 말한 수정 사항을 항목 단위로 쪼갠다.

- 값을 지어내지 마라. 사용자가 말하지 않은 건 바꾸지 않는다.
- 한 문장에 여러 강의가 있으면 각각 따로 적는다.
- 무슨 뜻인지 애매하면 patches에 넣지 말고 unclear에 적어라. 추측해서 바꾸면
  되돌릴 방법이 없다.
- 강의시간은 사용자가 쓴 표기를 그대로 옮긴다. 해석은 코드가 한다.
  \`월6A~6B\` 처럼 한 자리로 써도 그대로 둔다.

바꿀 수 있는 항목: ${Object.entries(FIELDS)
  .map(([key, { label }]) => `${key}(${label})`)
  .join(", ")}`;

export interface Patch {
  lecture: Lecture;
  field: FieldKey;
  label: string;
  before: string;
  after: string;
  /** class_time만 해당. 적용할 때 파싱 결과를 다시 쓰지 않으려고 들고 있는다. */
  parsed?: Lecture["lecture_infos"];
  rawValue: string;
}

export interface PatchPlan {
  patches: Patch[];
  problems: string[];
}

function findLecture(
  lectures: Lecture[],
  identifier: string,
  lectureClass: string,
): { lecture?: Lecture; problem?: string } {
  const wanted = identifier.trim().toLowerCase();
  let matches = lectures.filter(
    (l) => l.code.toLowerCase() === wanted || l.name.toLowerCase() === wanted,
  );

  if (matches.length === 0) {
    return { problem: `"${identifier}"에 해당하는 강의를 찾지 못했습니다.` };
  }
  if (lectureClass.trim() !== "") {
    const padded = lectureClass.trim().padStart(2, "0");
    matches = matches.filter((l) => l.lecture_class === padded);
    if (matches.length === 0) {
      return { problem: `"${identifier}"의 ${lectureClass}분반을 찾지 못했습니다.` };
    }
  }
  if (matches.length > 1) {
    const classes = matches.map((l) => l.lecture_class).join(", ");
    return { problem: `"${identifier}"는 분반이 여러 개입니다(${classes}). 분반을 지정해주세요.` };
  }

  return { lecture: matches[0] };
}

/**
 * 자연어 → 검증된 수정 계획.
 *
 * LLM은 "무엇을 무엇으로"만 뽑고, 그게 말이 되는지는 전부 코드가 본다.
 * 강의시간은 실제로 파싱해봐서 통과해야만 계획에 들어간다.
 */
export async function planPatches(
  text: string,
  lectures: Lecture[],
  timeFormat: TimeFormat,
): Promise<PatchPlan> {
  const raw = await generateStructured<{
    patches: { identifier: string; lectureClass: string; field: FieldKey; value: string }[];
    unclear: string[];
  }>({
    system: SYSTEM_PROMPT,
    schema: PATCH_SCHEMA as unknown as Record<string, unknown>,
    prompt: `다음 수정 요청을 구조화해줘.\n\n${text}`,
  });

  const patches: Patch[] = [];
  const problems = raw.unclear.map((line) => `무슨 뜻인지 확실하지 않아 넘겼습니다: ${line}`);

  for (const item of raw.patches) {
    const { lecture, problem } = findLecture(lectures, item.identifier, item.lectureClass);
    if (!lecture || problem) {
      problems.push(problem ?? "강의를 찾지 못했습니다.");
      continue;
    }

    const spec = FIELDS[item.field];
    const where = `${lecture.code} ${lecture.lecture_class} ${lecture.name}`;

    if (item.field === "class_time") {
      try {
        const parsed =
          timeFormat === "period"
            ? parsePeriodFormat(item.value)
            : parseRangeFormat(item.value, SEASONAL_DAYS);
        patches.push({
          lecture,
          field: item.field,
          label: spec.label,
          before: describeClassTime(lecture.lecture_infos),
          after: describeClassTime(parsed),
          parsed,
          rawValue: item.value,
        });
      } catch (error) {
        problems.push(
          `${where}: 강의시간 "${item.value}"를 해석하지 못했습니다. ${
            error instanceof ClassTimeParseError ? error.message : ""
          }`.trim(),
        );
      }
      continue;
    }

    if (item.value.length > spec.limit) {
      problems.push(`${where}: ${spec.label}이 ${item.value.length}자입니다 (상한 ${spec.limit}).`);
      continue;
    }

    patches.push({
      lecture,
      field: item.field,
      label: spec.label,
      before: String(lecture[item.field as keyof Lecture] ?? ""),
      after: item.value,
      rawValue: item.value,
    });
  }

  return { patches, problems };
}

/** 원본을 건드리지 않고 수정본을 새로 만든다. 적용 전 미리보기와 실제 적용이 갈라지지 않게. */
export function applyPatches(lectures: Lecture[], patches: Patch[]): Lecture[] {
  const byKey = new Map<string, Patch[]>();
  for (const patch of patches) {
    const id = `${patch.lecture.code}|${patch.lecture.lecture_class}`;
    byKey.set(id, [...(byKey.get(id) ?? []), patch]);
  }

  return lectures.map((lecture) => {
    const own = byKey.get(`${lecture.code}|${lecture.lecture_class}`);
    if (!own) {
      return lecture;
    }

    let next = { ...lecture };
    for (const patch of own) {
      if (patch.field === "class_time") {
        next = { ...next, lecture_infos: patch.parsed ?? [], raw_class_time: patch.rawValue };
      } else {
        next = { ...next, [patch.field]: patch.after };
      }
    }
    return next;
  });
}
