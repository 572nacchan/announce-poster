'use strict'

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;')
}

function buildRssPost({ title, link, description, post }) {
  const prefix = post?.titlePrefix ?? '更新：'
  const intro = post?.intro ?? '新しいコンテンツを公開しました！'
  const siteName = post?.siteName ?? post?.channelName ?? ''
  const siteUrl = post?.siteUrl ?? post?.channelUrl ?? ''

  const postTitle = `${prefix}${title}`
  // description はRSSフィードによってはHTMLを含む場合があるためエスケープしない
  const content = `
<p>${intro}</p>

<p>▶ <a href="${escapeHtml(link)}" target="_blank" rel="noopener">${escapeHtml(title)}</a></p>

${description ? `<p>${description}</p>\n` : ''}
${siteUrl ? `<p><a href="${escapeHtml(siteUrl)}" target="_blank" rel="noopener">${escapeHtml(siteName || siteUrl)}</a></p>` : ''}
`.trim()

  return { title: postTitle, content }
}

module.exports = { buildRssPost }
