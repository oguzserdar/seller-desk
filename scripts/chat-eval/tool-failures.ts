/** Collects failed tool calls separately from successful results, without storing exception bodies. */
export function failedToolNames(content: ReadonlyArray<{ type: string; toolName?: string }>): string[] {
  return content.filter(part => part.type === "tool-error").map(part => part.toolName ?? "unknown tool");
}
