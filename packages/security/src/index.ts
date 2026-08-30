export function redactSensitiveNarration(value: string): string {
  if (!value) {
    return '[redacted]';
  }

  return value.replace(/\b(?:account|ifsc|upi|bank|narration)\b[^\n]{0,80}/gi, '[redacted]');
}

export function summarizeEvidenceText(value: string, maxLength = 160): string {
  const sanitized = redactSensitiveNarration(value).replace(/\s+/g, ' ').trim();
  return sanitized.length > maxLength ? `${sanitized.slice(0, maxLength - 1)}…` : sanitized;
}
