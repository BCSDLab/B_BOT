// Notion 커넥터: 지정한 루트에서 트리를 재귀 크롤해 본문 있는 페이지/DB항목만 색인.
// 컬럼·토글·링크(link_to_page)·child_database(쿼리)까지 추적. 본문 없는 페이지(출석부 등 DB 행)는
// 0청크로 자동 스킵 → 흩어진 문서화를 루트 몇 개로 자동 발견하면서 노이즈는 안 들어옴.
import { createPool, query } from "~/helper/adapter/postgres";
import { embed } from "~/helper/adapter/ollama";
import { chunk } from "./chunk";
import type { Pool } from "pg";

const NOTION_VERSION = "2022-06-28";
const API = "https://api.notion.com/v1";

// 색인 루트(프로젝트·트랙이 전부 하위에 있는 Regular 페이지). 추가 스페이스가 생기면 여기 추가.
const ROOTS = ["396654620b1b4cbd9fcd6bdf93fdceb9"];
// 안전장치: 한 번에 스캔할 최대 페이지 수(폭주 방지).
const MAX_SCAN = 12000;

let _pool: Pool | undefined;
function getPool(): Pool {
  return (_pool ??= createPool());
}
function token(): string | undefined {
  return import.meta.env.NOTION_TOKEN;
}

// 이미 한 번 색인됐는지(커서 존재). 배포 시점 최초 1회 자동 색인 가드에 사용.
export async function isNotionIndexed(): Promise<boolean> {
  const r = await query(getPool(), `SELECT 1 FROM sync_cursor WHERE connector = 'notion'`);
  return r.rows.length > 0;
}
function headers() {
  return {
    Authorization: `Bearer ${token()}`,
    "Notion-Version": NOTION_VERSION,
    "Content-Type": "application/json",
  };
}
const norm = (id: string) => (id || "").replace(/-/g, "");

// 전역 요청 세마포어: Notion API(평균 3req/s 한도) 동시 요청 수를 제한해 천장에 붙이되 429 폭주 방지.
const MAX_INFLIGHT = 4;
let inflight = 0;
const waiters: Array<() => void> = [];
async function acquire(): Promise<void> {
  if (inflight < MAX_INFLIGHT) { inflight++; return; }
  await new Promise<void>((r) => waiters.push(r));
  inflight++;
}
function release() { inflight--; waiters.shift()?.(); }

// 동시성 제한 map(재귀 폭주 방지: 실제 요청은 세마포어가, 함수 팬아웃은 limit이 제한).
async function mapLimit<T>(items: T[], limit: number, fn: (t: T) => Promise<void>): Promise<void> {
  let i = 0;
  const run = async () => { while (i < items.length) await fn(items[i++]); };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, run));
}

interface RT { plain_text?: string }
interface Block { id: string; type: string; has_children?: boolean; [k: string]: unknown }
interface Page { id: string; url: string; last_edited_time: string; properties?: Record<string, unknown> }

const rt = (arr: RT[] | undefined) => (arr ?? []).map((t) => t.plain_text ?? "").join("");

async function nfetch<T>(path: string, init?: Record<string, unknown>): Promise<T | null> {
  await acquire();
  try {
    for (let i = 0; i < 3; i++) {
      try {
        return await $fetch<T>(`${API}${path}`, { headers: headers(), ...init });
      } catch (e) {
        const status = (e as { response?: { status?: number } })?.response?.status;
        if (status === 429) { await new Promise((s) => setTimeout(s, 1000 * (i + 1))); continue; }
        return null;
      }
    }
    return null;
  } finally {
    release();
  }
}

function pageTitle(page: Page): string {
  for (const v of Object.values(page.properties ?? {})) {
    const p = v as { type?: string; title?: RT[] };
    if (p?.type === "title") return rt(p.title) || "제목 없음";
  }
  return "제목 없음";
}

function blockText(b: Block): string {
  const d = (b as Record<string, { rich_text?: RT[]; checked?: boolean; cells?: RT[][] }>)[b.type];
  const text = rt(d?.rich_text);
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

// 레이아웃 블록은 재귀, 페이지/DB 참조는 수집.
async function readBlocks(blockId: string, depth = 0): Promise<{ prose: string; pageIds: string[]; dbIds: string[] }> {
  const lines: string[] = [];
  const pageIds: string[] = [];
  const dbIds: string[] = [];
  if (depth > 8) return { prose: "", pageIds, dbIds };
  let cursor: string | undefined;
  do {
    const res = await nfetch<{ results: Block[]; next_cursor?: string; has_more: boolean }>(
      `/blocks/${blockId}/children?page_size=100${cursor ? `&start_cursor=${cursor}` : ""}`,
    );
    if (!res) break;
    for (const b of res.results) {
      if (b.type === "child_page") { pageIds.push(b.id); continue; }
      if (b.type === "child_database") { dbIds.push(b.id); continue; }
      if (b.type === "link_to_page") {
        const lp = (b as { link_to_page?: { type?: string; page_id?: string; database_id?: string } }).link_to_page;
        if (lp?.type === "page_id" && lp.page_id) pageIds.push(lp.page_id);
        else if (lp?.type === "database_id" && lp.database_id) dbIds.push(lp.database_id);
        continue;
      }
      const t = blockText(b);
      if (t) lines.push(t);
      if (b.has_children) {
        const sub = await readBlocks(b.id, depth + 1);
        if (sub.prose) lines.push(sub.prose);
        pageIds.push(...sub.pageIds);
        dbIds.push(...sub.dbIds);
      }
    }
    cursor = res.has_more ? res.next_cursor : undefined;
  } while (cursor);
  return { prose: lines.join("\n"), pageIds, dbIds };
}

// 지정 루트에서 트리 재귀 크롤. 본문 있는 페이지만 증분 색인.
export async function ingestNotion(): Promise<{ scanned: number; docs: number; chunks: number; removed: number }> {
  if (!token()) return { scanned: 0, docs: 0, chunks: 0, removed: 0 };
  const pool = getPool();
  const runStart = new Date().toISOString();
  const cur = await query(pool, `SELECT last_edited_at FROM sync_cursor WHERE connector = 'notion'`);
  const cursor = cur.rows[0]?.last_edited_at ? new Date(cur.rows[0].last_edited_at).getTime() : 0;

  const visited = new Set<string>();
  const seenUrls: string[] = [];
  let scanned = 0;
  let docs = 0;
  let totalChunks = 0;

  // prefetched: DB 쿼리 결과의 페이지 객체(있으면 GET /pages 생략 → 요청 절반↓).
  async function crawlPage(pageId: string, prefetched?: Page): Promise<boolean> {
    const key = norm(pageId);
    if (visited.has(key) || scanned >= MAX_SCAN) return false;
    visited.add(key);
    const page = prefetched ?? (await nfetch<Page>(`/pages/${pageId}`));
    if (!page) return false;
    scanned++;
    const { prose, pageIds, dbIds } = await readBlocks(pageId);
    let hadBody = false;
    if (prose.trim()) {
      hadBody = true;
      seenUrls.push(page.url);
      const changed = !cursor || new Date(page.last_edited_time).getTime() > cursor;
      if (changed) {
        await query(pool, `DELETE FROM document_chunk WHERE source = 'notion' AND source_url = $1`, [page.url]);
        const prefix = `노션 문서 — ${pageTitle(page)}\n`;
        for (const c of chunk(prose)) {
          const body = prefix + c;
          const vec = await embed(body);
          await query(
            pool,
            `INSERT INTO document_chunk(source, source_url, project, title, content, embedding)
             VALUES('notion', $1, 'notion', $2, $3, $4::vector)`,
            [page.url, pageTitle(page), body, `[${vec.join(",")}]`],
          );
          totalChunks++;
        }
      }
      docs++;
    }
    for (const cp of pageIds) await crawlPage(cp);
    for (const db of dbIds) await crawlDatabase(db);
    return hadBody;
  }

  // DB 항목들을 크롤하되, 앞 SAMPLE개가 전부 빈 본문이면 추적용 DB(출석부 등)로 보고 중단.
  async function crawlDatabase(dbId: string): Promise<void> {
    const key = "db:" + norm(dbId);
    if (visited.has(key) || scanned >= MAX_SCAN) return;
    visited.add(key);
    const SAMPLE = 12;
    let seen = 0;
    let withBody = 0;
    let cursor2: string | undefined;
    let firstBatch = true;
    do {
      const res = await nfetch<{ results: Page[]; next_cursor?: string; has_more: boolean }>(
        `/databases/${dbId}/query`,
        { method: "POST", body: { page_size: 100, ...(cursor2 ? { start_cursor: cursor2 } : {}) } },
      );
      if (!res) break;
      // 표본(앞 SAMPLE개)은 순차 — 추적 DB 조기 판단용. 쿼리 결과 객체를 그대로 넘겨 GET 생략(②).
      if (firstBatch) {
        const sample = res.results.slice(0, SAMPLE);
        for (const entry of sample) {
          if (await crawlPage(entry.id, entry)) withBody++;
          seen++;
        }
        if (seen >= SAMPLE && withBody === 0) return; // 추적 DB → 중단
        // 나머지는 동시성(①)으로.
        await mapLimit(res.results.slice(SAMPLE), MAX_INFLIGHT, async (e) => { await crawlPage(e.id, e); });
        firstBatch = false;
      } else {
        await mapLimit(res.results, MAX_INFLIGHT, async (e) => { await crawlPage(e.id, e); });
      }
      cursor2 = res.has_more ? res.next_cursor : undefined;
    } while (cursor2);
  }

  for (const root of ROOTS) await crawlPage(root);

  let removed = 0;
  if (seenUrls.length > 0) {
    const del = await query(
      pool,
      `DELETE FROM document_chunk WHERE source = 'notion' AND source_url <> ALL($1) RETURNING 1`,
      [seenUrls],
    );
    removed = del.rows.length;
  }
  await query(
    pool,
    `INSERT INTO sync_cursor(connector, last_edited_at, updated_at)
     VALUES('notion', $1, now())
     ON CONFLICT (connector) DO UPDATE SET last_edited_at = $1, updated_at = now()`,
    [runStart],
  );
  return { scanned, docs, chunks: totalChunks, removed };
}
