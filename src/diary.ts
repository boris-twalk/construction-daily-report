import type { Diary, Row, Snapshot, Source } from './schema'

export function todayInTaiwan() {
  return new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Taipei', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date())
}
export const now = () => new Date().toISOString()
export function emptyDiary(date: string): Diary {
  return { date, updatedAt: now(), sources: [], rows: [], analyzed: {}, dismissed: [], goal: '', history: [] }
}
export function newSource(text = ''): Source {
  const timestamp = now()
  return { id: crypto.randomUUID(), text, createdAt: timestamp, updatedAt: timestamp }
}
export function editSource(sources: Source[], id: string, text: string) {
  return sources.map(source => source.id === id && source.text !== text ? { ...source, text, updatedAt: now() } : source)
}
export function removeSource(sources: Source[], id: string) {
  return sources.filter(source => source.id !== id)
}
export function snapshot(diary: Diary): Snapshot {
  const { sources, analyzed, rows, dismissed, goal, mode } = diary
  return { sources, analyzed, rows, dismissed, goal, mode }
}
export function checkpoint(next: Diary, previous: Diary, force = false): Diary {
  if (!force && JSON.stringify(snapshot(next)) === JSON.stringify(snapshot(previous))) return next
  return {
    ...next, updatedAt: now(),
    history: [{ savedAt: previous.updatedAt, snapshot: snapshot(previous) }, ...previous.history],
  }
}
export function progress(row: Row) {
  const value = (key: string) => row.fields.find(field => field.key === key)?.value
  function ratio(numerator: string, denominator: string) {
    const divisor = value(denominator)
    const amount = value(numerator)
    return amount !== undefined && divisor !== undefined && Number(divisor) > 0
      ? Number(amount) / Number(divisor) * 100 : undefined
  }
  return {
    cumulative: ratio('cumulative', 'total'),
    contribution: ratio('done', 'total'),
    achievement: ratio('done', 'planned'),
  }
}
