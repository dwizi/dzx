/**
 * @param {object} input
 * @param {Set<string>} input.tags
 * @param {Map<string, number>} [input.weights]
 * @returns {{ ok: boolean }}
 */
export default async function inputSetMap(input) {
  return { ok: Boolean(input.tags) };
}
