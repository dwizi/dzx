/**
 * @param {object} input
 * @param {string[]} input.tags
 * @param {number | string | null} [input.count]
 * @param {Array<"a" | "b">} [input.modes]
 * @returns {{ ok: boolean }}
 */
export default async function inputEdge(input) {
  return { ok: Boolean(input.tags) };
}
