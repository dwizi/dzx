/**
 * @returns {{ meta: { a: string } & { b: number } }}
 */
export default async function returnIntersectionObject() {
  return { meta: { a: "x", b: 1 } };
}
