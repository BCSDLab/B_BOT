import { generateStructured } from "~/services/lecture/llm";
import { sourceDays, type Day } from "./days";
import type {
  BusConversion,
  BusPayload,
  BusRoute,
  BusTarget,
  SemesterType,
} from "./types";
import { ARRIVAL_MARKERS } from "./types";
import { normalizeTime } from "./validation";

const TITLES = ["정규학기", "계절학기", "방학기간"] as const;
const SEMESTER_OF: Record<string, SemesterType> = {
  정규학기: "REGULAR",
  계절학기: "SEASONAL",
  방학기간: "VACATION",
};
const DAY_LABELS: Record<string, string> = {
  MON: "월",
  TUE: "화",
  WED: "수",
  THU: "목",
  FRI: "금",
  SAT: "토",
  SUN: "일",
};
const markers = new Set<string>(ARRIVAL_MARKERS);
const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;
const PERIOD = /^(\d{4}-\d{2}-\d{2})~(\d{4}-\d{2}-\d{2})$/;

export type BusPatchKind =
  | "arrival_time"
  | "route_name"
  | "running_days"
  | "period"
  | "remove_route"
  | "remove_trip"
  | "remove_stop"
  | "add_trip"
  | "add_stop";

export interface BusPatch {
  semester: SemesterType;
  target: BusTarget;
  region: string;
  routeType: string;
  routeName: string;
  kind: BusPatchKind;
  tripName?: string;
  stopName?: string;
  before: string;
  after: string;
  rawValue: string;
  value?: string;
  days?: Day[];
  addStop?: { name: string; beforeStop?: string; afterStop?: string };
}

export interface BusPatchPlan {
  patches: BusPatch[];
  problems: string[];
}

const clean = (value: unknown) =>
  String(value ?? "")
    .replaceAll("\n", " ")
    .replace(/\s+/g, " ")
    .trim();

const daysLabel = (days?: Day[]) => days?.map((d) => DAY_LABELS[d]).join(",") ?? "운행일 없음";

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
        required: [
          "semester",
          "region",
          "direction",
          "route",
          "field",
          "trip",
          "stop",
          "value",
          "days",
          "newStop",
          "referenceStop",
          "position",
        ],
        properties: {
          semester: { type: "string", enum: [...TITLES], description: "바꿀 대상 학기. 원문에서 안 보이면 변환 목록에 하나뿐인 학기로 채운다." },
          region: { type: "string", description: "지역(천안/청주/서울/세종/대전/아산). 모르면 빈 문자열." },
          direction: { type: "string", description: "등교/하교/셔틀. 모르면 빈 문자열." },
          route: { type: "string", description: "노선명. 사용자가 부른 그대로." },
          field: {
            type: "string",
            enum: [
              "arrival_time",
              "route_name",
              "running_days",
              "period",
              "remove_route",
              "remove_trip",
              "remove_stop",
              "add_trip",
              "add_stop",
            ],
            description: "무엇을 바꿀지. arrival_time은 특정 회차·정류장의 도착 시각, period는 적용 기간.",
          },
          trip: { type: "string", description: "회차 이름(1회, 목·금 추가1 등). 해당 없으면 빈 문자열." },
          stop: { type: "string", description: "정류장 이름. 해당 없으면 빈 문자열." },
          value: {
            type: "string",
            description: "새 값. 도착시각은 HH:MM 또는 도착/정차/하차/종점 같은 마커, 기간은 YYYY-MM-DD~YYYY-MM-DD, 노선명·정류장명은 사용자가 부른 그대로.",
          },
          days: { type: "string", description: "running_days일 때 요일 표기(월수금, 주중, 매일 등). 해당 없으면 빈 문자열." },
          newStop: { type: "string", description: "add_stop일 때 새 정류장 이름." },
          referenceStop: { type: "string", description: "add_stop일 때 위치 기준이 되는 정류장 이름." },
          position: { type: "string", enum: ["before", "after", ""], description: "add_stop일 때 기준 정류장의 앞(before)/뒤(after)." },
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

const SYSTEM_PROMPT = `너는 버스 시간표 수정 요청을 구조화하는 도구다.

사용자가 자연어로 말한 수정 사항을 항목 단위로 쪼갠다. 파싱으로 만든 버스 노선 데이터를
바꾸는 요청만 다룬다.

아래는 실제 존재하는 노선 목록이다. 사용자가 지역·방향·노선명을 줄여 말해도 이 목록의
정확한 값으로 맞춰서 적는다. 목록에 없는 지역·방향·노선명은 지어내지 마라.
예: 사용자가 "세종 등교 셔틀"이라 하면 목록에서 "세종" "등교" "세종 등교/하교"를 찾는다.

실제 노선 목록:
{{ROUTES}}

- 값을 지어내지 마라. 사용자가 말하지 않은 건 바꾸지 않는다.
- 한 문장에 여러 노선·항목이 있으면 각각 따로 적는다.
- 무슨 뜻인지 애매하면 patches에 넣지 말고 unclear에 적어라. 추측해서 바꾸면 되돌릴 방법이 없다.
- 도착시각은 HH:MM 또는 마커(도착/정차/하차/미정차/하차/승하차/종점)로 적는다.
- 적용 기간은 YYYY-MM-DD~YYYY-MM-DD 형태 그대로 적는다.
- 직전 대화가 함께 주어지면 참고만 해라. **지금 메시지가 요청하는 것만** 내놓는다.

바꿀 수 있는 항목: arrival_time(도착시각), route_name(노선명), running_days(운행요일),
period(적용기간), remove_route/remove_trip/remove_stop(노선/회차/정류장 삭제),
add_trip/add_stop(회차/정류장 추가)`;

interface RawPatch {
  semester: string;
  region: string;
  direction: string;
  route: string;
  field: string;
  trip: string;
  stop: string;
  value: string;
  days: string;
  newStop: string;
  referenceStop: string;
  position: string;
}
export type { RawPatch };

/** SemesterType ↔ 표시용 한글 학기명. 같은 노선명이 여러 학기에 걸쳐 있을 수 있어
 *  검토·수정 미리보기에서 어느 학기를 고쳤는지 반드시 같이 보여줘야 한다. */
export const TITLE_OF: Record<SemesterType, string> = {
  REGULAR: "정규학기",
  SEASONAL: "계절학기",
  VACATION: "방학기간",
};

function conversionBySemester(
  conversions: BusConversion[],
  semester: SemesterType,
): BusConversion | undefined {
  return conversions.find((conversion) =>
    conversion.payloads.some((payload) => payload.semester_type === semester),
  );
}

/** `conversionBySemester`와 달리 같은 학기가 여러 BusConversion에 걸쳐 있어도 전부 찾는다. */
function conversionsBySemester(conversions: BusConversion[], semester: SemesterType): BusConversion[] {
  return conversions.filter((conversion) =>
    conversion.payloads.some((payload) => payload.semester_type === semester),
  );
}

function semesterOfTitle(title: string): SemesterType | undefined {
  return SEMESTER_OF[clean(title)];
}

/**
 * conversions에 실제로 등장하는 학기 구분. LLM은 노선 목록({{ROUTES}})만 보고
 * 학기 정보는 못 보므로, 원문에 학기 언급이 없으면 십중팔구 "정규학기"로 찍는다
 * (실제로 계절학기·방학기간만 있는 파일이어도 마찬가지) — 그 hallucination을
 * 걸러내려면 파일에 학기가 실제로 몇 종류 있는지를 코드가 직접 세야 한다.
 * 하나의 학기라도 sheet/지역별로 BusConversion이 여러 개로 쪼개질 수 있어
 * `conversions.length === 1`은 대리 지표로 쓸 수 없다.
 */
function distinctSemesterTypes(conversions: BusConversion[]): SemesterType[] {
  const found = new Set<SemesterType>();
  for (const conversion of conversions) {
    for (const payload of conversion.payloads) found.add(payload.semester_type);
  }
  return [...found];
}

function routeCandidates(
  conversion: BusConversion,
  hints: { region: string; direction: string; route: string },
): Array<{ payload: BusPayload; payloadIndex: number; route: BusRoute; routeIndex: number }> {
  const wanted = clean(hints.route).toLowerCase();
  const candidates: Array<{ payload: BusPayload; payloadIndex: number; route: BusRoute; routeIndex: number }> = [];
  for (const [payloadIndex, payload] of conversion.payloads.entries()) {
    const routes = Object.values(payload.body)[0] ?? [];
    for (const [routeIndex, route] of routes.entries()) {
      if (wanted) {
        const routeName = clean(route.route_name).toLowerCase();
        if (!routeName.includes(wanted)) continue;
      }
      if (hints.region && !route.region.includes(clean(hints.region))) continue;
      if (hints.direction && clean(route.route_type) !== clean(hints.direction)) continue;
      candidates.push({ payload, payloadIndex, route, routeIndex });
    }
  }
  return candidates;
}

function describeRoute(route: BusRoute) {
  return `${route.region} ${route.route_type} "${route.route_name}"`;
}

function validateTime(value: string): string | undefined {
  const normalized = normalizeTime(clean(value));
  if (typeof normalized !== "string") return undefined;
  if (HHMM.test(normalized) || markers.has(normalized)) return normalized;
  return undefined;
}

type StopMatch =
  | { kind: "exact"; index: number; name: string }
  | { kind: "partial"; index: number; name: string }
  | { kind: "ambiguous"; names: string[] }
  | { kind: "none" };

function findStop(nodes: BusRoute["node_info"], name: string): StopMatch {
  const wanted = clean(name);
  const exact = nodes.findIndex((n) => clean(n.name) === wanted);
  if (exact !== -1) return { kind: "exact", index: exact, name: nodes[exact].name };
  const normalized = wanted.toLowerCase();
  const partials = nodes
    .map((n, i) => ({ n, i }))
    .filter(({ n }) => {
      const nLower = clean(n.name).toLowerCase();
      return nLower.includes(normalized) || normalized.includes(nLower);
    });
  if (partials.length === 1) return { kind: "partial", index: partials[0].i, name: nodes[partials[0].i].name };
  if (partials.length > 1) return { kind: "ambiguous", names: partials.map(({ n }) => n.name) };
  return { kind: "none" };
}

export function resolvePatch(
  raw: RawPatch,
  conversions: BusConversion[],
  problems: string[],
): BusPatch | null {
  // LLM은 노선 목록({{ROUTES}})만 보고 학기 정보는 못 본다 — 원문에 학기 언급이
  // 없으면 실제로 뭐가 있는지 모른 채 "정규학기"를 찍어내는 일이 흔하다. 그래서
  // raw.semester가 실제 존재하는 학기와 맞아떨어질 때만 "사용자가 지정한 학기"로
  // 믿고, 그렇지 않으면 hallucination으로 보고 무시한다 — 바로 실패시키지 않는다.
  const explicitSemester = semesterOfTitle(raw.semester);
  const explicitMatches = explicitSemester ? conversionsBySemester(conversions, explicitSemester) : [];

  if (raw.field === "period") {
    // period는 노선이 아니라 학기 전체(version_update)에 대한 수정이라, 노선
    // 검색으로 학기를 되짚을 방법이 없다. 학기가 실제로 하나뿐이면 그걸로
    // 강제하고, 그마저 아니면 명시적으로 받아야 한다.
    let conversion = explicitMatches[0];
    let resolvedSemester = explicitSemester;
    if (!conversion) {
      const distinct = distinctSemesterTypes(conversions);
      if (distinct.length === 1) {
        resolvedSemester = distinct[0];
        conversion = conversionBySemester(conversions, resolvedSemester);
      }
    }
    if (!conversion || !resolvedSemester) {
      problems.push(
        explicitSemester
          ? `"${TITLE_OF[explicitSemester]}"의 변환 결과가 없습니다.`
          : "어느 학기의 적용 기간을 바꿀지 확정할 수 없습니다. (정규학기/계절학기/방학기간을 지정해주세요)",
      );
      return null;
    }
    const before = conversion.version_update.content;
    const after = clean(raw.value);
    if (!PERIOD.test(after)) {
      problems.push(`적용 기간 "${raw.value}"은 YYYY-MM-DD~YYYY-MM-DD 형태여야 합니다.`);
      return null;
    }
    const [start, end] = after.split("~");
    if (new Date(`${start}T00:00:00Z`) > new Date(`${end}T00:00:00Z`)) {
      problems.push(`적용 기간 "${raw.value}"의 시작이 끝보다 늦습니다.`);
      return null;
    }
    return {
      semester: resolvedSemester,
      target: "commuting",
      region: "",
      routeType: "",
      routeName: "",
      kind: "period",
      before,
      after,
      rawValue: after,
      value: after,
    };
  }

  // 나머지 항목은 전부 노선 단위 수정이다. 학기를 먼저 확정하지 않고, 실제로
  // 존재하는 학기(explicitMatches)로 좁혀지면 그 안에서만, 아니면 전체 학기에서
  // 노선을 찾는다 — 노선 검색 결과가 학기를 알려주지, 그 반대가 아니다.
  const searchSpace = explicitMatches.length > 0 ? explicitMatches : conversions;
  const hints = { region: raw.region, direction: raw.direction, route: raw.route };
  const matches = searchSpace.flatMap((conversion) =>
    routeCandidates(conversion, hints).map((candidate) => ({ conversion, ...candidate })),
  );

  const label = clean(raw.route) || (clean(raw.region) || clean(raw.direction)
    ? `${clean(raw.region)} ${clean(raw.direction)}`.trim()
    : "지정한");

  if (matches.length === 0) {
    problems.push(`"${label}"에 해당하는 노선을 찾지 못했습니다.`);
    return null;
  }

  const bySemester = new Map<SemesterType, typeof matches>();
  for (const match of matches) {
    const semesterType = match.payload.semester_type as SemesterType;
    bySemester.set(semesterType, [...(bySemester.get(semesterType) ?? []), match]);
  }
  if (bySemester.size > 1) {
    problems.push(
      `"${label}"이 여러 학기에 걸쳐 있습니다: ${[...bySemester.keys()].map((s) => TITLE_OF[s]).join(", ")}. ` +
        `학기를 지정해주세요. (예: "계절학기 ${label} ...")`,
    );
    return null;
  }
  const [[resolvedSemester, candidates]] = bySemester;

  if (candidates.length > 1) {
    problems.push(
      `"${label}"는 여러 노선입니다: ${candidates.map((c) => describeRoute(c.route)).join(", ")}. 방향(등교/하교)까지 지정해주세요.`,
    );
    return null;
  }
  const { route } = candidates[0];
  const where = describeRoute(route);

  const trips = route.route_info;
  const trip = raw.trip
    ? trips.find((t) => clean(t.name) === clean(raw.trip))
    : trips.length === 1
      ? trips[0]
      : undefined;

  if (raw.field === "route_name") {
    const after = clean(raw.value);
    if (!after) {
      problems.push(`${where}: 바꿀 노선명을 적어주세요.`);
      return null;
    }
    return {
      semester: resolvedSemester,
      target: candidates[0].payload.target,
      region: route.region,
      routeType: route.route_type,
      routeName: route.route_name,
      kind: "route_name",
      before: route.route_name,
      after,
      rawValue: after,
      value: after,
    };
  }

  if (raw.field === "remove_route") {
    const routes = Object.values(candidates[0].payload.body)[0];
    if (routes.length <= 1) {
      problems.push(`${where}: 마지막 남은 노선은 삭제할 수 없습니다.`);
      return null;
    }
    return {
      semester: resolvedSemester,
      target: candidates[0].payload.target,
      region: route.region,
      routeType: route.route_type,
      routeName: route.route_name,
      kind: "remove_route",
      before: where,
      after: "삭제",
      rawValue: clean(raw.route),
    };
  }

  if (!trip && raw.field !== "add_trip" && raw.field !== "add_stop" && raw.field !== "remove_stop") {
    const msg = raw.trip
      ? `회차 "${clean(raw.trip)}"를 찾지 못했습니다.`
      : `회차를 지정해주세요. (가능한 회차: ${trips.map((t) => t.name).join(", ")})`;
    problems.push(`${where}: ${msg}`);
    return null;
  }

  if (raw.field === "arrival_time") {
    const stopMatch = raw.stop ? findStop(route.node_info, raw.stop) : { kind: "none" } as const;
    if (stopMatch.kind === "none") {
      problems.push(`${where}: 정류장 "${clean(raw.stop)}"를 찾지 못했습니다.`);
      return null;
    }
    if (stopMatch.kind === "ambiguous") {
      problems.push(`${where}: 정류장 "${clean(raw.stop)}"가 여러 개 일치합니다: ${stopMatch.names.join(", ")}. 정확한 이름을 적어주세요.`);
      return null;
    }
    const value = validateTime(raw.value);
    if (!value) {
      problems.push(`${where} ${trip!.name} ${clean(raw.stop)}: "${raw.value}"은 시각(HH:MM)이나 마커가 아닙니다.`);
      return null;
    }
    const before = trip!.arrival_time[stopMatch.index];
    return {
      semester: resolvedSemester,
      target: candidates[0].payload.target,
      region: route.region,
      routeType: route.route_type,
      routeName: route.route_name,
      kind: "arrival_time",
      tripName: trip!.name,
      stopName: stopMatch.name,
      before: before ?? "(미운행)",
      after: value,
      rawValue: value,
      value,
    };
  }

  if (raw.field === "running_days") {
    const days = sourceDays(raw.days || raw.value);
    if (!days) {
      problems.push(`${where} ${trip!.name}: 요일 표기 "${raw.days || raw.value}"를 해석하지 못했습니다. (예: 월수금, 주중, 매일)`);
      return null;
    }
    return {
      semester: resolvedSemester,
      target: candidates[0].payload.target,
      region: route.region,
      routeType: route.route_type,
      routeName: route.route_name,
      kind: "running_days",
      tripName: trip!.name,
      before: daysLabel(trip!.running_days),
      after: daysLabel(days),
      rawValue: raw.days || raw.value,
      days,
    };
  }

  if (raw.field === "remove_trip") {
    if (trips.length <= 1) {
      problems.push(`${where}: 마지막 남은 회차는 삭제할 수 없습니다.`);
      return null;
    }
    return {
      semester: resolvedSemester,
      target: candidates[0].payload.target,
      region: route.region,
      routeType: route.route_type,
      routeName: route.route_name,
      kind: "remove_trip",
      tripName: trip!.name,
      before: `${where} ${trip!.name} 삭제`,
      after: "삭제",
      rawValue: clean(raw.trip),
    };
  }

  if (raw.field === "remove_stop") {
    if (route.node_info.length <= 1) {
      problems.push(`${where}: 마지막 남은 정류장은 삭제할 수 없습니다.`);
      return null;
    }
    const stopMatch = raw.stop ? findStop(route.node_info, raw.stop) : { kind: "none" } as const;
    if (stopMatch.kind === "none") {
      problems.push(`${where}: 정류장 "${clean(raw.stop)}"를 찾지 못했습니다.`);
      return null;
    }
    if (stopMatch.kind === "ambiguous") {
      problems.push(`${where}: 정류장 "${clean(raw.stop)}"가 여러 개 일치합니다: ${stopMatch.names.join(", ")}. 정확한 이름을 적어주세요.`);
      return null;
    }
    return {
      semester: resolvedSemester,
      target: candidates[0].payload.target,
      region: route.region,
      routeType: route.route_type,
      routeName: route.route_name,
      kind: "remove_stop",
      stopName: stopMatch.name,
      before: `${where} ${stopMatch.name} 삭제`,
      after: "삭제",
      rawValue: stopMatch.name,
    };
  }

  if (raw.field === "add_trip") {
    const name = clean(raw.trip);
    if (!name) {
      problems.push(`${where}: 추가할 회차 이름을 적어주세요. (예: 7회)`);
      return null;
    }
    if (trips.some((t) => clean(t.name) === name)) {
      problems.push(`${where}: 회차 "${name}"이 이미 있습니다.`);
      return null;
    }
    const value = raw.value ? validateTime(raw.value) : undefined;
    if (raw.value && !value) {
      problems.push(`${where}: 추가 회차 시각 "${raw.value}"은 시각(HH:MM)이나 마커가 아닙니다.`);
      return null;
    }
    return {
      semester: resolvedSemester,
      target: candidates[0].payload.target,
      region: route.region,
      routeType: route.route_type,
      routeName: route.route_name,
      kind: "add_trip",
      tripName: name,
      before: "-",
      after: value ? `${name} 추가 (첫 정류장 ${value})` : `${name} 추가`,
      rawValue: name,
      value,
    };
  }

  if (raw.field === "add_stop") {
    const name = clean(raw.newStop);
    if (!name) {
      problems.push(`${where}: 추가할 정류장 이름을 적어주세요.`);
      return null;
    }
    const dup = findStop(route.node_info, name);
    if (dup.kind === "exact" || dup.kind === "partial") {
      problems.push(`${where}: 정류장 "${name}"이 이미 있습니다.`);
      return null;
    }
    if (dup.kind === "ambiguous") {
      problems.push(`${where}: 정류장 "${name}"와 유사한 정류장이 여러 개 있습니다: ${dup.names.join(", ")}.`);
      return null;
    }
    const reference = clean(raw.referenceStop);
    const ref = reference ? findStop(route.node_info, reference) : { kind: "none" } as const;
    if (ref.kind === "none") {
      problems.push(`${where}: 정류장 "${name}"을 어디에 추가할지 지정해주세요. (기준 정류장과 앞/뒤)`);
      return null;
    }
    if (ref.kind === "ambiguous") {
      problems.push(`${where}: 기준 정류장 "${reference}"가 여러 개 일치합니다: ${ref.names.join(", ")}. 정확한 이름을 적어주세요.`);
      return null;
    }
    const beforeStop = raw.position === "before" ? ref.name : undefined;
    const afterStop = raw.position === "after" ? ref.name : undefined;
    if (!beforeStop && !afterStop) {
      problems.push(`${where}: "${reference}" 기준으로 앞(before)인지 뒤(after)인지 지정해주세요.`);
      return null;
    }
    return {
      semester: resolvedSemester,
      target: candidates[0].payload.target,
      region: route.region,
      routeType: route.route_type,
      routeName: route.route_name,
      kind: "add_stop",
      before: "-",
      after: `${name} 추가 (${afterStop ? `${afterStop} 뒤` : `${beforeStop} 앞`})`,
      rawValue: name,
      addStop: { name, beforeStop, afterStop },
    };
  }

  problems.push(`${where}: "${raw.field}"은 지원하지 않는 수정 항목입니다.`);
  return null;
}

/** 실제 존재하는 노선 목록을 "지역 방향 노선명" 형태로 정리한다. 중복은 제거한다. */
export function buildRouteList(conversions: BusConversion[]): string {
  const names = new Set<string>();
  for (const conversion of conversions) {
    for (const payload of conversion.payloads) {
      const routes = Object.values(payload.body)[0] ?? [];
      for (const route of routes) {
        names.add(`${route.region} ${route.route_type} ${route.route_name}`);
      }
    }
  }
  return [...names].sort().join("\n");
}

/**
 * 자연어 → 검증된 수정 계획.
 * LLM은 "무엇을 무엇으로"만 뽑고, 그게 말이 되는지는 전부 코드가 본다.
 * 시각·요일·기간은 실제로 해석해봐서 통과해야만 계획에 들어간다.
 */
export async function planBusPatches(
  text: string,
  conversions: BusConversion[],
  context = "",
): Promise<BusPatchPlan> {
  const raw = await generateStructured<{
    patches: RawPatch[];
    unclear: string[];
  }>({
    system: SYSTEM_PROMPT.replace("{{ROUTES}}", buildRouteList(conversions)),
    schema: PATCH_SCHEMA as unknown as Record<string, unknown>,
    prompt: context
      ? `직전 대화:\n${context}\n\n지금 메시지(이것만 처리해라):\n${text}`
      : `다음 수정 요청을 구조화해줘.\n\n${text}`,
  });

  const problems = raw.unclear.map((line) => `무슨 뜻인지 확실하지 않아 넘겼습니다: ${line}`);
  const patches: BusPatch[] = [];
  for (const item of raw.patches) {
    const patch = resolvePatch(item, conversions, problems);
    if (patch) patches.push(patch);
  }
  return { patches, problems };
}

function routeOf(conversion: BusConversion, patch: BusPatch): { payload: BusPayload; route: BusRoute } | null {
  for (const payload of conversion.payloads) {
    const routes = Object.values(payload.body)[0] ?? [];
    const route = routes.find(
      (candidate) =>
        clean(candidate.route_name) === clean(patch.routeName) &&
        (!patch.region || candidate.region.includes(patch.region)) &&
        (!patch.routeType || clean(candidate.route_type) === clean(patch.routeType)),
    );
    if (route) return { payload, route };
  }
  return null;
}

function applyPatch(conversion: BusConversion, patch: BusPatch) {
  if (patch.kind === "period") {
    conversion.version_update.content = patch.value!;
    return;
  }

  const found = routeOf(conversion, patch);
  if (!found) throw new Error(`적용 대상 노선을 찾지 못했습니다: ${patch.routeName}`);
  const { payload, route } = found;

  if (patch.kind === "route_name") {
    route.route_name = patch.value!;
    return;
  }
  if (patch.kind === "remove_route") {
    const routes = Object.values(payload.body)[0];
    const index = routes.findIndex((candidate) => candidate === route);
    routes.splice(index, 1);
    return;
  }

  if (patch.kind === "remove_stop") {
    const index = route.node_info.findIndex((node) => clean(node.name) === patch.stopName);
    if (index === -1) throw new Error(`정류장을 찾지 못했습니다: ${patch.stopName}`);
    route.node_info.splice(index, 1);
    for (const trip of route.route_info) trip.arrival_time.splice(index, 1);
    return;
  }

  if (patch.kind === "add_stop") {
    const addStop = patch.addStop!;
    const reference = addStop.afterStop ?? addStop.beforeStop;
    const found = route.node_info.findIndex((node) => clean(node.name) === reference);
    if (found === -1) throw new Error(`정류장 위치를 찾지 못했습니다: ${addStop.name}`);
    const index = addStop.afterStop ? found + 1 : found;
    route.node_info.splice(index, 0, { name: addStop.name });
    for (const trip of route.route_info) trip.arrival_time.splice(index, 0, null);
    return;
  }

  if (patch.kind === "add_trip") {
    const value = patch.value ?? null;
    route.route_info.push({
      name: patch.tripName!,
      arrival_time: route.node_info.map((_, index) => (index === 0 ? value : null)),
    });
    return;
  }

  const trip = route.route_info.find((candidate) => clean(candidate.name) === clean(patch.tripName));
  if (!trip) throw new Error(`적용 대상 회차를 찾지 못했습니다: ${patch.tripName}`);

  if (patch.kind === "arrival_time") {
    const index = route.node_info.findIndex((node) => clean(node.name) === patch.stopName);
    if (index === -1) throw new Error(`정류장을 찾지 못했습니다: ${patch.stopName}`);
    trip.arrival_time[index] = patch.value!;
    return;
  }
  if (patch.kind === "running_days") {
    trip.running_days = patch.days;
    return;
  }
  if (patch.kind === "remove_trip") {
    const index = route.route_info.findIndex((candidate) => candidate === trip);
    route.route_info.splice(index, 1);
    return;
  }
}

/**
 * 원본을 건드리지 않고 수정본을 새로 만든다. 미리보기와 실제 적용이 갈라지지 않게.
 * 각 패치는 적용 시점에 다시 해석하므로 앞선 패치의 이름 변경을 따라잡는다.
 */
export function applyBusPatchesToConversions(
  conversions: BusConversion[],
  patches: BusPatch[],
): BusConversion[] {
  const next = structuredClone(conversions) as BusConversion[];
  for (const patch of patches) {
    const conversion = next.find((candidate) =>
      candidate.payloads.some((payload) => payload.semester_type === patch.semester),
    );
    if (!conversion) throw new Error(`적용 대상 학기를 찾지 못했습니다: ${patch.semester}`);
    applyPatch(conversion, patch);
  }
  return next;
}
