import type {
  AnalysedCell,
  AnalysedSheet,
  AnalysedWorkbook,
} from "./excelAnalyzer";
import type { ArrivalTime, BusRoute, BusTarget } from "./types";
import { normalizeTime } from "./validation";
import { sourceDays, WEEKDAYS } from "./days";

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
      const routeInfo: BusRoute["route_info"] = hasJoined
        ? splitColumnTrip(column.label, values, column.heading).map(
            (trip, index) => ({
              name: `${index + 1}회`,
              running_days: [...WEEKDAYS] as BusRoute["route_info"][number]["running_days"],
              arrival_time: trip.arrival_time,
            }),
          )
        : [
            {
              name: "1회",
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
      const routeInfo = tripColumns
        .map((trip) => ({
          name: trip.label,
          ...(sourceDays(title) ? { running_days: sourceDays(title) } : {}),
          arrival_time: usedRows.map(
            (row) => arrival(at.get(key(row.row, trip.column))) ?? null,
          ),
        }))
        .filter((info) => info.arrival_time.some((value) => value !== null));
      if (routeInfo.length) {
        const direction = target === "shuttle" ? "셔틀" : sourceDirection(title);
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
    // "교대 출발"/"동천 출발"처럼 회차 헤더 한 줄 위에 출발지가 따로 있으면,
    // 그 출발지가 같은 회차들(예: 월(1호차)/월(2호차)/화~금)은 한 노선으로
    // 묶는다. 출발지 표기가 없는 파일은 기존처럼 회차 컬럼마다 별도 노선을
    // 유지한다(출발지가 없으면 컬럼별로 서로 다른 그룹 키를 준다).
    const originRow = header.row - 1;
    const groups = new Map<string, { origin: string | null; columns: number[] }>();
    for (const column of tripColumns) {
      const origin = clean(at.get(key(originRow, column))) || null;
      const groupKey = origin ?? `column:${column}`;
      const group = groups.get(groupKey) ?? { origin, columns: [] };
      group.columns.push(column);
      groups.set(groupKey, group);
    }
    for (const { origin, columns } of groups.values()) {
      const nodeRows: Array<{ row: number; name: string }> = [];
      for (let row = header.row + 1; row < tableEnd; row += 1) {
        const name = clean(at.get(key(row, header.column)));
        if (!name) continue;
        const hasAny = columns.some(
          (column) => arrival(at.get(key(row, column))) !== undefined,
        );
        if (hasAny) nodeRows.push({ row, name });
      }
      if (!nodeRows.length) continue;
      const routeInfo = columns
        .map((column) => {
          const label = clean(at.get(key(header.row, column)));
          return {
            name: label,
            ...(sourceDays(label) ? { running_days: sourceDays(label) } : {}),
            arrival_time: nodeRows.map(
              (row) => arrival(at.get(key(row.row, column))) ?? null,
            ),
          };
        })
        .filter((info) => info.arrival_time.some((value) => value !== null));
      if (!routeInfo.length) continue;
      routes.push({
        target: "commuting",
        route: {
          region: "서울",
          route_type: "등교",
          route_name: origin
            ? `서울 ${origin.replace(/\s*출발\s*$/, "")}`
            : `서울 ${routeInfo[0].name}`,
          node_info: nodeRows.map((row) => ({ name: row.name })),
          route_info: routeInfo,
        },
      });
    }
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
    routes.push({
      target: "commuting",
      route: {
        region,
        route_type: /대학|본교/.test(nodes[0]) ? "하교" : "등교",
        route_name: region,
        node_info: nodes.map((name) => ({ name })),
        route_info: Array.from({ length: tripCount }, (_, index) => ({
          name: `${index + 1}회`,
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
      ...arrowTextRoutes(sheet),
    ]),
  );
}
