# Spec: FileScannerPort (Outbound Port)

## Purpose

Extracts text from files independently of the concrete format. The goal is pure
content extraction, not security assessment.

## Scope

- Markdown, YAML, JSON, TXT, CSV -> native
- PDF, DOCX, XLSX, HTML -> bounded `@llamaindex/liteparse`
- PPTX -> deterministic in-process OOXML slide-text extraction only; no
  LiteParse or LibreOffice fallback, including empty or invalid presentations

## Non-Scope

- Security assessment; handled by `SkillJudgerPort`
- OCR for images
- EML, ZIP, RTF, legacy Office formats; later through Tika
- Audio/video transcription
- Executable files

## Responsibilities

- Detect MIME type or accept it from the caller.
- Choose the matching extractor.
- Return text/Markdown.
- Extract metadata.
- Provide extracted text and metadata for the judger.

## Inputs / Outputs

- Inputs: buffer/stream plus MIME type plus file path
- Outputs: `{ text: string, metadata: object, extractedBy: string }`

## Dependencies

- `@llamaindex/liteparse`

## Failure Modes

- Unsupported file type -> `UnsupportedFileTypeError`
- liteparse error -> `ScannerError`
- liteparse timeout -> `ValidationError`
- Invalid PPTX OOXML package -> `ValidationError` without external parser fallback
- File too large -> `ValidationError`

## Acceptance Criteria

- PDF/DOCX/XLSX return Markdown text.
- PPTX extraction never invokes LiteParse or LibreOffice and returns slide text
  from OOXML; empty presentations return empty text and invalid packages fail.
- Third-party parser calls have a fixed timeout.
- CSV/TXT/YAML/JSON return raw text.
- Errors are reported clearly.

## Tests / Checks

- Contract tests with sample files
- Failure-mode tests

## Agent Guardrails

- Never execute or interpret files.
- Keep extractor-specific logic in the adapter only.
