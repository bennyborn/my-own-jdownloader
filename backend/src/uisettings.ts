import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'

// Settings of the web interface itself that every browser shares (JD is not involved). Kept in one small file.
export interface UiSettings {
  // The optional entries of the item context menu: id -> shown. An entry that is missing follows its default in the frontend.
  contextMenu: Record<string, boolean>
}

export class UiSettingsStore {
  private state: UiSettings = { contextMenu: {} }

  constructor(private readonly file: string) {
    try {
      const saved = JSON.parse(readFileSync(file, 'utf8')) as Partial<UiSettings>
      this.state = { contextMenu: onlyBooleans(saved.contextMenu) }
    } catch {
      // nothing saved yet
    }
  }

  get(): UiSettings {
    return this.state
  }

  setContextMenu(value: unknown): UiSettings {
    this.state = { ...this.state, contextMenu: onlyBooleans(value) }
    mkdirSync(dirname(this.file), { recursive: true })
    const tmp = `${this.file}.tmp`
    writeFileSync(tmp, JSON.stringify(this.state, null, 2), { mode: 0o600 })
    renameSync(tmp, this.file)
    return this.state
  }
}

const onlyBooleans = (value: unknown): Record<string, boolean> =>
  value && typeof value === 'object' ? Object.fromEntries(Object.entries(value).filter(([, v]) => typeof v === 'boolean')) : {}
