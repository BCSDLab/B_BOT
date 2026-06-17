// 마크다운/텍스트를 ~350자 청크로(문단 경계 + 긴 단락은 오버랩 분할).
// 작은 청크가 특정 사실을 독립 검색 단위로 만들어 RAG recall에 유리.

function windows(s: string, size: number, overlap: number): string[] {
  if (s.length <= size) return [s];
  const out: string[] = [];
  for (let i = 0; i < s.length; i += size - overlap) out.push(s.slice(i, i + size));
  return out;
}

export function chunk(text: string, size = 350, overlap = 80): string[] {
  const segs = text.split(/\n\s*\n/).map((x) => x.trim()).filter(Boolean);
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
