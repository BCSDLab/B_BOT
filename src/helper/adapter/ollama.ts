// 로컬 모델 사이드카(Ollama) HTTP 클라이언트. 봇과 같은 박스의 localhost:11434.
const BASE = import.meta.env.OLLAMA_BASE_URL || "http://localhost:11434";
const EMBED_MODEL = "bge-m3";
const GEN_MODEL = import.meta.env.OLLAMA_GEN_MODEL || "qwen2.5:3b";
// 모델을 메모리에 유지(콜드 로드 제거). 산발적 사용에도 빠르게 응답.
const KEEP_ALIVE = "30m";

// 텍스트 → 임베딩 벡터(bge-m3, 1024차원)
export async function embed(text: string): Promise<number[]> {
  const res = await $fetch<{ embedding: number[] }>(`${BASE}/api/embeddings`, {
    method: "POST",
    body: { model: EMBED_MODEL, prompt: text, keep_alive: KEEP_ALIVE },
  });
  return res.embedding;
}

// 프롬프트 → 생성(비스트리밍). num_predict로 길이 제한(지연 관리).
export async function generate(prompt: string, numPredict = 160): Promise<string> {
  const res = await $fetch<{ response: string }>(`${BASE}/api/generate`, {
    method: "POST",
    body: {
      model: GEN_MODEL,
      prompt,
      stream: false,
      keep_alive: KEEP_ALIVE,
      options: { num_predict: numPredict },
    },
  });
  return res.response.trim();
}

// 프롬프트 → 생성(스트리밍). 토큰이 쌓일 때마다 onText(누적 텍스트) 호출.
// 반환: 최종 전체 텍스트.
export async function generateStream(
  prompt: string,
  onText: (full: string) => void,
  numPredict = 160,
): Promise<string> {
  const res = await fetch(`${BASE}/api/generate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: GEN_MODEL,
      prompt,
      stream: true,
      keep_alive: KEEP_ALIVE,
      options: { num_predict: numPredict },
    }),
  });
  if (!res.ok || !res.body) throw new Error(`ollama generate ${res.status}`);

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  let full = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    let nl: number;
    while ((nl = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, nl).trim();
      buf = buf.slice(nl + 1);
      if (!line) continue;
      const j = JSON.parse(line);
      if (j.response) {
        full += j.response;
        onText(full);
      }
    }
  }
  return full.trim();
}
