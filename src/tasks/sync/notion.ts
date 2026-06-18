// Notion 공유 페이지를 RAG 색인하는 스케줄 태스크. nitro.config.ts scheduledTasks에서 호출.
export default defineTask({
  meta: {
    name: "sync:notion",
    description: "Notion 통합에 공유된 페이지를 RAG document_chunk에 색인",
  },
  async run() {
    const { ingestNotion } = await import("~/services/rag/notion");
    const res = await ingestNotion();
    console.log(
      `[sync:notion] scanned=${res.scanned} docs=${res.docs} chunks=${res.chunks} removed=${res.removed}`,
    );
    return { result: res };
  },
});
