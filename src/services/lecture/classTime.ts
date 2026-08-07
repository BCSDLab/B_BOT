import type { LectureInfo } from "./types";

const DAY_INDEX: Record<string, number> = {
  월: 0, 화: 1, 수: 2, 목: 3, 금: 4, 토: 5, 일: 6,
};

/** 슬롯 0이 09:00, 한 슬롯이 30분. 교시 n은 09:00 + (n-1)시간에 시작한다. */
const SLOT_START_HOUR = 9;
const SLOTS_PER_HOUR = 2;

/** `월07A~09B` 또는 요일이 생략된 `05A~06B`, `~` 없는 단일 교시 `07A`. */
const PERIOD_TOKEN = /^([월화수목금토일])?(\d{1,2})([AB])(?:~(\d{1,2})([AB]))?$/;

/** `09:00`, `9:00`, 그리고 콜론이 빠진 오타 `1200`. */
const TIME_TOKEN = /^(\d{1,2}):?(\d{2})$/;

export class ClassTimeParseError extends Error {}

/** 교시(1-based) + A/B → 하루 안에서의 슬롯 번호. A는 정각, B는 30분. */
function periodToSlot(period: number, half: string): number {
  return 2 * (period - 1) + (half === "A" ? 0 : 1);
}

/**
 * 정규학기 강의시간 파싱. `월07A~09B,화05A~05B` 형태.
 *
 * 두 가지가 특히 조용히 틀리기 쉽다.
 * - `화03A~03B,05A~06B` 처럼 뒷 토큰의 요일이 생략되면 앞 요일을 물려받는다.
 * - `0`은 파싱 실패가 아니라 시간이 없는 강의(K-MOOC·캡스톤 등)다.
 */
export function parsePeriodFormat(raw: string): LectureInfo[] {
  const trimmed = raw.trim();
  if (trimmed === "" || trimmed === "0") {
    return [];
  }

  // `금01A~03B(온라인)` 처럼 붙는 괄호 주석은 시간 정보가 아니다.
  const withoutNote = trimmed.replace(/\s*\([^)]*\)\s*$/, "").trim();
  if (withoutNote === "") {
    return [];
  }

  const infos: LectureInfo[] = [];
  let currentDay: number | null = null;

  for (const rawToken of withoutNote.split(",")) {
    const token = rawToken.trim();
    if (token === "") {
      continue;
    }

    const matched = PERIOD_TOKEN.exec(token);
    if (!matched) {
      throw new ClassTimeParseError(`교시 표기를 해석할 수 없습니다: ${token}`);
    }

    const [, day, startPeriod, startHalf, endPeriod, endHalf] = matched;
    if (day) {
      currentDay = DAY_INDEX[day];
    }
    if (currentDay === null) {
      throw new ClassTimeParseError(`첫 토큰에 요일이 없습니다: ${token}`);
    }

    const startSlot = periodToSlot(Number(startPeriod), startHalf);
    // `~`가 없으면 한 슬롯짜리 수업이라 시작과 끝이 같다.
    const endSlot = endPeriod
      ? periodToSlot(Number(endPeriod), endHalf)
      : startSlot;

    infos.push({
      day: currentDay,
      start_time: currentDay * 100 + startSlot,
      end_time: currentDay * 100 + endSlot,
    });
  }

  return infos;
}

function timeToSlot(text: string): number {
  const matched = TIME_TOKEN.exec(text.trim());
  if (!matched) {
    throw new ClassTimeParseError(`시각을 해석할 수 없습니다: ${text}`);
  }

  const hour = Number(matched[1]);
  const minute = Number(matched[2]);
  return (hour - SLOT_START_HOUR) * SLOTS_PER_HOUR + (minute >= 30 ? 1 : 0);
}

/**
 * 계절학기 강의시간 파싱. `09:00~12:00` 형태이고 요일 정보가 아예 없다.
 * 월~금 매일 수업이라 호출자가 넘긴 요일마다 같은 시간대를 복제한다.
 *
 * 구분자가 `~`와 `-`로 섞여 있고, `9:00-12:00/13:00-15:00` 처럼
 * 하루에 두 구간인 경우도 있다.
 */
export function parseRangeFormat(raw: string, days: number[]): LectureInfo[] {
  const trimmed = raw.trim();
  if (trimmed === "" || trimmed === "0") {
    return [];
  }

  const infos: LectureInfo[] = [];

  for (const rawRange of trimmed.split("/")) {
    const range = rawRange.trim();
    if (range === "") {
      continue;
    }

    const bounds = range.split(/[~\-–—]/);
    if (bounds.length !== 2) {
      throw new ClassTimeParseError(`시간 범위를 해석할 수 없습니다: ${range}`);
    }

    const startSlot = timeToSlot(bounds[0]);
    // 종료 시각은 수업이 끝나는 시점이라 마지막 슬롯은 그 직전이다.
    const endSlot = timeToSlot(bounds[1]) - 1;
    if (endSlot < startSlot) {
      throw new ClassTimeParseError(`종료가 시작보다 빠릅니다: ${range}`);
    }

    for (const day of days) {
      infos.push({
        day,
        start_time: day * 100 + startSlot,
        end_time: day * 100 + endSlot,
      });
    }
  }

  // 하루 두 구간인 강의는 요일별로 모아야 프로덕션 저장 순서와 맞는다.
  return infos.sort((a, b) => a.start_time - b.start_time);
}
