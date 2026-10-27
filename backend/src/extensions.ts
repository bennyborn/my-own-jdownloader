import type { MyJdClient } from './myjd/client.js'

// The extensions of one JDownloader (/extensions): ones that ship with it, ones that can be installed.
export interface JdExtension {
  id: string
  name: string
  description: string
  installed: boolean
  enabled: boolean
  // The settings of an installed extension (JD's config interface), if it has any
  configInterface?: string
}

interface RawExtension {
  id: string
  name?: string
  description?: string
  installed?: boolean
  enabled?: boolean
  configInterface?: string
}

export class Extensions {
  constructor(
    private readonly client: MyJdClient,
    private readonly deviceId: string
  ) {}

  async list(): Promise<JdExtension[]> {
    const raw = await this.client.callDevice<RawExtension[]>(this.deviceId, '/extensions/list', [{ name: true, description: true, installed: true, enabled: true, configInterface: true }])
    // JD leaves out false.
    return raw.map((e) => ({ id: e.id, name: e.name ?? e.id, description: e.description ?? '', installed: e.installed === true, enabled: e.enabled === true, configInterface: e.configInterface }))
  }

  // Downloads the extension from JD's update server; true when JD has it afterwards.
  install(id: string): Promise<boolean> {
    return this.client.callDevice<boolean>(this.deviceId, '/extensions/install', [id])
  }

  setEnabled(id: string, enabled: boolean): Promise<boolean> {
    return this.client.callDevice<boolean>(this.deviceId, '/extensions/setEnabled', [id, enabled])
  }
}
