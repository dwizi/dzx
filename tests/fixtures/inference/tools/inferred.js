/**
 * A tool with inferred schema.
 * @param {object} input
 * @param {string} input.name
 * @param {number} [input.age]
 * @returns {{ msg: string }}
 */
export default async function inferred(input) {
  return {
    msg: `Hello ${input.name}, age ${input.age}`,
  };
}
