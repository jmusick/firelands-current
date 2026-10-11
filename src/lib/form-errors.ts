// One message per field, shared by the server (which renders the errors after a redirect) and the browser
// script (which shows them before submitting), so both say the same thing. They never contain what was typed.
export const INBOX_FIELD_ERRORS = {
  name: 'Enter your name, up to 100 characters.',
  email: 'Enter a valid email address, such as name@example.com.',
  subject: 'Enter 3 to 120 characters.',
  body: 'Enter 20 to 10,000 characters.',
} as const;

export const CORRECTION_FIELD_ERRORS = {
  name: 'Enter your name, up to 100 characters.',
  email: 'Enter a valid email address, such as name@example.com.',
  details: 'Describe the problem in 10 to 5,000 characters.',
  suggested_fix: 'Keep this to 2,000 characters or fewer.',
  source_url: 'Enter a link that starts with http:// or https://, or leave this blank.',
} as const;

// The summary names the field so each link makes sense read out of context ("What is inaccurate?" becomes "What is inaccurate: ...").
export function summaryText(label: string, message: string): string {
  return `${label.trim().replace(/[?:.]+$/, '')}: ${message}`;
}

// Redirects carry only the names of invalid fields (`?error=invalid&fields=name,email`), never their contents.
export function invalidFieldsQuery(fields: string[]): string {
  return `error=invalid&fields=${fields.join(',')}`;
}

// Reads that list back, keeping only fields the form really has so the query string can't inject anything.
export function parseInvalidFields<T extends Record<string, string>>(raw: string | null, known: T): Array<keyof T & string> {
  const wanted = new Set((raw ?? '').split(','));
  return (Object.keys(known) as Array<keyof T & string>).filter((field) => wanted.has(field));
}
