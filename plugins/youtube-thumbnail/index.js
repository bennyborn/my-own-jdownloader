// Thumbnail plugin: finds the YouTube video id in the source URLs of the package's links.
// The oEmbed endpoint (no API key) gives the title.

const IMAGES = 'https://i.ytimg.com/vi'
const ID = '[\\w-]{11}'

// Watch, short, embed and shorts links, plus JDownloader's own youtubev2://<id>/... form.
const PATTERNS = [
  new RegExp(`^https?://(?:www\\.|m\\.|music\\.)?youtube(?:-nocookie)?\\.com/(?:watch\\?(?:[^#]*&)?v=|shorts/|embed/|live/|v/)(${ID})(?![\\w-])`, 'i'),
  new RegExp(`^https?://youtu\\.be/(${ID})(?![\\w-])`, 'i'),
  new RegExp(`^youtubev2://(${ID})(?![\\w-])`, 'i')
]

// "https://youtu.be/dQw4w9WgXcQ?t=5" -> "dQw4w9WgXcQ"
export const videoId = (url) => {
  for (const pattern of PATTERNS) {
    const id = pattern.exec(url)?.[1]
    if (id) return id
  }
  return null
}

export default {
  async packageData({ urls, settings, signal, image }) {
    // The source of the links tells where they come from; a package of a playlist shows its first video.
    const id = (await urls()).map(videoId).find(Boolean)
    if (!id) return null
    const oembed = new URL('https://www.youtube.com/oembed')
    oembed.searchParams.set('url', `https://www.youtube.com/watch?v=${id}`)
    oembed.searchParams.set('format', 'json')
    // Only for the title: private or non-embeddable videos still have a thumbnail.
    const info = await fetch(oembed, { signal })
      .then((res) => (res.ok ? res.json() : {}))
      .catch(() => ({}))
    const quality = settings.quality === 'hqdefault' ? 'hqdefault' : 'mqdefault'
    return {
      thumbnail: await image(`${IMAGES}/${id}/${quality}.jpg`),
      title: info.title,
      author: info.author_name,
      url: `https://www.youtube.com/watch?v=${id}`
    }
  }
}
