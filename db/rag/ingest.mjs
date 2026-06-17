// ingest.mjs — RAG PoC: 문서 → 청킹 → bge-m3 임베딩 → document_chunk 적재
// 실행(로컬, SSH 터널 전제: Ollama 11434, Postgres 5544):
//   OLLAMA_BASE_URL=http://localhost:11434 PGPORT=5544 PGPASSWORD=... PGDATABASE=bbot \
//     node db/rag/ingest.mjs
import pg from "pg";
import { readFileSync } from "node:fs";
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

// 긴 세그먼트를 size 창으로 오버랩 분할
function windows(s, size, overlap) {
  if (s.length <= size) return [s];
  const out = [];
  for (let i = 0; i < s.length; i += size - overlap) out.push(s.slice(i, i + size));
  return out;
}

// 마크다운을 ~350자 청크로(문단 경계 + 긴 단락은 오버랩 분할)
function chunk(text, size = 350, overlap = 80) {
  const segs = text.split(/\n\s*\n/).map((x) => x.trim()).filter(Boolean);
  const chunks = [];
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

async function embed(text) {
  const r = await fetch(`${OLLAMA}/api/embeddings`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ model: EMBED_MODEL, prompt: text }),
  });
  if (!r.ok) throw new Error(`embed ${r.status}`);
  return (await r.json()).embedding;
}

async function main() {
  const pc = new pg.Client(PG);
  await pc.connect();
  await pc.query("TRUNCATE document_chunk RESTART IDENTITY");
  let total = 0;
  for (const rel of FILES) {
    let raw;
    try { raw = readFileSync(join(ROOT, rel), "utf8"); }
    catch { console.log(`(건너뜀: ${rel} 없음)`); continue; }
    const chunks = chunk(raw);
    for (const c of chunks) {
      const vec = await embed(c);
      await pc.query(
        `INSERT INTO document_chunk(source, source_url, project, title, content, embedding)
         VALUES('manual', $1, 'bbot', $2, $3, $4::vector)`,
        [`repo:${rel}`, rel, c, `[${vec.join(",")}]`],
      );
      total++;
    }
    console.log(`✓ ${rel}: ${chunks.length} 청크`);
  }
  const { rows } = await pc.query("SELECT COUNT(*)::int n FROM document_chunk");
  console.log(`적재 완료: ${rows[0].n} 청크`);
  await pc.end();
}

main().catch((e) => { console.error("✗", e); process.exit(1); });
