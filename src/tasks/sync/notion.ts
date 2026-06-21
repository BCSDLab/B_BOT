// Notion 공유 페이지를 RAG 색인하는 스케줄 태스크. nitro.config.ts scheduledTasks에서 호출.
export default defineTask({
  meta: {
    name: "sync:notion",
    description: "Notion 통합에 공유된 페이지를 RAG document_chunk에 색인",
  },
  async run() {
    const { ingestNotion } = await import("~/services/rag/notion");
    // 매주 월요일: 증분(빠름). 매월 첫 월요일(날짜<=7)은 전체 크롤로 삭제분까지 정리(증분은 삭제 미반영).
    const full = new Date().getDate() <= 7;
    const res = await ingestNotion({ full });
    console.log(
      `[sync:notion] mode=${res.mode} scanned=${res.scanned} docs=${res.docs} chunks=${res.chunks} removed=${res.removed} errors=${res.errors}`,
    );
    return { result: res };
  },
});
