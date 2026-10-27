import type { MyJdClient } from './myjd/client.js'

// The questions JD would ask on its desktop (links that are already there, an unknown archive password, a file that exists, ...).
// The device lists them under /dialogs; every answer says how the dialog was closed and what was chosen or typed.
export interface JdDialog {
  id: number
  // choice: pick one; multi: pick several; input: a text; login: user name and password; newpassword: a password twice;
  // confirm: OK / cancel; message: only to read; other: a type we cannot answer (cancel is all we can do)
  kind: 'choice' | 'multi' | 'input' | 'login' | 'newpassword' | 'confirm' | 'message' | 'other'
  title: string
  message: string
  // What the question is about (archive, link, package, ...)
  details: { label: string; value: string }[]
  okText?: string
  cancelText?: string
  choices?: string[]
  preselected?: number
  defaultText?: string
  defaultUsername?: string
  // login: the checkbox "remember"
  rememberOption?: boolean
  remember?: boolean
}

export interface DialogAnswer {
  cancel: boolean
  index?: number
  indices?: number[]
  text?: string
  username?: string
  password?: string
  verification?: string
  remember?: boolean
}

interface RawDialog {
  type?: string
  properties?: Record<string, string>
}

// "File exists" (a download wants a name that is taken): the answer is one of JD's IfFileExistsAction values, not an index.
const FILE_EXISTS = 'jd.controlling.downloadcontroller.IfFileExistsDialogInterface'
const FILE_EXISTS_ACTIONS = [
  { value: 'OVERWRITE_FILE', label: 'Overwrite the file' },
  { value: 'SKIP_FILE', label: 'Skip the file' },
  { value: 'AUTO_RENAME', label: 'Rename the new file automatically' }
]

// The dialog types JD knows (found in its jars, /dialogs/getTypeInfo tells what an answer holds), by the end of the class name.
const KINDS: [string, JdDialog['kind']][] = [
  ['IconComboBoxDialogInterface', 'choice'],
  ['ComboBoxDialogInterface', 'choice'],
  ['MultiSelectionDialogInterface', 'multi'],
  ['InputDialogInterface', 'input'],
  ['AskContainerPasswordDialogInterface', 'input'],
  ['AskCrawlerPasswordDialogInterface', 'input'],
  ['AskDownloadPasswordDialogInterface', 'input'],
  ['ExtractPasswordDialogInterface', 'input'],
  ['LoginDialogInterface', 'login'],
  ['AskUsernameAndPasswordDialogInterface', 'login'],
  ['NewPasswordDialogInterface', 'newpassword'],
  ['ConfirmDialogInterface', 'confirm'],
  ['AskToUsePremiumDialogInterface', 'confirm'],
  ['MessageDialogInterface', 'message'],
  ['ExceptionDialogInterface', 'message']
]

const DETAILS: [string, string][] = [
  ['archivename', 'Archive'],
  ['linkname', 'Link'],
  ['packagename', 'Package'],
  ['linkhost', 'Host'],
  ['url', 'URL'],
  ['pluginhost', 'Plugin'],
  ['file', 'File'],
  ['domain', 'Site'],
  ['premiumurl', 'Premium page']
]

const kindOf = (type = ''): JdDialog['kind'] => KINDS.find(([suffix]) => type.endsWith(suffix))?.[1] ?? 'other'

// The labels come as JSON text inside the properties.
const labelsOf = (text: string | undefined): string[] => {
  try {
    const parsed = JSON.parse(text ?? '[]')
    return Array.isArray(parsed) ? parsed.map(String) : []
  } catch {
    return []
  }
}

const toDialog = (id: number, raw: RawDialog): JdDialog => {
  const p = raw.properties ?? {}
  const fileExists = raw.type === FILE_EXISTS
  const kind = fileExists ? 'choice' : kindOf(raw.type)
  const preselected = Number(p.preselectedindex)
  return {
    id,
    kind,
    title: p.title ?? '',
    message: fileExists ? `${p.filepath ?? ''}\nalready exists (package ${p.packagename ?? '?'}). What should happen with the new download?` : (p.message ?? ''),
    details: fileExists ? [] : DETAILS.filter(([key]) => p[key]).map(([key, label]) => ({ label, value: p[key] })),
    okText: p.okbuttontext,
    cancelText: p.cancelbuttontext,
    choices: fileExists ? FILE_EXISTS_ACTIONS.map((a) => a.label) : kind === 'choice' || kind === 'multi' ? labelsOf(p.labels) : undefined,
    preselected: kind === 'choice' && Number.isInteger(preselected) ? preselected : undefined,
    defaultText: kind === 'input' ? p.defaultmessage : undefined,
    defaultUsername: kind === 'login' ? p.defaultusername : undefined,
    rememberOption: kind === 'login' ? p.rememberoptionvisible === 'true' : undefined,
    remember: kind === 'login' ? p.defaultrememberselected === 'true' : undefined
  }
}

// JD wants its dialogs answered in its own order and refuses the others: "Answer Dialog <id> first".
export class DialogOrderError extends Error {
  constructor(readonly first: number) {
    super(`The JDownloader wants dialog ${first} answered first`)
  }
}

export class Dialogs {
  // A dialog does not change while it is open, so it is read once.
  private readonly known = new Map<number, { type: string; dialog: JdDialog | null }>()

  constructor(
    private readonly client: MyJdClient,
    private readonly deviceId: string
  ) {}

  async list(): Promise<JdDialog[]> {
    const ids = await this.client.callDevice<number[]>(this.deviceId, '/dialogs/list', [])
    for (const id of [...this.known.keys()]) if (!ids.includes(id)) this.known.delete(id)
    for (const id of ids) {
      if (this.known.has(id)) continue
      const raw = await this.client.callDevice<RawDialog>(this.deviceId, '/dialogs/get', [id, false, true]).catch(() => undefined)
      // Captchas have their own place in the interface.
      this.known.set(id, { type: raw?.type ?? '', dialog: raw && !/captcha/i.test(raw.type ?? '') ? toDialog(id, raw) : null })
    }
    return [...this.known.values()].flatMap((k) => (k.dialog ? [k.dialog] : []))
  }

  async answer(id: number, answer: DialogAnswer): Promise<void> {
    const data: Record<string, unknown> = { closereason: answer.cancel ? 'CANCEL' : 'OK', dontshowagainselected: false }
    if (!answer.cancel) {
      if (this.known.get(id)?.type === FILE_EXISTS) data.action = FILE_EXISTS_ACTIONS[answer.index ?? -1]?.value
      else if (answer.index !== undefined) data.selectedindex = answer.index
      if (answer.indices !== undefined) data.selectedindices = answer.indices
      if (answer.text !== undefined) data.text = answer.text
      if (answer.username !== undefined) data.username = answer.username
      if (answer.password !== undefined) data.password = answer.password
      if (answer.verification !== undefined) data.passwordverification = answer.verification
      if (answer.remember !== undefined) data.rememberselected = answer.remember
    }
    try {
      await this.client.callDevice(this.deviceId, '/dialogs/answer', [id, data])
    } catch (e) {
      const first = /Answer Dialog (\d+) first/.exec(e instanceof Error ? e.message : '')?.[1]
      throw first ? new DialogOrderError(Number(first)) : e
    }
    this.known.delete(id)
  }
}
