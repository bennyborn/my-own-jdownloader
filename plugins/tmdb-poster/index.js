// Poster plugin: looks the tmdbid=<id> from the package name up at TMDB.
// The id is either a movie or a series id; both are asked and the better match by title and year wins.

const API = 'https://api.themoviedb.org/3'
const IMAGES = 'https://image.tmdb.org/t/p/w185'

const normalize = (s) =>
  String(s ?? '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()

// "Backrooms (2026) [tmdbid=1083381]" -> { id: 1083381, title: "Backrooms", year: 2026 }
export const parseName = (name) => {
  const id = /tmdbid[=\-_ ]*(\d+)/i.exec(name)?.[1]
  if (!id) return null
  const year = /(?:^|[^\d])((?:19|20)\d{2})(?!\d)/.exec(name.replace(/tmdbid[=\-_ ]*\d+/i, ''))?.[1]
  const title = name
    .replace(/[\[({][^\])}]*tmdbid[^\])}]*[\])}]/i, ' ')
    .replace(/tmdbid[=\-_ ]*\d+/i, ' ')
    .split(/[\[({]|(?:^|[\s._-])(?:19|20)\d{2}(?!\d)|\bS\d{1,2}(?:E\d{1,3})?\b|\b(?:480|576|720|1080|2160)p\b/i)[0]
    .replace(/[._]+/g, ' ')
    .trim()
  return { id: Number(id), title, year: year ? Number(year) : undefined }
}

const call = async (kind, id, { apiKey, language }, signal) => {
  const token = apiKey.length > 40
  const url = new URL(`${API}/${kind}/${id}`)
  url.searchParams.set('language', language || 'en-US')
  if (!token) url.searchParams.set('api_key', apiKey)
  const res = await fetch(url, { signal, headers: token ? { Authorization: `Bearer ${apiKey}` } : {} })
  if (res.status === 404) return null
  if (res.status === 401) throw new Error('TMDB rejected the API key')
  if (!res.ok) throw new Error(`TMDB answered HTTP ${res.status}`)
  return res.json()
}

const yearOf = (item) => Number((item.release_date || item.first_air_date || '').slice(0, 4)) || undefined

const score = (item, kind, parsed, name) => {
  let points = 0
  const titles = [item.title, item.original_title, item.name, item.original_name].filter(Boolean).map(normalize)
  const wanted = normalize(parsed.title)
  if (wanted && titles.includes(wanted)) points += 3
  else if (wanted && titles.some((t) => t.includes(wanted) || wanted.includes(t))) points += 1
  if (parsed.year && yearOf(item) === parsed.year) points += 2
  if (/\bS\d{1,2}(E\d{1,3})?\b|season|staffel|episode/i.test(name)) points += kind === 'tv' ? 2 : 0
  return points
}

export default {
  async packageData({ name, settings, signal, image }) {
    const parsed = parseName(name)
    if (!parsed) return null
    const [movie, tv] = await Promise.all([call('movie', parsed.id, settings, signal), call('tv', parsed.id, settings, signal)])
    const candidates = [
      movie && { item: movie, kind: 'movie', points: score(movie, 'movie', parsed, name) },
      tv && { item: tv, kind: 'tv', points: score(tv, 'tv', parsed, name) }
    ].filter(Boolean)
    // On a tie the movie wins (it is listed first).
    const best = candidates.sort((a, b) => b.points - a.points)[0]
    if (!best) return null
    const { item, kind } = best
    return {
      poster: item.poster_path ? await image(IMAGES + item.poster_path) : undefined,
      title: item.title ?? item.name,
      year: yearOf(item),
      url: `https://www.themoviedb.org/${kind}/${item.id}`
    }
  }
}
