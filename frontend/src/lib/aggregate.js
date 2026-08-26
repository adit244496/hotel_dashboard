/** Portfolio roll-ups across the selected hotels. */

const SUM_FIELDS = [
  'rev',
  'room',
  'fnb',
  'other',
  'ebitda',
  'gop',
  'rm',
  'food',
  'bw',
  'smoke',
  'pay',
  'flp',
  'admin',
  'rmnt',
  'fees',
  'ap',
  'stores',
  'rent',
]

/** Additive totals for one scenario ('a' | 'b' | 'ly') across hotels. */
export function aggregate(hotels, scenario) {
  const out = Object.fromEntries(SUM_FIELDS.map((f) => [f, 0]))
  out.inv = 0
  hotels.forEach((hotel) => {
    const block = hotel[scenario] || {}
    SUM_FIELDS.forEach((field) => {
      out[field] += block[field] || 0
    })
    out.inv += hotel.inv || 0
  })
  return out
}

/**
 * Averages of the per-hotel rate metrics (occupancy, ARR, RevPAR).
 *
 * Divided by the number of hotels reporting an actual occupancy, so that the
 * Actual, Budget and Last Year averages share a denominator and stay directly
 * comparable — the same basis the original dashboard used.
 */
export function averageRates(hotels, scenario) {
  const reporting = hotels.filter((h) => h.a?.occ).length || hotels.length || 1
  const sum = { occ: 0, arr: 0, revpar: 0 }
  hotels.forEach((hotel) => {
    const block = hotel[scenario] || {}
    sum.occ += block.occ || 0
    sum.arr += block.arr || 0
    sum.revpar += block.revpar || 0
  })
  return {
    occ: sum.occ / reporting,
    arr: sum.arr / reporting,
    revpar: sum.revpar / reporting,
  }
}

/**
 * Merge each hotel's market segments into one portfolio view.
 *
 * Occupancy is recomputed as the segment's rooms sold per day over the combined
 * room inventory. Averaging or summing the per-hotel percentages would weight a
 * 48-room property the same as a 147-room one.
 */
export function mergeSegments(hotels) {
  const map = new Map()
  const totalInventory = hotels.reduce((sum, hotel) => sum + (hotel.inv || 0), 0)

  hotels.forEach((hotel) => {
    ;(hotel.seg || []).forEach((seg) => {
      const entry = map.get(seg.key) || {
        key: seg.key,
        label: seg.label,
        rooms: 0,
        roomsPerDay: 0,
        rev: 0,
        arrSum: 0,
        arrCount: 0,
      }
      entry.rooms += seg.rooms || 0
      entry.roomsPerDay += seg.roomsPerDay || 0
      entry.rev += seg.rev || 0
      if (seg.arr > 0) {
        entry.arrSum += seg.arr
        entry.arrCount += 1
      }
      map.set(seg.key, entry)
    })
  })

  return [...map.values()].map((entry) => ({
    ...entry,
    // Revenue-weighted rate, not an average of averages.
    arr: entry.rooms ? (entry.rev * 100000) / entry.rooms : entry.arrCount ? entry.arrSum / entry.arrCount : 0,
    occ: totalInventory ? (entry.roomsPerDay / totalInventory) * 100 : 0,
  }))
}

/** Merge outlets across hotels by outlet name. */
export function mergeOutlets(hotels) {
  const map = new Map()
  hotels.forEach((hotel) => {
    ;(hotel.out || []).forEach((outlet) => {
      const key = outlet.name.trim()
      const entry = map.get(key) || {
        name: key,
        rev: 0,
        cov: 0,
        ih: 0,
        wi: 0,
        hotels: 0,
      }
      entry.rev += outlet.rev || 0
      entry.cov += outlet.cov || 0
      entry.ih += outlet.ih || 0
      entry.wi += outlet.wi || 0
      entry.hotels += 1
      map.set(key, entry)
    })
  })
  return [...map.values()]
    .map((entry) => ({
      ...entry,
      // Average price per cover is revenue over covers, not an average of averages.
      apc: entry.cov ? (entry.rev * 100000) / entry.cov : 0,
    }))
    .sort((a, b) => b.rev - a.rev)
}
