import { env } from 'cloudflare:workers';
import { betterAuth } from 'better-auth';
import { APIError, createAuthMiddleware, getAuthoritativeSessionFromCtx } from 'better-auth/api';
import { captcha } from 'better-auth/plugins';
import { importPKCS8, SignJWT } from 'jose';
import { d1RateLimitStorage } from './auth-rate-limit';
import { sendPasswordResetMail, sendVerificationMail } from './mail';
import { MAX_PASSWORD, MIN_PASSWORD, PASSWORD_MESSAGES, passwordProblem } from './password-policy';
import { REAUTH_WINDOW_MINUTES, isFresh, recordReauth } from './reauth';

async function appleClientSecret(clientId: string, teamId: string, keyId: string, privateKey: string): Promise<string> {
  const key = await importPKCS8(privateKey.replace(/\\n/g, '\n'), 'ES256');
  const now = Math.floor(Date.now() / 1000);
  return new SignJWT({})
    .setProtectedHeader({ alg: 'ES256', kid: keyId })
    .setIssuer(teamId)
    .setSubject(clientId)
    .setAudience('https://appleid.apple.com')
    .setIssuedAt(now)
    .setExpirationTime(now + 60 * 60 * 24 * 30)
    .sign(key);
}

export type SocialProvider = 'google' | 'facebook' | 'apple' | 'microsoft';

export function enabledProviders(): SocialProvider[] {
  const providers: SocialProvider[] = [];
  if (env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET) providers.push('google');
  if (env.FACEBOOK_CLIENT_ID && env.FACEBOOK_CLIENT_SECRET) providers.push('facebook');
  if (env.APPLE_CLIENT_ID && env.APPLE_TEAM_ID && env.APPLE_KEY_ID && env.APPLE_PRIVATE_KEY) providers.push('apple');
  if (env.MICROSOFT_CLIENT_ID && env.MICROSOFT_CLIENT_SECRET) providers.push('microsoft');
  return providers;
}

/** Refuses new sessions for suspended accounts, so they can't sign in by any method. */
async function refuseSuspended(session: { userId: string }): Promise<void> {
  const suspension = await env.DB.prepare('SELECT expires_at FROM user_suspensions WHERE user_id = ? AND (expires_at IS NULL OR expires_at > ?)')
    .bind(session.userId, Date.now()).first<{ expires_at: number | null }>();
  if (!suspension) return;
  const until = suspension.expires_at
    ? ` until ${new Date(suspension.expires_at).toLocaleDateString('en-US', { dateStyle: 'long', timeZone: 'America/New_York' })}`
    : '';
  throw new APIError('FORBIDDEN', { message: `This account is suspended${until}.`, code: 'ACCOUNT_SUSPENDED' });
}

/**
 * Endpoints that change how an account can be signed in to or whether it exists. They need a recent
 * password confirmation (src/lib/reauth.ts), on top of Better Auth's own 24-hour session-age check for
 * unlinking. Better Auth has deleteUser switched off, so self-service deletion is not offered; the entry
 * keeps it gated should that change.
 */
const REAUTH_PATHS = ['/link-social', '/unlink-account', '/delete-user'];

/** Endpoints that choose a password, and the request-body field that carries it. */
const PASSWORD_FIELDS: Record<string, string> = {
  '/sign-up/email': 'password',
  '/change-password': 'newPassword',
  '/reset-password': 'newPassword',
};

export function createAuth() {
  if (!env.BETTER_AUTH_SECRET || !env.SITE_URL) {
    throw new Error('BETTER_AUTH_SECRET and SITE_URL must be configured');
  }

  const providers = enabledProviders();
  const googleId = env.GOOGLE_CLIENT_ID;
  const googleSecret = env.GOOGLE_CLIENT_SECRET;
  const facebookId = env.FACEBOOK_CLIENT_ID;
  const facebookSecret = env.FACEBOOK_CLIENT_SECRET;
  const appleId = env.APPLE_CLIENT_ID;
  const appleTeam = env.APPLE_TEAM_ID;
  const appleKeyId = env.APPLE_KEY_ID;
  const appleKey = env.APPLE_PRIVATE_KEY;
  const microsoftId = env.MICROSOFT_CLIENT_ID;
  const microsoftSecret = env.MICROSOFT_CLIENT_SECRET;
  return betterAuth({
    appName: 'Firelands Current',
    database: env.DB,
    baseURL: env.SITE_URL,
    secret: env.BETTER_AUTH_SECRET,
    user: { changeEmail: { enabled: true } },
    hooks: {
      before: createAuthMiddleware(async (ctx) => {
        if (ctx.path === '/change-email') {
          const current = await getAuthoritativeSessionFromCtx(ctx);
          if (!current) throw new APIError('UNAUTHORIZED', { message: 'Sign in before changing your email address.' });
          if (Date.now() - new Date(current.session.createdAt).getTime() >= 24 * 60 * 60 * 1000) {
            throw new APIError('FORBIDDEN', { message: 'Sign out and sign in again before changing your email address.', code: 'SESSION_NOT_FRESH' });
          }
        }
        if (REAUTH_PATHS.includes(ctx.path)) {
          // No session: the endpoint itself answers 401.
          const current = await getAuthoritativeSessionFromCtx(ctx);
          if (current && !(await isFresh(current.session.id))) {
            throw new APIError('FORBIDDEN', {
              message: `Confirm your password to continue. Your last confirmation was more than ${REAUTH_WINDOW_MINUTES} minutes ago.`,
              code: 'REAUTH_REQUIRED',
            });
          }
        }
        if (Object.hasOwn(PASSWORD_FIELDS, ctx.path)) {
          const body = (ctx.body ?? {}) as Record<string, unknown>;
          const password = body[PASSWORD_FIELDS[ctx.path]];
          // Length is Better Auth's own check (minPasswordLength, maxPasswordLength); this adds the blocklist.
          if (typeof password !== 'string' || password.length < MIN_PASSWORD || password.length > MAX_PASSWORD) return;
          const known = ctx.path === '/change-password' ? (await getAuthoritativeSessionFromCtx(ctx))?.user : undefined;
          const problem = await passwordProblem(password, {
            email: typeof body.email === 'string' ? body.email : known?.email,
            name: typeof body.name === 'string' ? body.name : known?.name,
          });
          if (problem && problem !== 'length') {
            throw new APIError('BAD_REQUEST', {
              message: PASSWORD_MESSAGES[problem],
              code: 'PASSWORD_TOO_PREDICTABLE',
            });
          }
        }
      }),
      // Typing the password, or finishing a provider sign-in, opens the window for privileged actions
      // (src/lib/reauth.ts). Sessions opened any other way, such as by an emailed link, start without it.
      after: createAuthMiddleware(async (ctx) => {
        if (!ctx.path.startsWith('/sign-in/') && !ctx.path.startsWith('/callback/') && ctx.path !== '/change-password') return;
        const session = ctx.context.newSession?.session;
        if (!session) return;
        try {
          await recordReauth(session.id);
        } catch {
          // The session simply stays stale and asks for the password before the next privileged action.
          console.error(JSON.stringify({ event: 'reauth_record_failed' }));
        }
      }),
    },
    emailAndPassword: {
      enabled: true,
      minPasswordLength: MIN_PASSWORD,
      maxPasswordLength: MAX_PASSWORD,
      // Nobody gets a session until they prove they own the address.
      requireEmailVerification: true,
      resetPasswordTokenExpiresIn: 60 * 60,
      revokeSessionsOnPasswordReset: true,
      sendResetPassword: async ({ user, url }) => sendPasswordResetMail(user, url),
    },
    emailVerification: {
      sendOnSignUp: true,
      sendOnSignIn: true,
      autoSignInAfterVerification: true,
      expiresIn: 60 * 60,
      sendVerificationEmail: async ({ user, url }) => sendVerificationMail(user, url),
    },
    plugins: [
      // Sending email to arbitrary addresses is the abuse risk, so those endpoints need a Turnstile token
      // in the x-captcha-response header. Sign-in is left alone: it only mails after a correct password.
      captcha({
        provider: 'cloudflare-turnstile',
        secretKey: env.TURNSTILE_SECRET_KEY,
        endpoints: ['/sign-up/email', '/request-password-reset', '/send-verification-email', '/change-email'],
      }),
    ],
    account: {
      accountLinking: {
        enabled: true,
        // Linking providers from a signed-in account is supported. Avoid merging
        // unrelated accounts merely because their email strings match.
        disableImplicitLinking: true,
        // Facebook never reports an email as verified, which makes Better Auth refuse even a deliberate
        // link. Trusting it here only affects linking from a signed-in session with a matching email;
        // sign-in still never merges accounts because of disableImplicitLinking above.
        trustedProviders: ['facebook'],
      },
    },
    socialProviders: {
      ...(googleId && googleSecret ? { google: { clientId: googleId, clientSecret: googleSecret } } : {}),
      ...(facebookId && facebookSecret ? { facebook: { clientId: facebookId, clientSecret: facebookSecret } } : {}),
      ...(microsoftId && microsoftSecret ? { microsoft: { clientId: microsoftId, clientSecret: microsoftSecret, tenantId: 'common' } } : {}),
      ...(appleId && appleTeam && appleKeyId && appleKey ? { apple: async () => ({ clientId: appleId, clientSecret: await appleClientSecret(appleId, appleTeam, appleKeyId, appleKey) }) } : {}),
    },
    // Failed social sign-ins land on our own sign-in page (as ?error=code) instead of Better Auth's stock error page.
    onAPIError: { errorURL: '/sign-in' },
    databaseHooks: {
      session: { create: { before: refuseSuspended } },
      user: { update: { before: async (user) => {
        if (user.name === undefined) return;
        if (typeof user.name !== 'string') throw new APIError('BAD_REQUEST', { message: 'Display name must be text.' });
        const name = user.name.trim();
        if (!name || name.length > 80) throw new APIError('BAD_REQUEST', { message: 'Display name must be 1–80 characters.' });
        return { data: { ...user, name } };
      } } },
    },
    trustedOrigins: providers.includes('apple') ? ['https://appleid.apple.com'] : [],
    // Better Auth's defaults allow 3 sign-in, sign-up, password- or email-change attempts per 10 seconds and
    // 3 reset or verification emails per minute, counted per client IP and path. Counting by IP rather than
    // by account means nobody can lock someone else out by failing sign-ins against their address.
    rateLimit: {
      // Better Auth only enables limits when NODE_ENV is "production", which the Workers runtime doesn't set.
      enabled: true,
      customStorage: d1RateLimitStorage(env.DB),
    },
    advanced: {
      ipAddress: {
        // Cloudflare sets this to the connecting address and replaces any copy the client sent, whereas
        // X-Forwarded-For (Better Auth's default) can carry client-chosen values. IPv6 is grouped by /64.
        ipAddressHeaders: ['cf-connecting-ip'],
      },
    },
  });
}

export type SiteAuth = ReturnType<typeof createAuth>;
