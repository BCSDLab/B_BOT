// ⚠️ 임시 운영 라우트: Notion full 재색인을 bbot 프로세스 안(월간 cron과 동일 경로)에서 1회 트리거.
// 청크 직접 import는 nitro를 통째로 부팅(EADDRINUSE)해 못 쓰므로, 정상 런타임에서 돌리기 위한 수단.
// 사용 후 삭제할 것. 게이트: ?key=<NOTION_TOKEN>(이미 가진 비밀, 로그 노출 금지).
export default defineEventHandler((event) => {
  const key = getQuery(event).key;
  if (!key || key !== import.meta.env.NOTION_TOKEN) {
    setResponseStatus(event, 403);
    return "forbidden";
  }
  // fire-and-forget: 3~5h 작업을 기다리지 않고 즉시 응답. 진행은 journalctl -u bbot.
  runTask("sync:notion", { payload: { full: true } }).then(
    (r) => console.log("[admin] notion full DONE", JSON.stringify(r)),
    (e) => console.error("[admin] notion full ERROR", e?.message ?? e),
  );
  return "started: notion full re-index (in-process). 진행: journalctl -u bbot | grep notion";
});
