# 0003. Methodology packs are data

- Status: Accepted
- Date: 2026-08-22

## Context

CCTS has nine sectors and ADEETIE fourteen, each with its own document types, streams,
denominators and rules. Encoding each sector as branches in the engine would make every new
sector a change to audited calculation code.

## Decision

A sector is a `MethodologyPack` record (`backend/domain/packs/`): document taxonomy, field
schemas, calculation method, factor references, stream and production bindings, rule IDs and a
clause citation per rule. Extraction, calculation and rules load the pack and never branch on
sector. `packs/loader.ts` validates every pack, including that each rule has a citation. A
database trigger stops an engagement being rebound to a different pack.

## Consequences

- Adding a sector means adding a pack and its tests, not changing the engine.
- An engagement's methodology cannot change after evidence is attached.
- Packs carry versions, recorded on every run.
- Sector-specific behaviour that cannot be expressed as bindings needs the pack type to grow,
  which is a deliberate, reviewed change.
