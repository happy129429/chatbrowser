import { Inflate } from 'fflate'

const READ_CHUNK_BYTES = 256 * 1024
// 控制每轮同步解压的工作量；输出交给调用方保存后才继续读取。
const INFLATE_CHUNK_BYTES = 8 * 1024

/** ZIP 结构损坏或使用了不支持的特性 */
export class ArchiveError extends Error {
  constructor() {
    super('Invalid or unsupported history archive')
    this.name = 'ArchiveError'
  }
}

const invalid = (): never => {
  throw new ArchiveError()
}

/** 本地文件头签名 PK\x03\x04，用于在解析前区分 ZIP 与其他文件。 */
export const isZipFile = async (file: File) => {
  const bytes = new Uint8Array(await file.slice(0, 4).arrayBuffer())
  return bytes.length === 4 && bytes.every((byte, index) => byte === [0x50, 0x4b, 3, 4][index])
}

const viewOf = (bytes: Uint8Array) => new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)

const crcTable = Uint32Array.from({ length: 256 }, (_, value) => {
  let crc = value
  for (let bit = 0; bit < 8; bit++) {
    crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0)
  }
  return crc >>> 0
})

const readBytes = async (file: File, start: number, length: number) => {
  if (start < 0 || length < 0 || start + length > file.size) {
    invalid()
  }
  const bytes = new Uint8Array(await file.slice(start, start + length).arrayBuffer())
  if (bytes.length !== length) {
    invalid()
  }
  return bytes
}

/** ZIP64、分卷与加密文件不属于导出格式，一律拒绝。 */
const checkExtra = (bytes: Uint8Array) => {
  const view = viewOf(bytes)
  let offset = 0
  while (offset < bytes.length) {
    if (offset + 4 > bytes.length) {
      invalid()
    }
    offset += 4 + view.getUint16(offset + 2, true)
    if (offset > bytes.length) {
      invalid()
    }
  }
}

const decodePath = (bytes: Uint8Array, flags: number) => {
  // 非 UTF-8 编码的 ZIP 文件名仅接受 ASCII，确保附件路径解码准确。
  if (!(flags & 0x800) && bytes.some((byte) => byte > 0x7f)) {
    invalid()
  }
  const path = new TextDecoder('utf-8', { fatal: true }).decode(bytes).normalize('NFC')
  if (!path || path.includes('\\') || path.includes('\0') || /^[A-Za-z]:/.test(path)) {
    invalid()
  }
  const parts = (path.endsWith('/') ? path.slice(0, -1) : path).split('/')
  if (parts.some((part) => !part || part === '.' || part === '..')) {
    invalid()
  }
  return path
}

type Entry = {
  path: string
  name: Uint8Array
  flags: number
  method: number
  crc: number
  compressedSize: number
  size: number
  offset: number
  zip64: boolean
}

const uint64 = (view: DataView, offset: number): number => {
  const value = view.getBigUint64(offset, true)
  if (value > BigInt(Number.MAX_SAFE_INTEGER)) {
    invalid()
  }
  return Number(value)
}

/** 解析 ZIP64 extra 中缺失的 64 位字段（按未压缩、压缩、偏移、磁盘顺序）。 */
const zip64Values = (
  bytes: Uint8Array,
  needSize: boolean,
  needCompressed: boolean,
  needOffset: boolean
): { size?: number; compressedSize?: number; offset?: number; disk?: number } => {
  const view = viewOf(bytes)
  let cursor = 0
  while (cursor + 4 <= bytes.length) {
    const id = view.getUint16(cursor, true)
    const length = view.getUint16(cursor + 2, true)
    if (cursor + 4 + length > bytes.length) {
      invalid()
    }
    if (id === 1) {
      const data = viewOf(bytes.subarray(cursor + 4, cursor + 4 + length))
      let position = 0
      const result: { size?: number; compressedSize?: number; offset?: number; disk?: number } = {}
      const take = () => {
        if (position + 8 > data.byteLength) {
          invalid()
        }
        const value = uint64(data, position)
        position += 8
        return value
      }
      if (needSize) {
        result.size = take()
      }
      if (needCompressed) {
        result.compressedSize = take()
      }
      if (needOffset) {
        result.offset = take()
      }
      if (data.byteLength >= position + 4) {
        result.disk = data.getUint32(position, true)
      }
      return result
    }
    cursor += 4 + length
  }
  return invalid()
}

const readDirectory = async (file: File): Promise<{ entries: Entry[]; offset: number }> => {
  if (file.size < 22) {
    invalid()
  }
  const tailStart = Math.max(0, file.size - 22 - 0xffff)
  const tail = await readBytes(file, tailStart, file.size - tailStart)
  const tailView = viewOf(tail)
  let end = tail.length - 22
  while (
    end >= 0 &&
    (tailView.getUint32(end, true) !== 0x06054b50 ||
      end + 22 + tailView.getUint16(end + 20, true) !== tail.length)
  ) {
    end--
  }
  if (end < 0) {
    invalid()
  }
  const count16 = tailView.getUint16(end + 10, true)
  const size32 = tailView.getUint32(end + 12, true)
  const offset32 = tailView.getUint32(end + 16, true)
  if (tailView.getUint16(end + 4, true) !== 0 || tailView.getUint16(end + 6, true) !== 0) {
    invalid()
  }
  let count = count16
  let size = size32
  let offset = offset32
  let directoryEnd = tailStart + end
  const needsZip64 = count16 === 0xffff || size32 === 0xffffffff || offset32 === 0xffffffff
  if (needsZip64) {
    // ZIP64 EOCD locator 紧挨在普通 EOCD 之前
    const locatorAt = tailStart + end - 20
    if (locatorAt < 0) {
      invalid()
    }
    const locator = viewOf(await readBytes(file, locatorAt, 20))
    if (
      locator.getUint32(0, true) !== 0x07064b50 ||
      locator.getUint32(4, true) !== 0 ||
      locator.getUint32(16, true) !== 1
    ) {
      invalid()
    }
    const eocd64At = uint64(locator, 8)
    const eocd64 = viewOf(await readBytes(file, eocd64At, 56))
    if (
      eocd64.getUint32(0, true) !== 0x06064b50 ||
      eocd64.getUint32(16, true) !== 0 ||
      eocd64.getUint32(20, true) !== 0
    ) {
      invalid()
    }
    count = uint64(eocd64, 32)
    size = uint64(eocd64, 40)
    offset = uint64(eocd64, 48)
    directoryEnd = eocd64At
  } else if (tailView.getUint16(end + 8, true) !== count) {
    invalid()
  }
  if (offset + size !== directoryEnd) {
    invalid()
  }
  const entries: Entry[] = []
  const paths = new Set<string>()
  let cursor = 0
  for (let index = 0; index < count; index++) {
    if (cursor + 46 > size) {
      invalid()
    }
    const view = viewOf(await readBytes(file, offset + cursor, 46))
    if (view.getUint32(0, true) !== 0x02014b50) {
      invalid()
    }
    const flags = view.getUint16(8, true)
    const method = view.getUint16(10, true)
    const compressed32 = view.getUint32(20, true)
    const size32Raw = view.getUint32(24, true)
    const nameLength = view.getUint16(28, true)
    const extraLength = view.getUint16(30, true)
    const next = cursor + 46 + nameLength + extraLength + view.getUint16(32, true)
    const offset32Raw = view.getUint32(42, true)
    const diskStart = view.getUint16(34, true)
    const extraBytes = await readBytes(file, offset + cursor + 46 + nameLength, extraLength)
    let compressedSize = compressed32
    let entrySize = size32Raw
    let entryOffset = offset32Raw
    const needsZip64Entry =
      compressed32 === 0xffffffff ||
      size32Raw === 0xffffffff ||
      offset32Raw === 0xffffffff ||
      diskStart === 0xffff
    if (needsZip64Entry) {
      const values = zip64Values(
        extraBytes,
        size32Raw === 0xffffffff,
        compressed32 === 0xffffffff,
        offset32Raw === 0xffffffff
      )
      entrySize = values.size ?? entrySize
      compressedSize = values.compressedSize ?? compressedSize
      entryOffset = values.offset ?? entryOffset
      if (diskStart === 0xffff && (values.disk ?? 1) !== 0) {
        invalid()
      }
    }
    // 只允许 deflate 选项、data descriptor 与 UTF-8 标志。
    if (
      flags & ~0x80e ||
      (method !== 0 && method !== 8) ||
      (method === 0 && compressedSize !== entrySize) ||
      entryOffset >= offset ||
      (diskStart !== 0 && diskStart !== 0xffff) ||
      ((view.getUint32(38, true) >>> 16) & 0xf000) === 0xa000 ||
      next > size
    ) {
      invalid()
    }
    const name = await readBytes(file, offset + cursor + 46, nameLength)
    const path = decodePath(name, flags)
    // 目录和同名文件也不能互相覆盖。
    const identity = path.endsWith('/') ? path.slice(0, -1) : path
    if (paths.has(identity) || (path.endsWith('/') && entrySize !== 0)) {
      invalid()
    }
    paths.add(identity)
    checkExtra(extraBytes)
    entries.push({
      path,
      name,
      flags,
      method,
      crc: view.getUint32(16, true),
      compressedSize,
      size: entrySize,
      offset: entryOffset,
      zip64: needsZip64Entry,
    })
    cursor = next
  }
  if (cursor !== size) {
    invalid()
  }
  return { entries: entries.sort((a, b) => a.offset - b.offset), offset }
}

const readEntryOffset = async (file: File, entry: Entry, boundary: number) => {
  if (entry.offset + 30 > boundary) {
    invalid()
  }
  const view = viewOf(await readBytes(file, entry.offset, 30))
  const nameLength = view.getUint16(26, true)
  const extraLength = view.getUint16(28, true)
  const start = entry.offset + 30 + nameLength + extraLength
  const end = start + entry.compressedSize
  if (
    view.getUint32(0, true) !== 0x04034b50 ||
    view.getUint16(6, true) !== entry.flags ||
    view.getUint16(8, true) !== entry.method ||
    nameLength !== entry.name.length ||
    end > boundary
  ) {
    invalid()
  }
  if ((entry.flags & 8) === 0) {
    const crc = view.getUint32(14, true)
    const localCompressed = view.getUint32(18, true)
    const localSize = view.getUint32(22, true)
    // ZIP64 本地头允许把尺寸标为 0xffffffff，实际值以中央目录与 extra 为准。
    const sentinel = localCompressed === 0xffffffff && localSize === 0xffffffff
    if (!sentinel && (localCompressed !== entry.compressedSize || localSize !== entry.size)) {
      invalid()
    }
    if (crc !== entry.crc) {
      invalid()
    }
  }
  const metadata = await readBytes(file, entry.offset + 30, nameLength + extraLength)
  if (entry.name.some((byte, index) => byte !== metadata[index])) {
    invalid()
  }
  checkExtra(metadata.subarray(nameLength))
  if (entry.flags & 8) {
    const localWide =
      view.getUint32(18, true) === 0xffffffff || view.getUint32(22, true) === 0xffffffff
    const wide =
      entry.zip64 || localWide || entry.compressedSize > 0xffffffff || entry.size > 0xffffffff
    const length = wide ? 20 : 12
    if (end + 4 + length > boundary) {
      invalid()
    }
    const descriptor = viewOf(await readBytes(file, end, Math.min(24, boundary - end)))
    const shift = descriptor.getUint32(0, true) === 0x08074b50 ? 4 : 0
    if (shift + length > descriptor.byteLength || descriptor.getUint32(shift, true) !== entry.crc) {
      invalid()
    }
    if (wide) {
      if (
        uint64(descriptor, shift + 4) !== entry.compressedSize ||
        uint64(descriptor, shift + 12) !== entry.size
      ) {
        invalid()
      }
    } else if (
      descriptor.getUint32(shift + 4, true) !== entry.compressedSize ||
      descriptor.getUint32(shift + 8, true) !== entry.size
    ) {
      invalid()
    }
  }
  return start
}

export type ArchiveEntry = {
  path: string
  size: number
  stream: AsyncIterable<Uint8Array>
}

export const countArchiveEntries = async (file: File, matches: (path: string) => boolean) =>
  (await readDirectory(file)).entries.filter((entry) => matches(entry.path)).length

/**
 * 按条目在文件中的物理顺序逐条、逐块解压，跳过目录条目。
 * 调用方必须消费完当前条目的数据，再请求下一个条目。
 */
export async function* readArchive(file: File): AsyncGenerator<ArchiveEntry> {
  const directory = await readDirectory(file)
  for (const [index, entry] of directory.entries.entries()) {
    const boundary = directory.entries[index + 1]?.offset ?? directory.offset
    const start = await readEntryOffset(file, entry, boundary)
    if (entry.path.endsWith('/')) {
      continue
    }
    let completed = false
    const stream = async function* (): AsyncGenerator<Uint8Array> {
      let written = 0
      let crc = 0xffffffff
      const pending: Uint8Array[] = []
      const append = (chunk: Uint8Array) => {
        written += chunk.length
        if (written > entry.size) {
          invalid()
        }
        for (const byte of chunk) {
          crc = (crc >>> 8) ^ crcTable[(crc ^ byte) & 0xff]
        }
        if (chunk.length) {
          pending.push(chunk)
        }
      }
      const inflate = entry.method === 8 ? new Inflate(append) : null
      for (let offset = 0; offset < entry.compressedSize; offset += READ_CHUNK_BYTES) {
        const chunk = await readBytes(
          file,
          start + offset,
          Math.min(READ_CHUNK_BYTES, entry.compressedSize - offset)
        )
        if (!inflate) {
          append(chunk)
          yield* pending.splice(0)
          continue
        }
        for (let cursor = 0; cursor < chunk.length; cursor += INFLATE_CHUNK_BYTES) {
          const end = Math.min(cursor + INFLATE_CHUNK_BYTES, chunk.length)
          inflate.push(chunk.subarray(cursor, end), offset + end === entry.compressedSize)
          // yield 暂停解压，等待调用方完成异步写入；不缓存整个条目。
          yield* pending.splice(0)
        }
      }
      if (inflate && entry.compressedSize === 0) {
        inflate.push(new Uint8Array(), true)
        yield* pending.splice(0)
      }
      if (written !== entry.size || (crc ^ 0xffffffff) >>> 0 !== entry.crc) {
        invalid()
      }
      completed = true
    }
    yield { path: entry.path, size: entry.size, stream: stream() }
    if (!completed) {
      invalid()
    }
  }
}

/** 读出整个条目：会话 JSON 需要完整解析，图片需要识别类型后整张保存。 */
export const readEntry = async (entry: ArchiveEntry): Promise<Blob> => {
  const parts: Blob[] = []
  for await (const chunk of entry.stream) {
    parts.push(new Blob([chunk as Uint8Array<ArrayBuffer>]))
  }
  return new Blob(parts)
}

/** 不需要的条目也要读完，以校验大小与 CRC。 */
export const skipEntry = async (entry: ArchiveEntry): Promise<void> => {
  const reader = entry.stream[Symbol.asyncIterator]()
  while (!(await reader.next()).done) {
    // 丢弃数据。
  }
}
