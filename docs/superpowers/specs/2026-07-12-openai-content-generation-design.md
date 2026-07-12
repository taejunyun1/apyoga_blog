# OpenAI 기반 콘텐츠 생성 설계

## 목표

A.P YOGA Content Studio의 네이버 블로그와 인스타그램 초안을 OpenAI Responses API로 생성한다. 네이버 본문은 공백과 줄바꿈을 포함한 `trim()` 이후 JavaScript 문자열 길이가 반드시 500자 이상이어야 한다. 인스타그램은 현재의 긴 캡션과 짧은 캡션 구분을 유지한다.

## 범위

- 네이버와 인스타그램을 각각 독립적으로 생성한다.
- 기존 사진 분석 결과, 사용자 메모, 필수 표현, 금지 표현, 채널별 톤을 모델 입력으로 사용한다.
- 사진 원본과 편집 이미지 데이터는 OpenAI로 전송하지 않는다.
- 기존 편집, 재작성, 복사, 부분 성공, 로컬 저장 흐름은 유지한다.
- 자동 게시, 대화 기록, 웹 검색, 이미지 생성은 추가하지 않는다.

## 아키텍처

브라우저는 OpenAI를 직접 호출하지 않는다. 인증된 브라우저 요청은 Cloudflare Pages Function의 콘텐츠 생성 API로 전달되고, Function이 `OPENAI_API_KEY` secret으로 OpenAI Responses API를 호출한다. API 키는 Cloudflare production secret으로만 존재하며 Git, 브라우저 번들, 응답, 로그에 포함하지 않는다.

클라이언트에는 기존 `AIProvider` 인터페이스를 구현하는 원격 provider를 둔다. `generateNaver`와 `generateInstagram`은 서로 다른 HTTP 요청을 보내 기존 `Promise.allSettled` 기반 부분 성공 동작을 보존한다. OpenAI 호출이 끝내 실패한 채널은 로컬 provider로 한 번 대체 생성한다.

## OpenAI 요청

- API: `POST https://api.openai.com/v1/responses`
- 모델: `gpt-5.6-luna`
- 저장: `store: false`
- 추론 강도: 콘텐츠 생성에 맞춘 낮은 추론 강도
- 출력: `text.format`의 strict JSON Schema Structured Outputs
- 안전 식별자: 로그인 계정을 직접 노출하지 않는 안정적인 해시값

네이버와 인스타그램은 각자 전용 JSON Schema를 사용한다. 네이버 schema는 제목 후보 3개, 도입 후보 3개, 본문, 사진 배치, 해시태그, 수업 안내를 요구한다. 인스타그램 schema는 첫 문장 후보 3개, 긴 캡션, 짧은 캡션, 해시태그, 표지와 사진 순서를 요구한다. 모델 출력은 schema 일치 여부와 별개로 애플리케이션 코드에서 다시 검증한다.

공식 참고 문서:

- https://developers.openai.com/api/docs/guides/migrate-to-responses
- https://developers.openai.com/api/docs/guides/structured-outputs
- https://developers.openai.com/api/docs/guides/latest-model.md

## 프롬프트 규칙

공통 프롬프트는 A.P YOGA의 차분하고 과장 없는 문체, 사용자가 지정한 채널별 톤, 메모와 필수 표현, 금지 표현을 한 번씩 명시한다. 치료·완치·교정 보장 등 의료적 단정은 작성하지 않는다. 입력에 없는 수업 시간, 가격, 예약 방법, 계절 정보는 사실처럼 만들지 않고 게시 전 확인 문구로 남긴다.

네이버 프롬프트는 수련 시작, 호흡 관찰, 신체 감각, 사진 장면, 일상 연결, 마무리를 서로 다른 문단으로 구성하고 본문만 최소 500자로 작성하도록 요구한다. 같은 문장이나 의미를 반복해 길이를 채우지 않는다. 인스타그램 프롬프트는 네이버와 다른 문장 흐름을 사용하며 긴 캡션과 짧은 캡션의 길이 차이를 분명히 한다.

## 데이터 흐름

1. 사용자가 브리프를 확인하고 두 채널 생성을 요청한다.
2. 클라이언트가 네이버와 인스타그램 요청을 병렬로 전송한다.
3. Pages middleware가 로그인 세션을 확인한다.
4. 각 Function 요청은 허용 필드와 최대 입력 길이를 검증한다.
5. Function이 채널 전용 prompt와 JSON Schema로 Responses API를 호출한다.
6. Function이 schema, 필수 표현, 금지 표현, 의료 표현, 채널별 길이를 검증한다.
7. 네이버 본문이 500자 미만이거나 결과가 부적합하면 보강 지시로 OpenAI를 한 번만 재호출한다.
8. OpenAI 호출이 두 번 모두 실패하면 해당 채널을 로컬 provider로 생성한다.
9. 클라이언트는 채널별 성공 또는 오류를 기존 UI에 표시하고 결과를 IndexedDB에 저장한다.

## 길이 보장

네이버 본문 길이는 `body.trim().length`로 계산한다. 첫 OpenAI 결과와 재시도 결과 모두 동일한 검증을 거친다. 로컬 대체 생성기도 구조화된 여러 문단을 만들고 금지 표현을 제거한 다음 500자 이상을 보장한다. 제목, 도입 후보, 해시태그, 수업 안내 문구는 500자 계산에 포함하지 않는다.

## 오류 처리

- OpenAI의 네트워크 오류, 429, 5xx, 중단 상태, 거절, JSON 파싱 실패, schema 불일치는 채널별 생성 실패로 처리한다.
- 500자 미만인 네이버 결과만 한 번 재시도한다. 무제한 재시도는 하지 않는다.
- OpenAI 오류 응답 본문과 API 키는 클라이언트나 로그에 노출하지 않는다.
- 사용자에게는 어떤 채널이 로컬 대체 생성됐는지 알 수 있는 짧은 안내를 제공하되 편집과 복사는 정상적으로 허용한다.
- 인증 실패는 기존 401 흐름을 유지하고 생성 API 응답은 `Cache-Control: no-store`를 사용한다.

## 보안 및 개인정보

- `OPENAI_API_KEY`는 Cloudflare secret으로만 등록한다.
- API는 세션 인증, same-origin JSON 검사, 요청 크기 제한을 적용한다.
- 사진 바이너리, 이메일 주소, 브라우저 저장 데이터는 OpenAI 입력에 포함하지 않는다.
- OpenAI 요청은 `store: false`를 사용한다.
- 안전 식별자는 계정 식별자의 SHA-256 해시처럼 원문을 복원할 수 없는 값으로 만든다.
- 사용자가 채팅에 공유한 기존 API 키는 배포 후 OpenAI 대시보드에서 회전하는 것을 권장한다.

## 테스트

1. 원격 provider가 네이버와 인스타그램을 독립 요청하고 기존 출력 타입으로 변환하는지 검사한다.
2. Pages Function이 인증되지 않은 요청, 다른 origin, 잘못된 JSON, 과도한 입력을 거부하는지 검사한다.
3. OpenAI 요청에 API 키가 서버 헤더로만 들어가고 `store: false`, 모델, schema가 정확한지 검사한다.
4. 네이버 결과가 499자이면 한 번 재시도하고 500자 이상이면 성공하는지 검사한다.
5. 재시도 실패 시 로컬 대체 결과가 500자 이상인지 검사한다.
6. 인스타그램 결과에는 500자 최소 기준을 적용하지 않는지 검사한다.
7. 금지 표현과 의료 과장 표현이 최종 결과에서 걸러지는지 검사한다.
8. 한 채널만 OpenAI 오류가 나도 다른 채널 결과가 유지되는지 검사한다.
9. 전체 단위·컴포넌트·타입·프로덕션 빌드 검증 후 Cloudflare 공개 주소에서 실제 생성 흐름을 확인한다.

## 배포

구현과 테스트가 완료되면 제공된 OpenAI API 키를 대화형 Wrangler 입력으로 `OPENAI_API_KEY` production secret에 등록한다. 키 값은 명령 인자, 파일, Git 이력에 남기지 않는다. Cloudflare Pages에 새 production 배포를 만들고 로그인 후 두 채널 생성, 네이버 500자 이상, 부분 실패 대체 동작을 검증한다.
