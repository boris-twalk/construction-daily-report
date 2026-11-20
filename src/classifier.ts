import { demoClassify } from './demo'
import { classificationSchema, type Candidate, type Source } from './schema'

type Result = { items: Candidate[]; mode: 'ai' | 'demo'; note?: string }
export interface Classifier {
  classify(date: string, sources: Source[]): Promise<Result>
}

export const classifier: Classifier = {
  async classify(date, sources) {
    try {
      if (typeof navigator !== 'undefined' && !navigator.onLine) throw new Error('Offline')
      const response = await fetch('/api/classify', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ date, sources }), signal: AbortSignal.timeout(45000),
      })
      if (!response.ok) throw new Error(String(response.status))
      const result = classificationSchema.parse(await response.json())
      const ids = new Set(sources.map(source => source.id))
      if (!result.items.every(item => item.sourceIds.every(id => ids.has(id)))) throw new Error('Unexpected source')
      return { ...result, mode: 'ai' }
    } catch {
      return {
        items: classificationSchema.parse({ items: demoClassify(sources) }).items, mode: 'demo',
        note: 'AI 服務未設定或目前無法使用，本次採用示範規則分類。',
      }
    }
  },
}
