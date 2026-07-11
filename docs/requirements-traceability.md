# A.P YOGA Content Studio MVP 요구사항 추적표

## 기준 문서

- `01_UX_Design_Flow_and_Icon_Spec.md`
- `02_Product_Feature_BrandMemory_Priority.md`
- `03_AI_API_Multichannel_Architecture.md`
- `04_Cloudflare_Data_Security_Operations.md`

상태 표기: **완료**는 로컬 MVP에서 동작하고 검증 근거가 있는 항목, **수동 확인**은 실제 Safari/기기 확인이 남은 항목, **제외**는 후속 운영형 어댑터 범위입니다.

| 요구사항 | 상태 | 구현 근거 | 검증 근거 |
|---|---|---|---|
| 모바일 우선 홈, 새 글, 임시 글, 이력 | 완료 | `src/views/HomeView.vue`, `src/app/styles.css` | `tests/component/app-shell.test.ts`, E2E 전체 흐름 |
| 최대 10장과 JPEG/PNG/WebP/HEIC 선택 | 완료 | `src/features/studio/PhotoUploader.vue`, `src/adapters/image-processor.ts` | `tests/unit/image-processor.test.ts`, `tests/component/photo-uploader.test.ts` |
| HEIC/HEIF 변환 | 완료·수동 확인 | `heic2any` 지연 로드 | 단위 형식 판별, 실제 iPhone HEIC는 수동 확인 |
| 긴 변 1280px, 2MB 목표 압축, EXIF 제거 | 완료 | Canvas 디코드·리사이즈·JPEG 재인코딩 | `tests/unit/image-processor.test.ts`, Chromium E2E 업로드 |
| 원본 미보관, 편집본만 저장 | 완료 | `prepareImage`, `DexieStudioRepository.images` | `tests/unit/dexie-repository.test.ts`, E2E 복원 |
| 로컬 얼굴 자동 감지 | 완료·수동 확인 | `MediaPipeFaceDetector`, 번들된 WASM/모델 | `tests/unit/face-detector.test.ts`, 모델 실패 시 수동 대체; 실제 얼굴 사진 수동 확인 |
| 수동 가림 추가·이동·크기·회전·삭제·실행 취소 | 완료 | `FaceMaskEditor.vue`, `MaskStylePicker.vue` | `tests/component/face-mask-editor.test.ts`, E2E 수동 추가 |
| 블러/흰색/AP 스티커와 픽셀 반영 | 완료 | `applyMasksToBlob` | `tests/unit/image-processor.test.ts`, `tests/component/studio-photo-flow.test.ts` |
| 사진 순서, 대표 사진, 삭제 | 완료 | `PhotoOrganizer.vue`, `domain/rules.ts` | `tests/component/photo-organizer.test.ts`, `tests/unit/domain-rules.test.ts` |
| 메모, 포함/제외, 모드와 채널 톤 | 완료 | `MemoToneForm.vue` | `tests/component/memo-tone-form.test.ts`, E2E 전체 흐름 |
| 공통 AI 브리프 확인·수정·확정 | 완료 | `ContentBriefReview.vue`, `LocalAIProvider.analyzeImages` | `tests/component/content-brief-review.test.ts`, E2E 전체 흐름 |
| 네이버·인스타그램 독립 병렬 생성 | 완료 | `studio-store.ts`의 `Promise.allSettled` | `tests/unit/studio-store.test.ts`, `tests/component/studio-generation-flow.test.ts` |
| 한 채널 실패 시 성공 결과 보존·개별 재시도 | 완료 | 채널별 `ChannelResult`와 `retryChannel` | `tests/e2e/partial-success.spec.ts` 모바일·데스크톱 |
| 제목/도입/훅 후보와 결과 편집 | 완료 | `ResultEditor.vue` | `tests/component/results.test.ts`, E2E 전체 흐름 |
| 선택 구간 부분 재작성 | 완료 | `RewriteActionSheet.vue`, `rewriteSection` | `tests/unit/studio-store.test.ts`, `tests/component/results.test.ts` |
| 제목/본문/해시태그/전체 복사와 실패 대체 | 완료 | `BrowserClipboard`, `CopyActionGroup.vue` | `tests/unit/browser-clipboard.test.ts`, `tests/component/results.test.ts` |
| 자동 저장과 새로고침 복원 | 완료 | `use-autosave.ts`, Dexie draft 저장 | `tests/unit/autosave.test.ts`, `tests/component/draft-restore.test.ts`, E2E reload |
| 편집 이미지 5일 만료·정리 | 완료 | `expiresAtFor`, `cleanupExpired` | `tests/unit/domain-rules.test.ts`, `tests/unit/dexie-repository.test.ts` |
| 설치 가능한 PWA와 아이콘 | 완료 | `vite.config.ts`, `public/icons` | `tests/unit/pwa-build.test.ts`, `npm run build`, 매니페스트 점검 |
| 320px 무수평 오버플로, 44px 터치 영역, safe area | 완료 | `src/app/styles.css` | 390×844·1280×900 E2E, 브라우저 수동 점검 |
| 실제 iPhone Safari 8장·HEIC·PWA 설치 | 수동 확인 | 로컬 MVP 구현 완료 | 실제 기기 체크리스트로 확인 필요 |
| 실제 OpenAI API | 제외 | `AIProvider` 포트만 준비 | `OpenAIProvider` 후속 구현 |
| Cloudflare Access, Worker, D1, R2 | 제외 | 저장소/AI 포트만 준비 | 계정·도메인·비밀키 승인 후 구현 |
| Brand Memory 자동 후보화·승인 | 제외 | 설계 정책만 정의 | P1 후속 범위 |
| 자동 게시, 멀티테넌시, Threads/카카오/릴스 | 제외 | 미구현으로 명시 | 후속 제품 범위 결정 필요 |

## 재현 가능한 완료 검증

```bash
npm run typecheck
npm run test:run
npm run test:e2e
npm run build
```

추가 수동 점검:

1. `dist/manifest.webmanifest`의 이름·색상·192/512 아이콘 경로 확인
2. `npm run preview`에서 모바일 390×844와 데스크톱 1280×900 확인
3. 실제 iPhone Safari에서 HEIC 사진, 8장 처리, 얼굴 감지, 홈 화면 설치 확인
4. 게시 전 가림·의학 표현·수업 정보 체크리스트를 사람이 최종 확인
