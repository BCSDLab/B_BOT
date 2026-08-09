import type { BusConversion, BusPayload, BusRoute, BusTarget, BusVersionUpdate, SemesterType } from "./types";
import type { KoinAdminAuth } from "~/services/koin/adminAuth";

/** 응답이 없으면 job이 APPLYING/버전 갱신 크론이 영원히 멈춘다. */
const REQUEST_TIMEOUT_MS = 30_000;

/**
 * Swagger 스펙으로 고정된 Admin API 경로·body 루트 키.
 */
export const BUS_API_TARGETS: Record<BusTarget, { path: string; bodyKey: string }> = {
  commuting: {
    path: "/admin/bus/commuting/timetable",
    bodyKey: "commuting_bus_timetables",
  },
  shuttle: {
    path: "/admin/bus/shuttle/timetable",
    bodyKey: "shuttle_bus_timetables",
  },
};

/**
 * `A(B)` → { name: "A", detail: "B" }. 괄호가 없으면 detail은 null.
 * route_name에서 sub_name을, node_info/route_info의 name에서 detail을 뽑는다.
 */
function splitParen(text: string): { name: string; detail: string | null } {
  const match = text.match(/^(.+?)\s*\(([^)]+)\)\s*$/);
  if (match) return { name: match[1].trim(), detail: match[2].trim() };
  return { name: text, detail: null };
}

/**
 * 우리 내부 `route_type`(등교/하교/셔틀)은 검토 화면 표시와 `!수정` 매칭에 쓰는
 * 방향/종류 라벨일 뿐, KOIN Admin API의 `route_type`과는 다른 값이다. 실제 API는
 * `ShuttleRouteType`(순환/주중/주말) 세 값만 받고, commuting 엔드포인트는 그중
 * "주중"만 허용한다(`validateCommuting()`) — "등교"/"하교"/"셔틀"을 그대로 보내면
 * "버스 노선 구분이 잘못되었습니다"로 거부된다. 그래서 API로 나가는 값은 대상별로
 * 고정하고, 내부 route_type은 그대로 둔 채 전송 직전에만 바꿔친다.
 */
const WEEKEND_DAYS = new Set(["SAT", "SUN"]);

/**
 * 셔틀 노선이 토·일요일에만 운행하면 "주말", 아니면(평일 포함 순환) "순환"이다.
 * `sourceDays`(days.ts)가 "주말"/"토요일" 같은 원문을 이미 SAT/SUN으로 옮겨
 * route_info에 심어두므로, 그 결과를 다시 읽기만 하면 된다 — 별도 파서 작업이
 * 필요 없다. 요일 정보가 없는 회차만 있으면(운행요일 미기재) 평소처럼 순환으로 둔다.
 */
function shuttleRouteType(route: BusRoute): string {
  const days = route.route_info.flatMap((trip) => trip.running_days ?? []);
  return days.length > 0 && days.every((day) => WEEKEND_DAYS.has(day)) ? "주말" : "순환";
}

const adminRouteType = (route: BusRoute, target: BusTarget): string =>
  target === "commuting" ? "주중" : shuttleRouteType(route);

/**
 * Admin API가 정의한 필드만 남긴다. running_days 같은 검수 전용 필드는 보내지 않는다.
 * route_name과 정류장/회차 이름에서 괄호 안 내용을 분리해 sub_name/detail로 보낸다.
 */
const toAdminRoute = (route: BusRoute, target: BusTarget) => {
  const { name: routeName, detail: subName } = splitParen(route.route_name);
  return {
    region: route.region,
    route_type: adminRouteType(route, target),
    route_name: routeName,
    sub_name: subName,
    node_info: route.node_info.map((node) => splitParen(node.name)),
    route_info: route.route_info.map((trip) => ({
      ...splitParen(trip.name),
      arrival_time: trip.arrival_time,
    })),
  };
};

/**
 * 어드민 API 호출 실패.
 *
 * **어느 호출에서 났는지를 들고 다닌다.** commuting과 shuttle은 별도 API라
 * 어느 쪽에서 멈췄는지가 재시도 판단에 필요하다.
 */
export class BusAdminApiError extends Error {
  constructor(
    message: string,
    readonly stage: BusTarget,
    readonly status: number,
  ) {
    super(message);
    this.name = "BusAdminApiError";
  }
}

/**
 * 실제 반영. 인증은 이 모듈이 갖지 않는다 — 토큰 발급 방식이 바뀌어도 여기는
 * 그대로 두려는 것이다.
 *
 * PUT은 payload(대상 × 학기)마다 따로 나간다. 중간에 실패하면 앞선 PUT은 이미
 * 반영된 상태로 남는다 — `onApplied`로 어디까지 갔는지 호출자에게 알려준다.
 * 각 PUT은 전체 시간표를 통째로 덮어써서 재시도해도 안전하다.
 */
export async function submitBusTimetables(
  conversions: BusConversion[],
  { baseUrl, accessToken }: KoinAdminAuth,
  onApplied?: (applied: { target: BusTarget; semesterType: SemesterType }) => void,
): Promise<void> {
  const base = baseUrl.replace(/\/$/, "");
  for (const payload of conversions.flatMap(
    (conversion: BusConversion) => conversion.payloads,
  ) as BusPayload[]) {
    const target = BUS_API_TARGETS[payload.target];
    const bodyKeys = Object.keys(payload.body);
    if (bodyKeys.length !== 1 || bodyKeys[0] !== target.bodyKey) {
      throw new BusAdminApiError(
        `${payload.target} Admin API body_key configuration mismatch`,
        payload.target,
        0,
      );
    }
    const url = new URL(base + target.path);
    url.searchParams.set("semester_type", payload.semester_type);
    const response = await fetch(url, {
      method: "PUT",
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        [target.bodyKey]: Object.values(payload.body)[0].map((route) =>
          toAdminRoute(route, payload.target),
        ),
      }),
    });
    if (!response.ok) {
      const detail = await response
        .text()
        .then((text) => text.slice(0, 300))
        .catch(() => "");
      throw new BusAdminApiError(
        `${payload.target} Admin API failed: ${response.status}${detail ? `\n${detail}` : ""}`,
        payload.target,
        response.status,
      );
    }
    onApplied?.({ target: payload.target, semesterType: payload.semester_type });
  }
}

/**
 * 사이트에 노출되는 "버전" 문구만 갱신한다. 시간표 반영(PUT)과는 별개 API라
 * 현재 version 값을 먼저 읽어와야 한다 — 버전 API는 title/content만 바꿔도
 * version 필드를 함께 요구한다.
 */
export async function updateBusVersionViaAdminApi(
  versionUpdate: BusVersionUpdate,
  { baseUrl, accessToken }: KoinAdminAuth,
): Promise<void> {
  const versionUrl = new URL(`/admin/version/${versionUpdate.type}`, baseUrl).toString();
  const headers = {
    Authorization: `Bearer ${accessToken}`,
    "Content-Type": "application/json",
  };
  const currentResponse = await fetch(versionUrl, {
    headers,
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  if (!currentResponse.ok) {
    throw new Error(`Version Admin API GET failed: ${currentResponse.status}`);
  }
  const current = (await currentResponse.json()) as { version?: unknown };
  if (typeof current.version !== "string" || !current.version) {
    throw new Error("Version Admin API GET response does not contain version");
  }

  const updateResponse = await fetch(versionUrl, {
    method: "PUT",
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    headers,
    body: JSON.stringify({
      version: current.version,
      title: versionUpdate.title,
      content: versionUpdate.content,
    }),
  });
  if (!updateResponse.ok) {
    throw new Error(`Version Admin API PUT failed: ${updateResponse.status}`);
  }
}
