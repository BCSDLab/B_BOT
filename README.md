# B-BOT (삐봇)

BCSD Lab Slack 봇. 재미 명령, CI/CD 알림 웹훅, Google Meet 생성, 그룹 멘션 등을 제공하며,
조직 지식 RAG·온보딩·운영 자동화로 고도화 중이다. (계획: [`docs/계획서.md`](./docs/계획서.md) · 기능: [`docs/기능명세서.md`](./docs/기능명세서.md))

- **스택**: Nitro (TypeScript), Slack **HTTP 웹훅**, MySQL(→ 추후 PostgreSQL+pgvector)
- **런타임**: Node `v22.13.1` (`.nvmrc`), 패키지 매니저 **pnpm**

## 시작하기

```bash
nvm use                 # Node 22.13.1 (.nvmrc)
pnpm install            # 의존성 설치
cp .env.example .env    # .env 생성 후 값 채우기 (아래 환경 변수 참고)
pnpm dev                # 개발 서버 (nitro dev)
```

빌드/실행:

```bash
pnpm build              # nitro build → .output
node .output/server/index.mjs
```

## 환경 변수

[`.env.example`](./.env.example)에 전체 키와 출처가 주석으로 있다. `cp .env.example .env` 후 채운다.

- **[필수]** `SLACK_BOT_TOKEN`, `DB_HOST` `DB_PORT` `DB_USER` `DB_PASSWORD` `DB_NAME`
- **[선택]** `SLACK_BOT_SIGNING_SECRET`(권장), `GOOGLE_*`(Meet), `APP_BASE_URL`, `CLARITY_TOKEN`, `ADMIN_NAME` — 없으면 해당 기능만 비활성.

> 실제 값(토큰·비밀번호)은 **절대 커밋 금지**. `.env`는 `.gitignore` 대상.

## 구조

```
src/
  routes/        Slack 수신 — event / slash / interaction (.post.ts) · event.get.ts
  plugins/       createInstnace.ts(WebClient·DB pool 주입)
  services/      slack 등 도메인 로직
  tasks/         scheduledTasks (예: crawl/clarity)
  utils/         member.ts(멤버 조회·타입) 등
  helper/        adapter/mysql.ts (DB 풀·쿼리)
  constant/      JSON 상수 (@/constant 별칭)
  types/         index.d.ts (env 타입 등)
nitro.config.ts  srcDir=src, tasks, KV(fs), scheduledTasks
```

## Slack 연동 (HTTP 웹훅)

소켓 모드는 폐기되었다. Slack App의 Event Subscriptions / Slash Commands / Interactivity
Request URL을 각각 배포 도메인의 `/event`, `/slash`, `/interaction`으로 설정한다.
(앱 매니페스트: [`slack-app-manifest.yml`](./slack-app-manifest.yml))
