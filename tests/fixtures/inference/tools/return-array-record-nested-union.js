/**
 * @returns {Array<Record<string, { score: number | null }>>}
 */
export default async function returnArrayRecordNestedUnion() {
  return [{ a: { score: 1 } }];
}
