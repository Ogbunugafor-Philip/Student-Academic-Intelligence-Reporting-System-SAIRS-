export function academicNumber(value, suffix = "") {
  if (value == null || value === "" || !Number.isFinite(Number(value)))
    return "—";
  return `${Number(value)}${suffix}`;
}

export function ordinal(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 1) return "—";
  const mod100 = n % 100;
  return `${n}${mod100 >= 11 && mod100 <= 13 ? "th" : n % 10 === 1 ? "st" : n % 10 === 2 ? "nd" : n % 10 === 3 ? "rd" : "th"}`;
}
