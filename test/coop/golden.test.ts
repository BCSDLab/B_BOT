import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { buildRegularCoopArtifacts } from "~/services/coop/pipeline";
import type { CoopShopBaseline, RawRegularCoopTimetable } from "~/services/coop/types";

const fixture = (path: string) => fileURLToPath(new URL(`../fixtures/coop/${path}`, import.meta.url));
const readJson = async <T>(path: string): Promise<T> =>
  JSON.parse(await readFile(fixture(path), "utf8")) as T;

describe("2026-1학기 생협 시간표", () => {
  it("제공된 원본 이미지를 fixture로 보존한다", async () => {
    const image = await readFile(fixture("image/regular-2026-1.png"));
    expect(image.subarray(1, 4).toString()).toBe("PNG");
    expect(createHash("sha256").update(image).digest("hex"))
      .toBe("1d709ce248e451551f2e5c729107f860e0f1d3a1b9585620122541d9ededa82f");
  });

  it("11개 표준 매장 JSON과 카드 HTML을 만든다", async () => {
    const raw = await readJson<RawRegularCoopTimetable>("raw/regular-2026-1.json");
    const baseline = await readJson<CoopShopBaseline>("baseline/regular-2026-1.json");
    const artifacts = buildRegularCoopArtifacts(raw, baseline);
    const expectedJson = JSON.parse(await readFile(fixture("expected/regular-2026-1.json"), "utf8"));
    const expectedHtml = await readFile(fixture("expected/regular-2026-1.html"), "utf8");

    expect(artifacts.conversion.semester).toBe("26-1학기");
    expect(artifacts.conversion.fromDate).toBe("2026-03-03");
    expect(artifacts.conversion.toDate).toBe("2026-06-19");
    expect(artifacts.conversion.shops).toHaveLength(11);
    expect(artifacts.conversion.excludedShops).toHaveLength(3);
    expect(artifacts.conversion.issues.filter((issue) => issue.severity === "blocking"))
      .toHaveLength(0);
    expect(JSON.parse(artifacts.requestJson)).toEqual(expectedJson);
    expect(artifacts.reviewHtml).toBe(expectedHtml);
    expect(artifacts.reviewHtml.match(/<article class="card/g)).toHaveLength(11);
    expect(artifacts.reviewHtml).toContain("상세 검증");
  });
});
