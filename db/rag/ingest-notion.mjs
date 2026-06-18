// ingest-notion.mjs — Notion 루트에서 트리 재귀 크롤 → 본문 있는 페이지/DB항목만 색인.
// 컬럼·토글·링크(link_to_page)·child_database(쿼리)까지 추적. 본문 없는 페이지는 0청크 스킵.
//   NOTION_TOKEN=ntn_... OLLAMA_BASE_URL=http://localhost:11500 PGPORT=5544 PGPASSWORD=... \
//     PGDATABASE=bbot node db/rag/ingest-notion.mjs [--root <id|url>] [--full] [--dry]
import pg from "pg";

const OLLAMA = process.env.OLLAMA_BASE_URL ?? "http://localhost:11434";
const TOKEN = process.env.NOTION_TOKEN;
const NOTION_VERSION = "2022-06-28";
const API = "https://api.notion.com/v1";
// 기본 루트: Regular(프로젝트·트랙 전부 하위에 있음)
const DEFAULT_ROOT = "396654620b1b4cbd9fcd6bdf93fdceb9";
const PG = {
  host: process.env.PGHOST ?? "127.0.0.1", port: Number(process.env.PGPORT ?? 5544),
  user: process.env.PGUSER ?? "postgres", password: process.env.PGPASSWORD,
  database: process.env.PGDATABASE ?? "bbot",
};
const headers = () => ({
  Authorization: `Bearer ${TOKEN}`, "Notion-Version": NOTION_VERSION, "Content-Type": "application/json",
});
const norm = (id) => (id || "").replace(/-/g, "");
const idFrom = (s) => (String(s).match(/[0-9a-f]{32}/i) || [s])[0];

// ── chunk.ts와 동일(헤딩 breadcrumb 인식) ──
function cleanMarkdown(md) {
  return md
    .replace(/<summary[^>]*>\s*<h([1-6])[^>]*>([\s\S]*?)<\/h\1>\s*<\/summary>/gi, "\n### $2\n")
    .replace(/<h([1-6])[^>]*>([\s\S]*?)<\/h\1>/gi, "\n### $2\n")
    .replace(/<summary[^>]*>([\s\S]*?)<\/summary>/gi, "\n### $1\n")
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, (_m, alt) =>
      /^(image|img|screenshot|배너|이미지)?$/i.test((alt || "").trim()) ? " " : ` ${alt} `)
    .replace(/<img[^>]*>/gi, " ").replace(/<\/?[a-zA-Z][^>]*>/g, " ")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1").replace(/^\s*\|?[\s:|-]+\|?\s*$/gm, "")
    .replace(/\|/g, " ").replace(/^\s*>+\s?/gm, "").replace(/`{1,3}/g, "")
    .replace(/[ \t]{2,}/g, " ").replace(/\n{3,}/g, "\n\n");
}
function windows(s, size, overlap) {
  if (s.length <= size) return [s];
  const out = []; for (let i = 0; i < s.length; i += size - overlap) out.push(s.slice(i, i + size));
  return out;
}
function chunk(text, size = 350, overlap = 80) {
  const lines = cleanMarkdown(text).split("\n");
  const out = []; const crumb = []; let buf = []; let head = "";
  const breadcrumb = () => crumb.filter(Boolean).join(" › ");
  const flush = () => {
    const body = buf.join("\n").trim(); buf = [];
    if (!body) return;
    const prefix = head ? head + "\n" : ""; let cur = "";
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
    if (m) { flush(); const lvl = m[1].length; crumb.length = lvl - 1; crumb[lvl - 1] = m[2].trim(); head = breadcrumb(); continue; }
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
const rt = (arr) => (arr ?? []).map((t) => t.plain_text ?? "").join("");
async function api(pathUrl, init, tries = 3) {
  for (let i = 0; i < tries; i++) {
    const r = await fetch(`${API}${pathUrl}`, { headers: headers(), ...init }).catch(() => null);
    if (r && r.ok) return await r.json();
    if (r && r.status === 429) { await new Promise((s) => setTimeout(s, 1000 * (i + 1))); continue; }
    return null;
  }
  return null;
}
function pageTitle(page) {
  for (const v of Object.values(page?.properties ?? {})) {
    if (v?.type === "title") return rt(v.title) || "제목 없음";
  }
  return "제목 없음";
}
function blockText(b) {
  const d = b[b.type]; const text = rt(d?.rich_text);
  switch (b.type) {
    case "heading_1": return `# ${text}`;
    case "heading_2": return `## ${text}`;
    case "heading_3": return `### ${text}`;
    case "bulleted_list_item": case "toggle": return `- ${text}`;
    case "numbered_list_item": return `1. ${text}`;
    case "to_do": return `- [${d?.checked ? "x" : " "}] ${text}`;
    case "quote": case "callout": return `> ${text}`;
    case "code": return `\n${text}\n`;
    case "table_row": return `| ${(d?.cells ?? []).map((c) => rt(c)).join(" | ")} |`;
    case "divider": return "---";
    default: return text;
  }
}
// 레이아웃 블록은 재귀, 페이지/DB 참조는 수집. {prose, pageIds, dbIds} 반환.
async function readBlocks(blockId, depth = 0) {
  const lines = []; const pageIds = []; const dbIds = [];
  if (depth > 8) return { prose: "", pageIds, dbIds };
  let cursor;
  do {
    const res = await api(`/blocks/${blockId}/children?page_size=100${cursor ? `&start_cursor=${cursor}` : ""}`);
    if (!res) break;
    for (const b of res.results) {
      if (b.type === "child_page") { pageIds.push(b.id); continue; }
      if (b.type === "child_database") { dbIds.push(b.id); continue; }
      if (b.type === "link_to_page") {
        const lp = b.link_to_page;
        if (lp?.type === "page_id") pageIds.push(lp.page_id);
        else if (lp?.type === "database_id") dbIds.push(lp.database_id);
        continue;
      }
      const t = blockText(b);
      if (t) lines.push(t);
      // 컬럼/토글/동기화 등 레이아웃 블록 안에 페이지·DB·본문이 중첩됨 → 재귀
      if (b.has_children) {
        const sub = await readBlocks(b.id, depth + 1);
        if (sub.prose) lines.push(sub.prose);
        pageIds.push(...sub.pageIds); dbIds.push(...sub.dbIds);
      }
    }
    cursor = res.has_more ? res.next_cursor : undefined;
  } while (cursor);
  return { prose: lines.join("\n"), pageIds, dbIds };
}

async function main() {
  if (!TOKEN) { console.error("✗ NOTION_TOKEN 미설정"); process.exit(1); }
  const argv = process.argv.slice(2);
  const DRY = argv.includes("--dry");
  const FULL = argv.includes("--full");
  const rootArg = argv[argv.indexOf("--root") + 1];
  const ROOT = idFrom(argv.includes("--root") && rootArg ? rootArg : DEFAULT_ROOT);

  const pc = DRY ? null : new pg.Client(PG);
  if (pc) await pc.connect();
  const runStart = new Date().toISOString();
  let cursor = 0;
  if (pc && !FULL) {
    const c = await pc.query("SELECT last_edited_at FROM sync_cursor WHERE connector='notion'");
    cursor = c.rows[0]?.last_edited_at ? new Date(c.rows[0].last_edited_at).getTime() : 0;
  }

  const visited = new Set();
  const seenUrls = [];
  let docs = 0, totalChunks = 0, scanned = 0, skippedEmpty = 0;

  async function crawlPage(pageId) {
    const key = norm(pageId);
    if (visited.has(key)) return false;
    visited.add(key);
    const page = await api(`/pages/${pageId}`);
    if (!page) return false;
    scanned++;
    if (scanned % 100 === 0) console.log(`  …진행: ${scanned}개 스캔, 문서 ${docs}개`);
    const { prose, pageIds, dbIds } = await readBlocks(pageId);
    const title = pageTitle(page);

    let hadBody = false;
    if (prose.trim()) {
      hadBody = true;
      seenUrls.push(page.url);
      const changed = !cursor || new Date(page.last_edited_time).getTime() > cursor;
      if (changed) {
        if (pc) await pc.query("DELETE FROM document_chunk WHERE source='notion' AND source_url=$1", [page.url]);
        const prefix = `노션 문서 — ${title}\n`;
        const chunks = chunk(prose);
        for (const c of chunks) {
          if (pc) {
            const vec = await embed(prefix + c);
            await pc.query(
              `INSERT INTO document_chunk(source, source_url, project, title, content, embedding)
               VALUES('notion', $1, 'notion', $2, $3, $4::vector)`,
              [page.url, title, prefix + c, `[${vec.join(",")}]`],
            );
          }
        }
        totalChunks += chunks.length;
        if (chunks.length) console.log(`✓ ${title}: ${chunks.length} 청크`);
      }
      docs++;
    } else {
      skippedEmpty++;
    }
    for (const cp of pageIds) await crawlPage(cp);
    for (const db of dbIds) await crawlDatabase(db);
    return hadBody;
  }

  async function crawlDatabase(dbId) {
    const key = "db:" + norm(dbId);
    if (visited.has(key)) return;
    visited.add(key);
    const SAMPLE = 12; let seen = 0, withBody = 0;
    let cur;
    do {
      const res = await api(`/databases/${dbId}/query`, {
        method: "POST", body: JSON.stringify({ page_size: 100, ...(cur ? { start_cursor: cur } : {}) }),
      });
      if (!res) break;
      for (const entry of res.results) {
        if (await crawlPage(entry.id)) withBody++;
        seen++;
        if (seen >= SAMPLE && withBody === 0) { console.log(`  ⤷ 추적 DB로 판단, 건너뜀(${dbId.slice(0, 8)}…)`); return; }
      }
      cur = res.has_more ? res.next_cursor : undefined;
    } while (cur);
  }

  console.log(`루트 ${ROOT} 부터 크롤${DRY ? " (dry-run, 적재 안 함)" : ""}${cursor ? ` (증분: ${new Date(cursor).toISOString()} 이후)` : " (전체)"}`);
  await crawlPage(ROOT);

  let removed = 0;
  if (pc && seenUrls.length > 0) {
    const del = await pc.query("DELETE FROM document_chunk WHERE source='notion' AND source_url <> ALL($1) RETURNING 1", [seenUrls]);
    removed = del.rows.length;
  }
  if (pc) {
    await pc.query(
      `INSERT INTO sync_cursor(connector, last_edited_at, updated_at) VALUES('notion', $1, now())
       ON CONFLICT (connector) DO UPDATE SET last_edited_at=$1, updated_at=now()`, [runStart],
    );
  }
  console.log(`\n완료: 스캔 ${scanned} / 문서(본문) ${docs} / 빈페이지 스킵 ${skippedEmpty} / 청크 +${totalChunks} / 정리 ${removed}`);
  if (pc) await pc.end();
}
main().catch((e) => { console.error("✗", e); process.exit(1); });
