import { loadCoopReview } from "~/services/coop/reviewStore";
import { loadReview as loadLectureReview } from "~/services/lecture/reviewStore";

/**
 * 강의 검토 페이지. 슬랙 메시지의 링크로 바로 열린다.
 * 토큰이 유일한 접근 수단이라 검색엔진에 잡히지 않게 막는다.
 */
export default defineEventHandler(async (event) => {
  const token = getRouterParam(event, "token") ?? "";
  const stored = await loadLectureReview(token) ?? await loadCoopReview(token);

  setResponseHeader(event, "X-Robots-Tag", "noindex, nofollow");
  setResponseHeader(event, "Cache-Control", "no-store");
  setResponseHeader(event, "Content-Type", "text/html; charset=utf-8");

  if (!stored) {
    // 만료·오타·없는 토큰을 구분해 알려주지 않는다. 어느 쪽이든 사람이 할 일은 같다.
    setResponseStatus(event, 404);
    return `<!doctype html><meta charset="utf-8">
<title>검토 페이지를 찾을 수 없습니다</title>
<body style="font:14px/1.6 -apple-system,sans-serif;padding:40px;max-width:520px;margin:0 auto">
<h1 style="font-size:18px">검토 페이지를 찾을 수 없습니다</h1>
<p>링크가 만료되었거나 잘못된 주소입니다. 검토 링크는 생성 후 7일간 유효합니다.</p>
<p style="color:#6b7280">슬랙에서 다시 변환하면 새 링크가 만들어집니다.</p>
</body>`;
  }

  return stored.html;
});
