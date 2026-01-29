/**
 * @param {object} input
 * @param {(string | number)[]} input.values
 * @param {Tuple<string, number>} [input.pair]
 * @returns {{ ok: boolean }}
 */
export default async function inputParensUnion(input) {
  return { ok: Boolean(input.values?.length) };
}
