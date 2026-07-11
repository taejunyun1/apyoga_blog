# A.P YOGA Content Studio Authentication Design

## Objective

Protect the public Cloudflare Pages application with a branded A.P YOGA login. The application uses one deployment-configured account, keeps authenticated sessions for 30 days, and never places the password or its plaintext equivalent in the browser bundle, source repository, logs, or test fixtures.

## Scope

This design covers:

- a branded Vue login screen;
- Cloudflare Pages Functions for login, session inspection, and logout;
- signed, expiring session cookies;
- protection for application routes and future private API routes;
- login-attempt throttling;
- PWA cache behavior that fails closed when the session cannot be verified;
- unit, component, integration, and deployed end-to-end verification.

It does not add multiple accounts, password recovery, account administration, social login, email login, role-based access control, or OpenAI API integration.

## Selected Approach

Use Cloudflare Pages Functions as the authentication boundary and the Vue application as the branded user interface.

The alternatives were rejected for these reasons:

- Cloudflare Access email verification does not match the requested fixed username and password flow.
- Browser Basic Authentication does not provide the requested branded screen or a clear logout experience.
- Client-only credential checks can be bypassed and would expose the credential or an equivalent value in the public bundle.

## Components

### Vue login experience

Add a public `/login` route with A.P YOGA branding and two fields: username and password. The form shows loading, invalid-credential, temporary-lockout, and network-error states without identifying which credential was incorrect.

At application startup, the client calls the session endpoint before rendering private routes or opening the draft repository. A valid response unlocks the application. An invalid, expired, or unverifiable session sends the user to `/login` and keeps private application content hidden.

Add a logout control to authenticated application chrome. Logging out clears the server session cookie and service-worker caches, then returns to `/login`. IndexedDB drafts and edited photos remain on the device so the same account can resume work after logging in again.

### Pages Functions authentication API

Provide these endpoints:

- `POST /api/auth/login` validates the submitted credentials and creates a session.
- `GET /api/auth/session` returns the current authentication state without exposing credential material.
- `POST /api/auth/logout` expires the session cookie.

All state-changing endpoints require a same-origin `Origin` header and a JSON content type. Endpoints return JSON except successful logout, which may return an empty success response. Authentication failures use a generic Korean message. Unexpected server failures return a generic retry message and log no secrets.

### Route protection middleware

Pages middleware allows the login page, authentication endpoints, and static assets required to render the login screen. It protects application documents such as `/` and `/studio/*`, plus all private `/api/*` routes added later.

For document requests, an invalid session redirects to `/login`. For private API requests, it returns `401` JSON. The login and logout endpoints remain reachable without an existing session.

Static JavaScript and CSS may remain publicly retrievable because they contain no credentials or private server data. The application still fails closed at startup and does not initialize private IndexedDB views until `GET /api/auth/session` succeeds.

### Credential storage and verification

Configure these values as Cloudflare secrets:

- `AUTH_USERNAME` for the single allowed account name;
- `AUTH_PASSWORD_HASH` containing a versioned PBKDF2 salt, iteration count, and derived hash;
- `SESSION_SECRET` containing a randomly generated signing secret.

The plaintext password is used only during one-time local hash generation and interactive authentication testing. It is never committed, written to a project file, printed, or passed as a command-line argument.

Password verification uses PBKDF2-HMAC-SHA-256 with a unique 128-bit salt, 600,000 iterations, a 256-bit derived key, and a timing-safe byte comparison. Session tokens use an HMAC-SHA-256 signature over a versioned payload containing the account subject, issue time, and expiration time.

### Session cookie

The cookie name is application-specific and contains only the signed session token. It uses:

- `HttpOnly`;
- `Secure`;
- `SameSite=Strict`;
- `Path=/`;
- `Max-Age=2592000` for 30 days.

The server rejects expired tokens, malformed payloads, invalid signatures, and tokens for an unexpected account. Logout sends the same cookie with an immediate expiration.

### Login-attempt throttling

Create a Cloudflare KV namespace bound as `AUTH_RATE_LIMIT`. Failed attempts are counted for a privacy-preserving keyed hash of the connecting address rather than storing the raw address.

Five failed attempts observed from one rate-limit key within ten minutes produce a `429` response and a generic Korean lockout message. A successful login clears the failure record. KV provides practical abuse resistance for this single-account MVP; because KV is eventually consistent, a distributed attacker switching Cloudflare locations may temporarily exceed this threshold. Strong globally serialized enforcement would require a Durable Object or an external identity service and is outside this single-account MVP.

## Data Flow

### Login

1. The unauthenticated user requests the application and is directed to `/login`.
2. The user submits the branded login form over HTTPS.
3. The login Function checks the rate-limit record and verifies the configured username and PBKDF2 hash.
4. On success, the Function creates a signed 30-day session cookie and clears failed-attempt state.
5. The client calls the session endpoint, receives an authenticated response, and navigates to `/`.

### Authenticated startup

1. The browser loads the application shell.
2. Before mounting private views or reading drafts, the client requests `/api/auth/session` with the cookie.
3. A valid session unlocks the router and draft repository.
4. Any other result keeps the application locked and routes to `/login`.

### Logout

1. The user activates logout.
2. The logout Function expires the cookie.
3. The client removes service-worker caches and returns to `/login`.
4. IndexedDB content remains intact for the next authenticated session.

## PWA and Cache Rules

The service worker must not treat session API responses as cacheable. Navigation caching must not allow private content to appear before the live session check completes. When the session endpoint is unreachable, the application remains locked rather than trusting stale client state.

Existing users may have an older service worker. The new deployment increments the generated service worker and performs an immediate update. The login release is verified both in a fresh browser context and after loading the previous production version.

## Error Handling

- Invalid credentials: generic `401` message with no field-specific hint.
- Rate limit reached: generic `429` message and retry guidance.
- Cross-origin or non-JSON state-changing request: reject with `403` or `415` before credential verification.
- Expired or tampered session: clear client authentication state and return to `/login`.
- Network or server error: keep the application locked and offer retry.
- Missing Cloudflare secret or KV binding: fail closed with a generic server error.
- Logout network failure: do not claim logout succeeded; offer retry and keep private UI hidden during the request.

No response or log includes the submitted password, password hash, signing secret, full session token, or raw rate-limit identifier.

## Testing Strategy

### Unit tests

- PBKDF2 verification succeeds for a matching test password and fails otherwise.
- Session signing and verification cover valid, expired, malformed, and tampered tokens.
- Cookie creation includes all required security attributes and the 30-day lifetime.
- Rate-limit keys do not contain the raw connecting address.

### Function integration tests

- Login success sets the cookie and clears failures.
- Invalid credentials return the generic error and increment failures.
- Five failures trigger a ten-minute lockout.
- Session inspection returns authenticated and unauthenticated states correctly.
- Logout expires the cookie.
- Middleware redirects private documents and returns `401` for private APIs.
- Login routes and required assets remain public.

### Vue component and router tests

- The login form covers validation, loading, invalid credentials, lockout, and network failure.
- Private views are not rendered before session verification.
- Successful login reaches the home screen.
- Logout returns to `/login` while preserving IndexedDB drafts.

### Deployed verification

- An unauthenticated private URL redirects to the branded login.
- Invalid credentials fail without revealing which value was wrong.
- The configured account can log in and complete the photo-to-two-channel generation flow.
- Refresh and direct `/studio/*` navigation work with the session cookie.
- Logout blocks subsequent private navigation.
- Desktop and mobile views have no relevant console errors or horizontal overflow.

Real deployment credentials are entered only through an interactive, non-echoing prompt or the login form. Automated tests use unrelated fixtures.

## Deployment Sequence

1. Implement tests and authentication code through red-green-refactor cycles.
2. Create and bind the KV namespace.
3. Generate the PBKDF2 credential hash and random session secret without logging either value.
4. Register all three authentication values as Cloudflare Pages secrets through interactive Wrangler prompts.
5. Run unit, component, integration, build, and local Function verification.
6. Deploy to Cloudflare Pages.
7. Run deployed unauthenticated, invalid-login, valid-login, refresh, private-route, logout, desktop, and mobile checks.

## Security and Operational Notes

The user-provided password appeared in chat and should be rotated after the initial login flow is verified. Rotation requires generating a new PBKDF2 value and replacing `AUTH_PASSWORD_HASH`; it does not require a code change.

This design protects the public application and future server APIs. It does not encrypt IndexedDB data at rest inside an already unlocked browser profile. Device and browser-profile security remain part of the operating boundary.
