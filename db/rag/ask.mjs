// ask.mjs — RAG PoC: 질문 → 임베딩 → pgvector top-k → 컨텍스트 → qwen2.5 생성 → 답+출처
// 실행: OLLAMA_BASE_URL=... PGPORT=5544 PGPASSWORD=... PGDATABASE=bbot \
//         node db/rag/ask.mjs "환경변수는 어디에 있나요?"
import pg from "pg";

const OLLAMA = process.env.OLLAMA_BASE_URL ?? "http://localhost:11434";
const EMBED_MODEL = "bge-m3";
const GEN_MODEL = process.env.GEN_MODEL ?? "qwen2.5:3b";
const TOP_K = 5;

const PG = {
  host: process.env.PGHOST ?? "127.0.0.1",
  port: Number(process.env.PGPORT ?? 5544),
  user: process.env.PGUSER ?? "postgres",
  password: process.env.PGPASSWORD,
  database: process.env.PGDATABASE ?? "bbot",
};

async function embed(text) {
  const r = await fetch(`${OLLAMA}/api/embeddings`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ model: EMBED_MODEL, prompt: text }),
  });
  return (await r.json()).embedding;
}

async function generate(prompt) {
  const r = await fetch(`${OLLAMA}/api/generate`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ model: GEN_MODEL, prompt, stream: false, options: { num_predict: 256 } }),
  });
  const d = await r.json();
  return { text: d.response.trim(), genTokps: d.eval_count / (d.eval_duration / 1e9) };
}

async function main() {
  const question = process.argv[2];
  if (!question) { console.error('질문을 인자로 주세요: node ask.mjs "..."'); process.exit(1); }

  const pc = new pg.Client(PG);
  await pc.connect();

  const t0 = Date.now();
  const qvec = await embed(question);
  const { rows } = await pc.query(
    `SELECT title, source_url, content, 1 - (embedding <=> $1::vector) AS score
     FROM document_chunk ORDER BY embedding <=> $1::vector LIMIT ${TOP_K}`,
    [`[${qvec.join(",")}]`],
  );
  const tSearch = Date.now() - t0;

  const context = rows
    .map((r, i) => `[${i + 1}] (출처: ${r.source_url})\n${r.content}`)
    .join("\n\n");
  const prompt =
    `당신은 BCSD 동아리의 봇입니다. 아래 [문서]만 근거로 질문에 한국어로 답하세요.\n` +
    `- 구체적인 명령어·경로·파일명이 문서에 있으면 그대로 포함하세요.\n` +
    `- 문서에 단서가 조금이라도 있으면 그것으로 답하고, 정말 없을 때만 "문서에 없음"이라고 하세요.\n\n` +
    `[문서]\n${context}\n\n[질문] ${question}\n\n[답변]`;

  const t1 = Date.now();
  const { text, genTokps } = await generate(prompt);
  const tGen = Date.now() - t1;

  console.log(`\n❓ ${question}\n`);
  console.log(`💬 ${text}\n`);
  console.log(`📎 출처:`);
  rows.forEach((r) => console.log(`   - ${r.source_url} (유사도 ${r.score.toFixed(3)})`));
  console.log(`\n⏱  검색 ${tSearch}ms / 생성 ${tGen}ms (${genTokps.toFixed(1)} tok/s)`);
  await pc.end();
}

main().catch((e) => { console.error("✗", e); process.exit(1); });
