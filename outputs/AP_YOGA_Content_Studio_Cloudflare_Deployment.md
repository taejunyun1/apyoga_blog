# A.P YOGA Content Studio Cloudflare 배포 기록

## 프로덕션

- 서비스 URL: [https://ap-yoga-content-studio.pages.dev/](https://ap-yoga-content-studio.pages.dev/)
- Cloudflare Pages 프로젝트: `ap-yoga-content-studio`
- 방식: Direct Upload
- 프로덕션 브랜치: `master`
- 최초 배포 URL: `https://3500bd7b.ap-yoga-content-studio.pages.dev`
- Wrangler: `4.110.0`
- 배포일: 2026-07-11

## 적용한 설정

`wrangler.jsonc`:

```json
{
  "$schema": "./node_modules/wrangler/config-schema.json",
  "name": "ap-yoga-content-studio",
  "pages_build_output_dir": "./dist",
  "compatibility_date": "2026-07-11"
}
```

재배포:

```bash
npm install
npm run deploy:cloudflare
```

`predeploy:cloudflare`가 `npm run build`를 먼저 실행하고, 성공하면 `wrangler pages deploy --branch master`를 호출합니다.

## 검증 결과

- `/`: HTTP 200, HTML 응답
- `/studio/deployment-check`: HTTP 200, Vue SPA fallback 응답
- `/manifest.webmanifest`: HTTP 200, `application/manifest+json`
- 공개 브라우저 제목: `A.P YOGA Content Studio`
- 홈 접근성 트리와 새 글 생성 라우팅 확인
- 새 글 클릭 후 `/studio/{draftId}` 이동 확인
- 브라우저 콘솔 오류·경고 없음
- PWA 빌드에서 `sw.js`, Workbox, 192/512 아이콘 생성 확인

## 운영 주의사항

- 현재 데이터와 사진은 사용자의 브라우저 IndexedDB에만 저장됩니다.
- 현재 생성기는 `LocalAIProvider`이며 외부 AI API를 호출하지 않습니다.
- API 키는 코드나 `wrangler.jsonc`에 넣지 않고 `wrangler secret put`으로 등록합니다.
- `.wrangler/`, `.dev.vars`, `.dev.vars.*`는 Git에서 제외됩니다.
- Direct Upload 프로젝트는 같은 프로젝트에서 Git integration으로 전환할 수 없습니다.
- 커스텀 도메인과 Cloudflare Access는 아직 연결하지 않았습니다.
