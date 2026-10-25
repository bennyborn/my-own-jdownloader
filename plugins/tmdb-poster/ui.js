// The web UI part of the plugin: fills the "package-aside" block of the package card with the poster.
// The host loads this module in the browser and calls the default export once.
// `data` is what packageData() in index.js returned for the package.

export default function register({ Vue, block }) {
  const { defineComponent, h } = Vue

  const Poster = defineComponent({
    props: { pkg: Object, device: String, data: Object },
    setup(props) {
      return () => {
        const d = props.data
        if (!d?.poster) return null
        const img = h('img', {
          src: d.poster,
          alt: d.title ?? '',
          loading: 'lazy',
          style: 'display:block;width:100%;height:100%;object-fit:cover'
        })
        return h(
          d.url ? 'a' : 'div',
          {
            href: d.url,
            target: '_blank',
            rel: 'noopener noreferrer',
            title: [d.title, d.year].filter(Boolean).join(' · '),
            // A click must not open or close the package.
            onClick: (e) => e.stopPropagation(),
            style: 'display:block;width:68px;height:100px;border-radius:4px;overflow:hidden;background:var(--border)'
          },
          [img]
        )
      }
    }
  })

  block('package-aside', Poster)
}
