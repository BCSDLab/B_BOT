import type { SemesterType } from "./types";

/** Infer the payload semester only from an explicit source label; never guess dates. */
export function semesterFromSource(text: string): SemesterType | undefined {
  if (/정규학기|학기\s*중/.test(text)) return "REGULAR";
  if (/계절학기/.test(text)) return "SEASONAL";
  if (/방학/.test(text)) return "VACATION";
  return undefined;
}

/** REGULAR conversion must ignore the workbook's reference vacation sheet. */
export function sheetsForSemester(
  sheetNames: string[],
  semester: SemesterType,
) {
  if (semester === "REGULAR")
    return sheetNames.filter((name) => /학기\s*중/.test(name));
  return sheetNames.filter((name) =>
    semester === "SEASONAL" ? /계절/.test(name) : /방학/.test(name),
  );
}
