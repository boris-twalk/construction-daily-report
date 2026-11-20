import { emptyDiary, newSource } from './diary'
import type { Candidate, Category, Source } from './schema'

export function demoClassify(sources: Source[]): Candidate[] {
  const items: Candidate[] = []
  for (const source of sources) {
    const add = (category: Category, values: Record<string, string | undefined>) => {
      items.push({ category, sourceIds: [source.id], fields: Object.entries(values).flatMap(([key, value]) => value ? [{ key, value }] : []) })
    }
    for (const sentence of source.text.split(/[。；;！？\n]+/).map(text => text.trim()).filter(Boolean)) {
      const start = items.length
      const reminder = (title: string) => add('reminder', { title })
      for (const clause of sentence.split(/[，,]/).filter(Boolean)) {
        const tomorrow = clause.match(/(?:明日|明天)(.+)/)
        const qa = clause.match(/^(.*?)\s*(查驗|檢驗)(合格|不合格|通過|待確認)/)
        const workDocument = clause.match(/^(.*?)(已送審|未送審|待送審|送審|審查中|已核准|尚未核准|未核准|待核准|核准)$/)
        if (tomorrow) {
          const quantity = tomorrow[1].match(/(\d+(?:\.\d+)?)(支|根|件|處|組|立方公尺|公尺|平方米)/)
          add('tomorrow', { title: tomorrow[1], planned: quantity?.[1], unit: quantity?.[2] })
          reminder('明日工作日期待確認')
        } else if (qa) {
          const location = qa[1].match(/^[A-Z]\d+(?:-[A-Z]?\d+)?/)
          add('qa', { title: (location ? qa[1].slice(location[0].length) : qa[1]) + qa[2], location: location?.[0], status: qa[3] })
          reminder(`${qa[1]}查驗編號待確認`)
        } else if (workDocument) {
          add('document', { title: workDocument[1], status: workDocument[2] === '送審' ? '已送審' : workDocument[2] })
          if (!['已核准', '核准'].includes(workDocument[2])) reminder(`${workDocument[1]}核准狀態待確認`)
        } else if (/護欄|臨邊|職安|工安|事故|防墜/.test(clause)) {
          add('ehs', { title: clause, description: clause, action: sentence.match(/已通知[^，,]*/)?.[0], pending: '改善結果待確認' })
          reminder(`${clause}，改善結果待確認`)
        } else if (/^待追蹤/.test(clause)) {
          add('followup', { title: clause.replace(/^待追蹤[：:\s]*/, '') || clause })
        }
      }
      const currentWork = sentence.split(/[，,]/).filter(clause => !/明日|明天|待確認|暫估|約莫|或是|可能/.test(clause)).join('，')
      const material = currentWork.match(/(?:鋼柱|鋼梁|模板|混凝土|鋼筋|管線)/)?.[0]
      const unitPattern = '(支|根|件|處|組|立方公尺|公尺|平方米|噸)'
      const quantity = (pattern: string, label: string) => {
        const matches = [...currentWork.matchAll(new RegExp(pattern + '\\s*(\\d+(?:\\.\\d+)?)' + unitPattern, 'g'))]
        if (new Set(matches.map(match => match[1] + match[2])).size > 1) {
          reminder(`${label}有不同數值，請核對：${matches.map(match => match[1] + match[2]).join('、')}`)
          return undefined
        }
        return matches[0]
      }
      const planned = quantity('(?:原定|預定)', '當日預定量')
      const done = quantity('(?:^|[，,]|區|樓|層|段)\\s*(?:已)?完成', '當日完成量')
      const cumulative = quantity('累計(?:完成)?', '累計量')
      const total = quantity('計畫(?:共|總量)?', '計畫總量')
      const workQuantities = [done, planned, cumulative, total].filter(Boolean)
      if (workQuantities.length && !/^\s*(?:明天|明日)/.test(sentence)) {
        const location = sentence.match(/^[A-Z]區|^\d+[樓層]/)?.[0]
        const title = material ? material + (sentence.includes('吊裝') ? '吊裝' : material === '鋼梁' ? '安裝' : '') : '工作主項待確認'
        const incomplete = sentence.match(/(?:另外)?(\d+(?:\.\d+)?)(支|根|件|處|組)[^，,]*未完成/)
        const reason = sentence.match(/因(.+?)影響/)
        const units = new Set(workQuantities.map(match => match?.[2]))
        add('work', {
          title, location, done: units.size === 1 ? done?.[1] : undefined, planned: units.size === 1 ? planned?.[1] : undefined,
          cumulative: units.size === 1 ? cumulative?.[1] : undefined, total: units.size === 1 ? total?.[1] : undefined,
          unit: units.size === 1 ? workQuantities[0]?.[2] : undefined,
          crew: sentence.match(/([^，,\s]+班)\s*\d+人/)?.[1],
          people: sentence.match(/(\d+)人/)?.[1],
          equipment: sentence.match(/\d+(?:噸|[Tt])[^，,]*?\d+台/)?.[0]?.replace('噸', 'T'),
          description: incomplete ? `未完成${incomplete[1]}${incomplete[2]}${reason ? `，受${reason[1]}影響` : ''}` : undefined,
        })
        if (reason) add('issue', { title: `${reason[1]}影響${title}`, impact: title, cause: reason[1] })
        if (!total && (done || cumulative)) reminder(`${location ?? ''}${title}計畫總量待確認`)
        if (units.size > 1) reminder(`${location ?? ''}${title}數量的計量單位不一致`)
      }
      if (items.length === start || /待確認|暫估|約莫|可能/.test(sentence)) reminder(`分類待確認：${sentence}`)
    }
  }
  return items
}

export const DEMO_DATE = '2026-11-20'
export function demoDiary() {
  const diary = emptyDiary(DEMO_DATE)
  diary.sources = [
    'A區完成3支鋼柱吊裝，吊裝班8人，150噸吊車1台，累計18支，計畫共30支。',
    'B區原定12支鋼梁，完成10支，另外2支因材料堆放影響未完成。',
    '4樓臨邊護欄有缺口，已通知安全人員改善。C3-C5鋼柱垂直度查驗合格。',
    '吊裝施工計畫已送審，明天繼續完成剩餘鋼梁。',
  ].map(newSource)
  return diary
}
