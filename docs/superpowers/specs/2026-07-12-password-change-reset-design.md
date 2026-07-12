# A.P YOGA 비밀번호 변경·초기화 설계

## 목표

단일 관리자 계정 구조를 유지하면서 다음 두 경로를 제공한다.

1. 로그인한 사용자가 현재 비밀번호를 다시 확인한 뒤 앱 안에서 새 비밀번호로 변경한다.
2. 비밀번호를 잊은 관리자가 로컬 터미널의 숨김 입력 명령으로 안전하게 초기화한다.

비밀번호가 변경되거나 초기화되면 기존 기기의 로그인 세션을 모두 무효화한다. 평문 비밀번호, 파생 해시, Cloudflare 관리 토큰은 브라우저·저장소·명령 인수·로그에 노출하지 않는다.

## 범위

### 포함

- 홈 화면의 `비밀번호 변경` 진입점과 전용 보호 경로 `/account/password`
- 현재 비밀번호, 새 비밀번호, 새 비밀번호 확인 폼
- 인증된 비밀번호 변경 API
- D1 기반 활성 비밀번호 해시와 인증 버전 관리
- 인증 버전을 포함한 세션 발급·검증
- 모든 기존 세션의 즉시 무효화
- 현재 비밀번호 검증 실패 제한
- 관리자용 `npm run auth:reset` 숨김 초기화 명령
- D1 마이그레이션, Cloudflare binding, 운영 문서와 배포 검증

### 제외

- 이메일·SMS 재설정 링크
- 다중 사용자 계정 관리
- 사용자 가입·초대
- Cloudflare API 토큰을 Pages Functions에 저장해 secret을 변경하는 방식
- 비밀번호 복구 질문

## 선택한 접근

비밀번호 변경 상태는 전용 D1 데이터베이스 `ap-yoga-auth`의 `AUTH_DB` binding에 저장한다. 로그인 실패 제한용 `AUTH_RATE_LIMIT` KV는 기존 역할만 유지한다.

Workers KV는 다른 엣지 위치에 변경이 보이기까지 지연될 수 있어 즉시 세션 무효화 요구에 맞지 않는다. 인증 읽기는 `AUTH_DB.withSession("first-primary")`를 사용해 최신 primary 상태에서 시작한다. Read replication은 이 기능에서 활성화하지 않는다.

Cloudflare secret은 최초 자격 증명과 관리자 초기화의 기준값으로 유지한다. D1에 변경 행이 없으면 `AUTH_PASSWORD_HASH`를 활성 해시로 사용하고, 행이 있으면 D1 값을 우선한다. D1 조회가 실패하면 secret으로 우회하지 않고 인증을 실패 처리한다.

## 데이터 모델

마이그레이션 파일 `migrations/0001_auth_credentials.sql`에서 단일 행 테이블을 만든다.

```sql
CREATE TABLE IF NOT EXISTS auth_credentials (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  password_hash TEXT NOT NULL,
  credential_version TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
```

- `password_hash`: `pbkdf2-sha256$100000$<salt>$<hash>` 형식
- `credential_version`: 비밀번호 변경 때마다 새로 생성하는 임의 UUID
- `updated_at`: UTC ISO 8601 문자열
- D1 행이 없으면 기존 `AUTH_PASSWORD_HASH` secret이 활성값이다.
- secret 기반 인증 버전은 `SESSION_SECRET`으로 `AUTH_PASSWORD_HASH`를 HMAC한 비공개 파생값을 사용한다. 해시 원문은 세션 payload에 넣지 않는다.

## 서버 구성요소

### 활성 자격 증명 저장소

`functions/lib/credentials.ts`가 다음 경계를 제공한다.

```ts
interface ActiveCredential {
  passwordHash: string
  version: string
  source: "secret" | "d1"
}

function readActiveCredential(env: AuthEnv): Promise<ActiveCredential>
function changeCredential(env: AuthEnv, passwordHash: string, version: string, updatedAt: string): Promise<void>
```

`readActiveCredential`은 D1 primary session에서 `id = 1`을 조회한다. 행이 없으면 secret 해시와 파생 버전을 반환한다. D1 binding·테이블·조회가 실패하면 예외를 내고 로그인이나 보호 요청을 fail closed 처리한다.

`changeCredential`은 `INSERT ... ON CONFLICT(id) DO UPDATE`로 해시·버전·시각을 한 번에 교체한다.

### 비밀번호 해시

기존 검증 함수와 동일한 PBKDF2-SHA256 100,000회, 16바이트 임의 salt, 32바이트 파생값을 사용한다. `functions/lib/auth.ts`에 새 레코드를 생성하는 함수를 추가하고 12~256 UTF-16 code unit 길이를 서버에서 검사한다.

새 비밀번호는 현재 비밀번호와 달라야 한다. 조합 규칙은 강제하지 않아 긴 passphrase를 허용한다.

### 세션 버전

새 세션 payload는 `v: 2`, 사용자 ID, 발급·만료 시각, `credentialVersion`을 포함한다. 매 보호 요청은 최신 활성 자격 증명을 읽고 서명과 인증 버전을 모두 검증한다.

기존 `v: 1` 세션은 D1 변경 행이 없을 때만 이전 호환을 위해 허용한다. 첫 앱 내 비밀번호 변경으로 D1 행이 생성되면 모든 `v: 1` 및 이전 인증 버전의 `v: 2` 세션이 즉시 거부된다. 관리자 초기화는 `SESSION_SECRET`도 회전하므로 모든 기존 세션이 무효화된다.

### 변경 API

보호된 `POST /api/auth/password`를 추가한다. middleware 인증과 별도로 현재 비밀번호를 다시 검증한다.

요청:

```json
{
  "currentPassword": "현재 비밀번호",
  "newPassword": "새 비밀번호"
}
```

규칙:

- 동일 출처 JSON 요청만 허용한다.
- 본문은 UTF-8 기준 2,048바이트 이하로 스트림 제한한다.
- 알려지지 않은 필드를 거부한다.
- 현재·새 비밀번호는 각각 256자 이하이며 새 비밀번호는 12자 이상이다.
- 현재 비밀번호가 틀리거나 새 비밀번호가 동일하면 저장하지 않는다.
- 현재 비밀번호 실패는 `AUTH_RATE_LIMIT`에 `password-change:<HMAC IP>` 범위로 기록하고 5회 실패 시 10분 제한한다.
- 새 해시와 새 UUID 버전을 D1에 저장한 뒤 응답에서 현재 세션 쿠키를 만료한다.
- 성공 응답은 `204`, 모든 응답은 `Cache-Control: no-store`다.

오류 메시지는 다음 범위로 제한한다.

- `400`: 새 비밀번호 길이·현재 비밀번호와 동일함 같은 수정 가능한 입력 문제
- `401`: 현재 비밀번호가 맞지 않음
- `403`: 출처·콘텐츠 유형 위반
- `413`: 본문 제한 초과
- `429`: 현재 비밀번호 확인 시도 초과
- `500/503`: 인증 저장소 또는 서버 설정 문제

## 브라우저 화면과 흐름

### 진입

홈 화면 브랜드 헤더에 `비밀번호 변경` 링크를 추가한다. `/account/password`는 기존 router guard와 Pages middleware가 모두 보호한다.

### 폼

`ChangePasswordView.vue`는 다음 세 필드를 제공한다.

- 현재 비밀번호: `autocomplete="current-password"`
- 새 비밀번호: `autocomplete="new-password"`, 12~256자 안내
- 새 비밀번호 확인: `autocomplete="new-password"`

브라우저는 새 비밀번호와 확인 값의 일치 여부를 먼저 검사하지만 서버가 보안 규칙을 최종 결정한다. 제출 중에는 필드와 버튼을 비활성화하고 상태를 접근성 있게 알린다. 오류가 나면 모든 비밀번호 필드를 비운다.

성공하면 인증 store를 `unauthenticated`로 바꾸고 `/login?password=changed`로 이동한다. 로그인 화면은 `비밀번호가 변경되었습니다. 새 비밀번호로 로그인해 주세요.`를 상태 메시지로 표시한다. IndexedDB의 작성 자료와 편집 사진은 지우지 않는다.

로그인 화면에는 `비밀번호를 잊으셨나요? 관리자 터미널에서 npm run auth:reset을 실행하세요.`라는 운영 안내를 추가한다. 재설정 링크처럼 오해될 버튼은 만들지 않는다.

## 관리자 초기화

`scripts/reset-auth.mjs`와 `npm run auth:reset`을 추가한다. 대화형 TTY에서 새 비밀번호와 확인 값을 숨김 입력으로 받고 일치·길이를 검증한다. 평문은 파일, 환경 변수, 명령 인수, 로그에 넣지 않는다.

초기화 순서는 장애 안전성을 위해 고정한다.

1. 로컬 메모리에서 새 PBKDF2 레코드와 새 `SESSION_SECRET`을 만든다.
2. Wrangler 표준 입력으로 `AUTH_PASSWORD_HASH`와 `SESSION_SECRET` production secret을 갱신한다.
3. `npm run deploy:cloudflare`를 실행해 새 secret이 적용된 배포를 완료한다.
4. 배포 성공 후 `wrangler d1 execute ap-yoga-auth --remote --command "DELETE FROM auth_credentials WHERE id = 1"`로 D1 override를 제거한다.
5. 새 비밀번호를 메모리에서만 사용해 canonical 로그인 endpoint가 `204`를 반환하는지 확인하고 완료 메시지만 출력한다.

배포가 실패하면 D1 override를 유지해 기존 앱 비밀번호가 계속 동작한다. D1 행 삭제가 실패하면 초기화 완료로 표시하지 않으며 재시도 명령을 안내한다. secret 값과 해시는 출력하지 않는다.

## 마이그레이션과 배포

- `wrangler.jsonc`에 `AUTH_DB` D1 binding을 추가한다.
- 데이터베이스는 Asia-Pacific 위치 힌트로 생성한다.
- 마이그레이션은 로컬 테스트 후 production에 적용한다.
- 순서는 D1 생성 → migration 적용 → binding 포함 코드 배포다.
- binding 또는 테이블이 없으면 인증은 fail closed 한다.
- 기존 로그인 실패 KV와 OpenAI secret은 변경하지 않는다.

## 테스트 전략

### 단위 테스트

- PBKDF2 생성 레코드가 새 salt를 사용하고 기존 검증 함수와 호환된다.
- 12자 미만·256자 초과 비밀번호를 거부한다.
- D1 행, secret fallback, D1 실패를 구분한다.
- 세션 버전 일치·불일치와 `v: 1` 호환 조건을 검증한다.
- 변경 API의 출처, JSON, byte limit, exact-key, 길이, 동일 비밀번호, 현재 비밀번호 오류, rate limit, D1 write, cookie expiry를 검증한다.
- 기존 로그인도 D1 활성 해시를 사용하고 D1 실패 시 secret으로 우회하지 않는다.
- 초기화 스크립트가 TTY·숨김 입력·표준 입력 secret 등록·배포 후 D1 삭제 순서를 지키고 key-like 값을 포함하지 않는다.

### 컴포넌트·라우팅 테스트

- 보호된 변경 화면 진입과 로그인 redirect
- password-manager autocomplete와 접근성 label
- 확인 불일치의 client validation
- 제출 중 비활성·상태 표시
- 서버 오류 시 필드 초기화
- 성공 후 login 안내와 로컬 작성 자료 보존

### 통합·운영 검증

- 전체 unit/component suite, 양쪽 typecheck, PWA build, E2E discovery
- D1 migration과 Cloudflare deployment contract
- 추적 파일 및 빌드 산출물의 credential scan
- production에서 기존 비밀번호 로그인, 앱 내 변경, 기존 세션 거부, 새 비밀번호 로그인 확인
- 관리자 초기화, 변경된 앱 비밀번호 거부, 초기화 비밀번호 로그인 확인
- session·password 응답의 `Cache-Control: no-store` 확인

## 승인 기준

- 로그인 사용자가 현재 비밀번호를 알아야만 새 비밀번호로 변경할 수 있다.
- 새 비밀번호는 브라우저나 저장소에 평문으로 남지 않는다.
- 변경 직후 모든 기존 세션이 거부된다.
- 변경 후 새 비밀번호로 로그인할 수 있다.
- 관리자 숨김 명령으로 앱 내 변경값을 안전하게 초기화할 수 있다.
- 실패한 초기화가 기존 동작 비밀번호를 예기치 않게 제거하지 않는다.
- 기존 콘텐츠 생성, 인증 rate limit, OpenAI secret과 사용자 로컬 자료에 회귀가 없다.
