/**
 * Screening for what a visitor types into the website assistant.
 *
 * Deterministic on purpose. It runs before retrieval and before any model call, so a
 * message that tries to change the assistant's rules, or that carries a personal or
 * secret number, is refused here and never reaches Gemini. Email addresses and phone
 * numbers are removed from the text that is kept, because an answer does not need them.
 */

export type ScreenReason = "prompt_injection" | "sensitive_data";

export type ScreenVerdict = { ok: true; text: string } | { ok: false; reason: ScreenReason };

/** Phrases that try to change the rules, reveal the prompt, or give the assistant another role. */
const INJECTION: readonly RegExp[] = [
  /\b(?:ignore|disregard|forget|override|bypass)\b[^.?!\n]{0,40}\b(?:instructions?|rules?|prompts?|guidelines?|guardrails?|directives?)\b/i,
  /\b(?:reveal|show|print|repeat|output|dump|display|share|tell me)\b[^.?!\n]{0,30}\byour\b[^.?!\n]{0,30}\b(?:prompts?|instructions?|rules|guardrails?|knowledge|configuration|training)\b/i,
  /\b(?:system|hidden|initial|original|developer)\s+(?:prompt|instructions?|messages?)\b/i,
  /\b(?:jailbreak|jailbroken|developer mode|do anything now)\b|\bDAN\b/,
  /\b(?:pretend|roleplay|role-play)\s+(?:to be|you are|that you are|as)\b/i,
  /\byou are now\s+(?:a|an|my|the|dan|free|unrestricted)\b/i,
  /<\/?\s*(?:system|assistant|instructions?)\s*>/i,
  /\[\s*(?:system|instructions?)\s*\]/i,
];

/** Shapes of API keys, tokens and passwords. None of them belongs in a chat. */
const SECRETS: readonly RegExp[] = [
  /\bAIza[0-9A-Za-z_-]{30,}/,
  /\bsk-[A-Za-z0-9_-]{20,}/,
  /\bsb_(?:secret|publishable)_[A-Za-z0-9_-]{10,}/,
  /\bre_[A-Za-z0-9_]{20,}/,
  /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/,
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
  /\bpass(?:word|wd|code|phrase)?\s*(?:is|=|:)\s*\S{3,}/i,
];

/** Indian PAN: five letters, four digits, one letter. */
const PAN = /\b[A-Z]{5}[0-9]{4}[A-Z]\b/i;

/** Aadhaar: twelve digits in groups of four, never starting with 0 or 1. */
const AADHAAR = /(?<!\d)[2-9]\d{3}[ -]?\d{4}[ -]?\d{4}(?!\d)/;

const EMAIL = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;
const PHONE = /(?<!\d)(?:\+?91[ -]?)?[6-9]\d{4}[ -]?\d{5}(?!\d)/g;

export function hasPromptInjection(text: string): boolean {
  return INJECTION.some((re) => re.test(text));
}

/** Luhn check, so that a long quantity is not mistaken for a card number. */
function luhnValid(digits: string): boolean {
  let sum = 0;
  let double = false;
  for (let i = digits.length - 1; i >= 0; i -= 1) {
    let d = Number(digits[i]);
    if (double) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
    double = !double;
  }
  return sum % 10 === 0;
}

function hasCardNumber(text: string): boolean {
  for (const match of text.matchAll(/(?:\d[ -]?){13,19}/g)) {
    const digits = match[0].replace(/\D/g, "");
    if (digits.length >= 13 && digits.length <= 19 && luhnValid(digits)) return true;
  }
  return false;
}

export function hasSensitiveData(text: string): boolean {
  return SECRETS.some((re) => re.test(text)) || PAN.test(text) || AADHAAR.test(text) || hasCardNumber(text);
}

/** Replaces email addresses and Indian mobile numbers with placeholders. */
export function redactPersonalData(text: string): string {
  return text.replace(EMAIL, "[email]").replace(PHONE, "[phone]");
}

/**
 * The verdict for one visitor message. A refused message is never retrieved or sent
 * to a model. An accepted one carries the redacted text that the rest of the pipeline uses.
 */
export function screenVisitorText(text: string): ScreenVerdict {
  if (hasPromptInjection(text)) return { ok: false, reason: "prompt_injection" };
  if (hasSensitiveData(text)) return { ok: false, reason: "sensitive_data" };
  return { ok: true, text: redactPersonalData(text).trim() };
}
