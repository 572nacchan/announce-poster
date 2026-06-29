'use strict'

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;')
}

function buildYoutubePost({ videoId, title, description, post }) {
  const prefix = post?.titlePrefix ?? '動画更新：'
  const intro = post?.intro ?? '新しい動画を公開しました！'
  const channelName = post?.channelName ?? ''
  const channelUrl = post?.channelUrl ?? ''

  const postTitle = `${prefix}${title}`
  const content = `
<p>${intro}</p>

<figure class="wp-block-embed is-type-video">
<div class="wp-block-embed__wrapper">
<iframe width="560" height="315"
  src="https://www.youtube.com/embed/${escapeHtml(videoId)}"
  title="${escapeHtml(title)}"
  frameborder="0"
  allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
  allowfullscreen></iframe>
</div>
</figure>

${description ? `<p>${escapeHtml(description)}</p>\n` : ''}
${channelUrl ? `<p>▶ <a href="${escapeHtml(channelUrl)}" target="_blank" rel="noopener">${escapeHtml(channelName || channelUrl)}</a></p>` : ''}
`.trim()

  return { title: postTitle, content }
}

module.exports = { buildYoutubePost }
