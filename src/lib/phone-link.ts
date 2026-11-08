/** A tel: address from a phone setting: digits and a leading +, nothing else. Null when there is no usable number. */
export function telHref(phone: string | null): string | null {
  if (phone === null) return null;
  const cleaned = phone.trim().replace(/[^0-9+]/g, "").replace(/(?!^)\+/g, "");
  return /[0-9]/.test(cleaned) ? `tel:${cleaned}` : null;
}

/**
 * A phone number as people read it in India: "+91 98765 43210". A ten digit number (or one with 91, or a 0 and a mobile number, in front) is grouped 5 and 5; anything else (112, a landline
 * with its STD code) is shown as it was written, trimmed. The digits are never changed, only the spaces and the +91. Null when there is no digit at all.
 */
export function formatPhone(phone: string | null): string | null {
  if (phone === null) return null;
  const digits = phone.replace(/\D/g, "");
  if (digits === "") return null;
  const national = digits.length === 10 ? digits : digits.length === 12 && digits.startsWith("91") ? digits.slice(2) : digits.length === 11 && /^0[6-9]/.test(digits) ? digits.slice(1) : null;
  return national === null ? phone.trim() : `+91 ${national.slice(0, 5)} ${national.slice(5)}`;
}
