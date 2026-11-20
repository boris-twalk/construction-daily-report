import { backupSchema, diarySchema, type Diary } from './schema'

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open('dcr-v2', 1)
    request.onupgradeneeded = () => request.result.createObjectStore('diaries', { keyPath: 'date' })
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
    request.onblocked = () => reject(new Error('資料庫升級受阻，請關閉其他日誌分頁。'))
  })
}

async function transaction<T>(mode: IDBTransactionMode, operation: (store: IDBObjectStore) => T): Promise<T> {
  const db = await openDatabase()
  try {
    return await new Promise((resolve, reject) => {
      const tx = db.transaction('diaries', mode)
      tx.onabort = () => reject(tx.error ?? new Error('無法儲存日誌'))
      try {
        const result = operation(tx.objectStore('diaries'))
        tx.oncomplete = () => resolve(result)
      } catch (error) {
        tx.abort()
        reject(error)
      }
    })
  } finally {
    db.close()
  }
}
export async function listDiaries(): Promise<Diary[]> {
  const request = await transaction('readonly', store => store.getAll())
  return request.result.map(item => diarySchema.parse(item)).sort((a, b) => b.date.localeCompare(a.date))
}
export async function readDiary(date: string) {
  const request = await transaction('readonly', store => store.get(date))
  return request.result ? diarySchema.parse(request.result) : undefined
}
export async function saveDiary(diary: Diary) {
  const validated = diarySchema.parse(diary)
  await transaction('readwrite', store => store.put(validated))
}
export async function importBackup(json: string) {
  const backup = backupSchema.parse(JSON.parse(json))
  await transaction('readwrite', store => {
    for (const diary of backup.diaries) {
      const existing = store.get(diary.date)
      existing.onsuccess = () => {
        if (existing.result) {
          const previous = diarySchema.parse(existing.result)
          const { date: _date, updatedAt, history, ...snapshot } = previous
          store.put({ ...diary, history: [{ savedAt: updatedAt, snapshot }, ...history, ...diary.history] })
        } else {
          store.put(diary)
        }
      }
    }
  })
  return backup.diaries.length
}
