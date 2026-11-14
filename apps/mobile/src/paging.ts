export async function collectPages<T extends Record<string, any>>(
  fetchPage: (offset: number, limit: number) => Promise<T[]>,
  limit = 500,
): Promise<T[]> {
  const result: T[] = [],
    seen = new Set<string>();
  for (let offset = 0; ; offset += limit) {
    const rows = await fetchPage(offset, limit);
    if (!Array.isArray(rows))
      throw new Error("Onverwacht antwoord bij catalogus laden.");
    for (const row of rows) {
      const key = row.id || row.itemId + ":" + row.locationId;
      if (seen.has(key))
        throw new Error(
          "De server herhaalt een pagina; synchronisatie gestopt om onvolledige data te voorkomen.",
        );
      seen.add(key);
      result.push(row);
    }
    if (rows.length < limit) return result;
  }
}
