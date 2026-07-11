# Visual Implementation Reference

## Source

- Concept: `outputs/AP_YOGA_Content_Studio_MVP_Concept.png`
- Native concept size: 1536 × 1024
- Reference screens: mobile home, face-mask editor, channel result editor

The generated concept is a layout and visual-system reference. All shipped UI text remains code-native. Generated yoga photography is not bundled; user-selected photos occupy the media regions.

## Color Lock

- Page background: warm ivory `#F6F1E8`
- Surface: white `#FFFFFF`
- Primary text and strong outlines: charcoal `#2B2B2B`
- Primary action and selected outline: apricot `#E7B98A`
- Soft selected background: `#F0D7B5`
- Muted text: `#6F6A63`
- Subtle border: `#DDD7CE`
- Success: `#269C50`
- Error: `#B94B45`

No gradients, glass effects, glows, or colored image overlays are allowed.

## Typography

- Family: `Pretendard Variable`, `Pretendard`, `-apple-system`, `BlinkMacSystemFont`, `Segoe UI`, sans-serif
- Product title: 31px mobile / 36px desktop, 760 weight, 1.08 line-height
- Screen title: 20px, 720 weight, 1.25 line-height
- Section title: 17px, 720 weight, 1.35 line-height
- Body: 15px, 450 weight, 1.65 line-height
- Control: 15px, 650 weight, 1.2 line-height
- Caption/status: 13px, 500 weight, 1.4 line-height

## Spacing and Geometry

- Mobile horizontal gutter: 20px
- Desktop content width: 760px
- Section gap: 28px
- Control gap: 10px
- Surface radius: 14px
- Input radius: 12px
- Primary action radius: 12px
- Border: 1px solid subtle border
- Shadows: only on the primary action and elevated editor toolbar; no card-stack shadows
- Minimum interactive height: 44px
- Bottom action bar: sticky, white, top border, `env(safe-area-inset-bottom)` padding

## Container Model

- Home: open page with one large primary action, then bordered list rows for drafts and history.
- Mask editor: edge-to-edge photo canvas between a compact top bar and an open controls rail.
- Results: channel tabs, bordered option group, open editable text region, compact rewrite control row, checklist, sticky copy actions.
- Avoid nested cards, bento grids, sidebar navigation, charts, and dashboard metrics.

## Component Families

- Buttons: primary apricot fill, secondary white with charcoal border, quiet text button.
- List rows: thumbnail or status at left, content center, SVG chevron right.
- Tabs: two equal segments with apricot selected border and charcoal text.
- Choice controls: radio-like rows with an apricot selected ring.
- Status: success check plus plain green text; error icon plus plain red text; no decorative pills.
- Inputs: white background, subtle border, explicit label, 15px control typography.
- Mask styles: square choices with preview, selected apricot outline.
- Checklist: open rows with green check icons and readable rule text.

## Icon Inventory

- Product mark: supplied lotus plus content-card SVG.
- Navigation: custom 2px outline SVG chevron/back arrows.
- New post: 2px outline compose icon.
- Settings: 2px outline gear only if settings becomes functional; otherwise omit.
- Undo: 2px outline curved arrow.
- Copy: 2px outline clipboard.
- Success/error: filled semantic circle with a simple white check or mark.

All icons use a 24px viewBox, round joins/caps, and `currentColor`. Plain text arrows are not used.

## Allowed First-Viewport Copy

- `A.P YOGA Content Studio`
- `새 글 만들기`
- `최대 10장 사진과 짧은 메모로 두 채널 콘텐츠를 만들어요.`
- `작성 중인 글`
- `최근 작성 기록`
- `임시 저장됨`
- `편집 사진은 5일 후 삭제됩니다`
- `로컬 기능형 MVP` may appear once as a quiet caption below the privacy note, not as a pill or heading eyebrow.

## Screen-Specific Fidelity Notes

### Home

The product mark and two-line title form the opening focal point. The apricot new-post action is the only dominant control. Drafts and history use compact rows rather than separate floating cards. The lower status rail remains visible without crowding the first viewport.

### Face-Mask Editor

The user photo is the visual focal point. The header remains one line, and controls below the image never overlap it. Mask choices use recognizably different previews. Selection state is an apricot outline, while the mask itself remains neutral. Autosave and five-day deletion status sit in the bottom rail.

### Results

Channel tabs remain pinned near the screen title. Title or hook choices occupy a single bordered group. Editable output text uses an open white editor with comfortable line height. Rewrite actions are secondary and compact; copy is the dominant bottom action. Partial success uses the same layout with one channel result preserved and the failed channel showing a retry row.

## Responsive Continuation

- At 390 × 844, content uses the full width and the bottom action remains reachable with one hand.
- From 768px, the 760px content column is centered; editor media may use a 4:3 frame but controls stay below it.
- The UI never becomes a multi-column dashboard because the task order is sequential.
- No horizontal overflow is permitted at 320px width.

## Motion

- 160ms ease-out for pressed, selected, and tab transitions.
- 220ms ease-out for step enter and error banner reveal.
- No decorative looping motion.
- With `prefers-reduced-motion: reduce`, all transitions become instant.
