# B-BOT (삐봇)

BCSD Lab Slack 봇. 재미 명령, CI/CD 알림 웹훅, Google Meet 생성, 그룹 멘션 등을 제공하며,
조직 지식 RAG·온보딩·운영 자동화로 고도화 중이다. (계획: [`docs/계획서.md`](./docs/계획서.md) · 기능: [`docs/기능명세서.md`](./docs/기능명세서.md))

- **스택**: Nitro (TypeScript), Slack **HTTP 웹훅**, MySQL(→ 추후 PostgreSQL+pgvector)
- **런타임**: Node `v24.22.1` (`.nvmrc`), 패키지 매니저 **pnpm**

## 시작하기

```bash
nvm use                 # Node 24.22.1 (.nvmrc)
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

## GitHub Actions 배포

`.github/workflows/deploy.yml`은 `main` push·수동 실행·기존 예약 실행으로 배포한다. 의존성 설치 → `nitro prepare` → PostgreSQL 서비스를 사용하는 테스트 → 배포 `.env` 생성 → 빌드 → 압축·SSH 전송 순서다. 테스트 전에 운영 LLM 키를 담은 `.env`를 만들지 않아 유료 모델 테스트가 자동 실행되지 않는다.

Superset 기능 배포에는 기존 Slack·DB·SSH Secrets 외에 다음 **Repository Secrets**가 필요하다.

```text
ANTHROPIC_API_KEY
SUPERSET_BASE_URL
SUPERSET_USERNAME
SUPERSET_PASSWORD
SUPERSET_DATASET_IDS
```

Superset은 `SUPERSET_USERNAME`/`SUPERSET_PASSWORD`로 자동 로그인한다. 별도 access/refresh token Secret은 사용하지 않는다. 필수 값이 비어 있으면 워크플로가 누락된 Secret 이름만 출력하고 빌드·전송 전에 중단한다. `.env`는 배포 압축 파일에 포함된다.


## Superset 4.x

명령어는 `!대시보드` 하나를 사용한다. 기존 RAG `!질문`과 별개다.

```text
!대시보드 지난달 매출이 얼마야?
!대시보드 월별 매출 대시보드 만들어줘
```

- Claude `claude-opus-5`가 질문/생성 의도를 분류한다. 분류를 명시하려면 `!대시보드 질문 …`, `!대시보드 생성 …`도 가능하다.
- 질문은 허용 데이터셋 하나에서 조회하고 결과를 근거로 답한다. 조회당 최대 100행이며, 기존 저장 지표·컬럼·비교 필터·기간·정렬·시간 집계(시간/일/주/월/연)를 사용한다. 결과가 제한되면 안내 문구를 덧붙인다. 원본 행은 같은 값의 중복도 보존하고, 명시적 그룹 조회만 그룹화한다. 임의 SQL이나 데이터 변경은 실행하지 않는다.
- `SUPERSET_DATASET_IDS`는 기존 물리 데이터셋과 등록된 가상(SQL) 데이터셋을 모두 지원한다. 저장 SQL/Jinja의 실행은 Superset이 담당하며, 봇은 해당 SQL을 LLM에 보내거나 수정하지 않는다. Jinja 데이터셋은 Superset의 `ENABLE_TEMPLATE_PROCESSING`이 활성화되어 있어야 한다. 필터·기간은 데이터셋에 공개된 컬럼 범위에서만 지정할 수 있다.
- 생성은 최대 4개 차트(표·막대·시계열 선)의 구성안을 보여준다. 요청자만 15분 이내에 **생성/취소**할 수 있다. 집계 표는 Superset 4가 유지할 수 있는 **단일 저장 지표 정렬**만 승인하며, 미지정 시 첫 지표 내림차순을 미리보기에 표시한다. 집계 표의 차원 정렬·다중 정렬은 생성 전에 거부한다. 데이터 질의와 원본 행 표의 정렬은 이 제한을 받지 않는다. 막대·선 차트의 컬럼과 정렬은 실제 축·시리즈·지표와 일치해야 한다.
- 상태 전이와 감사 로그는 동일 트랜잭션으로 기록하되, 외부 생성 결과 URL은 감사 실패에도 사라지지 않도록 먼저 별도 보존한다. 이후 상태가 `claimed`여도 요청자가 링크를 회수할 수 있으며, 재클릭은 Superset 생성을 반복하지 않는다. 선점된 작업은 실행 기한 15분을 갖고, 기한이 지난 URL 없는 작업은 중단 처리한다. 중단·기록 실패 시에는 Superset에 이미 생성된 항목이 있는지 확인한 뒤 새로 요청한다.
- 표의 시간 컬럼 메타데이터를 함께 저장해 대시보드가 브라우저에서 쿼리를 재생성해도 시간 집계를 유지한다. 대시보드 레이아웃은 Superset 4 계약(버전 키·ROOT/GRID/ROW/CHART 부모·행 배경)을 채운다.
- 생성 대시보드는 비공개 초안(`published=false`)이다. 열람자에게 Superset 자체 접근 권한이 필요하다. API 실패 시 일부 차트/대시보드가 남을 수 있으므로 실패 후 재요청 전에 Superset에서 확인한다.

설정: `.env.example`의 `ANTHROPIC_API_KEY`, `SUPERSET_BASE_URL`, `SUPERSET_USERNAME`, `SUPERSET_PASSWORD`, `SUPERSET_DATASET_IDS`와 봇 PostgreSQL `DB_*`를 채운다. 데이터셋 허용 목록이 비어 있으면 거부한다. Slack 사용자·채널 허용 목록은 사용하지 않는다. Superset 서비스 계정은 DB 로그인 방식(`provider=db`)과 대상 데이터셋 읽기 및 Chart/Dashboard 생성·수정 권한이 필요하다. 저장 지표와 필요한 그룹 컬럼은 Superset 데이터셋에 미리 정의한다.

**데이터 경계:** Superset 권한은 서비스 계정 기준이며 Slack 사용자의 Superset 계정을 대리하지 않는다. 봇이 명령을 수신하는 곳에서는 누구나 등록된 데이터셋을 조회하고 생성 요청을 할 수 있다. 질문·허용 데이터셋 컬럼/지표 이름·조회 결과는 외부 Anthropic API로 전송되며 응답 채널 참여자에게 보인다. 외부 전송 및 Slack 공유가 허용된 데이터셋만 등록한다. 생성/취소 버튼은 해당 요청자만 조작할 수 있다. 비밀번호·API 키는 프롬프트나 응답에 넣지 않는다. 확인 상태와 감사 기록은 기존 봇 PostgreSQL의 `superset_dashboard_confirmation`, `superset_audit`에 저장하며, 별도 DB나 Slack 엔드포인트를 만들지 않는다.

Superset 4.1 [차트 API](https://github.com/apache/superset/blob/4.1/superset/charts/api.py), [차트 조회](https://github.com/apache/superset/blob/4.1/superset/charts/data/api.py), [차트 플러그인](https://github.com/apache/superset/blob/4.1/superset-frontend/src/visualizations/presets/MainPreset.js) 계약을 기준으로 구현했다.

PostgreSQL 회귀 테스트는 `SUPERSET_TEST_DATABASE_URL`이 지정된 경우에만 실행한다. 테스트는 임시 스키마를 만들고 정리하므로, 스키마 생성 권한이 있는 전용 테스트 DB를 사용한다.

```bash
SUPERSET_TEST_DATABASE_URL='postgresql://user:password@localhost:5432/testdb' pnpm test
```


### Superset 토큰 발급

Superset의 `/swagger/v1`에서 `POST /api/v1/security/login`을 다음 본문으로 실행하면 access/refresh token을 함께 받는다. 예제의 비밀번호는 로컬에서만 입력하고 응답 토큰을 채팅·로그·커밋에 남기지 않는다.

```json
{
  "username": "bot-service-account",
  "password": "<서비스 계정 비밀번호>",
  "provider": "db",
  "refresh": true
}
```

`POST /api/v1/security/refresh`에 `Authorization: Bearer <refresh_token>` 헤더를 보내면 새 `access_token`을 받는다. 이 API는 refresh token을 재발급하지 않으므로 refresh token 만료 후에는 다시 로그인해야 한다. SSO 브라우저 세션만으로 로그인하는 계정이 아니라 DB 인증 서비스 계정이 필요하다(LDAP 인증 계정은 `provider=ldap`).

현재 봇은 계정 로그인 방식이며, 위에서 따로 발급한 토큰을 환경 변수로 받는 기능은 아직 없다. 토큰 직접 주입·자동 갱신은 별도 인증 방식 변경이 필요하다. API 계약: [Flask-AppBuilder 4.5.1 Security API](https://github.com/dpgaspar/Flask-AppBuilder/blob/v4.5.1/flask_appbuilder/security/api.py).



## 구조

```
src/
  routes/        Slack 수신 — event / slash / interaction (.post.ts) · event.get.ts
  plugins/       injectContext.ts(WebClient·DB pool 주입)
  services/      도메인 로직(bus·coop·lecture·koin·rag·member…)
    slack/       Slack 핸들러 — features/<기능>(구현) · registry/(등록표)
  tasks/         scheduledTasks (예: crawl/clarity)
  utils/         Slack 전송·서명 검증·파일 등 공용 함수
  infra/         외부 연결 어댑터 — postgres(공유 풀), LLM(openai·anthropic·ollama)
  constant/      JSON 상수 (@/constant 별칭)
  types/         index.d.ts (env 타입 등)
nitro.config.ts  srcDir=src, tasks, KV(fs), scheduledTasks
```

## Slack 연동 (HTTP 웹훅)

소켓 모드는 폐기되었다. Slack App의 Event Subscriptions / Slash Commands / Interactivity
Request URL을 각각 배포 도메인의 `/event`, `/slash`, `/interaction`으로 설정한다.
(앱 매니페스트: [`slack-app-manifest.yml`](./slack-app-manifest.yml))
