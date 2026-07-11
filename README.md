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

현재 생성기는 네트워크를 사용하지 않는 결정론적 `LocalAIProvider`입니다. 결과 화면에도 “로컬 데모 AI”라고 표시됩니다. 실제 OpenAI 결과나 최신 수업·예약 정보를 제공하지 않으므로 게시 전에 문장, 날짜, 수업 정보를 반드시 확인하세요.

자동 게시, 실제 로그인, Cloudflare Access, D1/R2 서버 저장, 실제 OpenAI 호출, 승인형 Brand Memory는 구현 범위 밖입니다. Safari의 HEIC 입력·메모리 사용·PWA 설치는 실제 기기에서 별도 확인이 필요합니다.

## Cloudflare Pages 배포

프로덕션 URL: [https://ap-yoga-content-studio.pages.dev/](https://ap-yoga-content-studio.pages.dev/)

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

Direct Upload 프로젝트는 같은 프로젝트에서 Git integration 방식으로 전환할 수 없습니다. 향후 GitHub 자동 배포가 필요하면 Git 연동용 Pages 프로젝트를 새로 만드는 편이 안전합니다. API 키는 `wrangler secret put`으로 입력하고 `.dev.vars`나 비밀 값을 Git에 커밋하지 마세요.

## 운영형 전환 로드맵

현재 UI와 Pinia 스토어는 포트/어댑터 경계를 사용합니다. 다음 단계에서는 화면 계약을 유지하며 아래 어댑터를 추가합니다.

1. `OpenAIProvider`: 공통 브리프, 채널 생성, 부분 재작성, 검수의 구조화 출력 연결
2. `D1DraftRepository`와 `R2ImageRepository`: 서버 임시 저장, TTL 삭제, 감사 가능한 작업 상태
3. Cloudflare Access: Google 로그인과 허용 사용자 정책
4. Worker API: 업로드 서명, 생성 요청, 채널별 재시도, 비용·오류 로깅
5. Brand Memory: 사용자 승인 후에만 후보를 정책으로 승격

구현 근거와 제외 범위는 [`docs/requirements-traceability.md`](docs/requirements-traceability.md), 설계는 [`docs/superpowers/specs/2026-07-11-ap-yoga-content-studio-mvp-design.md`](docs/superpowers/specs/2026-07-11-ap-yoga-content-studio-mvp-design.md), 제작 계획은 [`docs/superpowers/plans/2026-07-11-ap-yoga-content-studio-mvp-implementation.md`](docs/superpowers/plans/2026-07-11-ap-yoga-content-studio-mvp-implementation.md)를 참고하세요.
