// 배포(=봇 재시작) 시점에 아직 색인 안 된 지식 소스를 최초 1회 자동 색인.
// 주간/일일 cron을 기다리지 않고 배포 직후 채워지게. 색인되면(커서 존재) 건너뜀 → 이후 cron 위임.
// 백그라운드 실행(서버 기동 블로킹 X). 최초 크롤은 길어서 박스에서 도는 게 안전(터널 불필요).
export default defineNitroPlugin(() => {
  setTimeout(async () => {
    // Notion: 통합에 공유된 루트 트리 크롤
    if (import.meta.env.NOTION_TOKEN) {
      try {
        const { isNotionIndexed, ingestNotion } = await import("~/services/rag/notion");
        if (!(await isNotionIndexed())) {
          console.log("[notion:first-sync] 최초 색인 시작(배포 직후)…");
          const r = await ingestNotion();
          console.log(`[notion:first-sync] 완료 scanned=${r.scanned} docs=${r.docs} chunks=${r.chunks} removed=${r.removed} errors=${r.errors}`);
        }
      } catch (e) {
        console.error("[notion:first-sync] 실패", e);
      }
    }
    // Google Drive: 봇 계정 Docs (drive.readonly 재인증 후에만 실제 색인됨 — 전이면 0건 → 커서 미설정 → 재시도)
    try {
      const { isGdriveIndexed, ingestGdrive } = await import("~/services/rag/gdrive");
      if (!(await isGdriveIndexed())) {
        const r = await ingestGdrive();
        if (r.docs > 0) {
          console.log(`[gdrive:first-sync] 완료 docs=${r.docs} changed=${r.changed} chunks=${r.chunks} removed=${r.removed}`);
        }
      }
    } catch (e) {
      console.error("[gdrive:first-sync] 실패", e);
    }
  }, 8000);
});
