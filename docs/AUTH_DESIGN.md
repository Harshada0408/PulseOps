# Self-Hosted Authentication — Design

Design for removing the Supabase dependency from the proprietary edition. This is a design
document, not an implementation. No code described here exists yet.

## Why

The community edition authenticates through Supabase. That is a reasonable choice for a public
project and a serious limitation for a self-hosted product:

- `docker compose up` does not produce a working login. An operator must sign up for Supabase,
  create a project, configure a client, and supply keys before the product functions.
- Air-gapped and regulated deployments cannot use a hosted identity provider at all.
- The community edition stores the service-role key, which grants full administrative access to
  the auth schema. Handing that to a self-hosted operator is a poor trust boundary.
- An external identity provider in the request path is a hard dependency for the product's
  primary use case.

Every item in `ROADMAP.md` under P2 and P3 depends on solving this first.

## Constraints

1. The proprietary edition must reach a working login with only Docker, PostgreSQL, and Redis.
2. Existing data must survive. The community `User` table is the anchor for every other model,
   so user identity cannot be replaced wholesale.
3. The community edition keeps Supabase. This is additive, not a replacement.
4. Session handling must be at least as strong as what Supabase provides today.
5. SSO must be addable later without reworking the session layer.

## Data model

Five new tables in the proprietary edition's migrations. These do not exist in the community
schema.

```
User              (existing) — id, email, name, avatar, …
  └─1:1─ AuthIdentity      provider, providerUserId, passwordHash?
  └─1:N─ Session           refresh token hash, userAgent, ip, expiresAt, revokedAt?
  └─1:N─ VerificationToken tokenHash, purpose, expiresAt, consumedAt?
  └─1:N─ PasswordResetToken tokenHash, expiresAt, consumedAt?
  └─1:N─ SSOConnection     protocol, issuer, subject, email, lastLoginAt
```

Design notes:

- **`AuthIdentity`** is a join rather than columns on `User`, so several identity providers can
  back one account. A user created with a password can later be linked to SAML without a
  migration.
- **`Session`** stores a hash of the refresh token, never the token. A database leak does not
  yield usable credentials.
- **`SSOConnection`** stores the SAML or OIDC subject and issuer, not the assertion. Assertions
  are short-lived and must never be persisted.
- `Session.userAgent` and `Session.ip` exist so an operator can answer "what is this account
  logged into" without inventing the table under incident.

## Token strategy

Two-token model, matching what the community edition's clients already expect.

| Token | Lifetime | Transport | Storage |
|---|---|---|---|
| Access | 15 minutes | `Authorization: Bearer` | Memory only |
| Refresh | 30 days, rotating | `HttpOnly; Secure; SameSite=Lax` cookie | Database, hashed |

Access tokens are stateless JWTs signed with RS256. The key pair lives in the database or is
mounted into the container, so no signing secret is required in environment configuration.

Refresh tokens rotate on every use. Presenting a refresh token that was already consumed is
treated as theft: the entire session family is revoked and the user must re-authenticate. This
is the standard detection for a stolen token and is stronger than Supabase's default
behaviour.

`SameSite=Lax` plus a CSRF token on cookie-authenticated mutations covers browser CSRF. The API
is not CORS-open, and credentialed cross-origin requests are rejected outright.

## Password handling

- Argon2id, parameters tuned to the deployment host, re-hashed when a user's parameters change
  on next login
- Minimum length 12, checked against a breach corpus rather than composition rules
- No password complexity rules, no forced rotation — both are security theatre that pushes
  users toward `Password1!`
- Constant-time comparison on every hash check
- Rate limiting and lockout on verification, reset, and signin endpoints, keyed on IP and on
  account, so neither a distributed attack nor a targeted one succeeds
- Login responses do not disclose whether an account exists

`bcryptjs` is already a dependency and remains acceptable as a transitional measure while
Argon2id is integrated, but it is pure JavaScript and slow, which weakens the cost factor
against GPU attackers. Argon2id is the target.

## Flows

### Signup

```
POST /api/v1/auth/signup { email, password, name? }
  → validate
  → rate limit
  → hash password
  → create User + AuthIdentity in one transaction
  → create VerificationToken, send email
  → return 201, no session until verified
```

The local `User` id, not the Supabase id, becomes the canonical identifier going forward. This
is the point of no return for decoupling and must be designed as such.

### Signin

```
POST /api/v1/auth/signin { email, password }
  → rate limit, lockout
  → load User + AuthIdentity
  → if unverified, do not authenticate
  → verify hash, rehash if parameters changed
  → issue access + refresh, create Session
  → return
```

### Token refresh

```
POST /api/v1/auth/refresh  (refresh token in HttpOnly cookie)
  → hash lookup, check expiry and revocation
  → if token was previously consumed → revoke session family, 401
  → mark consumed, issue new pair, create new Session
  → return
```

### Logout

```
POST /api/v1/auth/logout
  → revoke the presented session
  → clear the cookie
```

Logout revokes the current session only. "Log out everywhere" revokes every session for the
user and is required for the compromised-credential response path.

### Password reset

```
POST /api/v1/auth/reset-password { email }
  → always 202, whether or not the account exists
  → if it exists, create PasswordResetToken, send email

POST /api/v1/auth/update-password { token, password }
  → validate token, check expiry and single use
  → update hash
  → revoke all sessions   ← forces re-authentication everywhere
```

Revoking all sessions on reset is deliberate. A reset issued because the old password may have
been exposed must not leave old sessions valid.

## Middleware integration

The current `authMiddleware` calls `supabaseAdmin.auth.getUser(token)` on every request and
then loads the user from the database. The proprietary version:

1. Verifies the JWT signature locally. No network call per request.
2. Checks the `iss`, `aud`, `exp`, and `nbf` claims.
3. Loads the user from the database, because authorization needs current data, not token
   contents. Authorization state must not be stale for the life of a token.
4. Rejects inactive accounts and, where applicable, memberships revoked after the token was
   issued.

Step 3 is why the access token is short-lived: a 15-minute token bounds how long a
deactivated or removed user retains access. Revocation lists would make it immediate, at the
cost of a lookup on every request. For this workload, short-lived tokens are the right
trade-off and the reason the number is 15 and not 60.

The middleware signature stays identical. Route handlers do not change, which keeps the
proprietary diff small and reviewable.

## Migration path

Existing deployments must not break.

1. Ship the new tables alongside the existing ones. No destructive migration.
2. Dual verification: if a Supabase token is presented, accept it and mirror the identity into
   `AuthIdentity` with `provider = 'supabase'`. New passwords are not required.
3. On next successful signin, offer self-hosted credential creation. The account keeps its id,
   so monitors, checks, alerts, and status pages are untouched.
4. After the migration window, disable the Supabase path behind a configuration flag.
5. Only then remove the dependency.

`User.id` never changes at any point, which is what makes this safe.

## SSO

Built after self-hosted auth, on top of the `Session` table, so it issues the same tokens
through the same path rather than a parallel mechanism.

| Protocol | Scope | Notes |
|---|---|---|
| OIDC | Generic | Authorization code flow, PKCE, discovery via `.well-known` |
| SAML 2.0 | Enterprise | SP-initiated, metadata import, signed assertions, certificate rotation |

Required for both: JIT provisioning on first login, domain-restricted auto-provisioning,
`Email` attribute mapping, group-to-role mapping, replay protection on assertions, and admin
configuration UI. An operator who cannot configure SSO without filing a support ticket has no
enterprise product.

## Security requirements

- Refresh tokens hashed at rest, rotated on use, reuse detected
- Access tokens RS256, short-lived, validated against issuer and audience
- CSRF token on cookie-authenticated mutations
- Argon2id with per-user salt, parameters re-evaluated on login
- Uniform responses on enumeration-prone endpoints
- Rate limiting and lockout on all auth endpoints, per IP and per account
- Session listing and revocation available to the user
- No password or token in logs; redaction is tested, not assumed
- Timing-safe comparison throughout

## Testing

Auth is the highest-risk code in the product. Required before release:

- Unit: hashing, token generation and rotation, expiry, claim validation
- Integration: every flow above against real PostgreSQL, including concurrent refresh with the
  same token, which must revoke the family exactly once
- Abuse: enumeration, credential stuffing, rate-limit bypass, CSRF, session fixation
- E2E: signup through authenticated request, plus the migration path for an existing account

The reuse-detection test is the one most likely to be wrong and the one that matters most. It
needs a deliberate concurrent test, not a sequential one.

## What this unlocks

- Offline and air-gapped deployment with no external SaaS dependency
- No service-role key in customer environments
- The session and identity substrate that RBAC, audit logging, and SSO all build on
- Removal of a network hop from every authenticated request

## Effort

Realistically several weeks for the core flows plus a comparable period for abuse testing. It
is the largest single item in the proprietary edition and the correct place to start, because
Organization, RBAC, audit, and SSO are all downstream of it.
