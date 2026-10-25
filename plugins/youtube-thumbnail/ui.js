// The web UI part of the plugin: fills the "package-aside" block of the package card with the thumbnail.
// `data` is what packageData() in index.js returned for the package.

export default function register({ Vue, block }) {
  const { defineComponent, h } = Vue

  const Thumbnail = defineComponent({
    props: { pkg: Object, device: String, data: Object },
    setup(props) {
      return () => {
        const d = props.data
        if (!d?.thumbnail) return null
        return h(
          'a',
          {
            href: d.url,
            target: '_blank',
            rel: 'noopener noreferrer',
            title: [d.title, d.author].filter(Boolean).join(' · '),
            // A click must not open or close the package.
            onClick: (e) => e.stopPropagation(),
            style: 'display:block;width:160px;height:90px;border-radius:4px;overflow:hidden;background:var(--border)'
          },
          [
            h('img', {
              src: d.thumbnail,
              alt: d.title ?? '',
              loading: 'lazy',
              style: 'display:block;width:100%;height:100%;object-fit:cover'
            })
          ]
        )
      }
    }
  })

  block('package-aside', Thumbnail)
}
