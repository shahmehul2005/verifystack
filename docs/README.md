# Documentation

| Folder | Contents |
| ------ | -------- |
| [`architecture/`](architecture) | [Overview](architecture/overview.md) — the system end to end. [Data flow](architecture/data-flow.md) — process-level DFDs. |
| [`decisions/`](decisions/README.md) | Architecture decision records: what we chose and why. |
| [`domain/`](domain) | [Regulatory register](domain/regulatory-register.md) — every regulatory value, its source and verification status. [Glossary](domain/glossary.md). |
| [`product/`](product) | [Citations and ECM brief](product/citations-and-ecm-brief.md). [Open questions](product/open-questions.md) waiting on founders or reviewers. |
| [`guides/`](guides) | [Supabase setup](guides/supabase-setup.md). [Platform steward checklist](guides/platform-steward-checklist.md). [Auditor onboarding](guides/auditor-onboarding.md) for the domain reviewer. |
| [`pitch/`](pitch) | [BPF2026 drafted answers](pitch/bpf2026-answers.md). The submission PDF is kept locally and not committed. |

## Keeping docs true

- Change `architecture/overview.md` in the same pull request as the behaviour it describes.
- Add an ADR for any decision that would surprise a new engineer.
- Record every regulatory value change, with its source, in the regulatory register.
- Move answered items out of `product/open-questions.md` once they are reflected in code or docs.
