import { describe, expect, it } from "vitest";
import { toDataUrl, validateStructuredImages } from "~/helper/adapter/structured";
import { isRegularSemesterLabel } from "~/services/coop/vision";

describe("구조화 출력 이미지", () => {
  it("base64 이미지를 data URL로 만든다", () => {
    expect(toDataUrl({ data: "YWJj", mimeType: "image/png" }))
      .toBe("data:image/png;base64,YWJj");
  });

  it("빈 이미지를 거부한다", () => {
    expect(() => validateStructuredImages([{ data: " ", mimeType: "image/png" }]))
      .toThrow("이미지 데이터가 비어 있습니다");
  });
});

describe("정규학기 판별", () => {
  it.each(["2026-1학기", "26-2학기", "26.1학기"])("%s", (label) => {
    expect(isRegularSemesterLabel(label)).toBe(true);
  });

  it.each(["2026 하계방학", "26-여름학기", "", "2026-3학기"])("%s 거부", (label) => {
    expect(isRegularSemesterLabel(label)).toBe(false);
  });
});
