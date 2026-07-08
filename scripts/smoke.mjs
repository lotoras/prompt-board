// CDP smoke test: connects to the running dev Electron app over the Chrome DevTools
// Protocol and verifies the renderer painted and the preload bridge is alive.
// Plain Node ESM, zero new dependencies (raw WebSocket client over net + crypto).
import net from 'node:net'
import crypto from 'node:crypto'
import http from 'node:http'

const CDP_HOST = '127.0.0.1'
const CDP_PORT = 9222

function httpGetJson(path) {
  return new Promise((resolve, reject) => {
    const req = http.get({ host: CDP_HOST, port: CDP_PORT, path }, (res) => {
      let body = ''
      res.on('data', (chunk) => (body += chunk))
      res.on('end', () => {
        try {
          resolve(JSON.parse(body))
        } catch (err) {
          reject(err)
        }
      })
    })
    req.on('error', reject)
  })
}

async function findPageTarget() {
  const maxAttempts = 10
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const targets = await httpGetJson('/json')
      const pages = targets.filter((t) => t.type === 'page')
      const preferred = pages.find((t) => (t.url || '').includes('localhost:5173'))
      const target = preferred || pages[0]
      if (target) return target
    } catch {
      // ignore, retry
    }
    await new Promise((r) => setTimeout(r, 1000))
  }
  throw new Error('No CDP page target found after retries')
}

class CdpSocket {
  constructor(socket) {
    this.socket = socket
    this.buffer = Buffer.alloc(0)
    this.nextId = 1
    this.pending = new Map()
    this.eventHandlers = new Map()
    socket.on('data', (chunk) => this._onData(chunk))
  }

  static connect(wsUrl) {
    return new Promise((resolve, reject) => {
      const url = new URL(wsUrl)
      const key = crypto.randomBytes(16).toString('base64')
      const socket = net.connect(Number(url.port) || 80, url.hostname, () => {
        const req =
          `GET ${url.pathname}${url.search} HTTP/1.1\r\n` +
          `Host: ${url.hostname}:${url.port}\r\n` +
          `Upgrade: websocket\r\n` +
          `Connection: Upgrade\r\n` +
          `Sec-WebSocket-Key: ${key}\r\n` +
          `Sec-WebSocket-Version: 13\r\n\r\n`
        socket.write(req)
      })
      socket.once('error', reject)
      const onHandshake = (chunk) => {
        const text = chunk.toString('utf8')
        if (!text.includes('101')) {
          reject(new Error('WebSocket handshake failed: ' + text.slice(0, 200)))
          return
        }
        const headerEnd = text.indexOf('\r\n\r\n')
        const rest = chunk.subarray(headerEnd + 4)
        socket.removeListener('data', onHandshake)
        const cdp = new CdpSocket(socket)
        if (rest.length > 0) cdp._onData(rest)
        resolve(cdp)
      }
      socket.on('data', onHandshake)
    })
  }

  _onData(chunk) {
    this.buffer = Buffer.concat([this.buffer, chunk])
    while (true) {
      const frame = this._tryParseFrame(this.buffer)
      if (!frame) break
      this.buffer = this.buffer.subarray(frame.total)
      if (frame.opcode === 0x1) {
        try {
          const msg = JSON.parse(frame.payload.toString('utf8'))
          this._handleMessage(msg)
        } catch {
          // ignore malformed
        }
      }
    }
  }

  _tryParseFrame(buf) {
    if (buf.length < 2) return null
    const b0 = buf[0]
    const b1 = buf[1]
    const opcode = b0 & 0x0f
    const masked = (b1 & 0x80) !== 0
    let len = b1 & 0x7f
    let offset = 2
    if (len === 126) {
      if (buf.length < offset + 2) return null
      len = buf.readUInt16BE(offset)
      offset += 2
    } else if (len === 127) {
      if (buf.length < offset + 8) return null
      len = Number(buf.readBigUInt64BE(offset))
      offset += 8
    }
    let maskKey
    if (masked) {
      if (buf.length < offset + 4) return null
      maskKey = buf.subarray(offset, offset + 4)
      offset += 4
    }
    if (buf.length < offset + len) return null
    let payload = buf.subarray(offset, offset + len)
    if (masked) {
      const unmasked = Buffer.alloc(len)
      for (let i = 0; i < len; i++) unmasked[i] = payload[i] ^ maskKey[i % 4]
      payload = unmasked
    }
    return { opcode, payload: Buffer.from(payload), total: offset + len }
  }

  _sendFrame(payload) {
    const payloadBuf = Buffer.from(payload, 'utf8')
    const len = payloadBuf.length
    let header
    if (len < 126) {
      header = Buffer.alloc(2)
      header[1] = 0x80 | len
    } else if (len < 65536) {
      header = Buffer.alloc(4)
      header[1] = 0x80 | 126
      header.writeUInt16BE(len, 2)
    } else {
      header = Buffer.alloc(10)
      header[1] = 0x80 | 127
      header.writeBigUInt64BE(BigInt(len), 2)
    }
    header[0] = 0x80 | 0x1 // FIN + text frame
    const maskKey = crypto.randomBytes(4)
    const masked = Buffer.alloc(len)
    for (let i = 0; i < len; i++) masked[i] = payloadBuf[i] ^ maskKey[i % 4]
    this.socket.write(Buffer.concat([header, maskKey, masked]))
  }

  send(method, params = {}) {
    const id = this.nextId++
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject })
      this._sendFrame(JSON.stringify({ id, method, params }))
    })
  }

  on(method, handler) {
    if (!this.eventHandlers.has(method)) this.eventHandlers.set(method, [])
    this.eventHandlers.get(method).push(handler)
  }

  _handleMessage(msg) {
    if (msg.id !== undefined && this.pending.has(msg.id)) {
      const { resolve, reject } = this.pending.get(msg.id)
      this.pending.delete(msg.id)
      if (msg.error) reject(new Error(msg.error.message))
      else resolve(msg.result)
      return
    }
    if (msg.method && this.eventHandlers.has(msg.method)) {
      for (const handler of this.eventHandlers.get(msg.method)) handler(msg.params)
    }
  }

  close() {
    this.socket.end()
  }
}

async function main() {
  const target = await findPageTarget()
  const cdp = await CdpSocket.connect(target.webSocketDebuggerUrl)

  const consoleErrors = []
  cdp.on('Runtime.consoleAPICalled', (params) => {
    if (params.type === 'error') {
      consoleErrors.push(params.args?.map((a) => a.value ?? a.description).join(' ') || 'error')
    }
  })
  cdp.on('Log.entryAdded', (params) => {
    if (params.entry?.level === 'error') {
      consoleErrors.push(params.entry.text)
    }
  })

  await cdp.send('Runtime.enable')
  await cdp.send('Log.enable')

  const rootResult = await cdp.send('Runtime.evaluate', {
    expression: "document.querySelector('#root')?.children.length ?? 0"
  })
  const rootChildren = rootResult.result?.value ?? 0

  const apiResult = await cdp.send('Runtime.evaluate', {
    expression: 'typeof window.api'
  })
  const apiType = apiResult.result?.value

  await new Promise((r) => setTimeout(r, 2000))

  cdp.close()

  const summary = { rootChildren, apiType, consoleErrors }
  console.log(JSON.stringify(summary))

  const ok = rootChildren > 0 && apiType === 'object' && consoleErrors.length === 0
  process.exit(ok ? 0 : 1)
}

main().catch((err) => {
  console.error(JSON.stringify({ error: String(err && err.stack ? err.stack : err) }))
  process.exit(1)
})
