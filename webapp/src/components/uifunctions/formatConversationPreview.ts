export function formatConversationPreview(content: string): string {
  const normalized = content.trim().replace(/\s+/g, " ")
  if (!normalized) {
    return "(no content)"
  }
  return normalized.length > 48 ? `${normalized.slice(0, 48)}…` : normalized
}
