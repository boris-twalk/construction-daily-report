const CACHE = 'dcr-shell-v1'
const scope = new URL(self.registration.scope)
const home = new URL('./', scope).href

self.addEventListener('install', event => {
  event.waitUntil((async () => {
    const shell = await fetch(home, { cache: 'reload' })
    if (!shell.ok) throw new Error('Unable to cache the application')
    const markup = await shell.clone().text()
    const assets = [...markup.matchAll(/(?:href|src)="(\/assets\/[^"]+)"/g)].map(match => new URL(match[1], scope).href)
    const cache = await caches.open(CACHE)
    await cache.addAll(assets)
    await cache.put(home, shell)
    await self.skipWaiting()
  })())
})

self.addEventListener('activate', event => {
  event.waitUntil(self.clients.claim())
})

self.addEventListener('fetch', event => {
  const request = event.request
  const url = new URL(request.url)
  if (request.method !== 'GET' || url.origin !== scope.origin) return
  if (url.pathname === scope.pathname && request.mode === 'navigate') {
    event.respondWith(refreshShell(request))
  } else if (url.pathname.startsWith(scope.pathname + 'assets/')) {
    event.respondWith(loadAsset(request))
  }
})

async function refreshShell(request) {
  const cache = await caches.open(CACHE)
  try {
    const shell = await fetch(request)
    if (!shell.ok) return shell
    const markup = await shell.clone().text()
    const assets = [...markup.matchAll(/(?:href|src)="(\/assets\/[^"]+)"/g)].map(match => new URL(match[1], scope).href)
    const missing = []
    for (const asset of assets) {
      if (!(await cache.match(asset))) missing.push(asset)
    }
    await cache.addAll(missing)
    await cache.put(home, shell.clone())
    return shell
  } catch {
    return (await cache.match(home)) ?? Response.error()
  }
}

async function loadAsset(request) {
  const cache = await caches.open(CACHE)
  return (await cache.match(request)) ?? fetch(request)
}
