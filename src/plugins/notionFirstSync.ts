// 배포(=봇 재시작) 시점에 Notion이 아직 색인 안 됐으면 최초 1회 자동 색인.
// 주간 cron을 기다리지 않고 배포 직후 바로 지식이 채워지게. 색인되면(커서 존재) 건너뜀 → 이후는 cron 위임.
// 백그라운드 실행(서버 기동 블로킹 X). 최초 전체 크롤은 길어서 박스에서 도는 게 안전(터널 불필요).
export default defineNitroPlugin(() => {
  if (!import.meta.env.NOTION_TOKEN) return;
  setTimeout(async () => {
    try {
      const { isNotionIndexed, ingestNotion } = await import("~/services/rag/notion");
      if (await isNotionIndexed()) return; // 이미 색인됨 → 주간 cron이 증분 유지
      console.log("[notion:first-sync] 최초 색인 시작(배포 직후)…");
      const r = await ingestNotion();
      console.log(`[notion:first-sync] 완료 scanned=${r.scanned} docs=${r.docs} chunks=${r.chunks} removed=${r.removed}`);
    } catch (e) {
      console.error("[notion:first-sync] 실패", e);
    }
  }, 8000);
});
