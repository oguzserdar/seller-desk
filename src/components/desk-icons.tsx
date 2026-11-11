"use client";

/**
 * @fileoverview Seller Desk's own sidebar icons, drawn on a 24 grid with a 2 px rounded line
 * over a soft tint of the desk accent. Each icon moves one part of its drawing to say what the
 * page is for (the bell rings, the reply arrives, the tag turns), plays once in under 600 ms and
 * never loops. Motion drives the parts; the sidebar starts and stops them through the same
 * `startAnimation` / `stopAnimation` handle and skips them for reduced-motion viewers.
 */
import { motion, useAnimation, type TargetAndTransition } from "motion/react";
import { forwardRef, useId, useImperativeHandle, type ReactNode } from "react";

/** The imperative handle every desk icon exposes to the row that hosts it. */
export type DeskIconHandle = { startAnimation: () => void; stopAnimation: () => void };

type DeskIconProps = { size?: number; className?: string; "aria-hidden"?: boolean };

/** One moving part: its pivot, as a share of the part's own box, and the motion it plays. */
type Part = { origin: string; play: TargetAndTransition };
type Move = (part: Part, children: ReactNode) => ReactNode;

const REST: TargetAndTransition = { x: 0, y: 0, rotate: 0, scale: 1, scaleX: 1, opacity: 1, transition: { duration: 0.15 } };
const SETTLE = [0.2, 0.8, 0.2, 1] as const;
const TINT = { fill: "var(--accent)", fillOpacity: 0.18, stroke: "none" } as const;

function deskIcon(name: string, draw: (move: Move, uid: string) => ReactNode) {
  const Icon = forwardRef<DeskIconHandle, DeskIconProps>(({ size = 24, className, ...rest }, ref) => {
    const controls = useAnimation();
    const uid = `desk-icon${useId().replace(/[^\w-]/g, "")}`;
    useImperativeHandle(ref, () => ({
      startAnimation: () => void controls.start("animate"),
      stopAnimation: () => void controls.start("normal"),
    }), [controls]);
    const move: Move = (part, children) => (
      <motion.g
        animate={controls}
        initial="normal"
        variants={{ normal: REST, animate: part.play }}
        style={{ transformBox: "fill-box", transformOrigin: part.origin }}
      >
        {children}
      </motion.g>
    );
    return (
      <span className={className} {...rest}>
        <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          {draw(move, uid)}
        </svg>
      </span>
    );
  });
  Icon.displayName = name;
  return Icon;
}

const BELL_DOME = "M5.5 16a6.5 6.5 0 0 1 13 0Z";
/** Desk: the striker presses and the bell rings, because someone needs you. */
export const DeskIcon = deskIcon("DeskIcon", (move) => (
  <>
    <path d="M5 19h14" />
    {move(
      { origin: "50% 100%", play: { rotate: [0, 0, -5, 3.5, -1.5, 0], transition: { duration: 0.52, times: [0, 0.25, 0.45, 0.65, 0.82, 1], ease: "easeOut" } } },
      <><path d={BELL_DOME} style={TINT} /><path d={BELL_DOME} /></>,
    )}
    {move(
      { origin: "50% 90%", play: { y: [0, 1.6, 0, 0], transition: { duration: 0.52, times: [0, 0.3, 0.6, 1], ease: "easeOut" } } },
      <><circle cx="12" cy="6" r="1.25" /><path d="M12 7.25v2.25" /></>,
    )}
  </>
));

const REPLY = "M14.5 13h4.25a2.75 2.75 0 0 1 0 5.5H16.5l-3 2.25v-2.5A2.75 2.75 0 0 1 14.5 13Z";
/** Conversations: the shop's reply pops up under the buyer's question. */
export const ConversationsIcon = deskIcon("ConversationsIcon", (move) => (
  <>
    <path d="M4.5 3.5h7A1.5 1.5 0 0 1 13 5v4a1.5 1.5 0 0 1-1.5 1.5H8l-3 2.5v-2.5h-.5A1.5 1.5 0 0 1 3 9V5a1.5 1.5 0 0 1 1.5-1.5Z" />
    {move(
      { origin: "0% 100%", play: { scale: [0.35, 1.07, 1], opacity: [0, 1, 1], transition: { duration: 0.38, times: [0, 0.7, 1], ease: SETTLE } } },
      <><path d={REPLY} style={TINT} /><path d={REPLY} /></>,
    )}
  </>
));

const TAG = "M10.5 6H19a1.5 1.5 0 0 1 1.5 1.5v8A1.5 1.5 0 0 1 19 17h-8.5L5.5 11.5Z";
/** Offers: the price tag turns over on its string to show its face. */
export const OffersIcon = deskIcon("OffersIcon", (move) => (
  <>
    <path d="M3 3.5c1.5 0 2.75 1 3.25 2.5" />
    {move(
      { origin: "50% 50%", play: { scaleX: [1, 0.5, 1], transition: { duration: 0.42, ease: "easeInOut" } } },
      <><path d={TAG} style={TINT} /><path d={TAG} /><circle cx="9.25" cy="11.5" r="1" /></>,
    )}
  </>
));

const CARD = "M10.5 9h8A1.5 1.5 0 0 1 20 10.5v8a1.5 1.5 0 0 1-1.5 1.5h-8A1.5 1.5 0 0 1 9 18.5v-8A1.5 1.5 0 0 1 10.5 9Z";
const UNDER = "M4.6 9.2 12.4 6.9a1.5 1.5 0 0 1 1.86 1.02l2.1 7.2a1.5 1.5 0 0 1-1.02 1.86l-7.8 2.28a1.5 1.5 0 0 1-1.86-1.02l-2.1-7.18A1.5 1.5 0 0 1 4.6 9.2Z";
/** Knowledge: a newly learned fact settles on top of the stack. */
export const KnowledgeIcon = deskIcon("KnowledgeIcon", (move, uid) => (
  <>
    <defs>
      <mask id={`${uid}-under`} maskUnits="userSpaceOnUse" x="0" y="0" width="24" height="24">
        <rect width="24" height="24" fill="white" stroke="none" />
        <path d={CARD} fill="black" stroke="black" strokeWidth="4" transform="rotate(7 14.5 14.5)" />
      </mask>
    </defs>
    <g mask={`url(#${uid}-under)`}><path d={UNDER} style={TINT} /><path d={UNDER} /></g>
    <g transform="rotate(7 14.5 14.5)">
      {move(
        { origin: "50% 100%", play: { x: [1.5, 0, 0], y: [-5, 0.5, 0], rotate: [10, -1.5, 0], opacity: [0, 1, 1], transition: { duration: 0.46, times: [0, 0.7, 1], ease: SETTLE } } },
        <><path d={CARD} /><path d="M12 13h5" /></>,
      )}
    </g>
  </>
));

const SIGN = "M9 10h10a1 1 0 0 1 1 1v6a1 1 0 0 1-1 1H9a1 1 0 0 1-1-1v-6a1 1 0 0 1 1-1Z";
/** Setup: the shop sign on its wall bracket swings once and settles. */
export const SetupIcon = deskIcon("SetupIcon", (move) => (
  <>
    <path d="M3.5 3v17" />
    <path d="M3.5 6.5h17" />
    {move(
      { origin: "50% 0%", play: { rotate: [0, 7, -3.5, 0], transition: { duration: 0.56, times: [0, 0.3, 0.65, 1], ease: "easeOut" } } },
      <><path d="M10.5 6.5V10M17.5 6.5V10" /><path d={SIGN} style={TINT} /><path d={SIGN} /></>,
    )}
  </>
));

const WIDGET = "M17.5 13a3.5 3.5 0 0 1 0 7H14v-3.5a3.5 3.5 0 0 1 3.5-3.5Z";
/** Install: the chat widget rises into the corner of your site. */
export const InstallIcon = deskIcon("InstallIcon", (move) => (
  <>
    <path d="M10.5 19.5H5A1.5 1.5 0 0 1 3.5 18V6A1.5 1.5 0 0 1 5 4.5h14A1.5 1.5 0 0 1 20.5 6v4" />
    <path d="M7 9h6" />
    {move(
      { origin: "50% 100%", play: { y: [5, -0.5, 0], scale: [0.7, 1.04, 1], opacity: [0, 1, 1], transition: { duration: 0.44, times: [0, 0.7, 1], ease: SETTLE } } },
      <><path d={WIDGET} style={TINT} /><path d={WIDGET} /></>,
    )}
  </>
));

/** Insights: the columns rise from the baseline, the tallest last. */
export const InsightsIcon = deskIcon("InsightsIcon", (move) => (
  <>
    <path d="M3.5 20.5h17" />
    {move(
      { origin: "50% 100%", play: { scaleY: [0.4, 1], transition: { duration: 0.32, ease: "easeOut" } } },
      <path d="M6.5 17.5v-5" />,
    )}
    {move(
      { origin: "50% 100%", play: { scaleY: [0.4, 1], transition: { duration: 0.38, delay: 0.06, ease: "easeOut" } } },
      <path d="M12 17.5v-9" />,
    )}
    {move(
      { origin: "50% 100%", play: { scaleY: [0.4, 1], transition: { duration: 0.44, delay: 0.12, ease: "easeOut" } } },
      <path d="M17.5 17.5V5" />,
    )}
  </>
));
