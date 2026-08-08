import { describe, expect, it } from "vitest";
import { findSpreadsheetFile } from "~/utils/slackFile";

const file = (name: string, filetype: string) => ({
  id: "F1",
  name,
  filetype,
  size: 100,
});

describe("스프레드시트 첨부 파일", () => {
  it("지원 형식만 고른다", () => {
    expect(findSpreadsheetFile([file("시간표.xls", "binary")])?.name).toBe(
      "시간표.xls",
    );
    expect(findSpreadsheetFile([file("시간표.xlsx", "xlsx")])?.name).toBe(
      "시간표.xlsx",
    );
    expect(findSpreadsheetFile([file("시간표.csv", "csv")])?.name).toBe(
      "시간표.csv",
    );
    expect(findSpreadsheetFile([file("시간표.pdf", "pdf")])).toBeNull();
    expect(findSpreadsheetFile([file("사진.png", "png")])).toBeNull();
  });
});
