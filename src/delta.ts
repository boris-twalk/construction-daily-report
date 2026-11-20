import type { Candidate, Diary, Row } from './schema'

export const field = (item: Candidate, key: string) => item.fields.find(value => value.key === key)?.value ?? ''
const normalized = (value: string) => value.normalize('NFKC').replace(/\s+/g, '').toLowerCase()
const identity = (item: Candidate) => JSON.stringify([item.category, normalized(field(item, 'title')), normalized(field(item, 'location'))])
const signature = (item: Candidate) => JSON.stringify([
  item.category, [...item.sourceIds].sort(),
  item.fields.map(({ key, value }) => [key, normalized(value)]).sort((a, b) => a[0].localeCompare(b[0])),
])
const overlaps = (a: string[], b: string[]) => a.some(id => b.includes(id))
export function candidateOf(row: Row): Candidate {
  const { category, fields, sourceIds } = row
  return { category, fields, sourceIds }
}
export function changedSources(diary: Diary) {
  return diary.sources.filter(source => source.text.trim() && diary.analyzed[source.id] !== source.text)
}
export function pendingDelta(diary: Diary) {
  return changedSources(diary).length > 0 || Object.keys(diary.analyzed).some(
    id => !diary.sources.some(source => source.id === id && source.text.trim()),
  )
}
export function mergeDelta(diary: Diary, items: Candidate[], mode?: 'demo' | 'ai'): Diary {
  if (!pendingDelta(diary)) return diary
  const changed = changedSources(diary).map(source => source.id)
  const analyzed = Object.fromEntries(diary.sources.filter(source => source.text.trim()).map(source => [source.id, source.text]))
  const removed = Object.keys(diary.analyzed).filter(id => !Object.hasOwn(analyzed, id))
  const removedSet = new Set(removed)
  const affected = [...changed, ...removed]
  const unique = [...new Map(items.map(item => [signature(item), item])).values()]
  const incoming = unique.filter(item => !diary.dismissed.some(entry => signature(entry.item) === signature(item) &&
    item.sourceIds.every(id => entry.sourceTexts[id] === analyzed[id])))
  const rows = diary.rows.map((row): Row => {
    if (!overlaps(affected, row.sourceIds)) return { ...row, change: 'unchanged' }
    const base = row.baseline ?? candidateOf(row)
    const exact = incoming.findIndex(item => signature(item) === signature(base))
    const matches = incoming.map((item, index) => ({ item, index })).filter(({ item }) =>
      identity(item) === identity(base) && overlaps(item.sourceIds, base.sourceIds))
    const match = exact >= 0 ? exact : matches.length === 1 ? matches[0].index : -1
    const retained = row.sourceIds.filter(id => !affected.includes(id))
    if (match < 0) {
      if (row.sourceIds.some(id => removedSet.has(id)) || (!retained.length && row.baseline)) {
        return { ...row, proposal: { kind: 'remove', reason: retained.length ? '部分關聯來源已刪除，請確認是否保留此事項。' : '來源已刪除或改寫，請確認是否保留此事項。' } }
      }
      if (row.sourceIds.some(id => changed.includes(id)) && (retained.length || row.origin === 'manual')) {
        return { ...row, proposal: { kind: 'remove', reason: '關聯來源已改寫，請確認現有事項是否仍需保留。' } }
      }
      return { ...row, change: 'unchanged' }
    }
    const [item] = incoming.splice(match, 1)
    const linked = { ...item, sourceIds: [...new Set([...retained, ...item.sourceIds])] }
    if (signature(base) === signature(linked)) return { ...row, proposal: undefined, change: 'unchanged' }
    if (row.reviewed || row.origin === 'manual' || row.closed || retained.length || hasQuantityConflict(linked)) {
      return { ...row, proposal: { kind: 'update', item: linked, reason: '來源分類有變更，請核對後選擇採用或保留現有內容。' } }
    }
    return { ...row, ...linked, baseline: linked, proposal: undefined, change: 'updated' }
  })
  for (const item of incoming) {
    rows.push({ ...item, id: crypto.randomUUID(), baseline: item, origin: 'auto', reviewed: false, closed: false, change: 'added' })
  }
  return { ...diary, analyzed, rows: appendWarnings(rows), mode: mode && diary.mode && diary.mode !== mode ? 'mixed' : mode ?? diary.mode }
}
function hasQuantityConflict(item: Candidate) {
  if (item.category !== 'work') return false
  const cumulative = field(item, 'cumulative')
  const done = field(item, 'done')
  const total = field(item, 'total')
  return Boolean((cumulative && done && Number(done) > Number(cumulative)) ||
    (cumulative && total && Number(cumulative) > Number(total)))
}
export function appendWarnings(rows: Row[]) {
  const generation = new Map<string, Candidate>()
  const add = (title: string, sourceIds: string[]) => {
    const item: Candidate = { category: 'reminder', fields: [{ key: 'title', value: title }], sourceIds: [...new Set(sourceIds)] }
    generation.set(signature(item), item)
  }
  const works = rows.filter(row => row.category === 'work' && row.proposal?.kind !== 'remove')
  for (const [index, row] of works.entries()) {
    const title = field(row, 'location') + field(row, 'title')
    if (hasQuantityConflict(row)) add(`${title}數量互相矛盾，請核對當日完成量、累計量與計畫總量`, row.sourceIds)
    if (row.proposal?.kind === 'update' && hasQuantityConflict(row.proposal.item)) {
      add(`${title}有待確認的數量差異`, row.sourceIds)
    }
    for (const other of works.slice(index + 1)) {
      const left = normalized(field(row, 'title'))
      const right = normalized(field(other, 'title'))
      if (left && right && (left.includes(right) || right.includes(left)) &&
          (!field(row, 'location') || !field(other, 'location') || normalized(field(row, 'location')) === normalized(field(other, 'location')))) {
        add(`${title}可能有重複或不同的數量紀錄，請比對來源`, [...row.sourceIds, ...other.sourceIds])
      }
    }
  }
  const prefix = 'warning:'
  const result = rows.filter(row => !row.id.startsWith(prefix) || generation.has(row.id.slice(prefix.length)) || row.reviewed || row.closed)
  for (const [key, item] of generation) {
    const id = prefix + key
    if (!result.some(row => row.id === id)) result.push({ ...item, id, origin: 'auto', reviewed: false, closed: false })
  }
  return result
}
export function decide(row: Row, accept: boolean): Row | undefined {
  const proposal = row.proposal
  if (accept && proposal?.kind === 'remove') return undefined
  if (proposal?.kind === 'update') {
    return { ...row, ...(accept ? proposal.item : {}), baseline: proposal.item, proposal: undefined, reviewed: true }
  }
  return { ...row, proposal: undefined, reviewed: true }
}
