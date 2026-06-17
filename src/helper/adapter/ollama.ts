// 로컬 모델 사이드카(Ollama) HTTP 클라이언트. 봇과 같은 박스의 localhost:11434.
const BASE = import.meta.env.OLLAMA_BASE_URL || "http://localhost:11434";
const EMBED_MODEL = "bge-m3";
const GEN_MODEL = import.meta.env.OLLAMA_GEN_MODEL || "qwen2.5:3b";

// 텍스트 → 임베딩 벡터(bge-m3, 1024차원)
export async function embed(text: string): Promise<number[]> {
  const res = await $fetch<{ embedding: number[] }>(`${BASE}/api/embeddings`, {
    method: "POST",
    body: { model: EMBED_MODEL, prompt: text },
  });
  return res.embedding;
}

// 프롬프트 → 생성 텍스트(소형 LLM). num_predict로 길이 제한(지연 관리).
export async function generate(prompt: string, numPredict = 200): Promise<string> {
  const res = await $fetch<{ response: string }>(`${BASE}/api/generate`, {
    method: "POST",
    body: {
      model: GEN_MODEL,
      prompt,
      stream: false,
      options: { num_predict: numPredict },
    },
  });
  return res.response.trim();
}
