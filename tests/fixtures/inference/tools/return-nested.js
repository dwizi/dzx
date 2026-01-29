/**
 * @returns {{ meta: { id: string }, tags?: string[] }}
 */
export default async function returnNested() {
  return { meta: { id: "1" }, tags: ["tag"] };
}
