"use client";

/**
 * The About page's backdrop: a field of small squares that glows from the bottom centre and
 * flickers a few cells at a time. Drawn on a canvas, paused off screen, still with reduced motion.
 */
import { useEffect, useRef } from "react";
import { useReducedMotion } from "motion/react";

const CELL = 16;
const GAP = 3;

/** A repeatable 0..1 value for a cell, so the field looks the same on every draw. */
function grain(column: number, row: number): number {
  const value = Math.sin(column * 127.1 + row * 311.7) * 43758.5453;
  return value - Math.floor(value);
}

export function PixelField() {
  const canvas = useRef<HTMLCanvasElement>(null);
  const still = useReducedMotion() ?? false;

  useEffect(() => {
    const node = canvas.current;
    const context = node?.getContext("2d");
    if (!node || !context) return;
    let columns = 0, rows = 0, frame = 0, timer = 0, visible = true;

    const level = (column: number, row: number) => {
      // Brightest low and centred, thinning out upward and sideways into scattered cells.
      const x = (column + 0.5) / columns - 0.5, y = 1 - (row + 0.5) / rows;
      const glow = Math.max(0, 1 - Math.hypot(x * 1.25, y * 1.05));
      return glow * glow * (0.35 + 0.65 * grain(column, row));
    };
    const paint = (column: number, row: number, boost = 0) => {
      const strength = Math.min(1, level(column, row) + boost);
      context.clearRect(column * CELL, row * CELL, CELL, CELL);
      if (strength < 0.06) return;
      const hue = 262 + 40 * grain(row, column);
      context.fillStyle = `oklch(${62 + 22 * strength}% 0.17 ${hue} / ${0.1 + 0.75 * strength})`;
      context.fillRect(column * CELL, row * CELL, CELL - GAP, CELL - GAP);
    };
    const draw = () => {
      const box = node.getBoundingClientRect(), ratio = Math.min(window.devicePixelRatio || 1, 2);
      node.width = Math.round(box.width * ratio);
      node.height = Math.round(box.height * ratio);
      context.setTransform(ratio, 0, 0, ratio, 0, 0);
      columns = Math.ceil(box.width / CELL);
      rows = Math.ceil(box.height / CELL);
      for (let column = 0; column < columns; column++) for (let row = 0; row < rows; row++) paint(column, row);
    };
    const flicker = () => {
      if (!visible || columns === 0) return;
      frame++;
      for (let count = 0; count < 26; count++) {
        const column = Math.floor(grain(frame, count) * columns), row = Math.floor(grain(count + 7, frame) * rows);
        paint(column, row, grain(frame + count, row) > 0.5 ? 0.35 : -0.25);
      }
    };

    draw();
    const resized = new ResizeObserver(draw);
    resized.observe(node);
    const watched = new IntersectionObserver(([entry]) => { visible = entry?.isIntersecting ?? true; });
    watched.observe(node);
    if (!still) timer = window.setInterval(flicker, 110);
    return () => { resized.disconnect(); watched.disconnect(); window.clearInterval(timer); };
  }, [still]);

  return <canvas ref={canvas} aria-hidden className="about-pixels" />;
}
