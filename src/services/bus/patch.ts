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

function conversionBySemester(
  conversions: BusConversion[],
  semester: SemesterType,
): BusConversion | undefined {
  return conversions.find((conversion) =>
    conversion.payloads.some((payload) => payload.semester_type === semester),
  );
}

function semesterOfTitle(title: string): SemesterType | undefined {
  return SEMESTER_OF[clean(title)];
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
      const nameMatches = clean(route.route_name).toLowerCase() === wanted;
      if (!nameMatches) continue;
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

export function resolvePatch(
  raw: RawPatch,
  conversions: BusConversion[],
  problems: string[],
): BusPatch | null {
  const semester = semesterOfTitle(raw.semester);
  const conversion = semester
    ? conversionBySemester(conversions, semester)
    : conversions.length === 1
      ? conversions[0]
      : undefined;
  if (!conversion) {
    problems.push(
      semester
        ? `"${clean(raw.semester)}"의 변환 결과가 없습니다.`
        : "어느 학기의 시간표인지 확정할 수 없습니다. (정규학기/계절학기/방학기간을 지정해주세요)",
    );
    return null;
  }
  const resolvedSemester: SemesterType =
    semester ?? (conversion.payloads[0].semester_type as SemesterType);

  if (raw.field === "period") {
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

  const candidates = routeCandidates(conversion, {
    region: raw.region,
    direction: raw.direction,
    route: raw.route,
  });
  if (candidates.length === 0) {
    problems.push(
      `"${clean(raw.route)}"에 해당하는 노선을 ${conversion.payloads[0].semester_type === "REGULAR" ? "정규학기" : conversion.payloads[0].semester_type === "SEASONAL" ? "계절학기" : "방학기간"}에서 찾지 못했습니다.`,
    );
    return null;
  }
  if (candidates.length > 1) {
    problems.push(
      `"${clean(raw.route)}"는 여러 노선입니다: ${candidates.map((c) => describeRoute(c.route)).join(", ")}. 방향(등교/하교)까지 지정해주세요.`,
    );
    return null;
  }
  const { route } = candidates[0];
  const where = describeRoute(route);

  const trips = route.route_info;
  const trip = raw.trip ? trips.find((t) => clean(t.name) === clean(raw.trip)) : undefined;

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
    problems.push(`${where}: 회차 "${clean(raw.trip)}"를 찾지 못했습니다.`);
    return null;
  }

  if (raw.field === "arrival_time") {
    const stopIndex = route.node_info.findIndex((node) => clean(node.name) === clean(raw.stop));
    if (stopIndex === -1) {
      problems.push(`${where}: 정류장 "${clean(raw.stop)}"를 찾지 못했습니다.`);
      return null;
    }
    const value = validateTime(raw.value);
    if (!value) {
      problems.push(`${where} ${trip!.name} ${clean(raw.stop)}: "${raw.value}"은 시각(HH:MM)이나 마커가 아닙니다.`);
      return null;
    }
    const before = trip!.arrival_time[stopIndex];
    return {
      semester: resolvedSemester,
      target: candidates[0].payload.target,
      region: route.region,
      routeType: route.route_type,
      routeName: route.route_name,
      kind: "arrival_time",
      tripName: trip!.name,
      stopName: clean(raw.stop),
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
    const stopName = clean(raw.stop);
    if (!route.node_info.some((node) => clean(node.name) === stopName)) {
      problems.push(`${where}: 정류장 "${stopName}"를 찾지 못했습니다.`);
      return null;
    }
    return {
      semester: resolvedSemester,
      target: candidates[0].payload.target,
      region: route.region,
      routeType: route.route_type,
      routeName: route.route_name,
      kind: "remove_stop",
      stopName,
      before: `${where} ${stopName} 삭제`,
      after: "삭제",
      rawValue: stopName,
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
    if (route.node_info.some((node) => clean(node.name) === name)) {
      problems.push(`${where}: 정류장 "${name}"이 이미 있습니다.`);
      return null;
    }
    const reference = clean(raw.referenceStop);
    const referenceIndex = reference
      ? route.node_info.findIndex((node) => clean(node.name) === reference)
      : -1;
    if (!reference || referenceIndex === -1) {
      problems.push(`${where}: 정류장 "${name}"을 어디에 추가할지 지정해주세요. (기준 정류장과 앞/뒤)`);
      return null;
    }
    const beforeStop = raw.position === "before" ? reference : undefined;
    const afterStop = raw.position === "after" ? reference : undefined;
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
    system: SYSTEM_PROMPT,
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
