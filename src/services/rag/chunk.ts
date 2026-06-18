// 마크다운/텍스트를 ~350자 청크로(문단 경계 + 긴 단락은 오버랩 분할).
// 작은 청크가 특정 사실을 독립 검색 단위로 만들어 RAG recall에 유리.

// 마크다운 노이즈 제거: 이미지·HTML 태그·링크 URL·표 구분선 → 텍스트만 남김.
// (README가 뱃지/아바타 이미지·HTML 표를 많이 써서, 정제 없이는 이름·기술명이 노이즈에 묻힘)
export function cleanMarkdown(md: string): string {
  return md
    // ![alt](url): 의미 있는 alt(예: 뱃지의 'Java')는 남기고 'Image' 같은 일반 alt는 제거
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, (_m, alt: string) =>
      /^(image|img|screenshot|배너|이미지)?$/i.test((alt || "").trim()) ? " " : ` ${alt} `,
    )
    .replace(/<img[^>]*>/gi, " ") // <img ...>
    .replace(/<\/?[a-zA-Z][^>]*>/g, " ") // 기타 HTML 태그(<details>,<summary>,<br/> 등)
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1") // [텍스트](url) → 텍스트(이름·링크명 보존)
    .replace(/^\s*\|?[\s:|-]+\|?\s*$/gm, "") // 표 구분선 | :--: |
    .replace(/\|/g, " ") // 남은 표 파이프 → 공백
    .replace(/^\s*>+\s?/gm, "") // blockquote 마커
    .replace(/`{1,3}/g, "") // 코드 펜스/인라인 백틱
    .replace(/[ \t]{2,}/g, " ") // 연속 공백 축소
    .replace(/\n{3,}/g, "\n\n"); // 연속 빈 줄 축소
}

function windows(s: string, size: number, overlap: number): string[] {
  if (s.length <= size) return [s];
  const out: string[] = [];
  for (let i = 0; i < s.length; i += size - overlap) out.push(s.slice(i, i + size));
  return out;
}

export function chunk(text: string, size = 350, overlap = 80): string[] {
  const segs = cleanMarkdown(text).split(/\n\s*\n/).map((x) => x.trim()).filter(Boolean);
  const chunks: string[] = [];
  let cur = "";
  for (const seg of segs) {
    for (const piece of windows(seg, size, overlap)) {
      if (cur && (cur + "\n" + piece).length > size) { chunks.push(cur); cur = piece; }
      else cur = cur ? cur + "\n" + piece : piece;
    }
  }
  if (cur) chunks.push(cur);
  return chunks.map((c) => c.trim()).filter((c) => c.length > 15);
}
