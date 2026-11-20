import { z } from 'zod'

export const categories = ['work', 'ehs', 'qa', 'document', 'issue', 'tomorrow', 'followup', 'reminder'] as const
export const labels: Record<Category, string> = {
  work: '施工工作主項', ehs: 'EHS 安衛環保', qa: 'QA/QC 及查驗', document: '文件進展',
  issue: '施工問題與限制', tomorrow: '明日預定工作', followup: '待追蹤事項', reminder: '日誌提醒事項',
}
export type Category = typeof categories[number]
export const fields: Record<Category, Record<string, string>> = {
  work: { title: '主項名稱', detail: '工作細項', location: '位置', description: '工作說明', planned: '當日預定量', done: '當日完成量', cumulative: '累計完成量', total: '計畫總量', unit: '計量單位', crew: '工班', people: '工作人數', equipment: '機具及數量' },
  ehs: { title: '安全事項', description: '異常描述', action: '已採取措施', pending: '待改善／待確認' },
  qa: { title: '查驗項目', location: '位置', status: '查驗結果', number: '查驗編號' },
  document: { title: '文件名稱', number: '文件編號', version: '版本', status: '送審／審查／核准狀態' },
  issue: { title: '問題描述', impact: '影響工作', cause: '原因', status: '排除狀態' },
  tomorrow: { title: '工作內容', date: '日期', planned: '預定數量', unit: '計量單位' },
  followup: { title: '追蹤內容', owner: '責任人', date: '期限', status: '處理狀態' },
  reminder: { title: '待確認內容' },
}
const numeric = new Set(['planned', 'done', 'cumulative', 'total', 'people'])
export function isDate(value: string) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(value)) &&
    new Date(value).toISOString().slice(0, 10) === value
}
export const itemShape = z.strictObject({
  category: z.enum(categories),
  sourceIds: z.array(z.string()),
  fields: z.array(z.strictObject({ key: z.string(), value: z.string() })),
})
export const aiShape = z.strictObject({ items: z.array(itemShape) })
function validFields(item: z.infer<typeof itemShape>) {
  return new Set(item.fields.map(field => field.key)).size === item.fields.length &&
    item.fields.every(({ key, value }) => Object.hasOwn(fields[item.category], key) &&
      value.trim() !== '' && (!numeric.has(key) || (/^\d+(\.\d+)?$/.test(value) && Number.isFinite(Number(value)))) &&
      (key !== 'date' || isDate(value)))
}
export const candidateSchema = itemShape.refine(validFields, '欄位不符合分類格式')
export const classificationSchema = aiShape.extend({ items: z.array(candidateSchema.refine(
  item => item.sourceIds.length > 0 && new Set(item.sourceIds).size === item.sourceIds.length && item.fields.length > 0,
  '分類必須包含來源及內容',
)) })
export type Candidate = z.infer<typeof candidateSchema>
export const sourceSchema = z.strictObject({ id: z.string().min(1), text: z.string(), createdAt: z.iso.datetime(), updatedAt: z.iso.datetime() })
export const requestSchema = z.strictObject({
  date: z.string().refine(isDate), sources: z.array(sourceSchema.extend({ text: z.string().trim().min(1).max(12000) })).min(1).max(100),
}).refine(request => new Set(request.sources.map(source => source.id)).size === request.sources.length)
export type Source = z.infer<typeof sourceSchema>
export const rowSchema = itemShape.extend({
  id: z.string().min(1), origin: z.enum(['auto', 'manual']),
  reviewed: z.boolean(), closed: z.boolean(),
  change: z.enum(['added', 'updated', 'unchanged']).optional(),
  baseline: candidateSchema.optional(),
  proposal: z.discriminatedUnion('kind', [
    z.strictObject({ kind: z.literal('remove'), reason: z.string() }),
    z.strictObject({ kind: z.literal('update'), reason: z.string(), item: candidateSchema }),
  ]).optional(),
}).refine(validFields)
export type Row = z.infer<typeof rowSchema>
export const snapshotSchema = z.strictObject({
  sources: z.array(sourceSchema),
  analyzed: z.record(z.string(), z.string()),
  rows: z.array(rowSchema),
  dismissed: z.array(z.strictObject({ item: candidateSchema, sourceTexts: z.record(z.string(), z.string()) })),
  goal: z.string(),
  mode: z.enum(['demo', 'ai', 'mixed']).optional(),
})
export const diarySchema = snapshotSchema.extend({
  date: z.string().refine(isDate), updatedAt: z.iso.datetime(),
  history: z.array(z.strictObject({ savedAt: z.iso.datetime(), snapshot: snapshotSchema })),
}).superRefine((diary, context) => {
  for (const snapshot of [diary, ...diary.history.map(entry => entry.snapshot)]) {
    if (new Set(snapshot.rows.map(row => row.id)).size !== snapshot.rows.length ||
        new Set(snapshot.sources.map(source => source.id)).size !== snapshot.sources.length) {
      context.addIssue({ code: 'custom', message: '日誌內有重複的來源或事項 ID' })
    }
  }
})
export type Snapshot = z.infer<typeof snapshotSchema>
export type Diary = z.infer<typeof diarySchema>
export const backupSchema = z.strictObject({
  format: z.literal('dcr-v2'), diaries: z.array(diarySchema),
}).refine(backup => new Set(backup.diaries.map(diary => diary.date)).size === backup.diaries.length, '日誌日期重複')
