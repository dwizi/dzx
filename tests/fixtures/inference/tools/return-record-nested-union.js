/**
 * @returns {Record<string, { score: number | null }>}
 */
export default async function returnRecordNestedUnion() {
  return { a: { score: 1 } };
}
