# Google Sign-In — Setup

Vertex Command supports **"Continue with Google"** alongside the existing email/password
login. It uses **Google Identity Services (GIS)** with the **ID-token flow**: the browser
gets a signed ID token from Google, the server verifies it against Google's public keys
(`google-auth-library`), then opens the normal session cookie. No redirect, no client secret.

The button is **hidden until `GOOGLE_CLIENT_ID` is set** — email/password login works regardless.

---

## 1. Create an OAuth Client ID in Google Cloud

1. Go to <https://console.cloud.google.com/> and select or **create a project**.
2. **APIs & Services → OAuth consent screen**:
   - User type: **External** (or Internal for a Workspace org).
   - Fill App name, support email, developer contact. Save.
   - While the app is in **Testing**, add your Google account under **Test users**
     (only test users can sign in until you click **Publish app**).
3. **APIs & Services → Credentials → Create Credentials → OAuth client ID**:
   - Application type: **Web application**.
   - **Authorized JavaScript origins** — add the origins the app is served from
     (scheme + host + port, **no path, no trailing slash**):
     - Local dev: `http://localhost:5000`
     - Production: `https://vertex.yourdomain.com` (your `VERTEX_DOMAIN`)
   - **Authorized redirect URIs**: leave empty — the GIS token flow does not redirect.
   - Click **Create** and copy the **Client ID** (looks like
     `1234567890-abc...xyz.apps.googleusercontent.com`).

> You do **not** need the client secret. ID-token verification only needs the Client ID.

---

## 2. Configure the app

Add the Client ID to `.env` (see `.env.example`):

```env
GOOGLE_CLIENT_ID=1234567890-abc...xyz.apps.googleusercontent.com
```

Restart the server. The frontend reads it (public) from `GET /api/v1/auth/google-config`.

---

## 3. Verify

1. `npm run dev` → open <http://localhost:5000>.
2. On the login screen, an **"Or continue with"** divider and a Google button appear
   below the email/password form.
3. Click it, pick a Google account (must be a **Test user** while unpublished).
4. You're logged in. New Google users are created with `email_verified`, a 7-day trial
   subscription, and a referral code — identical to email/password signup. An existing
   account with the same email is **linked** (its `google_id` is set) so both methods reach
   the same account.

---

## How it works (for maintainers)

| Layer | Location |
|---|---|
| Public config endpoint | `GET /api/v1/auth/google-config` → `{ clientId, enabled }` (`server/routes.ts`) |
| Token verification + login | `POST /api/v1/auth/google` (`server/routes.ts`) — `OAuth2Client.verifyIdToken({ audience: GOOGLE_CLIENT_ID })` |
| User lookup/link/create | `storage.getUserByGoogleId` / `getUserByEmail` / `updateUser` / `createUser` |
| Session | `req.session.userId` + existing cookie (`httpOnly`, `secure` in prod, `sameSite: lax`) |
| Frontend button | `client/src/pages/AuthPage.tsx` (GIS script + `google.accounts.id.renderButton`) |
| Mutation | `googleLogin` in `client/src/hooks/useAuth.ts` |
| CSP allow-list | `server/index.ts` — `accounts.google.com/gsi/*`, `*.googleusercontent.com` |

Security notes:
- The ID token is verified **server-side** against Google's public keys; `aud` must equal
  our `GOOGLE_CLIENT_ID` and `email_verified` must not be `false`.
- Session uses Secure / HttpOnly / SameSite=lax cookies (set in `server/index.ts`).
- The `POST /api/v1/auth/google` call goes through the same CSRF-token handling as the
  email/password login (`apiRequest` in `client/src/lib/queryClient.ts`).
- Google sign-in logs the user in directly; app-level TOTP 2FA is **not** re-challenged for
  the Google path (Google is the identity provider). Change in `server/routes.ts` if you
  want to also enforce TOTP for linked accounts.

Production: also add your production origin to **Authorized JavaScript origins** and
**Publish** the OAuth consent screen so any Google user (not just test users) can sign in.
