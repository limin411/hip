/** Execute `items` with at most `limit` concurrent invocations of `fn`.
 *  Results are returned in the same order as `items`. */
export async function runWithConcurrency<T, R>(
  items: readonly T[],
  limit: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  if (items.length === 0) return []
  const results: R[] = new Array(items.length)
  let nextIndex = 0
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (nextIndex < items.length) {
      const i = nextIndex++
      results[i] = await fn(items[i])
    }
  })
  await Promise.all(workers)
  return results
}
