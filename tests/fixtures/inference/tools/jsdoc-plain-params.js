/**
 * Tool with plain JSDoc params.
 * @param {string} name
 * @param {number} [count]
 * @returns {string}
 */
export default async function plain(input) {
  const suffix = typeof input.count === "number" ? ` (${input.count})` : "";
  return `hi ${input.name}${suffix}`;
}
