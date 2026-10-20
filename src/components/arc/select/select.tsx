"use client";

import { forwardRef, useCallback, useId, useState } from "react";
import type { ComponentPropsWithoutRef } from "react";
import * as SelectPrimitive from "@radix-ui/react-select";
import { Check, ChevronDown, ChevronUp } from "lucide-react";
import styles from "./select.module.css";

/** Accessible choice control with optional separately aligned numeric counts. */
export interface SelectProps
  extends Omit<
    ComponentPropsWithoutRef<typeof SelectPrimitive.Root>,
    "children"
  > {
  label: string;
  description?: string;
  placeholder?: string;
  id?: string;
  className?: string;
  options: {
    value: string;
    label: string;
    count?: number;
    disabled?: boolean;
  }[];
}

/** Keeps keyboard selection and floating options within the current colour scope. */
export const Select = forwardRef<HTMLButtonElement, SelectProps>(
  function Select(
    {
      label,
      description,
      placeholder = "Select an option",
      options,
      id,
      className,
      disabled,
      onValueChange,
      ...rootProps
    },
    ref,
  ) {
    const generatedId = useId();
    const [portalContainer, setPortalContainer] = useState<HTMLElement | null>(
      null,
    );
    const fieldRef = useCallback((node: HTMLDivElement | null) => {
      if (node)
        setPortalContainer(
          node.closest<HTMLElement>(".desk-theme, .buyer-page"),
        );
    }, []);
    const controlId = id ?? generatedId;
    const hintId = description ? `${controlId}-description` : undefined;
    const [uncontrolledValue, setUncontrolledValue] = useState(
      rootProps.defaultValue ?? "",
    );
    const currentValue = rootProps.value ?? uncontrolledValue;
    const index = options.findIndex((option) => option.value === currentValue);
    const shown = currentValue ? (options[index]?.label ?? "") : placeholder;

    return (
      <div ref={fieldRef} className={styles.field}>
        <label htmlFor={controlId}>{label}</label>
        <SelectPrimitive.Root
          {...rootProps}
          disabled={disabled}
          onValueChange={(next) => {
            setUncontrolledValue(next);
            onValueChange?.(next);
          }}
        >
          <SelectPrimitive.Trigger
            ref={ref}
            id={controlId}
            aria-describedby={hintId}
            className={[styles.trigger, className].filter(Boolean).join(" ")}
          >
            {/* Radix keeps the selected value available to assistive technology. */}
            <span className={styles.srOnly}>
              <SelectPrimitive.Value placeholder={placeholder} />
            </span>
            <span className={styles.valueText} aria-hidden="true">
              <span data-placeholder={currentValue ? undefined : ""}>
                {shown}
              </span>
            </span>
            <SelectPrimitive.Icon className={styles.chevron}>
              <ChevronDown size={16} strokeWidth={1.75} aria-hidden="true" />
            </SelectPrimitive.Icon>
          </SelectPrimitive.Trigger>
          <SelectPrimitive.Portal container={portalContainer ?? undefined}>
            <SelectPrimitive.Content
              className={styles.content}
              position="popper"
              sideOffset={4}
              collisionPadding={12}
            >
              <SelectPrimitive.ScrollUpButton className={styles.scrollButton}>
                <ChevronUp size={16} strokeWidth={1.75} aria-hidden="true" />
              </SelectPrimitive.ScrollUpButton>
              <SelectPrimitive.Viewport className={styles.viewport}>
                {options.map((option) => (
                  <SelectPrimitive.Item
                    key={option.value}
                    value={option.value}
                    disabled={option.disabled}
                    className={styles.item}
                  >
                    <span className={styles.itemLabel}>
                      <SelectPrimitive.ItemText>
                        {option.label}
                      </SelectPrimitive.ItemText>
                    </span>
                    {option.count !== undefined ? (
                      <span className={styles.count}>{option.count}</span>
                    ) : null}
                    <SelectPrimitive.ItemIndicator className={styles.indicator}>
                      <Check size={16} strokeWidth={1.75} aria-hidden="true" />
                    </SelectPrimitive.ItemIndicator>
                  </SelectPrimitive.Item>
                ))}
              </SelectPrimitive.Viewport>
              <SelectPrimitive.ScrollDownButton className={styles.scrollButton}>
                <ChevronDown size={16} strokeWidth={1.75} aria-hidden="true" />
              </SelectPrimitive.ScrollDownButton>
            </SelectPrimitive.Content>
          </SelectPrimitive.Portal>
        </SelectPrimitive.Root>
        {description && (
          <span id={hintId} className={styles.hint}>
            {description}
          </span>
        )}
      </div>
    );
  },
);
