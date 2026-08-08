import { describe, expect, it } from "vitest";
import { findBusTimetableFile } from "~/services/bus/slackAttachment";

const file = (name: string, filetype: string) => ({
  id: "F1",
  name,
  filetype,
  size: 100,
});

describe("버스 시간표 첨부 파일", () => {
  it("지원 형식만 고른다", () => {
    expect(findBusTimetableFile([file("시간표.xls", "binary")])?.name).toBe(
      "시간표.xls",
    );
    expect(findBusTimetableFile([file("시간표.xlsx", "xlsx")])?.name).toBe(
      "시간표.xlsx",
    );
    expect(findBusTimetableFile([file("시간표.csv", "csv")])?.name).toBe(
      "시간표.csv",
    );
    expect(findBusTimetableFile([file("시간표.pdf", "pdf")])).toBeNull();
    expect(findBusTimetableFile([file("사진.png", "png")])).toBeNull();
  });
});
