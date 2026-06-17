// 지식 소스 색인: 문서 upsert(소스·프로젝트 단위 갱신) + GitHub README 커넥터.
import { createPool, query } from "~/helper/adapter/postgres";
import { embed } from "~/helper/adapter/ollama";
import { chunk } from "./chunk";
import type { Pool } from "pg";
import RAG_REPOS from "@/constant/RAG_REPOS.json";

let _pool: Pool | undefined;
function getPool(): Pool {
  return (_pool ??= createPool());
}

// (source, project) 단위로 기존 청크 삭제 후 새로 적재 → 재동기화 시 중복/stale 방지.
export async function upsertDocument(opts: {
  source: string;
  sourceUrl: string;
  project: string;
  title: string;
  content: string;
}): Promise<number> {
  const pool = getPool();
  await query(pool, `DELETE FROM document_chunk WHERE source = $1 AND project = $2`, [
    opts.source,
    opts.project,
  ]);
  const chunks = chunk(opts.content);
  for (const c of chunks) {
    const vec = await embed(c);
    await query(
      pool,
      `INSERT INTO document_chunk(source, source_url, project, title, content, embedding)
       VALUES($1, $2, $3, $4, $5, $6::vector)`,
      [opts.source, opts.sourceUrl, opts.project, opts.title, c, `[${vec.join(",")}]`],
    );
  }
  return chunks.length;
}

async function fetchReadme(owner: string, repo: string): Promise<{ text: string; url: string } | null> {
  const res = await $fetch<{ content: string; html_url: string }>(
    `https://api.github.com/repos/${owner}/${repo}/readme`,
    { headers: { "User-Agent": "b-bot", Accept: "application/vnd.github+json" } },
  ).catch(() => null);
  if (!res?.content) return null;
  const text = Buffer.from(res.content, "base64").toString("utf8");
  return { text, url: res.html_url };
}

// 설정된 공개 레포들의 README를 가져와 색인. 무인증(공개 레포).
export async function ingestGithub(): Promise<{ repos: number; chunks: number; skipped: string[] }> {
  const { owner, repos } = RAG_REPOS as { owner: string; repos: string[] };
  let okRepos = 0;
  let totalChunks = 0;
  const skipped: string[] = [];
  for (const repo of repos) {
    const r = await fetchReadme(owner, repo);
    if (!r || !r.text.trim()) {
      skipped.push(repo);
      continue;
    }
    const n = await upsertDocument({
      source: "github",
      sourceUrl: r.url,
      project: repo,
      title: `${repo} README`,
      content: r.text,
    });
    okRepos++;
    totalChunks += n;
  }
  await query(
    getPool(),
    `INSERT INTO sync_cursor(connector, last_edited_at, updated_at)
     VALUES('github', now(), now())
     ON CONFLICT (connector) DO UPDATE SET last_edited_at = now(), updated_at = now()`,
  );
  return { repos: okRepos, chunks: totalChunks, skipped };
}
