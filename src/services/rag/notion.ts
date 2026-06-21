// Notion 커넥터: 지정한 루트에서 트리를 재귀 크롤해 본문 있는 페이지/DB항목만 색인.
// 컬럼·토글·링크(link_to_page)·child_database(쿼리)까지 추적. 본문 없는 페이지(출석부 등 DB 행)는
// 0청크로 자동 스킵 → 흩어진 문서화를 루트 몇 개로 자동 발견하면서 노이즈는 안 들어옴.
import { createPool, query } from "~/helper/adapter/postgres";
import { embed } from "~/helper/adapter/ollama";
import { chunk } from "./chunk";
import { classifyDocType } from "./classify";
import type { Pool } from "pg";

const NOTION_VERSION = "2022-06-28";
const API = "https://api.notion.com/v1";

// 색인 루트(프로젝트·트랙이 전부 하위에 있는 Regular 페이지). 추가 스페이스가 생기면 여기 추가.
const ROOTS = ["396654620b1b4cbd9fcd6bdf93fdceb9"];
// 안전장치: 한 번에 스캔할 최대 페이지 수(폭주 방지).
const MAX_SCAN = 30000; // 트리 + 접근가능 DB 전체(추적DB는 12개 표본 후 스킵).

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

// 일시 실패(429/5xx/네트워크)는 재시도, 영구 실패(404/403=미공유/없음)는 즉시 null(정상 케이스).
// 재시도 다 실패하면 nfetchErrors++ → 불완전 크롤 신호(삭제 안전 가드에서 사용).
let nfetchErrors = 0;
async function nfetch<T>(path: string, init?: Record<string, unknown>): Promise<T | null> {
  await acquire();
  try {
    for (let i = 0; i < 5; i++) {
      try {
        return await $fetch<T>(`${API}${path}`, { headers: headers(), ...init });
      } catch (e) {
        const status = (e as { response?: { status?: number } })?.response?.status;
        // 404/403/400 등 영구 클라이언트 에러(429 제외) = 접근불가/없음 → 즉시 null, 에러로 안 침.
        if (status && status >= 400 && status < 500 && status !== 429) return null;
        // 429/5xx/네트워크 = 일시 → 백오프 후 재시도.
        await new Promise((s) => setTimeout(s, 1000 * (i + 1)));
      }
    }
    nfetchErrors++; // 재시도 소진 = 진짜 실패(크롤 불완전).
    return null;
  } finally {
    release();
  }
}

// 통합에 접근 가능한 모든 데이터베이스 id 열거(트리-walk가 못 닿는 DB까지 자동 발견).
async function searchDatabases(): Promise<string[]> {
  const ids: string[] = [];
  let cursor: string | undefined;
  do {
    const res = await nfetch<{ results: Array<{ id: string }>; next_cursor?: string; has_more: boolean }>(
      `/search`,
      { method: "POST", body: { filter: { value: "database", property: "object" }, page_size: 100, ...(cursor ? { start_cursor: cursor } : {}) } },
    );
    if (!res) break;
    ids.push(...res.results.map((d) => d.id));
    cursor = res.has_more ? res.next_cursor : undefined;
  } while (cursor);
  return ids;
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

// 페이지 본문을 청크·임베딩해 교체 저장(full·증분 공용). 반환=쓴 청크 수.
async function writeChunks(pool: Pool, page: Page, prose: string): Promise<number> {
  await query(pool, `DELETE FROM document_chunk WHERE source = 'notion' AND source_url = $1`, [page.url]);
  const title = pageTitle(page);
  const docType = classifyDocType("notion", title);
  const prefix = `노션 문서 — ${title}\n`;
  let n = 0;
  for (const c of chunk(prose)) {
    const body = prefix + c;
    const vec = await embed(body);
    await query(
      pool,
      `INSERT INTO document_chunk(source, source_url, project, title, content, embedding, doc_type, updated_at)
       VALUES('notion', $1, 'notion', $2, $3, $4::vector, $5, $6)`,
      [page.url, title, body, `[${vec.join(",")}]`, docType, page.last_edited_time],
    );
    n++;
  }
  return n;
}

// Notion 색인. 두 모드:
//   full=true (첫 실행·월간): 루트 트리 + 접근가능 DB 전수 크롤 + 사라진 문서 정리(3~5h).
//   full=false (주간 증분): /search를 last_edited_time 내림차순으로 훑어 커서 이후 변경분만 재색인(~수 분).
//                           삭제 정리는 안 함(변경분만 보므로 전수 비교 불가) → 월간 full이 삭제분 담당.
export async function ingestNotion(opts?: { full?: boolean }): Promise<{ scanned: number; docs: number; chunks: number; removed: number; errors: number; mode: "full" | "incremental" }> {
  if (!token()) return { scanned: 0, docs: 0, chunks: 0, removed: 0, errors: 0, mode: "incremental" };
  const pool = getPool();
  nfetchErrors = 0; // 이번 실행 에러 카운트 리셋
  const runStart = new Date().toISOString();
  const cur = await query(pool, `SELECT last_edited_at FROM sync_cursor WHERE connector = 'notion'`);
  const cursor = cur.rows[0]?.last_edited_at ? new Date(cur.rows[0].last_edited_at).getTime() : 0;
  const full = (opts?.full ?? false) || cursor === 0; // 첫 실행(커서 없음)은 강제 전체 크롤.

  let scanned = 0;
  let docs = 0;
  let totalChunks = 0;
  let removed = 0;

  if (full) {
    // 이미 색인된 source_url 집합 → 신규/변경 페이지만 재임베딩(기존 코퍼스 재임베딩 방지).
    const idxRes = await query(pool, `SELECT DISTINCT source_url FROM document_chunk WHERE source = 'notion'`);
    const indexed = new Set<string>(idxRes.rows.map((r: { source_url: string }) => r.source_url));
    const visited = new Set<string>();
    const seenUrls: string[] = [];

    // prefetched: DB 쿼리 결과의 페이지 객체(있으면 GET /pages 생략 → 요청 절반↓).
    const crawlPage = async (pageId: string, prefetched?: Page): Promise<boolean> => {
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
        // 신규(미색인) 이거나 마지막 동기화 이후 수정됐으면 (재)임베딩.
        const changed = !indexed.has(page.url) || (cursor > 0 && new Date(page.last_edited_time).getTime() > cursor);
        if (changed) totalChunks += await writeChunks(pool, page, prose);
        docs++;
      }
      for (const cp of pageIds) await crawlPage(cp);
      for (const db of dbIds) await crawlDatabase(db);
      return hadBody;
    };

    // DB 항목들을 크롤하되, 앞 SAMPLE개가 전부 빈 본문이면 추적용 DB(출석부 등)로 보고 중단.
    const crawlDatabase = async (dbId: string): Promise<void> => {
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
    };

    // 1) 루트 트리 크롤(페이지)
    for (const root of ROOTS) await crawlPage(root);
    // 2) 접근 가능한 모든 DB 자동 발견·크롤(트리가 못 닿는 DB까지). visited가 중복 방지.
    for (const dbId of await searchDatabases()) await crawlDatabase(dbId);

    // 사라진(공유 해제·삭제) 페이지 정리 — **완전한 크롤일 때만**(불완전하면 멀쩡한 콘텐츠 오삭제).
    // 안전 조건: 일시 실패 0 + MAX_SCAN 미도달 + 충분히 큰 크롤(전체 트리 닿음).
    const cleanComplete = nfetchErrors === 0 && scanned < MAX_SCAN && seenUrls.length > 0;
    if (cleanComplete) {
      const del = await query(
        pool,
        `DELETE FROM document_chunk WHERE source = 'notion' AND source_url <> ALL($1) RETURNING 1`,
        [seenUrls],
      );
      removed = del.rows.length;
    } else if (nfetchErrors > 0) {
      console.log(`[notion] 크롤 불완전(에러 ${nfetchErrors}건) → 삭제 정리 건너뜀(오삭제 방지)`);
    }
  } else {
    // 증분: /search를 last_edited_time 내림차순으로 훑어 커서 이후 변경분만 재색인.
    // 내림차순이므로 커서 이하 페이지를 만나면 즉시 중단. 자식 재귀 안 함(자식이 바뀌면 자식도 검색에 뜸).
    let cursor2: string | undefined;
    let stop = false;
    do {
      const res = await nfetch<{ results: Page[]; next_cursor?: string; has_more: boolean }>(
        `/search`,
        {
          method: "POST",
          body: {
            filter: { value: "page", property: "object" },
            sort: { direction: "descending", timestamp: "last_edited_time" },
            page_size: 100,
            ...(cursor2 ? { start_cursor: cursor2 } : {}),
          },
        },
      );
      if (!res) break;
      for (const page of res.results) {
        if (new Date(page.last_edited_time).getTime() <= cursor || scanned >= MAX_SCAN) { stop = true; break; }
        scanned++;
        const { prose } = await readBlocks(page.id);
        if (prose.trim()) {
          totalChunks += await writeChunks(pool, page, prose);
          docs++;
        }
      }
      cursor2 = !stop && res.has_more ? res.next_cursor : undefined;
    } while (cursor2);
  }

  // 커서 갱신: 다음 실행은 이 시점 이후 변경분만(증분은 항상 최신 커서 필요).
  await query(
    pool,
    `INSERT INTO sync_cursor(connector, last_edited_at, updated_at)
     VALUES('notion', $1, now())
     ON CONFLICT (connector) DO UPDATE SET last_edited_at = $1, updated_at = now()`,
    [runStart],
  );
  return { scanned, docs, chunks: totalChunks, removed, errors: nfetchErrors, mode: full ? "full" : "incremental" };
}
