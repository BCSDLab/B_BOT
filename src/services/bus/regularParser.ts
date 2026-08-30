import type {
  AnalysedCell,
  AnalysedSheet,
  AnalysedWorkbook,
} from "./excelAnalyzer";
import type { ArrivalTime, BusRoute, BusTarget } from "./types";
import { normalizeTime } from "./validation";
import { sourceDays, WEEKDAYS, type Day } from "./days";

const KOREAN_DAY: Record<Day, string> = {
  MON: "월요일",
  TUE: "화요일",
  WED: "수요일",
  THU: "목요일",
  FRI: "금요일",
  SAT: "토요일",
  SUN: "일요일",
};

const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;
const MARKERS = new Set([
  "도착",
  "정차",
  "미정차",
  "하차",
  "미하차",
  "승하차",
  "종점",
]);

const key = (row: number, column: number) => `${row}:${column}`;
const clean = (value: unknown) =>
  String(value ?? "")
    .replaceAll("\n", " ")
    .replace(/\s+/g, " ")
    .trim();
const isMaster = (cell: AnalysedCell) => !cell.merged_from;
const isBlank = (value: unknown) =>
  value == null || value === "" || /^[xX-]$/.test(clean(value));

function arrival(value: unknown): ArrivalTime | undefined {
  if (isBlank(value)) return undefined;
  const normalized = normalizeTime(value);
  if (typeof normalized !== "string") return undefined;
  if (TIME.test(normalized) || MARKERS.has(normalized)) return normalized;
  if (normalized.includes("하차")) return "하차";
  if (normalized.includes("도착")) return "도착";
  return undefined;
}

function arrivalList(value: unknown): ArrivalTime | undefined {
  if (typeof value !== "string" || !value.includes("/")) return arrival(value);
  const parts = value.split("/").map((part) => arrival(part.trim()));
  return parts.every((part) => part !== undefined)
    ? parts.join("/")
    : undefined;
}

function sourceRegion(text: string): string | undefined {
  return ["천안", "청주", "서울", "세종", "대전", "아산"].find((region) =>
    text.includes(region),
  );
}

function sourceDirection(text: string): string {
  if (/등교/.test(text)) return "등교";
  if (/하교/.test(text)) return "하교";
  return "셔틀";
}

function values(sheet: AnalysedSheet) {
  return new Map(
    sheet.cells.map((cell) => [key(cell.row, cell.column), cell.value]),
  );
}

function splitColumnTrip(
  name: string,
  columnValues: Array<ArrivalTime | undefined>,
  heading: string,
): BusRoute["route_info"] {
  const parts = columnValues.map((value) =>
    typeof value === "string" && value.includes("/")
      ? value.split("/").map((part) => arrival(part.trim()) ?? null)
      : [value ?? null],
  );
  const count = Math.max(...parts.map((part) => part.length));
  const days = sourceDays(`${heading} ${name}`);
  return Array.from({ length: count }, (_, index) => ({
    name:
      count === 1
        ? name
        : /추가/.test(name)
          ? `목·금 추가${index + 1}`
          : `${name.replace(/\s*\(\d+대\)\s*$/, "")} ${index + 1}회`,
    ...(days ? { running_days: days } : {}),
    arrival_time: parts.map((part) => part[index] ?? null),
  }));
}

function regionalMatrices(
  sheet: AnalysedSheet,
): Array<{ target: BusTarget; route: BusRoute }> {
  const at = values(sheet);
  const masters = sheet.cells.filter(isMaster);
  const sections = masters
    .filter((cell) =>
      /(?:천안|청주|서울|세종|대전|아산)\s*지역.*등교/.test(clean(cell.value)),
    )
    .sort((left, right) => left.row - right.row);
  const routes: Array<{ target: BusTarget; route: BusRoute }> = [];

  for (const [sectionIndex, headingCell] of sections.entries()) {
    const sectionEnd =
      sections[sectionIndex + 1]?.row ??
      Math.max(...sheet.cells.map((cell) => cell.row)) + 1;
    const stopHeader = masters.find(
      (cell) =>
        cell.row > headingCell.row &&
        cell.row <= headingCell.row + 4 &&
        cell.column === headingCell.column &&
        clean(cell.value) === "정류장",
    );
    if (!stopHeader) continue;
    const nextBlock = masters
      .filter(
        (cell) =>
          cell.row === headingCell.row &&
          cell.column > headingCell.column &&
          /통학.*버스|대학원.*버스/.test(clean(cell.value)),
      )
      .sort((left, right) => left.column - right.column)[0];
    const endColumn = (nextBlock?.column ?? 40) - 1;
    const stopRows = sheet.cells
      .filter(
        (cell) =>
          cell.column === stopHeader.column &&
          cell.row > stopHeader.row &&
          cell.row < sectionEnd &&
          isMaster(cell) &&
          clean(cell.value) &&
          !/^운행기간/.test(clean(cell.value)),
      )
      .map((cell) => ({ row: cell.row, name: clean(cell.value) }));

    const columns: Array<{
      column: number;
      label: string;
      heading: string;
      target: BusTarget;
      rowValues: Array<ArrivalTime | undefined>;
    }> = [];
    for (let column = stopHeader.column + 1; column <= endColumn; column += 1) {
      const label = clean(at.get(key(stopHeader.row, column)));
      const rowValues = stopRows.map((row) =>
        arrivalList(at.get(key(row.row, column))),
      );
      if (
        !label ||
        // "운행기간 : ..." 같은 안내 문구가 옆 칸까지 넓게 병합돼 있으면, 그
        // 병합 범위의 각 열이 마치 회차 헤더처럼 보인다. 실제로는 다른
        // 표(예: 세종 노선)의 값이 같은 행 번호에 우연히 걸쳐 회차로 잘못
        // 잡히니 이런 안내문 라벨은 열 헤더로 쓰지 않는다.
        /^운행기간/.test(label) ||
        !rowValues.some((value) => value !== undefined)
      )
        continue;
      const localHeading = clean(
        masters
          .filter(
            (cell) =>
              cell.row === headingCell.row &&
              cell.column <= column &&
              /지역|셔틀|순환/.test(clean(cell.value)),
          )
          .sort((left, right) => right.column - left.column)[0]?.value ??
          headingCell.value,
      );
      const target: BusTarget = /셔틀|순환/.test(localHeading)
        ? "shuttle"
        : "commuting";
      columns.push({ column, label, heading: localHeading, target, rowValues });
    }

    for (const column of columns.filter(
      (item) => item.target === "commuting",
    )) {
      const selected = stopRows
        .map((row, index) => ({ ...row, value: column.rowValues[index] }))
        .filter(
          (row): row is typeof row & { value: ArrivalTime } =>
            row.value !== undefined,
        );
      if (!selected.length) continue;
      const values = selected.map((row) => row.value);
      const hasJoined = values.some(
        (value) => typeof value === "string" && value.includes("/"),
      );
      // KOIN 사이트는 route_type이 WEEKDAYS(통학)인 노선의 등교/하교를
      // route_info[].name이 정확히 "등교"/"하교"인지로 구분한다(백엔드
      // ShuttleBusService.setDirection). "1회"처럼 다르게 적으면 전부
      // "등교"로 잘못 분류돼 하교 쪽이 조회에서 통째로 빠진다.
      const routeInfo: BusRoute["route_info"] = hasJoined
        ? splitColumnTrip(column.label, values, column.heading).map((trip) => ({
            name: "등교",
            running_days: [...WEEKDAYS] as BusRoute["route_info"][number]["running_days"],
            arrival_time: trip.arrival_time,
          }))
        : [
            {
              name: "등교",
              running_days: [...WEEKDAYS] as BusRoute["route_info"][number]["running_days"],
              arrival_time: values,
            },
          ];
      routes.push({
        target: "commuting",
        route: {
          region: sourceRegion(clean(headingCell.value)) ?? column.label,
          route_type: "등교",
          route_name: column.label,
          node_info: selected.map((row) => ({ name: row.name })),
          route_info: routeInfo,
        },
      });
    }

    const shuttleGroups = new Map<string, typeof columns>();
    for (const column of columns.filter((item) => item.target === "shuttle")) {
      shuttleGroups.set(column.heading, [
        ...(shuttleGroups.get(column.heading) ?? []),
        column,
      ]);
    }
    for (const [heading, group] of shuttleGroups) {
      const usedRows = stopRows.filter((_, index) =>
        group.some((column) => column.rowValues[index] !== undefined),
      );
      if (!usedRows.length) continue;
      const indexes = usedRows.map((row) =>
        stopRows.findIndex((item) => item.row === row.row),
      );
      const routeInfo = group.flatMap((column) =>
        splitColumnTrip(
          column.label,
          indexes.map((index) => column.rowValues[index]),
          heading,
        ),
      );
      routes.push({
        target: "shuttle",
        route: {
          region:
            sourceRegion(heading) ??
            sourceRegion(clean(headingCell.value)) ??
            "천안",
          route_type: "셔틀",
          route_name: heading.replace(/\s*\(.*/, "").trim(),
          node_info: usedRows.map((row) => ({ name: row.name })),
          route_info: routeInfo,
        },
      });
    }
  }
  return routes;
}

/**
 * "(천안시내) 토요일 통학 셔틀버스"처럼 표 제목이 지역만 괄호로 담고,
 * 소속(예: 일학습병행대학)은 그 위 상위 제목("2026학년도 학기 중
 * 일학습병행대학 주말통학버스 운행시간표")에만 있는 경우 그 소속을 찾아
 * 합친다. 상위 제목이 없으면(예: "전문대학원 토요일 통학 셔틀버스"처럼
 * 소속이 이미 제목 앞에 있는 경우) "요일 통학 셔틀버스" 군더더기만 뗀다.
 * route_name은 이렇게 만들고, 방향·요일 판별에는 원래 title을 그대로 쓴다.
 */
function shuttleRouteName(
  sheet: AnalysedSheet,
  header: AnalysedCell,
  title: string,
): string {
  const region = title.match(/^\(([^)]+)\)/)?.[1];
  if (region) {
    const outer = sheet.cells
      .filter(
        (cell) =>
          isMaster(cell) &&
          cell.row < header.row &&
          cell.row >= header.row - 25 &&
          /주말\s*통학\s*버스|주말\s*셔틀버스/.test(clean(cell.value)),
      )
      .sort((left, right) => right.row - left.row)[0];
    const affiliation = clean(outer?.value ?? "").match(
      /학기\s*중\s*(.+?)\s*주말/,
    )?.[1];
    return affiliation ? `${affiliation} ${region}` : region;
  }
  return title.replace(/\s*(?:토요일|일요일|주중|주말)?\s*통학\s*셔틀버스\s*$/, "");
}

function nearestTitle(sheet: AnalysedSheet, header: AnalysedCell): string {
  return clean(
    sheet.cells
      .filter(
        (cell) =>
          isMaster(cell) &&
          cell.row < header.row &&
          cell.row >= header.row - 6 &&
          Math.abs(cell.column - header.column) <= 3 &&
          /셔틀버스|등교|하교|세종/.test(clean(cell.value)) &&
          !/^운행기간/.test(clean(cell.value)),
      )
      .sort(
        (left, right) =>
          right.row - left.row ||
          Math.abs(left.column - header.column) -
            Math.abs(right.column - header.column),
      )[0]?.value,
  );
}

function standaloneTables(
  sheet: AnalysedSheet,
): Array<{ target: BusTarget; route: BusRoute }> {
  const at = values(sheet);
  const masters = sheet.cells.filter(isMaster);
  const regionalHeaderKeys = new Set(
    masters
      .filter((cell) => /지역.*등교/.test(clean(cell.value)))
      .flatMap((heading) =>
        masters
          .filter(
            (cell) =>
              cell.column === heading.column &&
              cell.row > heading.row &&
              cell.row <= heading.row + 4 &&
              clean(cell.value) === "정류장",
          )
          .map((cell) => key(cell.row, cell.column)),
      ),
  );
  const routes: Array<{ target: BusTarget; route: BusRoute }> = [];
  for (const header of masters.filter(
    (cell) =>
      /^(정류장|승차장소)$/.test(clean(cell.value)) &&
      !regionalHeaderKeys.has(key(cell.row, cell.column)),
  )) {
    const title = nearestTitle(sheet, header);
    if (!title) continue;
    if (clean(header.value) === "승차장소" && !/통학.*셔틀버스/.test(title))
      continue;
    const tripColumns: Array<{ column: number; label: string }> = [];
    const tripHeaders = masters
      .filter(
        (cell) =>
          cell.row === header.row &&
          cell.column > header.column &&
          cell.column <= header.column + 8,
      )
      .sort((left, right) => left.column - right.column);
    for (const tripHeader of tripHeaders) {
      const sourceLabel = clean(tripHeader.value);
      const declaredCount = Number(
        sourceLabel.match(/(?:등교|하교)\s*(\d+)회/)?.[1] ?? 1,
      );
      for (let offset = 0; offset < declaredCount; offset += 1) {
        const column = tripHeader.column + offset;
        const hasValue = Array.from({ length: 30 }, (_, rowOffset) =>
          arrival(at.get(key(header.row + 1 + rowOffset, column))),
        ).some(Boolean);
        if (!hasValue) continue;
        const label =
          declaredCount > 1
            ? sourceLabel.replace(/\d+회/, `${offset + 1}회`)
            : sourceLabel;
        tripColumns.push({ column, label });
      }
    }
    if (!tripColumns.length) continue;
    // "등교 1회"/"하교 2회"처럼 방향이 라벨에 섞여 있으면 "N회(방향)"로
    // 바꾸고, 방향과 무관하게 표에 나온 순서대로 번호를 새로 매긴다(등교
    // 1·2회 다음 하교가 3·4회로 이어짐) — KOIN Admin API가 회차명 끝의
    // "(...)"만 방향(detail)으로 떼어내므로 이 포맷이어야 방향이 산다.
    for (const [index, trip] of tripColumns.entries()) {
      const direction = trip.label.match(/(등교|하교)/)?.[1];
      trip.label = `${index + 1}회${direction ? `(${direction})` : ""}`;
    }
    const rowCandidates: Array<{ row: number; name: string }> = [];
    let empty = 0;
    for (let row = header.row + 1; row < header.row + 35; row += 1) {
      const name = clean(at.get(key(row, header.column)));
      const hasArrival = tripColumns.some(
        (trip) => arrival(at.get(key(row, trip.column))) !== undefined,
      );
      if (!name && !hasArrival) {
        if (++empty >= 2 && rowCandidates.length) break;
        continue;
      }
      empty = 0;
      if (/^(운행기간|.*시간표|.*셔틀버스)$/.test(name) && rowCandidates.length)
        break;
      if (name) rowCandidates.push({ row, name });
    }
    const target: BusTarget = /셔틀|통학버스|대학원/.test(title)
      ? "shuttle"
      : "commuting";
    // "등교 1회"/"하교 2회"처럼 방향이 라벨에 섞여 있어도 회차마다 별도
    // 노선으로 쪼개지 않는다. "천안 셔틀"의 "토요일 오후"/"일요일 야간"
    // 회차들처럼, 한 제목 아래 여러 회차(왕복 포함)를 route_info 배열
    // 하나에 순서대로 담는 게 이 시트의 원래 표기 방식이다.
    const usedRows = rowCandidates.filter((row) =>
      tripColumns.some(
        (trip) => arrival(at.get(key(row.row, trip.column))) !== undefined,
      ),
    );
    if (usedRows.length) {
      // 통학(commuting) 표는 요일 표기가 원문에 없으면 평일 운행이 기본값이다
      // (regionalMatrices의 통학 노선도 같은 기본값을 쓴다). 셔틀 표는 표 자체가
      // 특정 요일 전용(토요일 등)일 때만 이 표를 타므로 강제하지 않는다.
      const defaultDays =
        target === "commuting" ? [...WEEKDAYS] : undefined;
      const direction = target === "shuttle" ? "셔틀" : sourceDirection(title);
      // KOIN 사이트는 route_type이 WEEKDAYS(통학)인 노선의 등교/하교를
      // route_info[].name이 정확히 "등교"/"하교"인지로 구분한다. 셔틀은
      // 이 규칙 대상이 아니라 원래 라벨(trip.label)을 그대로 쓴다.
      const routeInfo = tripColumns
        .map((trip) => ({
          name: target === "commuting" ? direction : trip.label,
          ...((sourceDays(title) ?? defaultDays)
            ? { running_days: sourceDays(title) ?? defaultDays }
            : {}),
          arrival_time: usedRows.map(
            (row) => arrival(at.get(key(row.row, trip.column))) ?? null,
          ),
        }))
        .filter((info) => info.arrival_time.some((value) => value !== null));
      if (routeInfo.length) {
        routes.push({
          target,
          route: {
            region:
              sourceRegion(`${title} ${usedRows.map((row) => row.name).join(" ")}`) ??
              "천안",
            route_type: direction,
            route_name: shuttleRouteName(sheet, header, title),
            node_info: usedRows.map((row) => ({ name: row.name })),
            route_info: routeInfo,
          },
        });
      }
    }
  }
  return routes;
}

function seoulGrids(
  sheet: AnalysedSheet,
): Array<{ target: BusTarget; route: BusRoute }> {
  const at = values(sheet);
  const routes: Array<{ target: BusTarget; route: BusRoute }> = [];
  for (const header of sheet.cells.filter(
    (cell) => isMaster(cell) && clean(cell.value) === "노선",
  )) {
    const title = clean(
      sheet.cells
        .filter(
          (cell) =>
            cell.row < header.row &&
            cell.row >= header.row - 5 &&
            /서울/.test(clean(cell.value)),
        )
        .sort((left, right) => right.row - left.row)[0]?.value,
    );
    if (!title) continue;
    const tripColumns = Array.from(
      { length: 8 },
      (_, index) => header.column + 1 + index,
    ).filter((column) =>
      /호차|월|화|수|목|금/.test(clean(at.get(key(header.row, column)))),
    );
    let tableEnd = header.row + 12;
    for (let row = header.row + 1; row < header.row + 12; row += 1) {
      const unsupported = tripColumns.some((column) => {
        const raw = at.get(key(row, column));
        return !isBlank(raw) && arrival(raw) === undefined;
      });
      if (unsupported) {
        tableEnd = row;
        break;
      }
    }
    // "교대 출발"/"동천 출발"은 배차가 어디서 출발하는 차량인지 적어둔
    // 것일 뿐, 학생 입장에선 같은 서울 노선의 1·2·3호차다. 노선을 가르지
    // 않고 표에 나온 컬럼 순서 그대로 한 노선에 담는다.
    const nodeRows: Array<{ row: number; name: string }> = [];
    for (let row = header.row + 1; row < tableEnd; row += 1) {
      const name = clean(at.get(key(row, header.column)));
      if (!name) continue;
      const hasAny = tripColumns.some(
        (column) => arrival(at.get(key(row, column))) !== undefined,
      );
      if (hasAny) nodeRows.push({ row, name });
    }
    if (nodeRows.length) {
      const routeInfo = tripColumns
        .map((column) => {
          const label = clean(at.get(key(header.row, column)));
          return {
            // KOIN 사이트는 route_type이 WEEKDAYS(통학)인 노선의 등교/하교를
            // route_info[].name이 정확히 "등교"/"하교"인지로 구분한다.
            name: "등교",
            ...(sourceDays(label) ? { running_days: sourceDays(label) } : {}),
            arrival_time: nodeRows.map(
              (row) => arrival(at.get(key(row.row, column))) ?? null,
            ),
          };
        })
        .filter((info) => info.arrival_time.some((value) => value !== null));
      if (routeInfo.length) {
        routes.push({
          target: "commuting",
          route: {
            region: "서울",
            route_type: "등교",
            route_name: "서울",
            node_info: nodeRows.map((row) => ({ name: row.name })),
            route_info: routeInfo,
          },
        });
      }
    }
  }
  return routes;
}

const MULTI_DEPARTURE = /(\d{1,2}:\d{2})\(([^)]+)\)/g;

/**
 * 서울 하교처럼 "노선"/"정류장" 헤더 없이, 출발 정류장 한 칸에 요일별 출발
 * 여러 회차가 "14:10(금), 16:10(금), 18:10(월~금)"처럼 쉼표로 뭉쳐 있고
 * 그 아래 정류장들은 전부 "하차"만 적힌 표를 읽는다. 뒤 정류장들은 회차별
 * 도착시각이 원문에 따로 없으니 모든 회차가 같은 "하차" 값을 공유한다.
 */
function seoulReturnRoutes(
  sheet: AnalysedSheet,
): Array<{ target: BusTarget; route: BusRoute }> {
  const at = values(sheet);
  const routes: Array<{ target: BusTarget; route: BusRoute }> = [];
  for (const anchor of sheet.cells.filter(
    (cell) =>
      isMaster(cell) &&
      typeof cell.value === "string" &&
      [...cell.value.matchAll(MULTI_DEPARTURE)].length >= 2,
  )) {
    const nearbySeoul = sheet.cells.some(
      (cell) =>
        cell.row < anchor.row &&
        cell.row >= anchor.row - 15 &&
        /서울/.test(clean(cell.value)),
    );
    if (!nearbySeoul) continue;
    const originCell = sheet.cells
      .filter((cell) => cell.row === anchor.row && cell.column < anchor.column)
      .sort((left, right) => right.column - left.column)[0];
    if (!originCell) continue;
    const nameColumn = originCell.column;
    const nodes: Array<{ row: number; name: string }> = [
      { row: anchor.row, name: clean(originCell.value) },
    ];
    for (let row = anchor.row + 1; row < anchor.row + 15; row += 1) {
      const name = clean(at.get(key(row, nameColumn)));
      if (!name || /^(운행기간|★|.*시간표|.*셔틀버스)/.test(name)) break;
      nodes.push({ row, name });
    }
    if (nodes.length < 2) continue;
    const dispatches = [...String(anchor.value).matchAll(MULTI_DEPARTURE)];
    // KOIN 사이트는 route_type이 WEEKDAYS(통학)인 노선의 등교/하교를
    // route_info[].name이 정확히 "등교"/"하교"인지로 구분한다.
    const routeInfo = dispatches.map((match) => ({
      name: "하교",
      ...(sourceDays(match[2]) ? { running_days: sourceDays(match[2]) } : {}),
      arrival_time: [
        match[1],
        ...nodes
          .slice(1)
          .map((node) => arrival(at.get(key(node.row, anchor.column))) ?? null),
      ],
    }));
    routes.push({
      target: "commuting",
      route: {
        region: "서울",
        route_type: "하교",
        route_name: "서울",
        node_info: nodes.map((node) => ({ name: node.name })),
        route_info: routeInfo,
      },
    });
  }
  return routes;
}

function timeParts(text: string): string[] {
  return [...text.matchAll(/(?<!\d)([0-2]?\d)(?:시|:)([0-5]\d)?/g)].map(
    (match) =>
      `${match[1].padStart(2, "0")}:${(match[2] ?? "00").padStart(2, "0")}`,
  );
}

function arrowTextRoutes(
  sheet: AnalysedSheet,
): Array<{ target: BusTarget; route: BusRoute }> {
  const routes: Array<{ target: BusTarget; route: BusRoute }> = [];
  for (const pathCell of sheet.cells.filter(
    (cell) =>
      isMaster(cell) &&
      typeof cell.value === "string" &&
      cell.value.includes("→"),
  )) {
    const label = clean(pathCell.value);
    const path = label.replace(/^\([^)]*\)/, "");
    if (/^\d/.test(path)) continue;
    const nodes = path.split("→").map(clean).filter(Boolean);
    if (nodes.length < 2) continue;
    const timeText = clean(
      sheet.cells.find(
        (cell) =>
          cell.row === pathCell.row &&
          cell.column > pathCell.column &&
          cell.column <= pathCell.column + 5 &&
          /\d{1,2}(?:시|:)/.test(clean(cell.value)),
      )?.value,
    );
    if (!timeText) continue;
    const perNode = timeText.includes("→")
      ? timeText.split("→").map(timeParts)
      : [timeParts(timeText), ...nodes.slice(1).map(() => [])];
    const tripCount = Math.max(...perNode.map((times) => times.length));
    const region = sourceRegion(`${label} ${nodes.join(" ")}`);
    if (!region || !tripCount) continue;
    const days = sourceDays(label);
    // KOIN Admin API의 통학(commuting) route_type은 "주중" 고정이고
    // running_days는 API로 보내지도 않는다(검수 전용). "일요일에만 등교",
    // "금요일에만 하교"처럼 특정 요일 하나로만 도는 노선은 이 요일 제한이
    // sub_name(=route_name 끝 괄호)으로만 살아남는다 — 안 붙이면 조용히
    // 사라진다.
    const dayLabel = days?.length === 1 ? KOREAN_DAY[days[0]] : undefined;
    const direction = /대학|본교/.test(nodes[0]) ? "하교" : "등교";
    routes.push({
      target: "commuting",
      route: {
        region,
        route_type: direction,
        route_name: dayLabel ? `${region}(${dayLabel})` : region,
        node_info: nodes.map((name) => ({ name })),
        // KOIN 사이트는 route_type이 WEEKDAYS(통학)인 노선의 등교/하교를
        // route_info[].name이 정확히 "등교"/"하교"인지로 구분한다.
        route_info: Array.from({ length: tripCount }, (_, index) => ({
          name: direction,
          ...(days ? { running_days: days } : {}),
          arrival_time: nodes.map(
            (_, nodeIndex) => perNode[nodeIndex]?.[index] ?? null,
          ),
        })),
      },
    });
  }
  return routes;
}

function unique(routes: Array<{ target: BusTarget; route: BusRoute }>) {
  const seen = new Set<string>();
  return routes.filter(({ target, route }) => {
    const signature = JSON.stringify([
      target,
      route.region,
      route.route_type,
      route.route_name,
      route.node_info,
      route.route_info,
    ]);
    if (seen.has(signature)) return false;
    seen.add(signature);
    return true;
  });
}

/** Parses layouts by semantic headings, merged ranges and time-bearing columns; no fixed row numbers. */
export function parseStructuredWorkbook(workbook: AnalysedWorkbook) {
  return unique(
    workbook.sheets.flatMap((sheet) => [
      ...regionalMatrices(sheet),
      ...standaloneTables(sheet),
      ...seoulGrids(sheet),
      ...seoulReturnRoutes(sheet),
      ...arrowTextRoutes(sheet),
    ]),
  );
}
