import Link from "next/link";
import type { ComponentProps } from "react";
import styles from "@/components/arc/button/button.module.css";
import type { ButtonVariant } from "@/components/arc/button/button";
import { cx } from "@/lib/cx";

/** A link that looks exactly like Arc's Button, for navigation that must stay a real link. */
export function LinkButton({ variant = "primary", size = "md", className, ...props }: ComponentProps<typeof Link> & { variant?: ButtonVariant; size?: "sm" | "md" | "lg" }) {
  return <Link {...props} className={cx(styles.button, styles[variant], styles[size], className)} />;
}
