// NENYA-1 §10: the provider strips identifying metadata before a file is locked. A phone photo
// carries the place, the time and the phone model; this removes them from JPEG and PNG files
// without touching a single pixel. Both formats are cleaned by keeping only the parts a picture
// needs and dropping everything else, including any data after the end of the image (phone
// trailers, motion-photo video, extra images). A JPEG keeps its orientation, so it is not shown
// sideways. The format is told from the file's first bytes, not from its claimed type.
//
// format names a JPEG or PNG found by its first bytes; checked is false when such a file could
// not be parsed, and then the caller must not send it as cleaned.

export type Stripped = {
  bytes: Uint8Array
  removed: number
  checked: boolean
  format: "jpeg" | "png" | null
}

const concat = (parts: Uint8Array[]) => {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0))
  let at = 0

  for (const p of parts) {
    out.set(p, at)
    at += p.length
  }

  return out
}

const startsWith = (bytes: Uint8Array, text: string) =>
  bytes.length >= text.length && Array.from(text).every((c, i) => bytes[i] === c.charCodeAt(0))

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]

const isJpeg = (b: Uint8Array) => b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff
const isPng = (b: Uint8Array) => b.length >= 8 && PNG_SIGNATURE.every((v, i) => b[i] === v)

// --- JPEG ------------------------------------------------------------------------------

// The orientation (1-8) from an Exif APP1 payload, or 0 when there is none.
const exifOrientation = (payload: Uint8Array) => {
  // "Exif\0\0" then a TIFF header.
  if (payload.length < 14 || !startsWith(payload, "Exif\0\0")) return 0

  const t = payload.subarray(6)
  const little = t[0] === 0x49 && t[1] === 0x49
  const u16 = (i: number) => (little ? t[i] | (t[i + 1] << 8) : (t[i] << 8) | t[i + 1])
  const u32 = (i: number) =>
    little
      ? (t[i] | (t[i + 1] << 8) | (t[i + 2] << 16) | (t[i + 3] << 24)) >>> 0
      : ((t[i] << 24) | (t[i + 1] << 16) | (t[i + 2] << 8) | t[i + 3]) >>> 0
  const ifd = u32(4)

  if (ifd + 2 > t.length) return 0

  const count = u16(ifd)

  for (let n = 0; n < count; n++) {
    const entry = ifd + 2 + n * 12

    if (entry + 12 > t.length) return 0
    if (u16(entry) === 0x0112) {
      const value = u16(entry + 8)

      return value >= 1 && value <= 8 ? value : 0
    }
  }

  return 0
}

// A minimal APP1 segment holding only the orientation tag.
// prettier-ignore
const orientationSegment = (orientation: number) =>
  new Uint8Array([
    0xff, 0xe1, 0x00, 0x22, // APP1, length 34
    0x45, 0x78, 0x69, 0x66, 0x00, 0x00, // "Exif\0\0"
    0x4d, 0x4d, 0x00, 0x2a, 0x00, 0x00, 0x00, 0x08, // big-endian TIFF, IFD0 at 8
    0x00, 0x01, // one entry
    0x01, 0x12, 0x00, 0x03, 0x00, 0x00, 0x00, 0x01, // Orientation, SHORT, count 1
    0x00, orientation, 0x00, 0x00, // value
    0x00, 0x00, 0x00, 0x00, // no next IFD
  ])

// Application segments (APP0-APP15) and comments are dropped unless the picture needs them:
// APP0 (JFIF), an ICC colour profile in APP2, and Adobe's colour transform in APP14.
const keepApplicationSegment = (marker: number, payload: Uint8Array) =>
  marker === 0xe0 ||
  (marker === 0xe2 && startsWith(payload, "ICC_PROFILE\0")) ||
  (marker === 0xee && startsWith(payload, "Adobe"))

const stripJpeg = (b: Uint8Array): Omit<Stripped, "format"> | null => {
  const kept: Uint8Array[] = [b.subarray(0, 2)]
  let removed = 0
  let orientation = 0
  let at = 2

  while (at + 1 < b.length) {
    if (b[at] !== 0xff) return null

    // Fill bytes before a marker.
    while (at + 1 < b.length && b[at + 1] === 0xff) at++

    const marker = b[at + 1]

    // End of image: everything after it is dropped.
    if (marker === 0xd9) {
      kept.push(b.subarray(at, at + 2))

      if (at + 2 < b.length) removed++

      // JFIF wants its APP0 first, so the orientation goes right after it.
      if (orientation > 1) {
        const after = kept.length > 1 && kept[1][1] === 0xe0 ? 2 : 1

        kept.splice(after, 0, orientationSegment(orientation))
      }

      return {bytes: concat(kept), removed, checked: true}
    }

    // Markers without a length.
    if ((marker >= 0xd0 && marker <= 0xd7) || marker === 0x01) {
      kept.push(b.subarray(at, at + 2))
      at += 2
      continue
    }

    if (at + 4 > b.length) return null

    const length = (b[at + 2] << 8) | b[at + 3]

    if (length < 2 || at + 2 + length > b.length) return null

    const segment = b.subarray(at, at + 2 + length)

    if ((marker >= 0xe0 && marker <= 0xef) || marker === 0xfe) {
      if (keepApplicationSegment(marker, segment.subarray(4))) {
        kept.push(segment)
      } else {
        if (marker === 0xe1 && !orientation) orientation = exifOrientation(segment.subarray(4))
        removed++
      }
    } else {
      kept.push(segment)
    }

    at += 2 + length

    // Start of scan: entropy-coded data runs to the next marker. In it, FF 00 is a stuffed
    // byte and FF D0-D7 are restart markers; any other FF xx ends the scan.
    if (marker === 0xda) {
      const start = at

      while (at + 1 < b.length) {
        if (b[at] === 0xff && b[at + 1] !== 0x00 && !(b[at + 1] >= 0xd0 && b[at + 1] <= 0xd7)) {
          if (b[at + 1] !== 0xff) break
        }

        at++
      }

      if (at + 1 >= b.length) return null

      kept.push(b.subarray(start, at))
    }
  }

  return null
}

// --- PNG -------------------------------------------------------------------------------

// Every critical chunk is kept; of the ancillary ones, only those that describe the image.
const PNG_KEEP = new Set([
  "tRNS",
  "cHRM",
  "gAMA",
  "iCCP",
  "sBIT",
  "sRGB",
  "cICP",
  "mDCV",
  "cLLI",
  "bKGD",
  "hIST",
  "pHYs",
  "acTL",
  "fcTL",
  "fdAT",
])

const stripPng = (b: Uint8Array): Omit<Stripped, "format"> | null => {
  const kept: Uint8Array[] = [b.subarray(0, 8)]
  let removed = 0
  let at = 8

  while (at + 12 <= b.length) {
    const length = ((b[at] << 24) | (b[at + 1] << 16) | (b[at + 2] << 8) | b[at + 3]) >>> 0
    const type = String.fromCharCode(...b.subarray(at + 4, at + 8))
    const end = at + 12 + length

    if (end > b.length) return null

    const critical = type.charCodeAt(0) >= 0x41 && type.charCodeAt(0) <= 0x5a

    if (critical || PNG_KEEP.has(type)) kept.push(b.subarray(at, end))
    else removed++

    at = end

    if (type === "IEND") {
      if (at < b.length) removed++

      return {bytes: concat(kept), removed, checked: true}
    }
  }

  return null
}

export const stripMetadata = (bytes: Uint8Array): Stripped => {
  if (isJpeg(bytes)) {
    return {...(stripJpeg(bytes) ?? {bytes, removed: 0, checked: false}), format: "jpeg"}
  }

  if (isPng(bytes)) {
    return {...(stripPng(bytes) ?? {bytes, removed: 0, checked: false}), format: "png"}
  }

  return {bytes, removed: 0, checked: false, format: null}
}
