"use client";
/**
 * Arc's select for owner forms, with the two things a plain <select> did for free.
 * Radix options cannot use an empty value, so a real "none" choice (for example
 * "All customers") is shown under a stand-in value and posted as "" through a
 * hidden field. Without such an option, the name and required flag go to Radix,
 * which posts the value and blocks an empty required choice itself.
 */
import { useState } from "react";
import { Select } from "@/components/arc/select/select";

const NONE = "__none__";

export type ChoiceOption = { value: string; label: string };

export function ChoiceSelect({ id, label, hint, name, value, defaultValue, onValueChange, options, required, placeholder }: {
  id?: string;
  label: string;
  hint?: string;
  /** Form field name; omit for controlled use. */
  name?: string;
  value?: string;
  defaultValue?: string;
  onValueChange?: (value: string) => void;
  options: ChoiceOption[];
  required?: boolean;
  /** Shown while nothing is chosen. */
  placeholder?: string;
}) {
  const hasNone = options.some((option) => option.value === "");
  const toArc = (raw: string | undefined) => (raw === undefined ? undefined : hasNone && raw === "" ? NONE : raw);
  const [posted, setPosted] = useState(value ?? defaultValue ?? "");
  return (
    // The wrapper only gives the trigger the same 3:1 control edge as inputs (see globals.css).
    <span className="choice-field contents">
      <Select
        id={id}
        label={label}
        description={hint}
        placeholder={placeholder}
        options={options.map((option) => ({ label: option.label, value: toArc(option.value)! }))}
        value={toArc(value)}
        defaultValue={toArc(defaultValue)}
        name={hasNone ? undefined : name}
        required={hasNone ? undefined : required}
        onValueChange={(next) => {
          const real = next === NONE ? "" : next;
          setPosted(real);
          onValueChange?.(real);
        }}
      />
      {hasNone && name ? <input type="hidden" name={name} value={value ?? posted} /> : null}
    </span>
  );
}
