import 'fake-indexeddb/auto'
import { describe, expect, it } from 'vitest'
import { appendWarnings, changedSources, decide, field, mergeDelta } from '../src/delta'
import { DEMO_DATE, demoClassify, demoDiary } from '../src/demo'
import { checkpoint, editSource, emptyDiary, newSource, progress, removeSource, snapshot } from '../src/diary'
import { backupSchema, classificationSchema } from '../src/schema'
import { importBackup, readDiary, saveDiary } from '../src/storage'

const organize = (day: ReturnType<typeof emptyDiary>) => mergeDelta(day, demoClassify(changedSources(day)), 'demo')
const sample = () => organize(demoDiary())

describe('原始敘述與分類', () => {
  it('新增、修改及刪除來源，保留 ID 與建立時間', () => {
    const first = newSource('施工說明')
    const second = newSource()
    expect(first.id).not.toBe(second.id)
    const edited = editSource([first, second], first.id, '更新說明')
    expect(edited[0]).toMatchObject({ id: first.id, text: '更新說明', createdAt: first.createdAt })
    expect(new Date(edited[0].updatedAt).getTime()).toBeGreaterThanOrEqual(new Date(first.updatedAt).getTime())
    expect(removeSource(edited, first.id)).toEqual([second])
  })
  it('驗證固定欄位、數值、日期及來源格式', () => {
    const values = demoClassify(demoDiary().sources)
    expect(classificationSchema.safeParse({ items: values }).success).toBe(true)
    for (const fields of [[{ key: 'nonsense', value: '1' }], [{ key: 'done', value: '不明' }], [{ key: 'done', value: '-5' }]]) {
      expect(classificationSchema.safeParse({ items: [{ category: 'work', sourceIds: ['id'], fields }] }).success).toBe(false)
    }
    expect(classificationSchema.safeParse({ items: [{ category: 'tomorrow', sourceIds: ['id'], fields: [{ key: 'date', value: '2026-02-30' }] }] }).success).toBe(false)
    expect(classificationSchema.safeParse({ items: [{ ...values[0], sourceIds: [] }] }).success).toBe(false)
  })
  it('同一句拆分工作和施工限制，解析全套示範日誌', () => {
    const day = sample()
    const source = day.sources[1].id
    expect(day.rows.filter(row => row.sourceIds.includes(source)).map(row => row.category)).toEqual(expect.arrayContaining(['work', 'issue', 'reminder']))
    expect(day.rows.map(row => row.category)).toEqual(expect.arrayContaining(['ehs', 'qa', 'document', 'tomorrow']))
    const a = day.rows.find(row => field(row, 'location') === 'A區')!
    expect(field(a, 'done')).toBe('3')
    expect(field(a, 'equipment')).toBe('150T吊車1台')
    expect(field(a, 'people')).toBe('8')
    const b = day.rows.find(row => field(row, 'location') === 'B區')!
    expect(field(b, 'done')).toBe('10')
    expect(field(b, 'description')).toContain('未完成2支')
  })
  it('缺資料時建立提醒，缺少的數量、責任人與日期維持空白', () => {
    const day = sample()
    const b = day.rows.find(row => field(row, 'location') === 'B區')!
    const tomorrow = day.rows.find(row => row.category === 'tomorrow')!
    expect(field(b, 'total')).toBe('')
    expect(field(b, 'cumulative')).toBe('')
    expect(field(tomorrow, 'date')).toBe('')
    expect(field(tomorrow, 'planned')).toBe('')
    expect(day.rows.filter(row => row.category === 'reminder').map(row => field(row, 'title'))).toEqual(expect.arrayContaining([expect.stringContaining('計畫總量'), expect.stringContaining('改善結果'), expect.stringContaining('核准狀態')]))
    const unknown = demoClassify([newSource('一段未能判讀的敘述')])
    expect(unknown[0].category).toBe('reminder')
  })
})

describe('差異合併', () => {
  it('相同敘述重複整理不建立資料或改變日誌', () => {
    const day = sample()
    expect(organize(day)).toBe(day)
    const duplicated = demoDiary()
    const items = demoClassify(duplicated.sources)
    expect(mergeDelta(duplicated, [...items, ...items], 'demo').rows).toHaveLength(items.length)
  })
  it('新增來源後保留既有工作數量，修改現有來源保留 ID 且只更新對應工作', () => {
    const day = sample()
    const a = day.rows.find(row => field(row, 'location') === 'A區')!
    const b = day.rows.find(row => field(row, 'location') === 'B區')!
    const source = day.sources[0]
    const newDay = organize({ ...day, sources: [...editSource(day.sources, source.id, source.text.replace('完成3支', '完成4支')), newSource('D區完成2支鋼柱吊裝')] })
    expect(newDay.rows.find(row => row.id === a.id)).toMatchObject({ change: 'updated' })
    expect(field(newDay.rows.find(row => row.id === a.id)!, 'done')).toBe('4')
    expect(newDay.rows.find(row => row.id === b.id)).toEqual({ ...b, change: 'unchanged' })
  })
  it('人工改過的欄位需要確認，接受和拒絕都能操作', () => {
    const day = sample()
    const [source] = day.sources
    day.rows = day.rows.map(row => row.category === 'work' && row.sourceIds.includes(source.id) ? { ...row, reviewed: true, fields: row.fields.map(value => value.key === 'done' ? { ...value, value: '2' } : value) } : row)
    const changed = organize({ ...day, sources: editSource(day.sources, source.id, source.text.replace('完成3支', '完成4支')) })
    const required = changed.rows.find(row => row.category === 'work' && row.sourceIds.includes(source.id))!
    expect(field(required, 'done')).toBe('2')
    expect(required.proposal?.kind).toBe('update')
    expect(field(decide(required, true)!, 'done')).toBe('4')
    expect(field(decide(required, false)!, 'done')).toBe('2')
  })
  it('移除來源後保留待確認事項，並可確認刪除或保留', () => {
    const day = sample()
    const removed = day.sources[2]
    const changed = organize({ ...day, sources: removeSource(day.sources, removed.id) })
    const linked = changed.rows.filter(row => row.sourceIds.includes(removed.id))
    expect(linked.length).toBeGreaterThan(1)
    expect(linked.every(row => row.proposal?.kind === 'remove')).toBe(true)
    expect(decide(linked[0], true)).toBeUndefined()
    expect(decide(linked[0], false)?.proposal).toBeUndefined()
    expect(organize(changed)).toBe(changed)
  })
  it('部分來源刪除時保留多重關聯的事項並提出確認', () => {
    const day = sample()
    const both = [day.sources[0].id, day.sources[1].id]
    day.rows[0] = { ...day.rows[0], origin: 'manual', reviewed: true, sourceIds: both }
    const changed = organize({ ...day, sources: removeSource(day.sources, both[1]) })
    expect(changed.rows[0]).toMatchObject({ id: day.rows[0].id, sourceIds: both, proposal: { kind: 'remove' } })
  })
  it('相似數量不加總，重算提醒不重複且保留已關閉狀態', () => {
    const day = sample()
    const changed = organize({ ...day, sources: [...day.sources, newSource('A區完成5支鋼柱吊裝')] })
    expect(changed.rows.filter(row => row.category === 'work' && field(row, 'location') === 'A區').map(row => field(row, 'done'))).toEqual(['3', '5'])
    const warning = changed.rows.find(row => field(row, 'title').includes('可能有重複'))!
    const closed = changed.rows.map(row => row.id === warning.id ? { ...row, closed: true } : row)
    expect(appendWarnings(appendWarnings(closed)).filter(row => row.id === warning.id)).toEqual([{ ...warning, closed: true }])
  })
  it('計算三種百分比，缺總量時只保留當日計畫達成率', () => {
    const day = sample()
    const a = day.rows.find(row => field(row, 'location') === 'A區')!
    const b = day.rows.find(row => field(row, 'location') === 'B區')!
    expect(progress(a)).toEqual({ cumulative: 60, contribution: 10, achievement: undefined })
    expect(progress(b).achievement).toBeCloseTo(83.3333)
    expect(progress(b).contribution).toBeUndefined()
    expect(progress(b).cumulative).toBeUndefined()
  })
  it('變更紀錄包含可回復的完整快照，無變更不新增快照', () => {
    const before = sample()
    const after = checkpoint({ ...before, goal: '查驗鋼柱' }, before)
    expect(after.history[0].snapshot).toEqual(snapshot(before))
    expect(checkpoint(after, after)).toBe(after)
  })
})

describe('IndexedDB 與備份', () => {
  it('提交寫入後重新開啟資料庫，可依日期完整讀回日誌', async () => {
    const day = sample()
    await saveDiary(day)
    expect(await readDiary(DEMO_DATE)).toEqual(day)
  })
  it('完整驗證備份，匯入同日保留原本內容於歷史紀錄', async () => {
    const original = emptyDiary('2026-11-25')
    await saveDiary(original)
    const incoming = { ...original, goal: '查驗' }
    expect(backupSchema.safeParse({ format: 'dcr-v2', diaries: [incoming, incoming] }).success).toBe(false)
    await expect(importBackup(JSON.stringify({ format: 'xxx', diaries: [incoming] }))).rejects.toThrow()
    expect(await importBackup(JSON.stringify({ format: 'dcr-v2', diaries: [incoming] }))).toBe(1)
    const read = await readDiary(original.date)
    expect(read?.goal).toBe('查驗')
    expect(read?.history[0].snapshot).toEqual(snapshot(original))
  })
})
