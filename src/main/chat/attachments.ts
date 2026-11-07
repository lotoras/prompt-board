import { app, BrowserWindow, dialog, nativeImage } from 'electron'
import { randomUUID } from 'crypto'
import { promises as fs } from 'fs'
import { basename, extname, join } from 'path'
import type { ChatAttachment } from '../../shared/types'

const IMAGE_MEDIA_TYPES: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.bmp': 'image/bmp'
}
const THUMB_WIDTH = 64

export function imageMediaType(path: string): string | undefined {
  return IMAGE_MEDIA_TYPES[extname(path).toLowerCase()]
}

export async function readImage(path: string): Promise<{ mediaType: string; base64: string }> {
  const buf = await fs.readFile(path)
  return { mediaType: imageMediaType(path) ?? 'image/png', base64: buf.toString('base64') }
}

export async function describe(paths: string[]): Promise<ChatAttachment[]> {
  const out: ChatAttachment[] = []
  for (const path of paths) {
    let size = 0
    try {
      const stat = await fs.stat(path)
      if (stat.isDirectory()) continue
      size = stat.size
    } catch {
      continue
    }
    const kind = imageMediaType(path) ? 'image' : 'file'
    const attachment: ChatAttachment = { path, name: basename(path), kind, size }
    if (kind === 'image') {
      try {
        const thumb = nativeImage.createFromPath(path).resize({ width: THUMB_WIDTH })
        if (!thumb.isEmpty()) attachment.thumbDataUrl = thumb.toDataURL()
      } catch {
        // chip falls back to the file icon
      }
    }
    out.push(attachment)
  }
  return out
}

export async function pick(getWindow: () => BrowserWindow | null): Promise<ChatAttachment[]> {
  const win = getWindow()
  const options = { properties: ['openFile', 'multiSelections'] as Array<'openFile' | 'multiSelections'> }
  const result = win ? await dialog.showOpenDialog(win, options) : await dialog.showOpenDialog(options)
  if (result.canceled || result.filePaths.length === 0) return []
  return describe(result.filePaths)
}

export async function saveImage(dataUrl: string, name?: string): Promise<ChatAttachment> {
  const match = /^data:(image\/[a-zA-Z0-9.+-]+);base64,(.*)$/s.exec(dataUrl)
  if (!match) throw new Error('Not an image data URL')
  const subtype = match[1].split('/')[1].toLowerCase()
  const ext = subtype === 'jpeg' ? 'jpg' : subtype.replace(/[^a-z0-9]/g, '') || 'png'
  const dir = join(app.getPath('userData'), 'attachments')
  await fs.mkdir(dir, { recursive: true })
  const path = join(dir, `${randomUUID()}.${ext}`)
  await fs.writeFile(path, Buffer.from(match[2], 'base64'))
  const [attachment] = await describe([path])
  if (!attachment) throw new Error('Could not save the image')
  return name ? { ...attachment, name } : attachment
}
