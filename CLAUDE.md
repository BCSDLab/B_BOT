# CLAUDE.md

B-BOT (삐봇) — BCSD Lab Slack 봇. 이 파일은 사람과 Claude Code가 빠르게 맥락을 잡기 위한 안내다.

## 무엇인가

- Nitro(TypeScript) 기반 Slack 봇. **HTTP 웹훅** 단일 모드(소켓 모드 폐기).
- 현행: 재미 명령, CI/CD 알림 웹훅, Google Meet 생성, 그룹 멘션.
- 고도화 방향: 조직 지식 RAG·온보딩 Q&A·운영 자동화·자연어 멤버 관리.
  → 설계 문서: `docs/계획서.md`, `docs/기능명세서.md` (작업 전 반드시 참고).

## 셋업

- Node `v22.13.1`(`.nvmrc`), **pnpm**.
- `nvm use` → `pnpm install` → `cp .env.example .env`(값 채우기) → `pnpm dev`.
- 필요한 env 키와 출처는 `.env.example` 참고.

## 아키텍처

- **수신**: `src/routes/*.post.ts` (`event`/`slash`/`interaction`) — Nitro 파일 라우팅으로 `/event` 등에 매핑.
- **주입**: `src/plugins/createInstnace.ts`가 요청마다 `event.context`에 `slackWebClient`(@slack/web-api)와 `sqlPool`(pg)을 넣는다. 핸들러는 여기서 꺼내 쓴다.
- **DB**: `src/helper/adapter/postgres.ts`의 `createPool`/`query`. **쿼리는 파라미터 바인딩**으로(직접 문자열 결합 금지). 봇 Postgres(pgvector)에는 PR 스레드·RAG·작업 기록만 둔다.
- **멤버**: 원본은 **인터널**(`internal.bcsdlab.com`). `src/utils/member.ts`가 서비스 API(`GET /v1/service/members`, `INTERNAL_SERVICE_TOKEN`)로 읽기만 한다(60초 캐시). 팀 구분은 폐지됐다. 봇 DB에 멤버 테이블을 다시 만들지 않는다.
- **배치**: Nitro `scheduledTasks` + `src/tasks/`(예: `crawl/clarity`). KV는 `useStorage('kvStorage')`(fs 드라이버).
- **상수**: `src/constant/*.json`, 별칭 `@/constant`.

## 컨벤션

- 환경 변수는 `import.meta.env.*`로 접근(Nitro). 타입은 `src/types/index.d.ts`.
- 새 Slack 수신 엔드포인트는 `routes/`에 `*.post.ts`로 추가하고 Request URL을 Slack App에 등록.
- 비밀(토큰·자격증명)은 절대 로그/응답/커밋에 노출하지 않는다. `.env`는 gitignore.
- DB 덤프 등 PII 포함 파일은 `backup/`(gitignore)에 두고 커밋하지 않는다.

## AI 작업 원칙 (고도화 단계)

- AI는 **"읽고 답하기(RAG·요약)"** 와 **"알아듣기(자연어→도구 호출)"** 에만 쓴다.
- DB·웹훅·검색·권한·비밀 처리는 전부 코드. 쓰기(예: 등급 변경)는 AI가 의도만 추출하고
  **권한 확인 + Slack confirm + 검증 + 감사 로그**는 코드가 한다. AI에 raw SQL 권한 금지.
- 생성 모델은 현재 **소형 로컬(B안, $0)**, 임베딩/STT는 로컬. 추상화 레이어로 추후 Haiku(A/C) 전환.

## 하지 말 것

- 소켓 모드 재도입(연결 churn 원인). HTTP 웹훅 유지.
- 지식 데이터를 위한 **새 DB 분리 생성**. 봇 Postgres 단일 공유. 멤버 데이터는 인터널 API로만 읽는다.
