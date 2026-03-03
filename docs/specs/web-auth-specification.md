# Web Auth - Behavioral Specification

| Field | Value |
|-------|-------|
| Feature | Web Auth |
| Phase | 4 |
| Date | 2026-03-03 |
| Status | Draft |

## Objective

Protect all web routes with cookie-based session authentication. Cortex is a single-user system with a configured password. All routes except `/login` and `/health` require a valid session. Sessions are managed via signed cookies.

## User Stories & Acceptance Criteria

### US-1: As a user, I want a login page so I can authenticate to the webapp.

- **AC-1.1:** GET `/login` renders a login form with a password field.
- **AC-1.2:** POST `/login` validates the password against the `WEBAPP_PASSWORD` env var.
- **AC-1.3:** On correct password, a session cookie is set (signed with `SESSION_SECRET`) and the user is redirected to `/`.
- **AC-1.4:** On incorrect password, the login page is re-rendered with an error message (e.g., "Invalid password").
- **AC-1.5:** The session cookie is `HttpOnly`, `Secure` (if HTTPS), `SameSite=Lax`.

### US-2: As a user, I want all routes except /login and /health to require authentication.

- **AC-2.1:** Unauthenticated requests to any route (except `/login`, `/health`) redirect to `/login`.
- **AC-2.2:** The original URL is preserved (e.g., as a `?redirect=` query parameter) so the user is redirected back after login.
- **AC-2.3:** API routes (e.g., routes under `/api/`) return `401 Unauthorized` instead of redirecting.

### US-3: As a user, I want to log out.

- **AC-3.1:** POST `/logout` clears the session cookie and redirects to `/login`.

## Constraints

- `WEBAPP_PASSWORD` and `SESSION_SECRET` are required env vars. The app must refuse to start if either is missing.
- `SESSION_SECRET` must be used to sign session cookies (e.g., via HMAC). It should be at least 32 characters (recommended: `openssl rand -hex 32`).
- Session cookies must not contain the password itself -- only a signed session token.
- The `/health` endpoint must always be publicly accessible (used by Docker healthcheck and monitoring).
- The `/login` page must be accessible without authentication (otherwise users cannot authenticate).
- Authentication middleware runs as Hono middleware before route handlers.

## Edge Cases

- **Expired session:** If session cookies have a max-age or expiration and the session expires, the user is redirected to `/login`. The redirect URL is preserved so they return to their previous page after re-authenticating.
- **Invalid session cookie:** If the cookie signature is invalid (tampered or corrupted), the cookie is treated as absent. The user is redirected to `/login`.
- **Multiple tabs:** All tabs share the same session cookie. Logging out in one tab invalidates the session for all tabs. Other tabs will redirect to `/login` on next navigation or API call.
- **SESSION_SECRET changes:** If `SESSION_SECRET` is rotated (e.g., during redeployment), all existing session cookies become invalid because their signatures no longer verify. All users are effectively logged out and must re-authenticate.
- **WEBAPP_PASSWORD changes:** Existing sessions remain valid until they expire or the user logs out. Only new login attempts use the updated password.

## Non-Goals

- Multi-user support (separate accounts, roles, permissions).
- User registration or sign-up flow.
- Password reset or recovery mechanism.
- OAuth or third-party authentication providers.
- Two-factor authentication (2FA).
- Session storage in the database (cookie-based sessions are sufficient for single-user).
- Rate limiting on login attempts (can be added later if needed).
- CSRF protection beyond SameSite cookies (SameSite=Lax provides baseline protection).

## Open Questions

- Should sessions have a fixed expiration (e.g., 30 days) or last indefinitely until logout?
- Should the login page show any branding or just a minimal password form?
- Should failed login attempts be logged with timestamps for security auditing?
