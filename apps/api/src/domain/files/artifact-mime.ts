export function resolveArtifactMimeType(mimeType: string | null | undefined, fileName: string): string {
  if (mimeType && mimeType !== 'application/octet-stream') {
    return mimeType;
  }

  const lowerName = fileName.toLowerCase();
  if (lowerName.endsWith('.md')) return 'text/markdown';
  if (lowerName.endsWith('.txt')) return 'text/plain';
  if (lowerName.endsWith('.yaml') || lowerName.endsWith('.yml')) return 'text/yaml';
  if (lowerName.endsWith('.json')) return 'application/json';
  if (lowerName.endsWith('.sh')) return 'text/x-shellscript';
  if (lowerName.endsWith('.py')) return 'text/x-python';
  if (lowerName.endsWith('.js')) return 'text/javascript';
  if (lowerName.endsWith('.ts')) return 'text/typescript';
  if (lowerName.endsWith('.html')) return 'text/html';
  if (lowerName.endsWith('.css')) return 'text/css';
  if (lowerName.endsWith('.pdf')) return 'application/pdf';
  if (lowerName.endsWith('.docx')) return 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
  if (lowerName.endsWith('.pptx')) return 'application/vnd.openxmlformats-officedocument.presentationml.presentation';
  if (lowerName.endsWith('.xlsx')) return 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
  return mimeType || 'application/octet-stream';
}
