export type StructuredImageMimeType = "image/png" | "image/jpeg" | "image/webp" | "image/gif";

export interface StructuredImage {
  data: string;
  mimeType: StructuredImageMimeType;
}

export interface StructuredGenerationRequest {
  system: string;
  prompt: string;
  schema: Record<string, unknown>;
  images?: StructuredImage[];
  maxTokens?: number;
}

/** 외부 SDK에 넘기기 전에 잘못된 이미지 입력을 같은 규칙으로 거른다. */
export function validateStructuredImages(images: StructuredImage[] = []): StructuredImage[] {
  for (const image of images) {
    if (!image.data.trim()) {
      throw new Error("이미지 데이터가 비어 있습니다.");
    }
  }
  return images;
}

export function toDataUrl(image: StructuredImage): string {
  return `data:${image.mimeType};base64,${image.data}`;
}
