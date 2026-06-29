'use strict'

require('dotenv').config()

const { readFileSync } = require('fs')
const path = require('path')

function loadConfig() {
  const feedsPath = path.join(__dirname, 'feeds.json')
  let raw
  try {
    raw = JSON.parse(readFileSync(feedsPath, 'utf-8'))
  } catch {
    console.error('エラー: feeds.json が見つかりません。feeds.example.json をコピーして設定してください。')
    process.exit(1)
  }

  const { wordpress, feeds } = raw

  if (!wordpress?.url) {
    console.error('エラー: feeds.json の wordpress.url が設定されていません')
    process.exit(1)
  }
  if (!wordpress?.username) {
    console.error('エラー: feeds.json の wordpress.username が設定されていません')
    process.exit(1)
  }
  if (!process.env.WP_APP_PASSWORD) {
    console.error('エラー: WP_APP_PASSWORD が .env に設定されていません。.env.example を参考に設定してください。')
    process.exit(1)
  }
  if (!Array.isArray(feeds) || feeds.length === 0) {
    console.error('エラー: feeds.json の feeds が空または配列ではありません')
    process.exit(1)
  }

  for (const feed of feeds) {
    if (!feed.name) {
      console.error(`エラー: フィードに name が設定されていません: ${JSON.stringify(feed)}`)
      process.exit(1)
    }
    if (!feed.type || !['youtube', 'rss'].includes(feed.type)) {
      console.error(`エラー: フィード "${feed.name}" の type が不正です（"youtube" または "rss" を指定してください）`)
      process.exit(1)
    }
    if (!feed.url) {
      console.error(`エラー: フィード "${feed.name}" の url が設定されていません`)
      process.exit(1)
    }
  }

  return {
    wordpress: {
      url: wordpress.url,
      username: wordpress.username,
      password: process.env.WP_APP_PASSWORD,
      categoryId: wordpress.categoryId ?? 1,
    },
    feeds: feeds.filter((f) => f.enabled !== false),
  }
}

module.exports = loadConfig()
