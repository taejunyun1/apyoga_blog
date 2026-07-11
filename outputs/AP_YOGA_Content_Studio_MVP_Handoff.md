# A.P YOGA Content Studio MVP 인수인계

## 결과

네 문서를 기준으로 한 로컬 기능형 MVP가 완성되었습니다. Vue 3 PWA에서 사진 선택 → 브라우저 내 얼굴 가림 → 사진 구성 → 수련 메모 → 공통 브리프 확인 → 네이버/인스타그램 독립 생성 → 부분 재작성·복사 → 자동 저장·복원의 전체 흐름이 동작합니다.

Cloudflare Pages 프로덕션: [https://ap-yoga-content-studio.pages.dev/](https://ap-yoga-content-studio.pages.dev/)

## 실행

프로젝트 루트에서 Node.js 22.12 이상을 사용합니다.

```bash
npm install
npm run dev
```

검증:

```bash
npm run typecheck
npm run test:run
npm run test:e2e
npm run build
```

E2E는 Chromium 모바일 `390×844`와 데스크톱 `1280×900`에서 전체 작성·새로고침 복원, 부분 성공·실패 채널 재시도를 검증합니다.

## 개인정보 처리

- 사진은 서버로 전송하지 않습니다.
- 원본은 영구 저장하지 않고 Canvas로 다시 만든 편집본만 IndexedDB에 저장합니다.
- 긴 변 1280px 이하, JPEG 재인코딩, 2MB 목표 압축으로 EXIF를 제거합니다.
- 얼굴 좌표는 가림 편집에만 사용하며 얼굴 임베딩이나 사용자 식별값을 만들지 않습니다.
- 편집 이미지는 생성 5일 후 만료 대상으로 정리됩니다.

## AI와 운영 범위

현재 생성기는 네트워크를 사용하지 않는 결정론적 `LocalAIProvider`입니다. 실제 OpenAI, Cloudflare Access, Worker, D1/R2, Brand Memory, 자동 게시는 제외되어 있습니다. 운영형 전환 시 기존 포트에 `OpenAIProvider`, `D1DraftRepository`, `R2ImageRepository`를 추가하도록 설계되어 있습니다.

Safari HEIC, 실제 얼굴 사진, 사진 8장 메모리 사용, 홈 화면 PWA 설치는 실제 iPhone에서 추가 확인이 필요합니다.

상세 설계와 실행 체크리스트는 같은 `outputs` 폴더의 다음 파일을 참고하세요.

- `AP_YOGA_Content_Studio_MVP_Design.md`
- `AP_YOGA_Content_Studio_MVP_Plan.md`
- `AP_YOGA_Content_Studio_MVP_Concept.png`
