// RAG: 질문 → 임베딩 → pgvector top-k 검색 → 컨텍스트 → 소형 LLM 생성 → 답+출처
import { createPool, query } from "~/helper/adapter/postgres";
import { embed, generate } from "~/helper/adapter/ollama";
import type { Pool } from "pg";

const TOP_K = 5;

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

export async function answer(question: string): Promise<RagAnswer> {
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

  if (!rows || rows.length === 0) {
    return { text: "아직 학습된 문서가 없어요. 관리자에게 문서 색인을 요청해주세요.", sources: [] };
  }

  const context = rows
    .map((r: any, i: number) => `[${i + 1}] (출처: ${r.source_url})\n${r.content}`)
    .join("\n\n");

  const prompt =
    `당신은 BCSD 동아리의 도우미 봇입니다. 아래 [문서]만 근거로 질문에 한국어로 간결히 답하세요.\n` +
    `- 구체적인 명령어·경로·파일명이 문서에 있으면 그대로 포함하세요.\n` +
    `- 문서에 단서가 조금이라도 있으면 그것으로 답하고, 정말 없을 때만 "문서에서 찾지 못했어요"라고 하세요.\n\n` +
    `[문서]\n${context}\n\n[질문] ${question}\n\n[답변]`;

  const text = await generate(prompt, 220);

  // 출처는 source_url 기준 중복 제거(상위 점수 유지)
  const seen = new Set<string>();
  const sources: RagSource[] = [];
  for (const r of rows as any[]) {
    if (seen.has(r.source_url)) continue;
    seen.add(r.source_url);
    sources.push({ title: r.title, source_url: r.source_url, score: Number(r.score) });
  }

  return { text, sources };
}
