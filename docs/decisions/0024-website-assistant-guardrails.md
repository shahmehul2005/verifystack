# 0024. The website assistant screens, scopes and grounds every answer

- Status: Accepted
- Date: 2026-10-31

## Context

The website assistant is public. It sits in the root layout, so it also appears inside the signed-in
app, and anyone can type into it. Three gaps made it easy to misuse or to mislead:

- When retrieval found nothing, it retried with the previous question appended, so an off-topic
  request could inherit the product topic and receive an on-topic entry.
- The library fallback showed the top entry for any keyword hit. "What's the best phone?" matched the
  fieldwork entry because of the word "phone", and the answer was that entry.
- Injected instructions and personal or secret numbers were forwarded to the model unchanged.
  The groundedness gate checked numbers and citations, but not whether the wording was about the
  product at all.

The knowledge base had also fallen behind the product (no desk review, evidence checklist, pro forma
inputs, review queue, calculation readiness, or DPR savings), and it made two claims the code does
not support: that digital PDFs are parsed deterministically, and that ECM is ADEETIE-only.

## Decision

Every visitor message passes these checks, in order. Each step can stop the message before the next.

1. **Screening** (`backend/domain/assistant/guard.ts`, deterministic). Messages that try to change the
   assistant's rules, reveal its prompt or assign it a role are refused. Messages carrying a PAN,
   Aadhaar, a Luhn-valid card number, an access key or a password are refused. A refused message is
   never retrieved or sent to a model. Email addresses and phone numbers are removed from the text
   kept. Earlier visitor turns are screened the same way.
2. **Scope** (`retrieve.ts`). A question with no matching entry is out of scope. A question also has
   a coverage: the share of its words that an entry names as a topic (keyword or title, not running
   prose). A match is clear when coverage is at least 60%. A loose match is never answered from the
   library alone.
3. **Follow-ups.** A question with no words of its own ("tell me more") takes the previous question.
   A question with words of its own is judged alone.
4. **Model as classifier and rephraser.** The model receives only the matched entries and the screened
   question, and may answer, say `not_covered`, or say `out_of_scope`. Its wording is shown only if it
   cites entries it was given, adds no number, link or phrase about its own instructions, and takes at
   least 60% of its words from the cited entries. Otherwise a clear match is shown as written, and a
   loose match is refused.
5. **Fixed replies** for refusals, out-of-scope questions and not-covered questions. A not-covered
   question links to the demo request, the next step a visitor can take.

The widget is reduced to what a visitor needs: one header, one greeting, three starter questions until
the first message, one link per reply, and one line of disclaimer. The route returns `no-store`, and
logs the outcome and mode only, never the question or the answer.

Questions are not stored. Refused questions are not analysed. Knowledge changes go with the feature
that changes them, and tests check the routing of each entry, that every link is a real page, and that
no entry states a scheme threshold or an unverified number.

## Consequences

- A loose question is refused, or sent to the model, instead of receiving a related entry. Visitors
  sometimes need to rephrase.
- Scope depends on keywords. Each new feature needs an entry, and a routing test. Keyword drift shows
  up as a failing test, not as a silent wrong answer.
- The 60% thresholds are heuristics. They are set so that every starter question and every clear
  product question tested is confident, and that the off-topic examples in the tests are not.
- Screening patterns can flag an ordinary sentence: "show your settings" is refused. That is accepted,
  because a refusal is safe and says what the assistant can help with.
- The assistant keeps no record of what it was asked. It therefore cannot show which questions were
  not covered. If that analysis is wanted later, it needs its own decision, with a retention period
  and a consent note on the page.
- A model call gets one attempt and fifteen seconds. The SDK's default of five attempts with backoff
  kept a visitor waiting for a minute while Gemini was busy. Now the answer comes from the matched
  entry, or the question is refused, and the visitor is not left on a typing indicator.
- Rate limits and the model budget remain per server instance, as before.
- The assistant is not regulatory guidance. Its knowledge repeats product behaviour, and it says so.
