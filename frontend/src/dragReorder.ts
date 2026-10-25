import { ref } from 'vue'

export type DropPosition = 'before' | 'after'

// Drag & drop reordering for a list of items identified by numeric ids.
// onMove receives the ids to move (in list order) and the id they should be placed after (-1 = top).
// getGroup returns the ids that travel along with the dragged one (the marked items when it is marked).
export const useDragReorder = (
  getIds: () => number[],
  onMove: (ids: number[], afterId: number) => void,
  getGroup?: (id: number) => number[]
) => {
  const dragId = ref<number | null>(null)
  const overId = ref<number | null>(null)
  const position = ref<DropPosition>('before')

  const onDragStart = (id: number, event: DragEvent) => {
    dragId.value = id
    event.dataTransfer?.setData('text/plain', String(id))
    if (event.dataTransfer) event.dataTransfer.effectAllowed = 'move'
  }

  const onDragOver = (id: number, event: DragEvent) => {
    if (dragId.value === null) return
    event.preventDefault()
    const rect = (event.currentTarget as HTMLElement).getBoundingClientRect()
    overId.value = id
    position.value = event.clientY < rect.top + rect.height / 2 ? 'before' : 'after'
  }

  const onDrop = (event: DragEvent) => {
    event.preventDefault()
    const moving = dragId.value
    const target = overId.value
    const group = moving === null ? [] : getGroup?.(moving) ?? [moving]
    const set = new Set(group.includes(moving!) ? group : [moving!])
    if (moving !== null && target !== null && !set.has(target)) {
      const all = getIds()
      const rest = all.filter((id) => !set.has(id))
      const targetIndex = rest.indexOf(target)
      const insertAt = position.value === 'before' ? targetIndex : targetIndex + 1
      const after = insertAt === 0 ? -1 : rest[insertAt - 1]
      onMove(all.filter((id) => set.has(id)), after)
    }
    onDragEnd()
  }

  const onDragEnd = () => {
    dragId.value = null
    overId.value = null
  }

  const dropClass = (id: number) =>
    overId.value === id && dragId.value !== id ? (position.value === 'before' ? 'drop-before' : 'drop-after') : ''

  return { dragId, onDragStart, onDragOver, onDrop, onDragEnd, dropClass }
}

// Local (optimistic) reorder, the next live update from the server replaces it with the real order.
export const reorderLocally = <T>(items: T[], getId: (item: T) => number, ids: number[], afterId: number): T[] => {
  const set = new Set(ids)
  const moving = items.filter((item) => set.has(getId(item)))
  if (!moving.length) return items
  const rest = items.filter((item) => !set.has(getId(item)))
  const at = afterId === -1 ? 0 : rest.findIndex((item) => getId(item) === afterId) + 1
  rest.splice(at, 0, ...moving)
  return rest
}
