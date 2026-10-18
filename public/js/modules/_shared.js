import { api } from "../api.js";
import { readSnapshot } from "../sync.js";
export { academicNumber, ordinal } from "../academic-format.mjs";

export async function cachedThenNetwork(key, endpoint, offline) {
  const pack = await readSnapshot().catch(() => null),
    cached = pack?.modules?.[key] || null;
  if (offline || !navigator.onLine)
    return { data: cached, cached: true, syncedAt: pack?.generatedAt || "" };
  try {
    return { data: await api.get(endpoint), cached: false };
  } catch (error) {
    if (cached) return { data: cached, cached: true, error };
    throw error;
  }
}

export const name = (record) =>
  [record?.FirstName, record?.MiddleName, record?.LastName]
    .filter(Boolean)
    .join(" ");

