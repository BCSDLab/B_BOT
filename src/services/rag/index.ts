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
    `SELECT source, project, title, source_url, content, 1 - (embedding <=> $1::vector) AS score
     FROM document_chunk
     ORDER BY embedding <=> $1::vector
     LIMIT ${TOP_K}`,
    [vecLiteral],
  );
  return rows as Array<{
    source: string;
    project: string;
    title: string;
    source_url: string;
    content: string;
    score: number;
  }>;
}

// 출처를 사람이 읽을 수 있는 라벨로(프로젝트·종류 명시 → 모델이 도메인 구분).
function label(r: Awaited<ReturnType<typeof retrieve>>[number]): string {
  if (r.source === "github") return `프로젝트 ${r.project} (GitHub README)`;
  return `B-BOT 봇 내부 기획/문서: ${r.title}`;
}

function buildPrompt(question: string, rows: Awaited<ReturnType<typeof retrieve>>) {
  const context = rows
    .map((r, i) => `[출처 ${i + 1} — ${label(r)}]\n${r.content}`)
    .join("\n\n");
  return (
    `당신은 BCSD 동아리의 도우미 봇입니다. 아래 [문서]만 근거로 한국어로 답하세요.\n` +
    `규칙:\n` +
    `- 질문이 특정 프로젝트/레포에 관한 것이면 **그 프로젝트 출처만** 사용하세요. 다른 프로젝트나 B-BOT 봇 내부 문서의 내용을 절대 섞지 마세요.\n` +
    `- 서로 다른 출처의 내용을 합쳐 하나의 답으로 지어내지 마세요.\n` +
    `- 어느 프로젝트를 묻는지 출처에서 확신할 수 없으면, 추측하지 말고 "어느 프로젝트(레포)를 말하는지 알려주세요"라고 되물으세요.\n` +
    `- 구체적인 기술명·명령어·경로는 출처에 있는 그대로 쓰세요.\n` +
    `- 해당 프로젝트 출처에 핵심 정보가 없으면 "문서에서 찾지 못했어요"라고 하세요.\n\n` +
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
