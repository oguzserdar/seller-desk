/** The one sentence every Desk count uses, so the subtitle, the section and the menu never disagree. */
export function needsYouLabel(count: number): string {
  if (count === 0) return "Nothing needs you";
  return count === 1 ? "1 needs you" : `${count} need you`;
}
