import { timingSafeEqual } from 'node:crypto'
import type { FastifyReply, FastifyRequest } from 'fastify'

const safeEqual = (a: string, b: string): boolean => {
  const bufA = Buffer.from(a)
  const bufB = Buffer.from(b)
  return bufA.length === bufB.length && timingSafeEqual(bufA, bufB)
}

// HTTP Basic auth guarding the UI and API. Disabled if no password is configured.
export const createAuthHook = (password: string | undefined) => {
  if (!password) return undefined
  return async (request: FastifyRequest, reply: FastifyReply) => {
    if (request.url === '/api/health') return
    const header = request.headers.authorization ?? ''
    if (header.startsWith('Basic ')) {
      const decoded = Buffer.from(header.slice(6), 'base64').toString('utf8')
      const given = decoded.slice(decoded.indexOf(':') + 1)
      if (safeEqual(given, password)) return
    }
    reply.header('WWW-Authenticate', 'Basic realm="my-own-jdownloader"')
    return reply.code(401).send({ error: 'Unauthorized' })
  }
}
