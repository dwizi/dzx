/**
 * @returns {{ status: "ok" | "error", code?: number | null }}
 */
export default async function returnNestedUnion() {
  return { status: "ok" };
}
