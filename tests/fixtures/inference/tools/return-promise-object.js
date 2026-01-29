/**
 * @returns {Promise<{ id: string, tags?: string[] }>}
 */
export default async function returnPromiseObject() {
  return { id: "abc", tags: ["x"] };
}
