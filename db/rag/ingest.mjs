// ingest.mjs — 저장소 자체 문서(README·CLAUDE·계획서·기능명세서)를 source='manual'로 (재)적재.
// ⚠️ 자기 출처(manual)만 지우고 다시 넣음 — 다른 출처(notion/gdrive/github)는 절대 안 건드림.
// 실행(로컬, SSH 터널 전제: Ollama 11434, Postgres 5544):
//   OLLAMA_BASE_URL=http://localhost:11434 PGPORT=5544 PGPASSWORD=... PGDATABASE=bbot \
//     node db/rag/ingest.mjs
import pg from "pg";
import { readFileSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const OLLAMA = process.env.OLLAMA_BASE_URL ?? "http://localhost:11434";
const EMBED_MODEL = "bge-m3";

// PoC 코퍼스: 온보딩/도메인 질문에 답할 수 있는 프로젝트 문서
const FILES = ["README.md", "CLAUDE.md", "docs/계획서.md", "docs/기능명세서.md"];

const PG = {
  host: process.env.PGHOST ?? "127.0.0.1",
  port: Number(process.env.PGPORT ?? 5544),
  user: process.env.PGUSER ?? "postgres",
  password: process.env.PGPASSWORD,
  database: process.env.PGDATABASE ?? "bbot",
};

// chunk.ts와 동일 로직(헤딩 breadcrumb 인식)
function cleanMarkdown(md) {
  return md
    .replace(/<summary[^>]*>\s*<h([1-6])[^>]*>([\s\S]*?)<\/h\1>\s*<\/summary>/gi, "\n### $2\n")
    .replace(/<h([1-6])[^>]*>([\s\S]*?)<\/h\1>/gi, "\n### $2\n")
    .replace(/<summary[^>]*>([\s\S]*?)<\/summary>/gi, "\n### $1\n")
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, (_m, alt) =>
      /^(image|img|screenshot|배너|이미지)?$/i.test((alt || "").trim()) ? " " : ` ${alt} `)
    .replace(/<img[^>]*>/gi, " ")
    .replace(/<\/?[a-zA-Z][^>]*>/g, " ")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/^\s*\|?[\s:|-]+\|?\s*$/gm, "")
    .replace(/\|/g, " ")
    .replace(/^\s*>+\s?/gm, "")
    .replace(/`{1,3}/g, "")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/\n{3,}/g, "\n\n");
}

// 긴 세그먼트를 size 창으로 오버랩 분할
function windows(s, size, overlap) {
  if (s.length <= size) return [s];
  const out = [];
  for (let i = 0; i < s.length; i += size - overlap) out.push(s.slice(i, i + size));
  return out;
}

// 헤딩 경로를 추적하며 청크 앞에 breadcrumb를 붙임
function chunk(text, size = 350, overlap = 80) {
  const lines = cleanMarkdown(text).split("\n");
  const out = [];
  const crumb = [];
  let buf = [];
  let head = "";
  const breadcrumb = () => crumb.filter(Boolean).join(" › ");
  const flush = () => {
    const body = buf.join("\n").trim();
    buf = [];
    if (!body) return;
    const prefix = head ? head + "\n" : "";
    let cur = "";
    for (const seg of body.split(/\n\s*\n/).map((x) => x.trim()).filter(Boolean)) {
      for (const piece of windows(seg, size, overlap)) {
        if (cur && (cur + "\n" + piece).length > size) { out.push(prefix + cur); cur = piece; }
        else cur = cur ? cur + "\n" + piece : piece;
      }
    }
    if (cur) out.push(prefix + cur);
  };
  for (const line of lines) {
    const m = /^(#{1,6})\s+(.*)$/.exec(line.trim());
    if (m) {
      flush();
      const lvl = m[1].length;
      crumb.length = lvl - 1;
      crumb[lvl - 1] = m[2].trim();
      head = breadcrumb();
      continue;
    }
    if (buf.length === 0) head = breadcrumb();
    buf.push(line);
  }
  flush();
  return out.map((c) => c.trim()).filter((c) => c.length > 15);
}

async function embed(text) {
  const r = await fetch(`${OLLAMA}/api/embeddings`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ model: EMBED_MODEL, prompt: text }),
  });
  if (!r.ok) throw new Error(`embed ${r.status}`);
  return (await r.json()).embedding;
}

// src/services/rag/classify.ts와 동일(휴리스틱 doc_type). 앱과 일치시켜 재랭킹 보존.
const DATE_RE = /(^|\s)\d{2,4}[.\-/]\s?\d{1,2}[.\-/]\s?\d{1,2}/;
function classifyDocType(source, title) {
  if (source === "github") return "readme";
  const t = (title || "").trim();
  if (/인수인계/.test(t)) return "handover";
  if (/영수증|결제|서버비|사용비|지원|회비|거래내역|사업자|환급|정산|과금|비용|납부|결산/.test(t)) return "finance";
  if (/역기획서|기획서|차시|주차|보고서|과제|제출|템플릿/.test(t)) return "personal_work";
  if (/커리큘럼|온보딩|가이드|시작하기|문서화|컨벤션|규칙|회칙|셋업|setup|환경\s*설정|아키텍처|명세/i.test(t)) return "guide";
  if (DATE_RE.test(t) || /회의|주간\s*공유|월간\s*공유|미팅|회고|standup|스크럼|monthly|weekly/i.test(t)) return "meeting";
  return "doc";
}

async function main() {
  const pc = new pg.Client(PG);
  await pc.connect();
  // ⚠️ 자기 출처(manual)만 정리 — 다른 커넥터(notion/gdrive/github) 코퍼스는 보존.
  await pc.query("DELETE FROM document_chunk WHERE source = 'manual'");
  let total = 0;
  for (const rel of FILES) {
    const abs = join(ROOT, rel);
    let raw, mtime;
    try { raw = readFileSync(abs, "utf8"); mtime = statSync(abs).mtime; }
    catch { console.log(`(건너뜀: ${rel} 없음)`); continue; }
    const docType = classifyDocType("manual", rel);
    const chunks = chunk(raw);
    for (const c of chunks) {
      const vec = await embed(c);
      await pc.query(
        `INSERT INTO document_chunk(source, source_url, project, title, content, embedding, doc_type, updated_at)
         VALUES('manual', $1, 'bbot', $2, $3, $4::vector, $5, $6)`,
        [`repo:${rel}`, rel, c, `[${vec.join(",")}]`, docType, mtime],
      );
      total++;
    }
    console.log(`✓ ${rel}: ${chunks.length} 청크 (${docType})`);
  }
  const { rows } = await pc.query("SELECT COUNT(*)::int n FROM document_chunk");
  console.log(`적재 완료: ${rows[0].n} 청크`);
  await pc.end();
}

main().catch((e) => { console.error("✗", e); process.exit(1); });
