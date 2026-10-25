import type { MyJdClient } from './myjd/client.js'

export const SKIP_TYPES = ['SINGLE', 'BLOCK_HOSTER', 'BLOCK_PACKAGE', 'BLOCK_ALL_CAPTCHAS', 'REFRESH'] as const
export type SkipType = (typeof SKIP_TYPES)[number]

export interface CaptchaJob {
  id: number
  hoster: string
  challengeType: string
  link?: number
  remaining: number
  timeout: number
  // image: a picture to type off (answered in the web UI); widget: hCaptcha / reCAPTCHA / Turnstile (browser extension)
  kind: 'image' | 'widget'
}

// What a browser needs to render the widget on the hoster's real page.
export interface CaptchaDetails extends CaptchaJob {
  siteKey: string
  siteUrl: string
  boundToDomain: boolean
  // Everything /captcha/get reported (site key, type, ...), for debugging unknown challenge types.
  raw: Record<string, unknown>
}

// Open captcha jobs of the JDownloader. The browser extension solves them on the hoster's page
// (the token is bound to that domain) and hands the token back through here.
export class Captchas {
  constructor(
    private readonly client: MyJdClient,
    private readonly deviceId: string
  ) {}

  private call<T>(action: string, params: unknown[] = []): Promise<T> {
    return this.client.callDevice<T>(this.deviceId, action, params)
  }

  async list(): Promise<CaptchaJob[]> {
    const raw = await this.call<Partial<CaptchaJob & { type: string; captchaCategory: string }>[]>('/captcha/list')
    return raw.map((j) => ({
      id: j.id ?? 0,
      hoster: j.hoster ?? '',
      challengeType: j.challengeType ?? j.type ?? '',
      link: j.link,
      remaining: j.remaining ?? 0,
      timeout: j.timeout ?? 0,
      kind: (j.challengeType ?? j.type) === 'BasicCaptchaChallenge' ? ('image' as const) : ('widget' as const)
    }))
  }

  async details(id: number): Promise<CaptchaDetails | undefined> {
    const job = (await this.list()).find((j) => j.id === id)
    if (!job) return undefined
    const raw = await this.call<({ siteKey?: string; siteUrl?: string; contextUrl?: string; boundToDomain?: boolean } & Record<string, unknown>) | null>('/captcha/get', [id, 'rawtoken'])
    if (!raw?.siteKey) return undefined
    return { ...job, siteKey: raw.siteKey, siteUrl: raw.siteUrl ?? raw.contextUrl ?? '', boundToDomain: raw.boundToDomain === true, raw }
  }

  // The picture of an image captcha. JD reports it as "image/jpeg;base64,..." although the bytes may be a PNG,
  // so the type is taken from the bytes.
  async image(id: number): Promise<{ type: string; data: Buffer } | undefined> {
    const raw = await this.call<string | null>('/captcha/get', [id])
    const match = typeof raw === 'string' ? /^(?:data:)?[\w/+.-]+;base64,(.+)$/s.exec(raw) : null
    if (!match) return undefined
    const data = Buffer.from(match[1], 'base64')
    const type = data.subarray(0, 4).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47])) ? 'image/png' : data.subarray(0, 2).equals(Buffer.from([0xff, 0xd8])) ? 'image/jpeg' : data.subarray(0, 3).toString('latin1') === 'GIF' ? 'image/gif' : undefined
    return type ? { type, data } : undefined
  }

  // Answer of an image captcha (the two-argument solve is the one for typed text).
  async solveText(id: number, text: string): Promise<void> {
    await this.call('/captcha/solve', [id, text])
  }

  async skip(id: number, type: SkipType): Promise<void> {
    await this.call('/captcha/skip', [id, type])
  }

  // Hands the solved token (g-recaptcha-response / h-captcha-response) to JDownloader.
  async solve(id: number, token: string): Promise<void> {
    // The two-argument solve only knows image captchas (UNKNOWN_CHALLENGETYPE for hCaptcha / reCAPTCHA);
    // resultFormat "rawtoken" is the same format name that /captcha/get uses.
    await this.call('/captcha/solve', [id, token, 'rawtoken'])
  }
}
