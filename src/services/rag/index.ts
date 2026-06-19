// RAG: 질문 → 임베딩 → (레포 라우팅) → pgvector top-k 검색 → 컨텍스트 → 소형 LLM 생성 → 답+출처
import { createPool, query } from "~/helper/adapter/postgres";
import { embed, generate, generateStream } from "~/helper/adapter/ollama";
import type { Pool } from "pg";
import RAG_REPOS from "@/constant/RAG_REPOS.json";
import { TYPE_WEIGHT, type DocType } from "./classify";

const SOURCE_MAX = 4; // 답변에 표시할 출처 최대 개수(노이즈 컷)
const CANDIDATES = 20; // 타입 재랭킹용 후보 풀(이후 TOP_K로 좁힘)

const TOP_K = 8;
const NUM_PREDICT = 280; // 답변이 중간에 잘리지 않도록(스트리밍이라 체감 대기는 완화).

// 레포 라우팅 임계: 질문이 특정 레포를 충분히 강하게 가리킬 때만 그 레포로 한정.
// (그래야 소형 모델이 다른 레포 청크를 아예 못 봐서 섞임/오귀속이 원천 차단됨)
const ROUTE_MIN_SCORE = 0.5; // 1위 레포와의 최소 유사도
const ROUTE_MIN_MARGIN = 0.03; // 1위-2위 유사도 차(모호하면 폴백)

// 봇 메시지 핸들러엔 pool이 주입되지 않으므로 RAG 전용 싱글톤 풀 사용.
let _pool: Pool | undefined;
function getPool(): Pool {
  return (_pool ??= createPool());
}

// 레포 식별 문구("이름 + 설명")를 한 번 임베딩해 캐시 → 질문과의 유사도로 라우팅.
let _repoVecs: Array<{ project: string; vec: number[] }> | undefined;
async function repoVectors() {
  if (_repoVecs) return _repoVecs;
  const { repos, desc, alias } = RAG_REPOS as {
    repos: string[];
    desc: Record<string, string>;
    alias: Record<string, string>;
  };
  const out: Array<{ project: string; vec: number[] }> = [];
  for (const r of repos) {
    out.push({ project: r, vec: await embed(`${r} ${desc[r] ?? ""} ${alias?.[r] ?? ""}`) });
  }
  _repoVecs = out;
  return out;
}

function cosine(a: number[], b: number[]): number {
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) { dot += a[i] * b[i]; na += a[i] * a[i]; nb += b[i] * b[i]; }
  return dot / (Math.sqrt(na) * Math.sqrt(nb) || 1);
}

// 질문이 특정 레포를 강하게 가리키면 검색을 한정할 project 집합 반환(아니면 null=전체).
// B_BOT(봇 자신)으로 라우팅되면 manual 내부 문서(project='bbot')까지 포함.
async function routeProjects(queryVec: number[]): Promise<string[] | null> {
  const scored = (await repoVectors())
    .map((x) => ({ project: x.project, s: cosine(queryVec, x.vec) }))
    .sort((a, b) => b.s - a.s);
  const [first, second] = scored;
  if (!first || first.s < ROUTE_MIN_SCORE) return null;
  if (second && first.s - second.s < ROUTE_MIN_MARGIN) return null;
  return first.project === "B_BOT" ? ["B_BOT", "bbot"] : [first.project];
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

type Chunk = {
  source: string;
  project: string;
  title: string;
  source_url: string;
  content: string;
  score: number;
  doc_type: DocType | null;
};

// 질문 임베딩 → (1) desc 기반 사전 라우팅 → 없으면 (2) 전체 검색 후 사후 보정
// → (3) 문서 타입 가중치로 재랭킹(회의록·재무 down-rank, 가이드·readme 우선).
async function retrieve(question: string): Promise<Chunk[]> {
  const vec = await embed(question);
  const vecLiteral = `[${vec.join(",")}]`;
  const projects = await routeProjects(vec);

  const params: unknown[] = [vecLiteral];
  let where = "";
  if (projects) {
    params.push(projects);
    where = `WHERE project = ANY($2)`;
  }
  // 타입 재랭킹이 하위 후보를 끌어올릴 수 있게 넉넉한 후보 풀을 가져옴.
  const { rows } = await query(
    getPool(),
    `SELECT source, project, title, source_url, content, doc_type,
            1 - (embedding <=> $1::vector) AS score
     FROM document_chunk
     ${where}
     ORDER BY embedding <=> $1::vector
     LIMIT ${CANDIDATES}`,
    params,
  );
  let chunks = rows as Chunk[];

  // (3) 타입 가중치 재랭킹: 유사도 + TYPE_WEIGHT[doc_type]로 정렬.
  const adj = (c: Chunk) => Number(c.score) + (c.doc_type ? TYPE_WEIGHT[c.doc_type] ?? 0 : 0);
  chunks.sort((a, b) => adj(b) - adj(a));

  // 사후 보정: 사전 라우팅이 폴백된 경우, 1위 청크의 레포가 상위 결과를 장악하면(≥2개)
  // 그 레포로 한정 → "코인 백엔드 참여자"처럼 라우팅은 모호하나 청크는 한 레포에 쏠린 질문 처리.
  if (!projects && chunks.length > 0) {
    const dom = chunks[0].project;
    const same = chunks.filter((c) => c.project === dom);
    if (same.length >= 2) chunks = same;
  }
  return chunks.slice(0, TOP_K);
}

// 출처를 사람이 읽을 수 있는 라벨로(프로젝트·종류 명시 → 모델이 도메인 구분).
function label(r: Awaited<ReturnType<typeof retrieve>>[number]): string {
  if (r.source === "github") return `프로젝트 ${r.project} (GitHub README)`;
  if (r.source === "notion") return `노션 문서: ${r.title}`;
  if (r.source === "gdrive") return `구글 문서: ${r.title}`;
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
    `- 해당 프로젝트 출처에 핵심 정보가 없으면 "문서에서 찾지 못했어요"라고 하세요.\n` +
    `- **핵심만 간결히**, 불필요한 미사여구 없이 답하고 **반드시 문장을 완결해서 끝맺으세요**(중간에 끊지 말 것).\n` +
    `- **답변 본문에 URL·링크를 지어내지 마세요.** 출처는 답변 하단에 자동으로 표시됩니다. 문서를 가리킬 땐 제목만 쓰세요.\n\n` +
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
  return out.slice(0, SOURCE_MAX); // 상위 출처만(노이즈 컷)
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
