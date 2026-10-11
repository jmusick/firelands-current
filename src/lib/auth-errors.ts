// Better Auth reports failed sign-ins and links as ?error=code on the page it redirects to.
const MESSAGES: Record<string, string> = {
  account_not_linked: 'An account with that email address already exists. Sign in with your email and password, then link the other sign-in method from your account page.',
  unable_to_link_account: 'That sign-in method could not be linked to your account. Try again from your account page.',
  email_does_not_match: 'That sign-in method uses a different email address than your account, so it was not linked.',
  access_denied: 'Sign-in was cancelled.',
};

export function authErrorMessage(code: string | null): string | null {
  if (!code) return null;
  return MESSAGES[code.toLowerCase()] ?? 'That sign-in did not work. Please try again.';
}

// Shown when the request itself fails (offline, DNS, a dropped connection) rather than the server answering with an error.
export const NETWORK_ERROR = 'We could not reach the server. Check your connection and try again.';
