# Spec: Duplicate Similarity Contract

## Purpose

Define the hardened structured prompt/output boundary used for internal semantic
duplicate enrichment.

## Contract

- Metadata and entrypoint text are untrusted data, never instructions.
- Entrypoint text is length-limited, JSON encoded, and angle brackets are escaped
  so content cannot close the surrounding prompt delimiter.
- The system prompt forbids following embedded instructions and forbids quoting
  or revealing compared content.
- Output contains only a finite `similarityScore` in `[0,1]` and a high-level
  `reason`; malformed output raises `JudgerProtocolError`.

## Tests

- Delimiter-injection regression test
- Structured output bounds and protocol-error test
