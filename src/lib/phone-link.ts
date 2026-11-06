/** A tel: address from a phone setting: digits and a leading +, nothing else. Null when there is no usable number. */
export function telHref(phone: string | null): string | null {
  if (phone === null) return null;
  const cleaned = phone.trim().replace(/[^0-9+]/g, "").replace(/(?!^)\+/g, "");
  return /[0-9]/.test(cleaned) ? `tel:${cleaned}` : null;
}
