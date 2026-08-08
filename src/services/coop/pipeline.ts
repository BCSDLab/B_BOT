import type { StructuredImageMimeType } from "~/helper/adapter/structured";
import { convertRegularTimetable } from "./convert";
import { renderRegularCoopReview } from "./reviewHtml";
import type {
  CoopShopBaseline,
  RawRegularCoopTimetable,
  RegularConversionResult,
} from "./types";
import { extractRegularTimetable } from "./vision";

export interface RegularCoopArtifacts {
  conversion: RegularConversionResult;
  requestJson: string;
  reviewHtml: string;
}

export function buildRegularCoopArtifacts(
  raw: RawRegularCoopTimetable,
  baseline: CoopShopBaseline,
): RegularCoopArtifacts {
  const conversion = convertRegularTimetable(raw, baseline);
  return {
    conversion,
    requestJson: `${JSON.stringify(conversion.request, null, 2)}\n`,
    reviewHtml: renderRegularCoopReview(conversion),
  };
}

export async function convertRegularCoopImage({
  image,
  mimeType,
  fileName,
  baseline,
}: {
  image: ArrayBuffer | Uint8Array;
  mimeType: StructuredImageMimeType;
  fileName: string;
  baseline: CoopShopBaseline;
}): Promise<RegularCoopArtifacts> {
  const bytes = image instanceof Uint8Array ? image : new Uint8Array(image);
  if (bytes.byteLength === 0) {
    throw new Error("생협 시간표 이미지가 비어 있습니다.");
  }
  const raw = await extractRegularTimetable({
    imageBase64: Buffer.from(bytes).toString("base64"),
    mimeType,
    fileName,
  });
  return buildRegularCoopArtifacts(raw, baseline);
}
