'use strict'

const { readFileSync, writeFileSync } = require('fs')
const path = require('path')
const { XMLParser } = require('fast-xml-parser')
const config = require('./config')
const { buildYoutubePost } = require('./templates/youtube')
const { buildRssPost } = require('./templates/rss')

const DRY_RUN = process.argv.includes('--dry-run')
const STATE_PATH = path.join(__dirname, 'state.json')
const FETCH_TIMEOUT_MS = 15000

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  removeNSPrefix: true,
  cdataPropName: '__cdata',
})

function loadState() {
  try {
    return JSON.parse(readFileSync(STATE_PATH, 'utf-8'))
  } catch {
    return {}
  }
}

function saveState(state) {
  writeFileSync(STATE_PATH, JSON.stringify(state, null, 2))
}

function isValidHttpUrl(str) {
  try {
    const u = new URL(str)
    return u.protocol === 'http:' || u.protocol === 'https:'
  } catch {
    return false
  }
}

async function fetchWithTimeout(url, options = {}) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS)
  try {
    return await fetch(url, { ...options, signal: controller.signal })
  } finally {
    clearTimeout(timer)
  }
}

async function fetchXml(url) {
  const res = await fetchWithTimeout(url)
  if (!res.ok) throw new Error(`fetch失敗: ${url} (${res.status})`)
  return parser.parse(await res.text())
}

function getText(val) {
  if (typeof val === 'string') return val
  if (val === null || val === undefined) return ''
  if (Array.isArray(val)) {
    for (const v of val) {
      if (typeof v === 'string' && v) return v
      if (v?.__cdata) return v.__cdata
      if (v?.['#text']) return v['#text']
    }
    return ''
  }
  if (typeof val === 'object') return val.__cdata || val['#text'] || ''
  return String(val)
}

function sanitize(str) {
  return str.replace(/[\uD800-\uDFFF]/g, '')
}

function getCredentials() {
  const { username, password } = config.wordpress
  return Buffer.from(`${username}:${password}`).toString('base64')
}

async function uploadThumbnail(imageUrl, filename) {
  const { url } = config.wordpress
  const credentials = getCredentials()

  const imgRes = await fetchWithTimeout(imageUrl)
  if (!imgRes.ok) throw new Error(`サムネDL失敗: ${imageUrl}`)
  const buffer = await imgRes.arrayBuffer()

  const contentType = imgRes.headers.get('content-type')?.split(';')[0] || 'image/jpeg'
  const ext = contentType.split('/')[1] || 'jpg'
  const safeFilename = filename.replace(/\.[^.]+$/, '') + '.' + ext

  const res = await fetchWithTimeout(`${url}/wp-json/wp/v2/media`, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${credentials}`,
      'Content-Disposition': `attachment; filename="${safeFilename}"`,
      'Content-Type': contentType,
    },
    body: buffer,
  })

  if (!res.ok) {
    const body = await res.text()
    throw new Error(`サムネアップロード失敗: ${res.status} ${body}`)
  }

  return (await res.json()).id
}

async function createDraft(title, content, featuredMediaId = null, tags = []) {
  const { url, categoryId } = config.wordpress
  const credentials = getCredentials()

  const body = {
    title: sanitize(title),
    content: sanitize(content),
    status: 'draft',
    categories: [categoryId],
    tags,
  }
  if (featuredMediaId) body.featured_media = featuredMediaId

  const res = await fetchWithTimeout(`${url}/wp-json/wp/v2/posts`, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${credentials}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  })

  if (!res.ok) {
    const errBody = await res.text()
    throw new Error(`WordPress APIエラー: ${res.status} ${errBody}`)
  }

  return res.json()
}

async function fetchOgImage(url) {
  try {
    const res = await fetchWithTimeout(url, { headers: { 'User-Agent': 'Mozilla/5.0' } })
    if (!res.ok) return null
    const html = await res.text()
    const match =
      html.match(/<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i) ||
      html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image["']/i)
    return match ? match[1] : null
  } catch {
    return null
  }
}

async function processYoutube(feed, state) {
  const label = `[${feed.name}]`
  console.log(`${label} RSSを取得中...`)
  const data = await fetchXml(feed.url)
  const raw = data.feed?.entry
  if (!raw) { console.log(`${label} エントリなし`); return state }

  const entries = Array.isArray(raw) ? raw : [raw]

  const rawId = entries[0]?.videoId
  if (!rawId) {
    console.warn(`${label} videoIdが取得できませんでした（フィード構造を確認してください）`)
    return state
  }
  const latestId = String(rawId)
  const feedState = state[feed.name] ?? { lastId: null }

  if (feedState.lastId === null) {
    console.log(`${label} 初回実行 - 最新IDを記録（投稿スキップ）: ${latestId}`)
    return { ...state, [feed.name]: { lastId: latestId } }
  }

  const newEntries = []
  for (const entry of entries) {
    const id = entry.videoId ? String(entry.videoId) : null
    if (!id || id === feedState.lastId) break
    newEntries.push(entry)
  }

  if (newEntries.length === 0) {
    console.log(`${label} 新着なし`)
    return state
  }

  for (const entry of newEntries.reverse()) {
    const videoId = String(entry.videoId)
    const { title, content } = buildYoutubePost({
      videoId,
      title: entry.title,
      description: entry.group?.description || '',
      post: feed.post,
    })

    let thumbnailId = null
    if (DRY_RUN) {
      console.log(`${label} [DRY-RUN] サムネアップ省略`)
    } else {
      try {
        const thumbUrl = `https://img.youtube.com/vi/${videoId}/maxresdefault.jpg`
        thumbnailId = await uploadThumbnail(thumbUrl, `yt-${videoId}.jpg`)
        console.log(`${label} サムネアップ完了: media ID ${thumbnailId}`)
      } catch (e) {
        console.warn(`${label} サムネスキップ: ${e.message}`)
      }
    }

    if (DRY_RUN) {
      console.log(`${label} [DRY-RUN] 下書き作成省略: ${title}`)
    } else {
      await createDraft(title, content, thumbnailId, feed.tags ?? [])
      console.log(`${label} 下書き作成: ${title}`)
    }
  }

  return { ...state, [feed.name]: { lastId: latestId } }
}

function getRssId(item) {
  const id = item.guid?.['#text'] ||
    (typeof item.guid === 'string' ? item.guid : null) ||
    item.link
  return id ? String(id) : null
}

async function processRss(feed, state) {
  const label = `[${feed.name}]`
  console.log(`${label} RSSを取得中...`)
  const data = await fetchXml(feed.url)
  const raw = data.rss?.channel?.item
  if (!raw) { console.log(`${label} エントリなし`); return state }

  const items = Array.isArray(raw) ? raw : [raw]
  const latestId = getRssId(items[0])
  if (!latestId) {
    console.warn(`${label} 最新エントリのIDが取得できませんでした（フィード構造を確認してください）`)
    return state
  }

  const feedState = state[feed.name] ?? { lastId: null }

  if (feedState.lastId === null) {
    console.log(`${label} 初回実行 - 最新IDを記録（投稿スキップ）: ${latestId}`)
    return { ...state, [feed.name]: { lastId: latestId } }
  }

  const newItems = []
  for (const item of items) {
    const id = getRssId(item)
    if (!id || id === feedState.lastId) break
    newItems.push(item)
  }

  if (newItems.length === 0) {
    console.log(`${label} 新着なし`)
    return state
  }

  for (const item of newItems.reverse()) {
    const link = getText(item.link)
    const itemTitle = getText(item.title)
    const description = getText(item.description)

    let thumbnailId = null

    // thumbnailId が設定されていれば固定サムネ優先、なければ fetchOgImage を試みる
    if (feed.thumbnailId) {
      thumbnailId = feed.thumbnailId
    } else if (feed.fetchOgImage !== false) {
      if (DRY_RUN) {
        console.log(`${label} [DRY-RUN] og:image取得省略`)
      } else {
        try {
          const ogImageUrl = await fetchOgImage(link)
          if (ogImageUrl && isValidHttpUrl(ogImageUrl)) {
            const slug = link.split('/').pop() || feed.name
            thumbnailId = await uploadThumbnail(ogImageUrl, `${feed.name}-${slug}.jpg`)
            console.log(`${label} サムネアップ完了: media ID ${thumbnailId}`)
          }
        } catch (e) {
          console.warn(`${label} サムネスキップ: ${e.message}`)
        }
      }
    }

    const { title, content } = buildRssPost({ title: itemTitle, link, description, post: feed.post })
    if (DRY_RUN) {
      console.log(`${label} [DRY-RUN] 下書き作成省略: ${title}`)
    } else {
      await createDraft(title, content, thumbnailId, feed.tags ?? [])
      console.log(`${label} 下書き作成: ${title}`)
    }
  }

  return { ...state, [feed.name]: { lastId: latestId } }
}

async function main() {
  if (DRY_RUN) console.log('=== announce-poster 開始（DRY-RUN: WordPressへの書き込みは行いません）===')
  else console.log('=== announce-poster 開始 ===')
  let state = loadState()

  for (const feed of config.feeds) {
    try {
      if (feed.type === 'youtube') {
        state = await processYoutube(feed, state)
      } else {
        state = await processRss(feed, state)
      }
      if (!DRY_RUN) saveState(state)
    } catch (e) {
      console.error(`[${feed.name}] エラー: ${e.message}`)
    }
  }

  if (DRY_RUN) console.log('=== 完了（DRY-RUN: state.json は更新されませんでした）===')
  else console.log('=== 完了 ===')
}

main().catch((err) => {
  console.error('致命的エラー:', err.message)
  process.exit(1)
})
