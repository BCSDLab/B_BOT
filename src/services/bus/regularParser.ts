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
      if (!label || !rowValues.some((value) => value !== undefined)) continue;
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
    for (const trip of tripColumns) {
      const selected = rowCandidates
        .map((row) => ({
          ...row,
          value: arrival(at.get(key(row.row, trip.column))),
        }))
        .filter(
          (row): row is typeof row & { value: ArrivalTime } =>
            row.value !== undefined,
        );
      if (!selected.length) continue;
      const normalizedLabel = trip.label;
      const direction = target === "shuttle" ? "셔틀" : sourceDirection(title);
      routes.push({
        target,
        route: {
          region:
            sourceRegion(
              `${title} ${selected.map((row) => row.name).join(" ")}`,
            ) ?? "천안",
          route_type: direction,
          route_name:
            tripColumns.length === 1 &&
            /^(1회|예정시간|시간)$/.test(normalizedLabel)
              ? title
              : `${title} ${normalizedLabel}`,
          node_info: selected.map((row) => ({ name: row.name })),
          route_info: [
            {
              name: normalizedLabel,
              ...(sourceDays(title) ? { running_days: sourceDays(title) } : {}),
              arrival_time: selected.map((row) => row.value),
            },
          ],
        },
      });
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
    for (const column of tripColumns) {
      const label = clean(at.get(key(header.row, column)));
      const nodes: Array<{ name: string; time: ArrivalTime }> = [];
      for (let row = header.row + 1; row < tableEnd; row += 1) {
        const name = clean(at.get(key(row, header.column)));
        const time = arrival(at.get(key(row, column)));
        if (name && time) nodes.push({ name, time });
      }
      if (!nodes.length) continue;
      routes.push({
        target: "commuting",
        route: {
          region: "서울",
          route_type: "등교",
          route_name: `서울 ${label}`,
          node_info: nodes.map((node) => ({ name: node.name })),
          route_info: [
            {
              name: "등교",
              ...(sourceDays(label) ? { running_days: sourceDays(label) } : {}),
              arrival_time: nodes.map((node) => node.time),
            },
          ],
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
