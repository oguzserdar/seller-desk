/**
 * A pen nib over a line. While the assistant writes, the line draws itself out under the nib and the
 * nib follows it; at rest it is still. Honors reduced motion.
 */
export function WritingPen({ writing = false, size = 16 }: { writing?: boolean; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden className={writing ? "writing-pen is-writing" : "writing-pen"}>
      <g className="writing-pen-nib" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
        <path d="M14.5 4.5l5 5L10 19l-5.5 1 1-5.5 9-10z" />
        <path d="M12.5 6.5l5 5" />
      </g>
      <path className="writing-pen-line" d="M3 22h8" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" />
    </svg>
  );
}
