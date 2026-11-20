import { useEffect, useRef, useState, type ChangeEvent } from 'react'
import { ArrowDownToLine, ArrowLeft, ArrowRight, BookOpen, CalendarDays, Check, ChevronRight, ClipboardList, Clock3, FileText, HardHat, History, Layers3, LoaderCircle, Plus, Printer, Save, Sparkles, Trash2, Upload } from 'lucide-react'
import { classifier } from './classifier'
import { appendWarnings, candidateOf, changedSources, decide, field, mergeDelta, pendingDelta } from './delta'
import { DEMO_DATE, demoClassify, demoDiary } from './demo'
import { checkpoint, editSource, emptyDiary, newSource, now, progress, removeSource, snapshot, todayInTaiwan } from './diary'
import { candidateSchema, categories, fields, isDate, labels, type Category, type Diary, type Row } from './schema'
import { importBackup, listDiaries, readDiary, saveDiary } from './storage'
import './style.css'

type Page = 'input' | 'report' | 'library'
const dateText = (date: string) => new Intl.DateTimeFormat('zh-TW', { dateStyle: 'full', timeZone: 'Asia/Taipei' }).format(new Date(date + 'T12:00:00+08:00'))
const timestamp = (date: string) => new Intl.DateTimeFormat('zh-TW', { dateStyle: 'short', timeStyle: 'short', timeZone: 'Asia/Taipei' }).format(new Date(date))
const badge = (mode?: Diary['mode']) => mode === 'ai' ? 'AI 分類' : mode === 'mixed' ? 'AI 與示範混合' : '示範模式'
const today = todayInTaiwan()

function App() {
  const [diary, setDiary] = useState<Diary>()
  const [page, setPage] = useState<Page>('input')
  const [library, setLibrary] = useState<Diary[]>([])
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const [saveStatus, setSaveStatus] = useState('正在載入')
  const [service, setService] = useState<'ai' | 'demo'>('demo')
  const [editing, setEditing] = useState<string>()
  const [selected, setSelected] = useState<string[]>([])
  const [filter, setFilter] = useState('')
  const [focusId, setFocusId] = useState<string>()
  const [historyOpen, setHistoryOpen] = useState(false)
  const file = useRef<HTMLInputElement>(null)
  const durable = useRef<Diary | undefined>(undefined)
  const latest = useRef<Diary | undefined>(undefined)
  const queue = useRef(Promise.resolve())
  const textareas = useRef(new Map<string, HTMLTextAreaElement>())

  useEffect(() => {
    async function initialize() {
      let demo = await readDiary(DEMO_DATE)
      if (!demo) {
        const sample = demoDiary()
        demo = mergeDelta(sample, demoClassify(sample.sources), 'demo')
        await saveDiary(demo)
      }
      const found = today === DEMO_DATE ? demo : await readDiary(today)
      const initial = found ?? { ...emptyDiary(today), sources: [newSource()] }
      durable.current = initial
      latest.current = initial
      setDiary(initial)
      setSaveStatus('本機儲存已就緒')
    }
    void initialize().catch(error => setMessage('無法開啟本機資料庫：' + String(error)))
    void fetch('/api/status').then(response => response.json()).then(data => setService(data.mode === 'ai' ? 'ai' : 'demo')).catch(() => {})
  }, [])

  function setDay(next: Diary) {
    latest.current = next
    setDiary(next)
  }
  function persist(day: Diary, record = true) {
    const promise = queue.current.catch(() => {}).then(async () => {
      const previous = durable.current
      const stored = record && previous?.date === day.date ? checkpoint(day, previous) : day
      await saveDiary(stored)
      durable.current = stored
      if (latest.current === day) setDay(stored)
      setSaveStatus('已儲存於此裝置')
    })
    queue.current = promise
    return promise
  }
  useEffect(() => {
    if (!diary || diary === durable.current) return
    const timer = window.setTimeout(() => {
      if (latest.current === diary) void persist(diary).catch(() => setSaveStatus('自動儲存失敗'))
    }, 320)
    return () => window.clearTimeout(timer)
  }, [diary])
  useEffect(() => {
    const flush = () => {
      if (document.visibilityState === 'hidden' && latest.current && latest.current !== durable.current) {
        void persist(latest.current).catch(() => setSaveStatus('自動儲存失敗'))
      }
    }
    document.addEventListener('visibilitychange', flush)
    return () => document.removeEventListener('visibilitychange', flush)
  }, [])
  useEffect(() => {
    if (focusId && page === 'input') {
      textareas.current.get(focusId)?.focus()
      textareas.current.get(focusId)?.scrollIntoView({ block: 'nearest' })
      setFocusId(undefined)
    }
  }, [focusId, page])

  function patch(update: Partial<Diary>) {
    const current = latest.current
    if (!current) return
    setSaveStatus('儲存中…')
    setDay({ ...current, ...update, updatedAt: now() })
  }
  function navigate(to: Page) {
    setPage(to)
    setEditing(undefined)
    setHistoryOpen(false)
    setSelected([])
    setMessage('')
    if (to === 'library') {
      const current = latest.current
      void (current && current !== durable.current ? persist(current) : queue.current)
        .then(listDiaries).then(setLibrary).catch(() => setMessage('無法讀取歷史日誌。'))
    }
  }
  async function openDate(date: string, to: Page = 'input') {
    if (!isDate(date) || busy) return
    setBusy(true)
    try {
      const current = latest.current
      if (current && current !== durable.current) await persist(current)
      else await queue.current.catch(() => {})
      const next = await readDiary(date) ?? { ...emptyDiary(date), sources: [newSource()] }
      durable.current = next
      setDay(next)
      setSaveStatus('本機儲存已就緒')
      navigate(to)
    } catch {
      setMessage('無法切換日期，請確認本機儲存空間。')
    } finally {
      setBusy(false)
    }
  }
  async function organize() {
    const current = latest.current
    if (busy || !current) return
    setBusy(true)
    setMessage('')
    try {
      await queue.current.catch(() => {})
      const sources = changedSources(current)
      const result = sources.length ? await classifier.classify(current.date, sources) : undefined
      const next = mergeDelta(current, result?.items ?? [], result?.mode)
      if (next !== current) {
        await queue.current.catch(() => {})
        const previous = durable.current?.date === current.date ? durable.current : current
        const staged = { ...current, history: previous.history }
        const saved = checkpoint(next, staged)
        setDay(saved)
        await persist(saved, false)
      } else if (current !== durable.current) {
        await persist(current)
      }
      navigate('report')
      setMessage(result?.note ?? (next === current ? '來源內容未變更，已保留現有日誌。' : '整理完成，請檢查分類與提醒。'))
    } catch {
      setMessage('整理或儲存未完成，請重試。')
    } finally {
      setBusy(false)
    }
  }
  function manualRows(rows: Row[]) {
    patch({ rows: appendWarnings(rows) })
  }
  function deleteRows(ids: string[]) {
    const current = latest.current
    if (!current) return
    patch({
      rows: appendWarnings(current.rows.flatMap(row => {
        if (!ids.includes(row.id)) return [row]
        return row.id.startsWith('warning:') ? [{ ...row, closed: true, reviewed: true, proposal: undefined }] : []
      })),
      dismissed: [...current.dismissed, ...current.rows.filter(row => ids.includes(row.id)).map(row => {
        const item = row.baseline ?? candidateOf(row)
        return { item, sourceTexts: Object.fromEntries(item.sourceIds.map(id => [id, current.analyzed[id] ?? ''])) }
      })],
    })
    setEditing(undefined)
    setSelected([])
  }
  function mergeSelected() {
    if (!diary) return
    const chosen = diary.rows.filter(row => selected.includes(row.id))
    const first = chosen[0]
    if (!first || chosen.length < 2 || chosen.some(row => row.category !== first.category)) {
      setMessage('請選擇至少兩筆相同類別的事項。')
      return
    }
    const conflicts = chosen.slice(1).flatMap(row => row.fields.filter(value => {
      const existing = field(first, value.key)
      return existing && existing !== value.value
    }).map(value => `${fields[row.category][value.key]}：${value.value}`))
    if (conflicts.length && !window.confirm(`合併將保留第一筆同欄內容。其餘不同的值會記入提醒。\n${conflicts.join('\n')}`)) return
    const combined = new Map(first.fields.map(value => [value.key, value]))
    chosen.slice(1).forEach(row => row.fields.forEach(value => { if (!combined.has(value.key)) combined.set(value.key, value) }))
    const sourceIds = [...new Set(chosen.flatMap(row => row.sourceIds))]
    const merged: Row = { ...first, fields: [...combined.values()], sourceIds, reviewed: true, origin: 'manual', proposal: undefined }
    const rows = diary.rows.filter(row => !selected.includes(row.id) || row.id === first.id).map(row => row.id === first.id ? merged : row)
    if (conflicts.length) rows.push({ id: crypto.randomUUID(), category: 'reminder', sourceIds, fields: [{ key: 'title', value: `人工合併時有不同欄位值：${[...new Set(conflicts)].join('、')}` }], origin: 'manual', reviewed: false, closed: false })
    patch({
      rows: appendWarnings(rows),
      dismissed: [...diary.dismissed, ...chosen.slice(1).map(row => {
        const item = row.baseline ?? candidateOf(row)
        return { item, sourceTexts: Object.fromEntries(item.sourceIds.map(id => [id, diary.analyzed[id] ?? ''])) }
      })],
    })
    setSelected([])
    setEditing(first.id)
  }
  async function carryWork() {
    const current = latest.current
    if (!current || current.rows.some(row => row.category === 'work')) return
    try {
      const earlier = (await listDiaries()).find(day => day.date < current.date &&
        day.rows.some(row => row.category === 'work' && row.reviewed && !row.proposal))
      if (!earlier) { setMessage('找不到較早日誌中已確認的工作主項。'); return }
      if (latest.current !== current || !window.confirm(`沿用 ${earlier.date} 已確認的工作主項與累計資料？`)) return
      const masterKeys = ['title', 'location', 'cumulative', 'total', 'unit']
      const rows = earlier.rows.filter(row => row.category === 'work' && row.reviewed && !row.proposal).map((row): Row => ({
        id: crypto.randomUUID(), category: 'work', sourceIds: [], origin: 'manual', reviewed: true, closed: false,
        fields: row.fields.filter(value => masterKeys.includes(value.key)),
      }))
      manualRows([...current.rows, ...rows])
      setMessage('已沿用確認過的工作主項與累計資料。')
    } catch { setMessage('無法讀取較早的日誌。') }
  }
  async function explicitSave() {
    if (!latest.current) return
    try {
      await persist(latest.current)
      setMessage(page === 'input' ? '草稿已儲存。' : '日誌已儲存。')
    } catch {
      setMessage('儲存失敗，請確認瀏覽器本機儲存權限與空間。')
    }
  }
  async function exportAll() {
    try {
      await queue.current
      if (latest.current && latest.current !== durable.current) await persist(latest.current)
      const url = URL.createObjectURL(new Blob([JSON.stringify({ format: 'dcr-v2', diaries: await listDiaries() }, null, 2)], { type: 'application/json' }))
      const link = document.createElement('a')
      link.href = url
      link.download = `DCR-${today}.json`
      link.click()
      window.setTimeout(() => URL.revokeObjectURL(url), 1000)
      setMessage('已下載完整日誌備份。')
    } catch { setMessage('無法下載備份。') }
  }
  async function importAll(event: ChangeEvent<HTMLInputElement>) {
    const selectedFile = event.target.files?.[0]
    event.target.value = ''
    if (!selectedFile || !window.confirm('匯入會更新相同日期的日誌，現有內容會記入版本紀錄。確定匯入？')) return
    setBusy(true)
    try {
      if (latest.current && latest.current !== durable.current) await persist(latest.current)
      await queue.current
      const count = await importBackup(await selectedFile.text())
      if (latest.current) {
        const loaded = await readDiary(latest.current.date)
        if (loaded) { durable.current = loaded; setDay(loaded) }
      }
      setLibrary(await listDiaries())
      setMessage(`已匯入 ${count} 份日誌。`)
    } catch { setMessage('匯入失敗，請選擇符合 DCR V2.0 格式的 JSON 備份。') }
    finally { setBusy(false) }
  }
  async function restore(entry: Diary['history'][number]) {
    const current = latest.current
    if (!current || !window.confirm('還原此版本？目前內容也會保留於版本紀錄。')) return
    try {
      await queue.current.catch(() => {})
      const restored = checkpoint({ ...current, ...entry.snapshot, mode: entry.snapshot.mode }, { ...current, history: durable.current?.history ?? current.history }, true)
      setDay(restored)
      await persist(restored, false)
      setMessage('已還原所選版本。')
    } catch { setMessage('還原未能儲存。') }
  }

  const nav = [
    { to: 'input', label: '工作敘述', icon: ClipboardList },
    { to: 'report', label: '日誌預覽', icon: FileText },
    { to: 'library', label: '歷史日誌', icon: History },
  ] as const

  return <div className="layout">
    <aside className="rail no-print">
      <div className="brand"><span className="brand-icon"><HardHat size={23} /></span><div><strong>DCR <small>V2.0</small></strong><p>智慧工程工作日誌</p></div></div>
      <nav aria-label="主要導覽">
        {nav.map(({ to, label, icon: Icon }) => <button key={to} className={page === to ? 'active' : ''} aria-current={page === to ? 'page' : undefined} disabled={busy} onClick={() => navigate(to)}><Icon size={18} />{label}{page === to && <ChevronRight className="nav-arrow" size={15} />}</button>)}
      </nav>
      <div className="rail-bottom"><span className="status-dot" />本機工作區</div>
    </aside>
    <div className="workspace">
      <header className="topbar no-print"><div><BookOpen size={17} /><span>工程日誌</span><ChevronRight size={14} /><strong>{nav.find(item => item.to === page)?.label}</strong></div><span className="mode"><span className="status-dot" />{service === 'ai' ? 'AI 服務已設定' : '示範模式'}</span></header>
      <main>
        <p className="message no-print" role="status" hidden={!message}>{message}</p>
        {!diary ? <p>載入本機日誌…</p> : page === 'input' ? <>
          <div className="page-heading"><div><div className="eyebrow"><span /> DAILY CONSTRUCTION REPORT</div><h1>工作日誌</h1><p>記錄今日工地動態，整理成可編輯的工程日誌。</p></div><button className="button outline history-button" disabled={busy} onClick={() => navigate('library')}><History size={17} />查看歷史日誌</button></div>
          <section className="panel date-panel">
            <span className="tile"><CalendarDays size={20} /></span>
            <label className="date-label">工作日期<small>{dateText(diary.date)}</small></label>
            <input type="date" aria-label="工作日期" value={diary.date} disabled={busy} onChange={event => void openDate(event.target.value)} />
          </section>
          <section className="panel sources-panel">
            <div className="panel-heading"><div className="section-title"><span className="tile"><ClipboardList size={19} /></span><div><h2>工作敘述 <span className="count">{diary.sources.length} 筆</span></h2><p>輸入當日施工、查驗或現場狀況，一筆可包含多項事項。</p></div></div><button className="button outline" disabled={busy} onClick={() => { const source = newSource(); patch({ sources: [...diary.sources, source] }); setFocusId(source.id) }}><Plus size={17} />新增敘述</button></div>
            <div className="source-list">
              {diary.sources.map((source, index) => <div className="source" key={source.id}>
                <div className="source-header"><label htmlFor={source.id}><span className="source-number">{String(index + 1).padStart(2, '0')}</span>紀錄 {index + 1}</label><button className="icon-button danger" aria-label={`刪除紀錄 ${index + 1}`} disabled={busy} onClick={() => {
                  if (!source.text.trim() || window.confirm('刪除此來源敘述？相關分類會在整理後請你確認。')) patch({ sources: removeSource(diary.sources, source.id) })
                }}><Trash2 size={17} /></button></div>
                <textarea id={source.id} ref={element => { if (element) textareas.current.set(source.id, element); else textareas.current.delete(source.id) }} value={source.text} disabled={busy} rows={2} placeholder="例如：A 區完成 3 支鋼柱吊裝，吊裝班 8 人……" onChange={event => patch({ sources: editSource(diary.sources, source.id, event.target.value) })} />
              </div>)}
              {!diary.sources.length && <p className="empty">尚無工作敘述，可新增一筆開始記錄。</p>}
            </div>
          </section>
          <div className="actionbar no-print"><span className="save-state"><Check size={16} />{saveStatus}</span><div><button className="button outline" disabled={busy} onClick={() => void explicitSave()}><Save size={17} />儲存草稿</button><button className="button primary" disabled={busy} onClick={() => void organize()}>{busy ? <LoaderCircle className="spin" size={17} /> : <Sparkles size={17} />}AI 整理日誌</button></div></div>
          {service === 'demo' && <p className="mode-note"><Sparkles size={15} />示範模式以文字規則分類，不具備 AI 語意理解能力。</p>}
        </> : page === 'library' ? <>
          <div className="page-heading"><div><h1>歷史日誌</h1><p>按日期查找這台裝置上已儲存的日誌。</p></div></div>
          <section className="panel library-panel"><div className="toolbar">
            <label>查找日期 <input type="date" value={filter} onChange={event => setFilter(event.target.value)} /></label>
            {filter && <button className="button outline" onClick={() => setFilter('')}>清除篩選</button>}
            <button className="button outline" disabled={busy} onClick={() => void exportAll()}><ArrowDownToLine size={17} />JSON 備份</button>
            <button className="button outline" disabled={busy} onClick={() => file.current?.click()}><Upload size={17} />匯入 JSON</button>
            <input hidden ref={file} type="file" accept=".json,application/json" onChange={event => void importAll(event)} />
          </div>
          {library.filter(day => !filter || day.date === filter).map(day => <button className="library-row" key={day.date} disabled={busy} onClick={() => void openDate(day.date, 'report')}><CalendarDays size={20} /><span><strong>{dateText(day.date)}</strong><small>{day.sources.length} 筆來源 · 更新於 {timestamp(day.updatedAt)}</small></span><ArrowRight size={17} /></button>)}
          {!library.some(day => !filter || day.date === filter) && <p className="empty">找不到這個日期的日誌。</p>}
          </section>
        </> : <>
          <div className="page-heading no-print"><div><button className="text-button" onClick={() => navigate('input')}><ArrowLeft size={16} />返回工作敘述</button><h1>日誌預覽</h1><p>{badge(diary.mode)}{diary.mode !== 'ai' ? ' · 示範結果來自文字規則' : ''} · 更新於 {timestamp(diary.updatedAt)}</p></div>
          <div className="toolbar"><button className="button outline" onClick={() => setHistoryOpen(!historyOpen)}><Clock3 size={17} />版本紀錄</button><button className="button outline" onClick={() => window.print()}><Printer size={17} />列印／PDF</button><button className="button primary" onClick={() => void explicitSave()}><Save size={17} />儲存日誌</button></div></div>
          {pendingDelta(diary) && <p className="message no-print">原始敘述有未整理的變更。<button className="text-button" onClick={() => navigate('input')}>回到工作敘述</button></p>}
          {historyOpen && <section className="panel history no-print"><h2>版本紀錄</h2>{diary.history.length ? diary.history.map((entry, index) => <details key={index}><summary>{timestamp(entry.savedAt)} · {entry.snapshot.sources.length} 筆來源 · {entry.snapshot.rows.length} 筆事項</summary><ul>{entry.snapshot.sources.map(source => <li key={source.id}>{source.text || '空白敘述'}</li>)}{entry.snapshot.rows.map(row => <li key={row.id}>{labels[row.category]}：{row.fields.map(value => value.value).join('／')}</li>)}</ul><button className="button outline" onClick={() => void restore(entry)}>還原此版本</button></details>) : <p className="empty">目前沒有舊版本。</p>}</section>}
          <article className="panel report">
            <header className="report-header"><span className="section-title"><span className="tile"><HardHat size={22} /></span><span><h2>工程工作日誌</h2><p>{dateText(diary.date)}</p></span></span><span className="mode">{badge(diary.mode)}</span></header>
            <section className={diary.goal.trim() ? 'goal report-section' : 'goal report-section no-print'}>
              <h3>關鍵工作目標</h3><label className="no-print"><span className="sr-only">關鍵工作目標</span><input placeholder="有工作目標時可填寫" value={diary.goal} onChange={event => patch({ goal: event.target.value })} /></label><p className="print-only">{diary.goal}</p>
            </section>
            <div className="report-tools no-print">
              <button className="button outline" onClick={() => {
                const row: Row = { id: crypto.randomUUID(), category: 'work', fields: [], sourceIds: [], origin: 'manual', reviewed: true, closed: false }
                manualRows([...diary.rows, row]); setEditing(row.id)
              }}><Plus size={16} />新增事項</button>
              {!diary.rows.some(row => row.category === 'work') && <button className="button outline" onClick={() => void carryWork()}>沿用已確認主項</button>}
              <button className="button outline" disabled={selected.length < 2} onClick={mergeSelected}><Layers3 size={16} />合併已選事項</button>
            </div>
            {categories.map(category => <section key={category} className="report-section">
              <h3>{labels[category]}</h3>
              {!diary.rows.some(row => row.category === category) && <p className="empty">無</p>}
              {diary.rows.filter(row => row.category === category).map(row => <div key={row.id} className="report-row">
                <div className="row-top"><strong>{field(row, 'location') && category === 'work' ? field(row, 'location') + ' ' : ''}{field(row, 'title') || '未命名事項'}</strong><div className="row-buttons no-print">
                  {row.change && !row.proposal && <span className="change-label">{row.change === 'added' ? '新增' : row.change === 'updated' ? '更新' : '內容未變更'}</span>}
                  <label className="select-row"><input type="checkbox" aria-label={`選取 ${field(row, 'title') || '事項'}`} checked={selected.includes(row.id)} onChange={event => setSelected(event.target.checked ? [...selected, row.id] : selected.filter(id => id !== row.id))} />選取</label>
                  <button className="text-button" onClick={() => setEditing(editing === row.id ? undefined : row.id)}>編輯</button>
                  <button className="text-button danger" onClick={() => { if (window.confirm('確定刪除此事項？')) deleteRows([row.id]) }}>刪除</button>
                </div></div>
                <dl>{row.fields.filter(value => value.key !== 'title' && !(category === 'work' && ['location', 'people', 'equipment', 'crew'].includes(value.key))).map(value => <div key={value.key}><dt>{fields[category][value.key]}</dt><dd>{value.value}</dd></div>)}</dl>
                {category === 'work' && <div className="progress">{Object.entries(progress(row)).map(([key, value]) => value === undefined ? null : <span key={key}>{key === 'cumulative' ? '累計完成率' : key === 'contribution' ? '當日進度貢獻' : '當日計畫達成率'} <strong>{value.toLocaleString('zh-TW', { maximumFractionDigits: 2 })}%</strong></span>)}</div>}
                <div className="source-ref">{row.sourceIds.map(id => {
                  const index = diary.sources.findIndex(source => source.id === id)
                  const label = index >= 0 ? `來源紀錄 ${index + 1}` : `已移除來源 ${id.slice(0, 8)}`
                  return <span key={id}>{index >= 0 ? <><button className="text-button no-print" onClick={() => { navigate('input'); setFocusId(id) }}>{label}</button><span className="print-only">{label}</span></> : label}</span>
                })}{row.reviewed && <span>人工確認</span>}{row.closed && <span>已關閉</span>}</div>
                {row.proposal && <div className="proposal">
                  <strong>需要人工確認</strong><p>{row.proposal.reason}</p>
                  {row.proposal.kind === 'update' && <p>建議：{row.proposal.item.fields.map(value => `${fields[row.proposal?.kind === 'update' ? row.proposal.item.category : category][value.key]} ${value.value}`).join('、')}</p>}
                  <div className="toolbar no-print"><button className="button outline" onClick={() => {
                    const accepted = decide(row, true)
                    if (accepted) manualRows(diary.rows.map(item => item.id === row.id ? accepted : item)); else deleteRows([row.id])
                  }}>{row.proposal.kind === 'remove' ? '確認刪除' : '採用建議'}</button><button className="button outline" onClick={() => manualRows(diary.rows.map(item => item.id === row.id ? decide(row, false)! : item))}>保留現有內容</button></div>
                </div>}
                {category === 'reminder' && <div className="toolbar no-print"><button className="text-button" onClick={() => manualRows(diary.rows.map(item => item.id === row.id ? { ...item, reviewed: true } : item))}>確認提醒</button><button className="text-button" onClick={() => manualRows(diary.rows.map(item => item.id === row.id ? { ...item, closed: !item.closed, reviewed: true } : item))}>{row.closed ? '重新開啟' : '關閉提醒'}</button></div>}
                {editing === row.id && <RowEditor key={row.id} row={row} onCancel={() => setEditing(undefined)} onSave={edited => {
                  manualRows(diary.rows.map(item => item.id === row.id ? edited : item)); setEditing(undefined)
                }} onSplit={(left, right) => {
                  manualRows(diary.rows.flatMap(item => item.id === row.id ? [left, right] : [item])); setEditing(right.id)
                }} />}
              </div>)}
              {category === 'work' && <div className="personnel"><h3>人數與機具</h3>
                {diary.rows.filter(row => row.category === 'work' && ['crew', 'people', 'equipment'].some(key => field(row, key))).map(row => <p key={row.id}><strong>{field(row, 'location')} {field(row, 'title')}</strong> {[
                  field(row, 'crew'), field(row, 'people') && field(row, 'people') + ' 人', field(row, 'equipment'),
                ].filter(Boolean).join(' · ')}</p>)}
                {!diary.rows.some(row => row.category === 'work' && ['crew', 'people', 'equipment'].some(key => field(row, key))) && <p className="empty">無</p>}
              </div>}
            </section>)}
          </article>
        </>}
      </main>
    </div>
  </div>
}

function RowEditor({ row, onSave, onCancel, onSplit }: {
  row: Row; onSave: (row: Row) => void; onCancel: () => void; onSplit: (left: Row, right: Row) => void
}) {
  const [category, setCategory] = useState(row.category)
  const [values, setValues] = useState<Record<string, string>>(() => Object.fromEntries(row.fields.map(value => [value.key, value.value])))
  const [split, setSplit] = useState(false)
  const [splitTitle, setSplitTitle] = useState('')
  const [moved, setMoved] = useState<string[]>([])
  const [error, setError] = useState('')
  return <form className="editor no-print" onSubmit={event => {
    event.preventDefault()
    const next = { ...row, category, fields: Object.keys(fields[category]).flatMap(key => values[key]?.trim() ? [{ key, value: values[key].trim() }] : []), origin: 'manual' as const, reviewed: true }
    if (!candidateSchema.safeParse(candidateOf(next)).success || !field(next, 'title')) {
      setError('請填寫名稱，並確認數量為非負數、日期為有效日期。')
      return
    }
    if (!split) { onSave(next); return }
    if (!splitTitle.trim()) { setError('拆分時請輸入新事項名稱。'); return }
    onSplit(
      { ...next, fields: next.fields.filter(value => !moved.includes(value.key)) },
      { ...next, id: crypto.randomUUID(), proposal: undefined, baseline: undefined, fields: [{ key: 'title', value: splitTitle.trim() }, ...next.fields.filter(value => moved.includes(value.key))] },
    )
  }}>
    <label>分類<select value={category} onChange={event => {
      setCategory(event.target.value as Category)
      setMoved([])
    }}>{categories.map(value => <option key={value} value={value}>{labels[value]}</option>)}</select></label>
    <div className="editor-grid">{Object.entries(fields[category]).map(([key, label]) => <label key={key}>{label}<input required={key === 'title'} type={key === 'date' ? 'date' : 'text'} inputMode={['planned', 'done', 'cumulative', 'total', 'people'].includes(key) ? 'decimal' : undefined} value={values[key] ?? ''} onChange={event => setValues({ ...values, [key]: event.target.value })} /></label>)}</div>
    {split && <fieldset><legend>拆分至新事項</legend><label>新事項名稱<input value={splitTitle} onChange={event => setSplitTitle(event.target.value)} /></label><div className="toolbar">{Object.entries(fields[category]).filter(([key]) => key !== 'title' && values[key]?.trim()).map(([key, label]) => <label key={key} className="select-row"><input type="checkbox" checked={moved.includes(key)} onChange={event => setMoved(event.target.checked ? [...moved, key] : moved.filter(value => value !== key))} />{label}</label>)}</div></fieldset>}
    {error && <p role="alert" className="danger">{error}</p>}
    <div className="toolbar"><button type="submit" className="button primary">{split ? '確認拆分' : '確認修改'}</button><button type="button" className="button outline" onClick={() => setSplit(!split)}>{split ? '取消拆分' : '拆分事項'}</button><button type="button" className="button outline" onClick={onCancel}>取消編輯</button></div>
  </form>
}

import { createRoot } from 'react-dom/client'
createRoot(document.getElementById('root')!).render(<App />)

if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  void navigator.serviceWorker.register('/dcr-offline.js').catch(() => {
    // IndexedDB and the rule-based classifier are still available in the open page.
  })
}
