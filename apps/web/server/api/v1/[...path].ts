export default defineEventHandler(async (event) => {
  const config = useRuntimeConfig()
  const path = getRouterParam(event, 'path') || ''
  const rawUrl = getRequestURL(event)
  const apiInternal = process.env.API_INTERNAL || config.apiInternal
  const target = `${apiInternal}/api/v1/${path}${rawUrl.search}`
  const headers: Record<string, string> = {}
  if (!['GET', 'HEAD', 'OPTIONS'].includes(event.method)) {
    const expected = process.env.APP_ORIGIN || 'http://localhost:3000'
    if (getHeader(event, 'origin') !== expected) throw createError({ statusCode: 403, statusMessage: 'Invalid request origin' })
  }
  for (const key of ['cookie', 'content-type', 'origin']) {
    const value = getHeader(event, key)
    if (value) headers[key] = value
  }
  const response = await fetch(target, {
    method: event.method, headers,
    body: ['GET','HEAD'].includes(event.method) ? undefined : await readRawBody(event),
    redirect: 'manual'
  })
  setResponseStatus(event, response.status)
  const setCookie = response.headers.get('set-cookie')
  if (setCookie) appendResponseHeader(event, 'set-cookie', setCookie)
  setResponseHeader(event, 'content-type', response.headers.get('content-type') || 'application/json')
  return response.text()
})
