// RAG: 질문 → 임베딩 → pgvector top-k 검색 → 컨텍스트 → 소형 LLM 생성 → 답+출처
import { createPool, query } from "~/helper/adapter/postgres";
import { embed, generate, generateStream } from "~/helper/adapter/ollama";
import type { Pool } from "pg";

const TOP_K = 5;
const NUM_PREDICT = 160;

// 봇 메시지 핸들러엔 pool이 주입되지 않으므로 RAG 전용 싱글톤 풀 사용.
let _pool: Pool | undefined;
function getPool(): Pool {
  return (_pool ??= createPool());
}

export interface RagSource {
  title: string;
  source_url: string;
  score: number;
}
export interface RagAnswer {
  text: string;
  sources: RagSource[];
}

// 질문 임베딩 → 상위 청크 검색
async function retrieve(question: string) {
  const vec = await embed(question);
  const vecLiteral = `[${vec.join(",")}]`;
  const { rows } = await query(
    getPool(),
    `SELECT title, source_url, content, 1 - (embedding <=> $1::vector) AS score
     FROM document_chunk
     ORDER BY embedding <=> $1::vector
     LIMIT ${TOP_K}`,
    [vecLiteral],
  );
  return rows as Array<{ title: string; source_url: string; content: string; score: number }>;
}

function buildPrompt(question: string, rows: Awaited<ReturnType<typeof retrieve>>) {
  const context = rows
    .map((r, i) => `[${i + 1}] (출처: ${r.source_url})\n${r.content}`)
    .join("\n\n");
  return (
    `당신은 BCSD 동아리의 도우미 봇입니다. 아래 [문서]만 근거로 질문에 한국어로 간결히 답하세요.\n` +
    `- 구체적인 명령어·경로·파일명이 문서에 있으면 그대로 포함하세요.\n` +
    `- 문서에 단서가 조금이라도 있으면 그것으로 최대한 답하고, 핵심 정보가 전혀 없을 때만 "문서에서 찾지 못했어요"라고 하세요.\n\n` +
    `[문서]\n${context}\n\n[질문] ${question}\n\n[답변]`
  );
}

// source_url 기준 중복 제거(상위 점수 유지)
function dedupSources(rows: Awaited<ReturnType<typeof retrieve>>): RagSource[] {
  const seen = new Set<string>();
  const out: RagSource[] = [];
  for (const r of rows) {
    if (seen.has(r.source_url)) continue;
    seen.add(r.source_url);
    out.push({ title: r.title, source_url: r.source_url, score: Number(r.score) });
  }
  return out;
}

const EMPTY: RagAnswer = {
  text: "아직 학습된 문서가 없어요. 관리자에게 문서 색인을 요청해주세요.",
  sources: [],
};

export async function answer(question: string): Promise<RagAnswer> {
  const rows = await retrieve(question);
  if (rows.length === 0) return EMPTY;
  const text = await generate(buildPrompt(question, rows), NUM_PREDICT);
  return { text, sources: dedupSources(rows) };
}

// 스트리밍: 생성 토큰이 쌓일 때마다 onText(누적 텍스트) 호출. 반환은 최종 답+출처.
export async function answerStream(
  question: string,
  onText: (full: string) => void,
): Promise<RagAnswer> {
  const rows = await retrieve(question);
  if (rows.length === 0) return EMPTY;
  const text = await generateStream(buildPrompt(question, rows), onText, NUM_PREDICT);
  return { text, sources: dedupSources(rows) };
}
