/**
 * Sign-in with Google, Facebook, Apple, or Microsoft only needs the provider's tokens during the
 * callback, where Better Auth reads the profile with them. Nothing here calls a provider API on a
 * user's behalf afterwards, so the `account` table keeps none of them: a leaked database export
 * then holds no credentials for the user's provider account. (The Facebook Page publisher uses its
 * own Page token, held as a Worker secret and not in this table.)
 */
const TOKEN_FIELDS = ['accessToken', 'refreshToken', 'idToken', 'accessTokenExpiresAt', 'refreshTokenExpiresAt'] as const;

/**
 * Database-hook result that nulls whichever token fields a write carries. Better Auth encrypts access
 * and refresh tokens (account.encryptOAuthTokens) before this runs and never encrypts idToken, so the
 * hook is what keeps the values out of storage; encryption only backs it up should the hook be removed.
 */
export function withoutOAuthTokens(data: Record<string, unknown>): { data: Record<string, null> } | undefined {
  const cleared: Record<string, null> = {};
  for (const field of TOKEN_FIELDS) {
    if (data[field] != null) cleared[field] = null;
  }
  return Object.keys(cleared).length ? { data: cleared } : undefined;
}
