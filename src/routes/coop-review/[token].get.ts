import { loadCoopReview } from "~/services/coop/reviewStore";

/** 생협 검토 전용 페이지. 강의 검토 저장소나 라우트에 의존하지 않는다. */
export default defineEventHandler(async (event) => {
  const token = getRouterParam(event, "token") ?? "";
  const stored = await loadCoopReview(token);

  setResponseHeader(event, "X-Robots-Tag", "noindex, nofollow");
  setResponseHeader(event, "Cache-Control", "no-store");
  setResponseHeader(event, "Content-Type", "text/html; charset=utf-8");

  if (!stored) {
    setResponseStatus(event, 404);
    return `<!doctype html><meta charset="utf-8">
<title>생협 검토 페이지를 찾을 수 없습니다</title>
<body style="font:14px/1.6 -apple-system,sans-serif;padding:40px;max-width:520px;margin:0 auto">
<h1 style="font-size:18px">생협 검토 페이지를 찾을 수 없습니다</h1>
<p>링크가 만료되었거나 잘못된 주소입니다. 검토 링크는 생성 후 7일간 유효합니다.</p>
<p style="color:#6b7280">슬랙에서 다시 변환하면 새 링크가 만들어집니다.</p>
</body>`;
  }

  return stored.html;
});
