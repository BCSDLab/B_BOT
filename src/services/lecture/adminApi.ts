import type { Lecture, LectureInfo } from "./types";

/** POST /admin/lectures의 term enum. */
export type AdminTerm = "FIRST" | "SECOND" | "SUMMER" | "WINTER";

const TERM_BY_NAME: Record<string, AdminTerm> = {
  "1학기": "FIRST",
  "2학기": "SECOND",
  여름학기: "SUMMER",
  겨울학기: "WINTER",
};

export function toAdminTerm(termName: string): AdminTerm {
  const term = TERM_BY_NAME[termName.trim()];
  if (!term) {
    throw new Error(`알 수 없는 학기입니다: ${termName}`);
  }
  return term;
}

export interface AdminLecture {
  code: string;
  name: string;
  grades: string;
  lecture_class: string;
  regular_number: string;
  department: string;
  target: string;
  professor?: string;
  is_english: string;
  design_score: string;
  is_elearning: string;
  class_time: number[];
}

export interface AdminLectureCreateRequest {
  year: number;
  term: AdminTerm;
  lectures: AdminLecture[];
}

/**
 * `{day, start_time, end_time}` 구간을 슬롯 하나하나로 펼친다.
 * 어드민 API는 구간이 아니라 슬롯 배열을 받는다.
 */
export function toClassTime(infos: LectureInfo[]): number[] {
  const slots: number[] = [];
  for (const info of infos) {
    for (let t = info.start_time; t <= info.end_time; t += 1) {
      slots.push(t);
    }
  }
  return slots;
}

/**
 * 어드민 API가 거절할 값을 보내기 전에 찾아낸다.
 *
 * 지금은 강의 수정·삭제 API가 없다. 한 번 잘못 넣으면 되돌릴 수단이 없고,
 * 중복이 하나라도 있으면 409로 **요청 전체가** 막힌다.
 * 그래서 서버가 거절하기 전에 우리가 먼저 세어 사람에게 숫자로 보여준다.
 */
const LIMITS = {
  code: 10, name: 50, grades: 2, lecture_class: 3, regular_number: 4,
  department: 30, target: 200, professor: 30, is_english: 2,
  design_score: 2, is_elearning: 2,
} as const;

const MAX_CLASS_TIME = 50;
const MAX_SLOT = 999;

/**
 * 이게 비면 파싱이 잘못된 것이다. 값이 없는 게 아니라 못 읽은 것이므로 반영을 막는다.
 * 나머지 필드는 빈 문자열로 보내도 된다(백엔드 확인 완료).
 */
const IDENTITY_FIELDS = ["code", "name", "lecture_class"] as const;

/** 엑셀에 정원이 비어 있는 강의가 있다. 빈 값 대신 0으로 보낸다(백엔드 확인 완료). */
const EMPTY_REGULAR_NUMBER = "0";

export interface PreflightIssue {
  lecture: string;
  kind: "too_long" | "missing" | "empty_value" | "too_many_slots" | "slot_out_of_range" | "duplicate";
  /** blocking은 반영을 막고, info는 사람이 알아두기만 하면 된다. */
  severity: "blocking" | "info";
  detail: string;
}

export interface PreflightResult {
  request: AdminLectureCreateRequest;
  issues: PreflightIssue[];
  stats: { total: number; withoutTime: number; maxClassTime: number };
}

export const blockingIssues = (issues: PreflightIssue[]) =>
  issues.filter((issue) => issue.severity === "blocking");

export function buildAdminRequest(
  lectures: Lecture[],
  { year, term }: { year: number; term: AdminTerm },
): PreflightResult {
  const issues: PreflightIssue[] = [];
  const seen = new Map<string, number>();
  let maxClassTime = 0;
  let withoutTime = 0;

  const converted = lectures.map((lecture) => {
    const label = `${lecture.code}|${lecture.lecture_class} ${lecture.name}`;
    const class_time = toClassTime(lecture.lecture_infos);
    maxClassTime = Math.max(maxClassTime, class_time.length);
    if (class_time.length === 0) {
      withoutTime += 1;
    }

    const admin: AdminLecture = {
      code: lecture.code,
      name: lecture.name,
      grades: lecture.grades,
      lecture_class: lecture.lecture_class,
      regular_number: lecture.regular_number || EMPTY_REGULAR_NUMBER,
      department: lecture.department,
      target: lecture.target,
      professor: lecture.professor || undefined,
      is_english: lecture.is_english,
      design_score: lecture.design_score,
      is_elearning: lecture.is_elearning,
      class_time,
    };

    for (const [field, limit] of Object.entries(LIMITS)) {
      const value = admin[field as keyof AdminLecture];
      if (typeof value === "string" && value.length > limit) {
        issues.push({
          lecture: label,
          kind: "too_long",
          severity: "blocking",
          detail: `${field} ${value.length}자 (상한 ${limit}) — "${value.slice(0, 30)}…"`,
        });
      }
    }

    for (const field of Object.keys(LIMITS) as (keyof typeof LIMITS)[]) {
      if (admin[field as keyof AdminLecture]) {
        continue;
      }
      // professor는 아예 선택 항목이라 비어도 알릴 것이 없다.
      if (field === "professor") {
        continue;
      }
      const identity = (IDENTITY_FIELDS as readonly string[]).includes(field);
      issues.push({
        lecture: label,
        kind: identity ? "missing" : "empty_value",
        severity: identity ? "blocking" : "info",
        detail: identity
          ? `${field}를 읽지 못했습니다`
          : `${field}가 엑셀에 비어 있습니다 (빈 값으로 보냅니다)`,
      });
    }

    if (class_time.length > MAX_CLASS_TIME) {
      issues.push({
        lecture: label,
        kind: "too_many_slots",
        severity: "blocking",
        detail: `class_time ${class_time.length}개 (상한 ${MAX_CLASS_TIME})`,
      });
    }
    const bad = class_time.find((slot) => slot < 0 || slot > MAX_SLOT);
    if (bad !== undefined) {
      issues.push({
        lecture: label,
        kind: "slot_out_of_range",
        severity: "blocking",
        detail: `class_time에 ${bad} 포함`,
      });
    }

    // 중복이 하나라도 있으면 요청 전체가 409로 막힌다. 보내기 전에 잡는다.
    const key = `${lecture.code}|${lecture.lecture_class}`;
    const before = seen.get(key);
    if (before !== undefined) {
      issues.push({
        lecture: label,
        kind: "duplicate",
        severity: "blocking",
        detail: `과목코드+분반이 이미 나왔습니다 (앞선 ${before + 1}번째 강의)`,
      });
    } else {
      seen.set(key, seen.size);
    }

    return admin;
  });

  return {
    request: { year, term, lectures: converted },
    issues,
    stats: { total: converted.length, withoutTime, maxClassTime },
  };
}

export interface KoinAdminAuth {
  baseUrl: string;
  accessToken: string;
}

/**
 * 실제 반영. 중복이 하나라도 있으면 409로 요청 전체가 거절되므로
 * 여기까지 오기 전에 `buildAdminRequest`의 사전 검증을 통과시켜야 한다.
 *
 * 인증은 이 모듈이 갖지 않는다. 토큰 발급 방식(정적 키·로그인 등)이 바뀌어도
 * 여기는 그대로 두려는 것이다.
 */
export async function submitLectures(
  request: AdminLectureCreateRequest,
  { baseUrl, accessToken }: KoinAdminAuth,
): Promise<void> {
  const response = await fetch(`${baseUrl.replace(/\/$/, "")}/admin/lectures`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${accessToken}` },
    body: JSON.stringify(request),
  });

  if (response.ok) {
    return;
  }

  // 어느 쪽이 문제인지 사람이 바로 알 수 있게 상태별로 다른 말을 한다.
  const body = await response.text().catch(() => "");
  const reason =
    {
      401: "인증이 만료됐습니다. KOIN_ADMIN_TOKEN을 갱신해주세요.",
      403: "권한이 없는 계정입니다.",
      404: `${request.year} ${request.term} 학기가 아직 없습니다. 학기를 먼저 만들어야 합니다.`,
      409: "이미 등록된 강의가 있습니다. 지금은 수정 API가 없어 되돌릴 수 없습니다.",
    }[response.status] ?? `HTTP ${response.status}`;

  throw new Error(`${reason}\n${body.slice(0, 300)}`);
}
