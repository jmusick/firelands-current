// Accessible validation for the public contact, news-tip, correction, and advertising forms.
//
// - Checks the fields in the browser (replacing the browser's own bubbles, which assistive technology
//   announces inconsistently), then shows a linked error summary, per-field messages, and aria-invalid.
// - Keeps what was typed in sessionStorage so a server-side rejection (bad human check, failed send,
//   validation the browser missed) doesn't lose it. Nothing goes in the URL, a cookie, or to our servers,
//   and the draft is dropped after a successful send or the next time the form is opened normally.
//
// Without JavaScript the browser's own validation runs and the server renders the same summary and messages.

import { summaryText } from '../lib/form-errors';

type Field = HTMLInputElement | HTMLTextAreaElement;

const DRAFT_PREFIX = 'fc-draft:';

function readDraft(key: string): Record<string, string | boolean> | null {
  try { return JSON.parse(sessionStorage.getItem(key) ?? 'null'); } catch { return null; }
}
function writeDraft(key: string, value: Record<string, string | boolean> | null): void {
  try {
    if (value) sessionStorage.setItem(key, JSON.stringify(value));
    else sessionStorage.removeItem(key);
  } catch { /* Storage can be blocked; the form still works without a draft. */ }
}

// Mirrors the server's rules, which trim before measuring.
function isInvalid(field: Field): boolean {
  const value = field.value.trim();
  if (!value) return field.required;
  if (field.minLength > 0 && value.length < field.minLength) return true;
  if (field.maxLength >= 0 && value.length > field.maxLength) return true;
  return field.validity.typeMismatch || field.validity.patternMismatch;
}

function enhance(form: HTMLFormElement): void {
  // Set here rather than in the markup so the browser's validation still works without JavaScript.
  form.noValidate = true;
  const summary = form.querySelector<HTMLElement>('[data-error-summary]')!;
  const list = summary.querySelector('ul')!;
  const fields = [...form.querySelectorAll<Field>('[data-error-message]')];
  const captcha = form.querySelector<HTMLElement>('[data-captcha]');
  const key = DRAFT_PREFIX + (form.dataset.draftKey ?? location.pathname);
  const params = new URLSearchParams(location.search);

  // A draft only comes back after the server sent the visitor here with an error.
  const draft = params.has('error') && !params.has('sent') ? readDraft(key) : null;
  if (!params.has('error')) writeDraft(key, null);
  if (draft) {
    for (const field of form.querySelectorAll<Field>('[data-draft]')) {
      const saved = draft[field.name];
      if (field instanceof HTMLInputElement && field.type === 'checkbox') { if (typeof saved === 'boolean') field.checked = saved; }
      else if (typeof saved === 'string') field.value = saved;
    }
  }

  const errorFor = (field: Field) => document.getElementById(`${field.id}-error`)!;

  function clearField(field: Field): void {
    field.removeAttribute('aria-invalid');
    field.removeAttribute('aria-describedby');
    const note = errorFor(field);
    note.hidden = true;
    note.replaceChildren();
    list.querySelector(`[data-for="${field.id}"]`)?.remove();
    if (!list.children.length) summary.hidden = true;
  }

  function item(target: string, text: string, forField: string): HTMLLIElement {
    const li = document.createElement('li');
    li.dataset.for = forField;
    const link = document.createElement('a');
    link.href = `#${target}`;
    link.textContent = text;
    li.appendChild(link);
    return li;
  }

  function showField(field: Field): HTMLLIElement {
    const message = field.dataset.errorMessage!;
    field.setAttribute('aria-invalid', 'true');
    field.setAttribute('aria-describedby', `${field.id}-error`);
    const note = errorFor(field);
    const prefix = document.createElement('span');
    prefix.className = 'visually-hidden';
    prefix.textContent = 'Error: ';
    note.replaceChildren(prefix, message);
    note.hidden = false;
    return item(field.id, message, field.id);
  }

  form.addEventListener('submit', (event) => {
    const items: HTMLLIElement[] = [];
    for (const field of fields) {
      clearField(field);
      if (isInvalid(field)) {
        const li = showField(field);
        li.firstElementChild!.textContent = summaryText(field.closest('label')?.firstChild?.textContent ?? field.name, field.dataset.errorMessage!);
        items.push(li);
      }
    }
    const widget = captcha?.querySelector<HTMLElement>('[data-captcha-widget]');
    const token = form.querySelector<HTMLInputElement>('[name="cf-turnstile-response"]')?.value;
    if (widget && !token) {
      const status = captcha!.querySelector<HTMLElement>('[data-captcha-status]')!.textContent;
      items.push(item(widget.id, status || 'Complete the human check before sending.', widget.id));
    }
    if (items.length) {
      event.preventDefault();
      list.replaceChildren(...items);
      summary.hidden = false;
      summary.focus();
      return;
    }
    // Saved only now, once the browser is really sending it; password-style fields never opt in.
    const values: Record<string, string | boolean> = {};
    for (const field of form.querySelectorAll<Field>('[data-draft]')) {
      values[field.name] = field instanceof HTMLInputElement && field.type === 'checkbox' ? field.checked : field.value;
    }
    writeDraft(key, values);
  });

  // Fixing a field removes its message right away instead of leaving a stale error.
  for (const field of fields) {
    field.addEventListener('input', () => {
      if (field.getAttribute('aria-invalid') === 'true' && !isInvalid(field)) clearField(field);
    });
  }

  // Links in the summary move focus to the field itself; a bare #fragment doesn't do that in every browser.
  summary.addEventListener('click', (event) => {
    const link = (event.target as HTMLElement).closest('a');
    if (!link) return;
    const target = document.getElementById(link.getAttribute('href')!.slice(1));
    if (!target) return;
    event.preventDefault();
    target.focus();
    target.scrollIntoView({ block: 'center' });
  });

  if (!summary.hidden) summary.focus();
}

// After a successful send the page may not even have a form (corrections show a thank-you instead).
if (new URLSearchParams(location.search).has('sent')) {
  try {
    for (const key of Object.keys(sessionStorage)) if (key.startsWith(DRAFT_PREFIX)) sessionStorage.removeItem(key);
  } catch { /* Storage can be blocked. */ }
}

document.querySelectorAll<HTMLFormElement>('form[data-form-errors]').forEach(enhance);
