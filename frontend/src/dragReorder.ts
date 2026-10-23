import { ref } from 'vue'

export type DropPosition = 'before' | 'after'

// Drag & drop reordering for a list of items identified by numeric ids.
// onMove receives the dragged id and the id it should be placed after (-1 = top).
export const useDragReorder = (getIds: () => number[], onMove: (id: number, afterId: number) => void) => {
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
    if (moving !== null && target !== null && moving !== target) {
      const rest = getIds().filter((id) => id !== moving)
      const targetIndex = rest.indexOf(target)
      const insertAt = position.value === 'before' ? targetIndex : targetIndex + 1
      const after = insertAt === 0 ? -1 : rest[insertAt - 1]
      onMove(moving, after)
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
export const reorderLocally = <T>(items: T[], getId: (item: T) => number, id: number, afterId: number): T[] => {
  const moving = items.find((item) => getId(item) === id)
  if (!moving) return items
  const rest = items.filter((item) => getId(item) !== id)
  const at = afterId === -1 ? 0 : rest.findIndex((item) => getId(item) === afterId) + 1
  rest.splice(at, 0, moving)
  return rest
}
