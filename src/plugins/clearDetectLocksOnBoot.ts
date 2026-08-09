// 배포(=봇 재시작) 시점에 남아있는 감지 락을 전부 지운다.
//
// detect_lock은 "지금 이 프로세스가 이 게시글을 처리 중"이라는 표시일 뿐이다.
// 서버가 재시작되면 그 표시를 남긴 프로세스는 이미 죽은 것이므로, 남은 락은
// 전부 30분 만료를 기다릴 이유 없는 고아 상태다. 매 기동마다 정리한다.
export default defineNitroPlugin(() => {
  (async () => {
    try {
      const { clearAllDetectLocks } = await import("~/services/koin/detectLock");
      const cleared = await clearAllDetectLocks();
      if (cleared > 0) {
        console.log(`[detectLock:boot-clear] 남아있던 락 ${cleared}건 정리`);
      }
    } catch (e) {
      console.error("[detectLock:boot-clear] 실패", e);
    }
  })();
});
