# Supported File Types

The goal is not to parse every format individually. Instead, the system uses
`@llamaindex/liteparse` for standard documents and direct reads for native text
formats.

## Strategy

1. **Native text formats**: read directly; no parser required.
2. **Standard documents**: use `@llamaindex/liteparse`.
   It returns structured Markdown for:
   - PDF
   - DOCX
   - XLSX, with tables as Markdown tables
   - PPTX
   - HTML

## Supported File Types In The MVP

| Type | MIME | Extractor |
|------|------|-----------|
| Markdown | `text/markdown` | native |
| Plain text | `text/plain` | native |
| YAML | `text/yaml`, `application/x-yaml` | native |
| JSON | `application/json` | native |
| CSV | `text/csv` | native |
| PDF | `application/pdf` | liteparse |
| DOCX | `application/vnd.openxmlformats-officedocument.wordprocessingml.document` | liteparse |
| XLSX | `application/vnd.openxmlformats-officedocument.spreadsheetml.sheet` | liteparse |
| PPTX | `application/vnd.openxmlformats-officedocument.presentationml.presentation` | liteparse |
| HTML | `text/html` | liteparse |

## Not Supported In The MVP

| Type | Reason |
|------|--------|
| Images (PNG, JPG, GIF) | OCR is missing |
| EML, ZIP, RTF, legacy Office formats | Tika is not integrated yet |
| Audio/video | No transcription |
| Executable files (.exe, .dll) | Security risk |
| Encrypted files | Cannot be processed |

## Architecture

```text
FileScannerPort
├── LiteParseFileScanner  -> @llamaindex/liteparse
└── NativeFileScanner     -> MD, YAML, JSON, TXT, CSV
```

`FileScannerPort` decides based on MIME type:

- Native text format -> native
- Standard document -> liteparse

If liteparse fails, the system returns a clear error.

## Future Extension

Apache Tika can be added as a fallback for exotic formats.
