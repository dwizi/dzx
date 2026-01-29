/**
 * @returns {{ ok: boolean }}
 */
export default async function inputUnboxed({ name, count = 1 }) {
  return { ok: Boolean(name && count) };
}
