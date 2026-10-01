"use client";

import { useEffect, useState, type InputHTMLAttributes } from "react";
import { formatPhone, maskPhoneInput, phoneComplete } from "@/lib/phone";

/**
 * Поле телефона с маской: всегда «+7» и десять цифр, без пробелов; «8 701…»
 * становится «+7701…» прямо при наборе (`lib/phone.ts`). Неполный номер —
 * подсказка под полем, когда из него вышли.
 */
export function PhoneInput({
  value,
  onChange,
  className = "input",
  placeholder = "+77XXXXXXXXX",
  ...rest
}: Omit<InputHTMLAttributes<HTMLInputElement>, "value" | "onChange" | "type"> & {
  value: string;
  onChange: (value: string) => void;
}) {
  const [focused, setFocused] = useState(false);
  // Старая запись «8 701 555 20 30» — сразу к одному виду, чтобы при сохранении ушла уже такой.
  useEffect(() => {
    const clean = formatPhone(value);
    if (clean !== value && phoneComplete(clean)) onChange(clean);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);
  const showHint = !focused && !!value && !phoneComplete(value);
  return (
    <>
      <input
        {...rest}
        type="tel"
        inputMode="tel"
        autoComplete="tel"
        className={className}
        placeholder={placeholder}
        value={value}
        onFocus={(e) => {
          setFocused(true);
          if (!value) onChange("+7");
          rest.onFocus?.(e);
        }}
        onBlur={(e) => {
          setFocused(false);
          if (value === "+7" || value === "+") onChange("");
          rest.onBlur?.(e);
        }}
        onChange={(e) => onChange(maskPhoneInput(e.target.value, value))}
      />
      {showHint && <span className="block text-xs text-status-critical mt-1">Номер неполный: нужно +7 и 10 цифр</span>}
    </>
  );
}
