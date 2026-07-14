# Emotional Photo Copy Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 사진 분석의 구체성은 유지하면서 최종 결과를 장면 나열이 아닌 감성적인 발행용 글로 만들고, 사진·메모 분석 중 진행 상태를 명확히 표시한다.

**Architecture:** 서버 생성 프롬프트와 결과 검증이 보고서형 사진 문장을 차단하고, 로컬 대체 생성기도 동일한 감성 변환 규칙을 따른다. 중간 확인 화면은 분석 정보를 유지하되 최종 결과 카드는 원본 설명을 숨기며, `StudioView`가 지속형 분석 토스트와 `MemoToneForm`의 busy 상태를 관리한다.

**Tech Stack:** Vue 3, TypeScript, Pinia, Cloudflare Pages Functions, Vitest, Testing Library, Playwright

## Global Constraints

- 사진별 상세 분석 문장은 중간 `AI가 이해한 내용` 화면에만 표시한다.
- 최종 발행용 결과에는 `첫 번째 사진에는`, `2번째 사진은` 같은 순서형 장면 나열을 허용하지 않는다.
- 최종 글에는 사진 분석에서 얻은 구체적인 시각 단서를 최소 두 개 이상 유지한다.
- 네이버 본문은 500자 이상을 유지한다.
- 사진 블러 또는 사진 가림 단계는 추가하지 않는다.
- 분석 중에는 지속 토스트를 표시하고 중복 제출을 막는다.

---

### Task 1: 서버 생성 규칙과 보고서형 문구 검증

**Files:**
- Modify: `tests/unit/openai-content.test.ts`
- Modify: `functions/lib/openai-content.ts`

**Interfaces:**
- Consumes: `GenerateContentInput.brief.imageDescriptions`, `validateGeneratedContent()`
- Produces: 보고서형 사진 순서 표현을 거부하는 `validateEmotionalPhotoCopy()` 내부 검증과 강화된 생성 프롬프트

- [ ] **Step 1: 보고서형 네이버·인스타그램 결과가 거부되는 실패 테스트 작성**

```ts
it.each([
  ["naver", { ...validNaver(), body: `${validNaver().body} 첫 번째 사진에는 큰 창과 매트가 보입니다.` }],
  ["instagram", { ...validInstagram(), captionLong: `${validInstagram().captionLong} 2번째 사진은 나무 바닥을 보여 줍니다.` }],
] as const)("rejects report-style photo enumeration in %s copy", (channel, content) => {
  expect(() => validateGeneratedContent(channel, content, request))
    .toThrow("사진 장면을 나열하지 않고 감성적인 발행 문장으로 작성해 주세요.")
})
```

- [ ] **Step 2: 테스트를 실행해 RED 확인**

Run: `npm test -- --run tests/unit/openai-content.test.ts`

Expected: FAIL because report-style photo enumeration is currently accepted.

- [ ] **Step 3: 최소 검증과 프롬프트 규칙 구현**

```ts
const PHOTO_REPORT_PATTERN = /(?:사진\s*(?:\d+|[첫두세네다섯여섯일곱여덟아홉열]+\s*번째)|\d+\s*번째\s*사진|(?:첫|두|세|네|다섯|여섯|일곱|여덟|아홉|열)\s*번째\s*사진)(?:에는|은|는|에서|을|를)?/u

function validateEmotionalPhotoCopy(channel: ContentChannel, content: GeneratedContent): void {
  const text = channel === "naver"
    ? (content as GeneratedNaver).body
    : (content as GeneratedInstagram).captionLong
  if (PHOTO_REPORT_PATTERN.test(text)) {
    throw new OpenAIContentError("사진 장면을 나열하지 않고 감성적인 발행 문장으로 작성해 주세요.", true)
  }
}
```

Call this before `validatePhotoGrounding()`. Update `promptFor()` to require emotional transformation of light, color, props, and space and prohibit ordinal photo labels. Update `rewritePrompt()` so `사진 분위기 더하기` strengthens visual mood without listing scenes or inventing facts.

- [ ] **Step 4: 단위 테스트 통과 확인**

Run: `npm test -- --run tests/unit/openai-content.test.ts`

Expected: PASS.

- [ ] **Step 5: 변경 커밋**

```bash
git add tests/unit/openai-content.test.ts functions/lib/openai-content.ts
git commit -m "2026-07-14 보고서형 사진 문구 차단"
```

---

### Task 2: 로컬 대체 생성의 감성 변환

**Files:**
- Modify: `tests/unit/local-ai-provider.test.ts`
- Modify: `src/adapters/local-ai-provider.ts`

**Interfaces:**
- Consumes: `safeImageDescriptions(input)`, `brief.overallMood`
- Produces: 순서형 사진 설명 없이 시각 단서를 감성 문단에 섞는 `emotionalVisualParagraphs()`

- [ ] **Step 1: 감성 변환 요구를 표현하는 실패 테스트 작성**

```ts
expect(naver.body).toContain("햇살")
expect(naver.body).toContain("나무 바닥")
expect(naver.body).not.toMatch(/(?:\d+번째|첫 번째)\s*사진/u)
expect(instagram.captionLong).toContain("햇살")
expect(instagram.captionLong).toContain("나무 바닥")
expect(instagram.captionLong).not.toMatch(/(?:\d+번째|첫 번째)\s*사진/u)
```

Change rewrite test instructions from `사진 설명 늘리기` to `사진 분위기 더하기`.

- [ ] **Step 2: 로컬 생성 테스트를 실행해 RED 확인**

Run: `npm test -- --run tests/unit/local-ai-provider.test.ts`

Expected: FAIL because local output currently emits `N번째 사진에는`.

- [ ] **Step 3: 최소 감성 변환 구현**

```ts
function emotionalVisualParagraphs(input: ChannelInput): string[] {
  const mood = sanitizeLocalFragment(input.brief.overallMood, input.avoid) || "차분한"
  return safeImageDescriptions(input).map(({ description }, index) => index % 2 === 0
    ? `${description}에서 느껴지는 빛과 결을 따라 ${mood} 호흡이 공간 안에 천천히 머물렀습니다.`
    : `${description}의 색과 배치는 서두르지 않는 움직임과 어우러져 오늘 수련의 여운을 더욱 선명하게 남겼습니다.`)
}
```

Use these paragraphs in `naverBody()` and join them naturally into `captionLong`. Keep `imagePlacements.caption` as internal image mapping metadata. Update local rewrite branches to recognize `사진 분위기 더하기`.

- [ ] **Step 4: 로컬 생성 테스트 통과 확인**

Run: `npm test -- --run tests/unit/local-ai-provider.test.ts`

Expected: PASS with Naver body length still at least 500.

- [ ] **Step 5: 변경 커밋**

```bash
git add tests/unit/local-ai-provider.test.ts src/adapters/local-ai-provider.ts
git commit -m "2026-07-14 로컬 사진 감성 문체 적용"
```

---

### Task 3: 최종 사진 카드와 재작성 문구 정리

**Files:**
- Modify: `tests/component/result-image-map.test.ts`
- Modify: `tests/component/results.test.ts`
- Modify: `tests/unit/rewrite-actions.test.ts`
- Modify: `tests/unit/studio-store.test.ts`
- Modify: `tests/e2e/studio-flow.spec.ts`
- Modify: `src/features/studio/ResultImageMap.vue`
- Modify: `src/features/studio/rewrite-actions.ts`

**Interfaces:**
- Consumes: `NaverOutput.imagePlacements`, `rewriteActions`
- Produces: 설명을 숨긴 최종 사진 카드와 `사진 분위기 더하기` 재작성 요청

- [ ] **Step 1: 최종 화면 노출 규칙의 실패 테스트 작성**

```ts
expect(screen.getByRole("img", { name: placement.caption })).toBeTruthy()
expect(screen.queryByText(placement.caption)).not.toBeInTheDocument()
expect(screen.getByRole("button", { name: "사진 분위기 더하기" })).toBeTruthy()
expect(screen.queryByRole("button", { name: "사진 설명 늘리기" })).toBeNull()
```

Update pending rewrite keys and feedback fixtures to use `사진 분위기 더하기` and `사진의 분위기를 보강했어요`.

- [ ] **Step 2: UI 관련 테스트를 실행해 RED 확인**

Run: `npm test -- --run tests/component/result-image-map.test.ts tests/component/results.test.ts tests/unit/rewrite-actions.test.ts tests/unit/studio-store.test.ts`

Expected: FAIL because the caption is visible and the old action label remains.

- [ ] **Step 3: 최소 UI 구현**

Remove only the visible caption paragraph from `ResultImageMap.vue` while retaining `alt: placement.caption`. Replace the rewrite action with:

```ts
{
  channel: "naver",
  section: "body",
  instruction: "사진 분위기 더하기",
  label: "사진 분위기 더하기",
  feedback: { preview: "네이버 본문", toast: "사진의 분위기를 보강했어요" }
}
```

Update E2E selectors to the new label.

- [ ] **Step 4: UI 관련 테스트 통과 확인**

Run: `npm test -- --run tests/component/result-image-map.test.ts tests/component/results.test.ts tests/unit/rewrite-actions.test.ts tests/unit/studio-store.test.ts`

Expected: PASS.

- [ ] **Step 5: 변경 커밋**

```bash
git add tests/component/result-image-map.test.ts tests/component/results.test.ts tests/unit/rewrite-actions.test.ts tests/unit/studio-store.test.ts tests/e2e/studio-flow.spec.ts src/features/studio/ResultImageMap.vue src/features/studio/rewrite-actions.ts
git commit -m "2026-07-14 최종 사진 설명 숨김 및 감성 재작성"
```

---

### Task 4: 사진·메모 분석 중 지속 토스트와 제출 잠금

**Files:**
- Modify: `tests/component/memo-tone-form.test.ts`
- Modify: `tests/component/studio-generation-flow.test.ts`
- Modify: `src/features/studio/MemoToneForm.vue`
- Modify: `src/views/StudioView.vue`

**Interfaces:**
- Consumes: `store.busy`, `store.analyze()`
- Produces: `MemoToneForm.busy: boolean`, `showToast(message, { persistent })`, 분석 성공 토스트

- [ ] **Step 1: busy 폼과 지속 토스트 실패 테스트 작성**

```ts
render(MemoToneForm, { props: { ...baseProps, busy: true } })
expect(screen.getByRole("button", { name: "사진과 메모 분석 중…" })).toBeDisabled()
```

In the Studio flow, hold `analyzeImages()` with a deferred promise, submit the memo, assert the persistent status `사진과 메모를 분석하고 있어요…` and disabled button, resolve the promise, then assert `사진 분석이 완료됐어요`.

- [ ] **Step 2: 분석 상태 테스트를 실행해 RED 확인**

Run: `npm test -- --run tests/component/memo-tone-form.test.ts tests/component/studio-generation-flow.test.ts`

Expected: FAIL because the form has no busy prop and no analysis toast.

- [ ] **Step 3: 최소 분석 상태 구현**

```ts
function showToast(message: string, options: { persistent?: boolean } = {}) {
  toastMessage.value = message
  toastId.value += 1
  if (toastTimer) clearTimeout(toastTimer)
  toastTimer = options.persistent ? null : setTimeout(() => { toastMessage.value = null }, 2400)
}

async function submitMemo(value: Parameters<typeof store.updateMemo>[0]) {
  if (store.busy) return
  store.updateMemo(value)
  showToast("사진과 메모를 분석하고 있어요…", { persistent: true })
  const completed = await run(() => store.analyze())
  if (completed) showToast("사진 분석이 완료됐어요")
  else {
    if (toastTimer) clearTimeout(toastTimer)
    toastMessage.value = null
  }
}
```

Pass `:busy="store.busy"` to `MemoToneForm`. Add `busy: boolean` with a default of `false`, prevent emission while busy, disable the button for `busy || !memo.trim()`, and render the busy label.

- [ ] **Step 4: 분석 상태 테스트 통과 확인**

Run: `npm test -- --run tests/component/memo-tone-form.test.ts tests/component/studio-generation-flow.test.ts`

Expected: PASS.

- [ ] **Step 5: 변경 커밋**

```bash
git add tests/component/memo-tone-form.test.ts tests/component/studio-generation-flow.test.ts src/features/studio/MemoToneForm.vue src/views/StudioView.vue
git commit -m "2026-07-14 사진 메모 분석 진행 토스트 추가"
```

---

### Task 5: 전체 회귀 검증, 운영 배포 및 실제 흐름 확인

**Files:**
- Verify: all modified files

**Interfaces:**
- Consumes: Tasks 1-4의 통합 결과
- Produces: GitHub 브랜치와 Cloudflare Pages 운영 배포

- [ ] **Step 1: 정적 검사와 전체 테스트 실행**

Run: `npm run typecheck && npm test -- --run && npm run build`

Expected: all checks PASS and production build succeeds.

- [ ] **Step 2: 핵심 E2E 실행**

Run: `npx playwright test tests/e2e/studio-flow.spec.ts`

Expected: PASS with the new rewrite action label and photo mapping UI.

- [ ] **Step 3: 변경 사항 최종 검토**

Run: `git diff HEAD~4 --check && git status --short --branch`

Expected: no whitespace errors and no unexpected files.

- [ ] **Step 4: 원격 브랜치 푸시**

Run: `git push origin codex/photo-aware-generation`

Expected: the existing pull request updates successfully.

- [ ] **Step 5: Cloudflare Pages 배포**

Run: `npm run deploy:cloudflare`

Expected: deployment succeeds and `https://ap-yoga-content-studio.pages.dev` serves the new build.

- [ ] **Step 6: 운영 환경 실제 흐름 검증**

Use the production login, upload test photos from the authorized Resource directory, enter a memo, and verify:

- persistent analysis toast appears while analysis is pending;
- final copy uses photo details without ordinal scene narration;
- final cards show thumbnails and placements without visible raw descriptions;
- `사진 분위기 더하기` works and shows its toast.

- [ ] **Step 7: 최종 상태 기록**

Run: `git status --short --branch && git log -5 --oneline`

Expected: clean working tree and remote branch up to date.
