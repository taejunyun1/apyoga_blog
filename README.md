# A.P YOGA Content Studio MVP

`AP_YOGA_Content_Studio_4Docs_v7`의 네 기획 문서를 바탕으로 만든 로컬 기능형 PWA입니다. 사진을 브라우저 안에서 정리하고 얼굴을 가린 뒤, 짧은 수련 메모로 네이버 블로그와 인스타그램 초안을 생성·수정·복사할 수 있습니다.

## 현재 MVP에서 되는 일

- 최대 10장 JPEG, PNG, WebP, HEIC/HEIF 선택
- 긴 변 1280px 리사이즈, JPEG 재인코딩, 2MB 목표 압축, EXIF 제거
- 번들된 MediaPipe 모델을 이용한 브라우저 내 얼굴 감지와 수동 가림 추가
- 블러(모자이크), 흰색 원, A.P YOGA 스티커 가림과 이동·크기·회전·삭제·실행 취소
- 가림 픽셀을 실제 편집본 Blob에 반영하고 원본은 영구 저장하지 않음
- 사진 순서와 대표 사진 선택
- 수련 메모, 포함/제외 표현, 글쓰기 방식, 채널별 톤 설정
- 공통 콘텐츠 브리프 확인 후 네이버·인스타그램 독립 생성
- 한 채널 실패 시 성공 결과 보존과 실패 채널만 재시도
- 부분 재작성, 후보 선택, 채널별 복사와 클립보드 실패 대체 UI
- IndexedDB 자동 저장, 새로고침 복원, 작성 이력, 편집 이미지 5일 만료 정리
- 설치 가능한 PWA 매니페스트와 앱 아이콘

## 실행 환경

- Node.js `22.12.0` 이상
- npm 10 이상 권장
- Chromium 최신 버전 또는 iPhone Safari 최신 버전 권장

```bash
npm install
npm run dev
```

개발 서버 주소는 터미널에 표시됩니다. 기본 Vite 주소는 `http://localhost:5173`입니다.

## 검증 명령

```bash
npm run typecheck
npm run test:run
npm run test:e2e
npm run build
npm run preview
```

E2E는 Chromium의 `390×844` 모바일 뷰포트와 `1280×900` 데스크톱 뷰포트에서 전체 작성·복원 흐름과 부분 성공 재시도를 확인합니다.

기본 `npm run test:e2e`는 로컬 Vite 서버에서 인증이 필요 없는 흐름만 실행합니다. 인증 E2E는 Pages Functions를 제공하는 별도 테스트 서버를 준비하고, 프로덕션 자격 증명이 아닌 일회용 가짜 `AUTH_USERNAME`, `AUTH_PASSWORD_HASH`, `SESSION_SECRET`과 테스트용 KV binding만 설정한 뒤 실행합니다. 외부 서버 주소는 셸 환경에서 주입하고 저장소나 명령 기록에 secret 값을 넣지 마세요.

```bash
PLAYWRIGHT_BASE_URL="$AUTH_TEST_BASE_URL" npm run test:e2e:auth
```

`test:e2e:auth`는 `PLAYWRIGHT_AUTH=1` 모드를 사용해 `auth-flow.spec.ts`만 두 뷰포트에서 실행합니다. `PLAYWRIGHT_BASE_URL`을 생략하면 Functions가 없는 Vite 서버가 선택되므로 인증 스위트에는 반드시 외부 테스트 URL을 제공해야 합니다.

## 로컬 데이터 초기화

모든 임시 글과 편집 사진은 브라우저의 `ap-yoga-content-studio` IndexedDB에 저장됩니다. 초기화하려면 브라우저 개발자 도구의 Application/Storage에서 해당 사이트의 IndexedDB를 삭제하거나 사이트 데이터 전체 지우기를 실행한 뒤 앱을 새로고침하세요.

초기화는 복구할 수 없습니다. 실제 수련 사진을 사용했다면 테스트가 끝난 뒤 사이트 데이터를 지우는 것을 권장합니다.

## 개인정보와 이미지 처리

- 이 MVP는 사진을 서버로 업로드하지 않습니다.
- 원본 파일을 영구 저장하지 않고, Canvas로 다시 만든 편집본만 IndexedDB에 보관합니다.
- 얼굴 좌표는 로컬 임시 글의 가림 편집에만 사용하며 얼굴 임베딩이나 회원 식별값을 만들지 않습니다.
- 편집본은 생성 시각 기준 5일 후 만료 대상으로 정리됩니다.
- 자동 얼굴 감지는 보조 기능입니다. 게시 전 모든 사진의 가림 상태를 사용자가 직접 확인해야 합니다.

## AI 동작과 제한

프로덕션 생성 요청은 Cloudflare Pages Functions에서 OpenAI Responses API로 전달됩니다. `OPENAI_API_KEY`는 Pages secret으로만 보관되며 브라우저 코드나 응답에 노출되지 않습니다. Responses 요청에는 `store: false`를 사용하고, 네이버 본문은 500자 이상인지 검증합니다. OpenAI 호출이 실패하거나 응답 계약을 충족하지 못하면 로컬 생성 결과로 대체될 수 있으므로 게시 전에 문장, 날짜, 수업 정보를 반드시 확인하세요.

자동 게시, Cloudflare Access, D1/R2 서버 저장, 승인형 Brand Memory는 구현 범위 밖입니다. Safari의 HEIC 입력·메모리 사용·PWA 설치는 실제 기기에서 별도 확인이 필요합니다.

## Cloudflare Pages 배포

프로덕션 URL: [https://ap-yoga-content-studio.pages.dev/](https://ap-yoga-content-studio.pages.dev/)

로그인 URL: [https://ap-yoga-content-studio.pages.dev/login](https://ap-yoga-content-studio.pages.dev/login)

이 프로젝트는 Cloudflare Pages Direct Upload 방식입니다. `wrangler.jsonc`의 프로젝트명과 `dist` 출력 경로를 사용하며, 아래 명령은 빌드를 먼저 실행한 뒤 `master` 프로덕션 브랜치로 업로드합니다.

```bash
npm run deploy:cloudflare
```

배포 전 확인:

```bash
npx wrangler whoami
npx wrangler pages project list
```

배포 이력 확인:

```bash
npx wrangler pages deployment list --project-name ap-yoga-content-studio
```

Direct Upload 프로젝트는 같은 프로젝트에서 Git integration 방식으로 전환할 수 없습니다. 향후 GitHub 자동 배포가 필요하면 Git 연동용 Pages 프로젝트를 새로 만드는 편이 안전합니다. `.dev.vars`나 비밀 값을 Git에 커밋하지 마세요.

### 프로덕션 로그인 운영

Pages에는 `AUTH_USERNAME`, `AUTH_PASSWORD_HASH`, `SESSION_SECRET` 세 secret과 로그인 시도 제한용 `AUTH_RATE_LIMIT` KV binding이 필요합니다. 실제 아이디와 비밀번호, 파생 해시, 세션 secret 값은 문서·명령 기록·저장소에 남기지 않습니다.

최초 등록은 대화형 터미널에서 아래 명령만 사용합니다. 아이디와 비밀번호는 이 명령의 프롬프트를 통해서만 입력하고, 개별 `wrangler pages secret put` 명령이나 파일에 직접 넣지 마세요.

```bash
npm run auth:provision
```

비밀번호를 잊었거나 로그인할 수 없는 복구 상황에서는 대화형 TTY에서 아래 초기화 명령을 사용합니다. `auth:provision`은 최초 설정용이고 `auth:reset`은 기존 관리자 계정의 비밀번호 복구용입니다. 명령이 묻는 기존 관리자 아이디는 초기화 후 로그인 확인에만 사용하며, 아이디는 변경하지 않습니다.

```bash
npm run auth:reset
```

초기화 명령은 새 비밀번호와 확인 값을 숨김 입력으로 받은 뒤, `AUTH_PASSWORD_HASH`와 새 `SESSION_SECRET`을 Wrangler 표준 입력으로 등록하고, 프로덕션 배포를 완료한 다음, D1의 `auth_credentials` override를 삭제합니다. 마지막으로 canonical 프로덕션 로그인 endpoint에서 새 비밀번호 로그인이 `204`인지 확인하고 확인 세션을 로그아웃한 뒤에만 완료를 알립니다. 새 `SESSION_SECRET` 등록은 모든 기존 로그인 세션을 무효화합니다.

명령을 중단했거나 secret 등록·배포·D1 삭제·로그인 확인 중 하나라도 실패했다면 초기화가 완료된 것으로 간주하지 마세요. 특히 배포 실패 시 D1 override를 유지하므로 기존 앱 비밀번호가 계속 동작합니다. D1 삭제가 실패하면 원인을 해결한 뒤 `npm run auth:reset` 전체를 다시 실행해야 합니다. 이 작업은 반드시 대화형 TTY에서 실행하며 평문 비밀번호, 파생 해시, session secret을 명령 인수·파일·로그에 남기지 않습니다.

`auth:provision`과 `auth:reset` 모두 비밀번호 해시와 새 `SESSION_SECRET`을 함께 등록하므로 기존 로그인 세션을 무효화합니다. 로그인 쿠키의 최대 수명은 30일이며 로그아웃 또는 자격 증명 회전 시 그보다 일찍 종료됩니다.

로그인 실패 횟수는 Cloudflare KV에 저장됩니다. KV는 eventual consistency 방식이므로 엣지 위치가 다른 동시 요청에서는 제한 상태 반영이 잠시 늦거나 서로 다르게 보일 수 있습니다. 강한 일관성이 필요한 계정 잠금 수단으로 사용하지 마세요.

### OpenAI secret 운영

`OPENAI_API_KEY`는 대화형 프로비저닝 명령의 숨김 프롬프트로만 입력합니다. 이 명령은 키를 명령줄 인수나 파일에 기록하지 않고 Wrangler의 표준 입력으로 전달합니다. 등록 후 프로덕션을 배포합니다.

```bash
npm run openai:provision
npm run deploy:cloudflare
```

공유 채팅에 입력했던 OpenAI API key를 회전할 때는 기존 키를 먼저 폐기하지 마세요. OpenAI에서 별도의 대체 키를 생성한 다음 그 키를 숨김 프롬프트에 입력해 `npm run openai:provision`을 실행하고, 이어서 반드시 `npm run deploy:cloudflare`로 다시 배포하세요. 프로덕션에서 콘텐츠 생성이 정상 동작하는지 확인한 뒤에만 기존 공유 키를 폐기합니다. 키 값을 문서, 셸 기록, `.env` 또는 `.dev.vars`에 남기지 마세요.

## 운영형 전환 로드맵

현재 채널별 초안 생성은 OpenAI Responses API를 사용하고, 공통 브리프 분석·부분 재작성·검수는 로컬에서 처리합니다. UI와 Pinia 스토어의 포트/어댑터 경계를 유지하며 다음 운영 기능을 확장할 수 있습니다.

1. `OpenAIProvider`: 현재 연결된 채널별 생성의 품질·비용·오류 관측 강화
2. `D1DraftRepository`와 `R2ImageRepository`: 서버 임시 저장, TTL 삭제, 감사 가능한 작업 상태
3. Cloudflare Access: Google 로그인과 허용 사용자 정책
4. Worker API: 업로드 서명, 생성 요청, 채널별 재시도, 비용·오류 로깅
5. Brand Memory: 사용자 승인 후에만 후보를 정책으로 승격

구현 근거와 제외 범위는 [`docs/requirements-traceability.md`](docs/requirements-traceability.md), 설계는 [`docs/superpowers/specs/2026-07-11-ap-yoga-content-studio-mvp-design.md`](docs/superpowers/specs/2026-07-11-ap-yoga-content-studio-mvp-design.md), 제작 계획은 [`docs/superpowers/plans/2026-07-11-ap-yoga-content-studio-mvp-implementation.md`](docs/superpowers/plans/2026-07-11-ap-yoga-content-studio-mvp-implementation.md)를 참고하세요.
