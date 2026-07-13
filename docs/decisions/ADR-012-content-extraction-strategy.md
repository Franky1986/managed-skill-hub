# ADR-012: Content Extraction Strategy

## Status

Accepted

## Context

Skills can contain many file types: PDFs, Excel, Word, and code. We do not want
to build a parser for every format. Instead, we extract text/Markdown
generically.

## Decision

- Native text formats (MD, YAML, JSON, TXT, CSV) are read directly.
- Standard documents (PDF, DOCX, XLSX, PPTX, HTML) use
  `@llamaindex/liteparse`.
- Apache Tika is not integrated yet, but can be added later as a fallback.
- Security assessment is a separate process (`SkillJudgerPort`), not part of
  extraction.

## Consequences

- Less custom format-parsing code.
- Good Markdown output for standard documents through liteparse.
- Exotic formats such as EML, ZIP, RTF, and legacy Office are not supported in
  the MVP.

## Open Points

- Integrate Apache Tika as a fallback for exotic formats.
