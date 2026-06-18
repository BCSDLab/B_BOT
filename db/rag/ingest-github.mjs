// ingest-github.mjs — GitHub 공개 레포 README → 청킹 → bge-m3 임베딩 → document_chunk
// 즉시 적재용(로컬에서 SSH 터널 전제: Ollama 11434, Postgres 5544). 봇 TS 커넥터와 동일 로직.
//   OLLAMA_BASE_URL=http://localhost:11434 PGPORT=5544 PGPASSWORD=... PGDATABASE=bbot \
//     node db/rag/ingest-github.mjs
import pg from "pg";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const { owner, repos } = JSON.parse(readFileSync(join(ROOT, "src/constant/RAG_REPOS.json"), "utf8"));
const OLLAMA = process.env.OLLAMA_BASE_URL ?? "http://localhost:11434";

const PG = {
  host: process.env.PGHOST ?? "127.0.0.1",
  port: Number(process.env.PGPORT ?? 5544),
  user: process.env.PGUSER ?? "postgres",
  password: process.env.PGPASSWORD,
  database: process.env.PGDATABASE ?? "bbot",
};

function cleanMarkdown(md) {
  return md
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
function windows(s, size, overlap) {
  if (s.length <= size) return [s];
  const out = [];
  for (let i = 0; i < s.length; i += size - overlap) out.push(s.slice(i, i + size));
  return out;
}
function chunk(text, size = 350, overlap = 80) {
  const segs = cleanMarkdown(text).split(/\n\s*\n/).map((x) => x.trim()).filter(Boolean);
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
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ model: "bge-m3", prompt: text }),
  });
  return (await r.json()).embedding;
}
async function fetchReadme(repo) {
  const r = await fetch(`https://api.github.com/repos/${owner}/${repo}/readme`, {
    headers: { "User-Agent": "b-bot", Accept: "application/vnd.github+json" },
  });
  if (!r.ok) return null;
  const j = await r.json();
  if (!j.content) return null;
  return { text: Buffer.from(j.content, "base64").toString("utf8"), url: j.html_url };
}

async function main() {
  const pc = new pg.Client(PG);
  await pc.connect();
  let okRepos = 0, totalChunks = 0; const skipped = [];
  for (const repo of repos) {
    const r = await fetchReadme(repo).catch(() => null);
    if (!r || !r.text.trim()) { skipped.push(repo); continue; }
    await pc.query("DELETE FROM document_chunk WHERE source='github' AND project=$1", [repo]);
    const chunks = chunk(r.text);
    for (const c of chunks) {
      const vec = await embed(c);
      await pc.query(
        `INSERT INTO document_chunk(source, source_url, project, title, content, embedding)
         VALUES('github', $1, $2, $3, $4, $5::vector)`,
        [r.url, repo, `${repo} README`, c, `[${vec.join(",")}]`],
      );
    }
    okRepos++; totalChunks += chunks.length;
    console.log(`✓ ${repo}: ${chunks.length} 청크`);
  }
  await pc.query(
    `INSERT INTO sync_cursor(connector, last_edited_at, updated_at) VALUES('github', now(), now())
     ON CONFLICT (connector) DO UPDATE SET last_edited_at=now(), updated_at=now()`,
  );
  const { rows } = await pc.query("SELECT COUNT(*)::int n FROM document_chunk WHERE source='github'");
  console.log(`\n완료: ${okRepos}개 레포 / github 청크 ${rows[0].n}개` + (skipped.length ? ` / 건너뜀: ${skipped.join(", ")}` : ""));
  await pc.end();
}
main().catch((e) => { console.error("✗", e); process.exit(1); });
