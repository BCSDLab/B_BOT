/**
 * 키별로 묶는다. 키와 항목 순서는 처음 나온 순서를 따른다.
 * `Map.groupBy`는 Node 21부터라 운영 서버 Node 버전과 무관하게 쓰려고 둔다.
 */
export function groupBy<T, K>(items: Iterable<T>, keyOf: (item: T) => K): Map<K, T[]> {
  const groups = new Map<K, T[]>();
  for (const item of items) {
    const key = keyOf(item);
    groups.set(key, [...(groups.get(key) ?? []), item]);
  }
  return groups;
}
