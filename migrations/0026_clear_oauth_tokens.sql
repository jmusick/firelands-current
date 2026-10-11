-- Provider access, refresh, and ID tokens are no longer stored: sign-in only needs them during the OAuth
-- callback, and nothing calls a provider API afterwards (src/lib/oauth-tokens.ts). This clears the values
-- earlier sign-ins left behind. Linked sign-in still works: it matches on providerId and accountId, and
-- `scope` stays. Safe to run more than once.
UPDATE "account"
SET "accessToken" = NULL,
    "refreshToken" = NULL,
    "idToken" = NULL,
    "accessTokenExpiresAt" = NULL,
    "refreshTokenExpiresAt" = NULL
WHERE "accessToken" IS NOT NULL
   OR "refreshToken" IS NOT NULL
   OR "idToken" IS NOT NULL
   OR "accessTokenExpiresAt" IS NOT NULL
   OR "refreshTokenExpiresAt" IS NOT NULL;
