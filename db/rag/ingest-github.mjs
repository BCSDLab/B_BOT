// ingest-github.mjs — GitHub 공개 레포 README + 언어 구성 → 청킹 → bge-m3 → document_chunk
// 즉시 적재용(로컬에서 SSH 터널 전제: Ollama 11434/11500, Postgres 5544). 봇 TS 커넥터와 동일 로직.
//   OLLAMA_BASE_URL=http://localhost:11434 PGPORT=5544 PGPASSWORD=... PGDATABASE=bbot \
//     node db/rag/ingest-github.mjs
import pg from "pg";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const { owner, repos, desc } = JSON.parse(readFileSync(join(ROOT, "src/constant/RAG_REPOS.json"), "utf8"));
const OLLAMA = process.env.OLLAMA_BASE_URL ?? "http://localhost:11434";

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
function windows(s, size, overlap) {
  if (s.length <= size) return [s];
  const out = [];
  for (let i = 0; i < s.length; i += size - overlap) out.push(s.slice(i, i + size));
  return out;
}
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
async function fetchLanguages(repo) {
  const r = await fetch(`https://api.github.com/repos/${owner}/${repo}/languages`, {
    headers: { "User-Agent": "b-bot", Accept: "application/vnd.github+json" },
  }).catch(() => null);
  if (!r || !r.ok) return null;
  return await r.json();
}
function languageChunk(langs) {
  if (!langs) return null;
  const entries = Object.entries(langs).sort((a, b) => b[1] - a[1]);
  if (entries.length === 0) return null;
  const total = entries.reduce((s, [, v]) => s + v, 0) || 1;
  const list = entries.map(([k, v]) => `${k} ${Math.round((v / total) * 100)}%`).join(", ");
  // prefix(프로젝트 X — desc)는 적재 시 붙으므로 여기선 본문만.
  return `기술스택 / 사용 언어 구성(GitHub 기준): ${list}`;
}

async function main() {
  const pc = new pg.Client(PG);
  await pc.connect();
  let okRepos = 0, totalChunks = 0; const skipped = [];
  for (const repo of repos) {
    const r = await fetchReadme(repo).catch(() => null);
    if (!r || !r.text.trim()) { skipped.push(repo); continue; }
    await pc.query("DELETE FROM document_chunk WHERE source='github' AND project=$1", [repo]);
    const d = desc?.[repo] ?? repo;
    const pre = `프로젝트 ${repo} — ${d}\n`;
    const langChunk = languageChunk(await fetchLanguages(repo));
    const pieces = [...chunk(r.text), ...(langChunk ? [langChunk] : [])];
    for (const c of pieces) {
      const body = pre + c;
      const vec = await embed(body);
      await pc.query(
        `INSERT INTO document_chunk(source, source_url, project, title, content, embedding)
         VALUES('github', $1, $2, $3, $4, $5::vector)`,
        [r.url, repo, `${repo} README`, body, `[${vec.join(",")}]`],
      );
    }
    okRepos++; totalChunks += pieces.length;
    console.log(`✓ ${repo}: ${pieces.length} 청크`);
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
