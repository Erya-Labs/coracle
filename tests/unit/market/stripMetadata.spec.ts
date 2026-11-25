import {describe, expect, it} from "vitest"
import {stripMetadata} from "src/util/stripMetadata"

const ascii = (s: string) => Array.from(s, c => c.charCodeAt(0))

const segment = (marker: number, payload: number[]) => [
  0xff,
  marker,
  (payload.length + 2) >> 8,
  (payload.length + 2) & 0xff,
  ...payload,
]

// Exif with IFD0 holding Orientation = 6 and a fake GPS note after it.
// prettier-ignore
const exif = (littleEndian: boolean) => {
  const tiff = littleEndian
    ? [0x49, 0x49, 0x2a, 0x00, 0x08, 0x00, 0x00, 0x00, 0x01, 0x00, 0x12, 0x01, 0x03, 0x00, 0x01, 0x00, 0x00, 0x00, 0x06, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00]
    : [0x4d, 0x4d, 0x00, 0x2a, 0x00, 0x00, 0x00, 0x08, 0x00, 0x01, 0x01, 0x12, 0x00, 0x03, 0x00, 0x00, 0x00, 0x01, 0x00, 0x06, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00]

  return [...ascii("Exif\0\0"), ...tiff, ...ascii("GPS 35.68N 139.69E")]
}

const SOI = [0xff, 0xd8]
const EOI = [0xff, 0xd9]
// A scan header and entropy-coded data holding a stuffed FF 00 and a restart marker.
const scan = [0xff, 0xda, 0x00, 0x04, 0x01, 0x02, 0xaa, 0xff, 0x00, 0xbb, 0xff, 0xd0, 0xcc]
const jfif = segment(0xe0, ascii("JFIF\0\x01\x01\0\0\x01\0\x01\0\0"))
const text = (bytes: Uint8Array) => String.fromCharCode(...bytes)

describe("stripping JPEG metadata", () => {
  for (const little of [true, false]) {
    it(`drops Exif, XMP, IPTC and comments and keeps the orientation (${little ? "little" : "big"}-endian)`, () => {
      const input = new Uint8Array([
        ...SOI,
        ...jfif,
        ...segment(0xe1, exif(little)),
        ...segment(0xe1, ascii("http://ns.adobe.com/xap/1.0/\0<x:xmpmeta>Pixel 9</x:xmpmeta>")),
        ...segment(0xed, ascii("Photoshop 3.0\0IPTC")),
        ...segment(0xfe, ascii("taken at home")),
        ...segment(0xdb, [0x00, 1, 2, 3]),
        ...scan,
        ...EOI,
      ])
      const out = stripMetadata(input)

      expect(out.format).toBe("jpeg")
      expect(out.checked).toBe(true)
      expect(out.removed).toBe(4)
      expect(text(out.bytes)).not.toMatch(/GPS|Pixel 9|IPTC|taken at home/)
      // SOI, JFIF first, then the orientation-only Exif, then the rest untouched.
      expect(Array.from(out.bytes.subarray(0, 2 + jfif.length))).toEqual([...SOI, ...jfif])
      expect(out.bytes[2 + jfif.length + 1]).toBe(0xe1)
      expect(out.bytes[2 + jfif.length + 29]).toBe(6)
      expect(Array.from(out.bytes.subarray(out.bytes.length - scan.length - 2))).toEqual([
        ...scan,
        ...EOI,
      ])
    })
  }

  it("adds no orientation segment when the photo is upright", () => {
    const input = new Uint8Array([...SOI, ...segment(0xfe, ascii("note")), ...scan, ...EOI])

    expect(Array.from(stripMetadata(input).bytes)).toEqual([...SOI, ...scan, ...EOI])
  })

  it("drops everything after the end of the image: phone trailers, motion video, extra images", () => {
    const trailer = [
      ...ascii("SEFH Image_UTC_Data1732579200000 MCC_Data440"),
      ...SOI,
      ...segment(0xe1, exif(true)),
      ...EOI,
      ...ascii("ftypmp42 moov mvhd"),
    ]
    const input = new Uint8Array([...SOI, ...scan, ...EOI, ...trailer])
    const out = stripMetadata(input)

    expect(Array.from(out.bytes)).toEqual([...SOI, ...scan, ...EOI])
    expect(out.removed).toBe(1)
  })

  it("keeps only the colour profile and Adobe parts of the other application segments", () => {
    const icc = segment(0xe2, ascii("ICC_PROFILE\0\x01\x01profile"))
    const adobe = segment(0xee, ascii("Adobe\0\x64\0\0\0\0\x01"))
    const input = new Uint8Array([
      ...SOI,
      ...icc,
      ...segment(0xe2, ascii("MPF\0index of a second image")),
      ...segment(0xeb, ascii("JP\0\0c2pa provenance by Pixel 9")),
      ...segment(0xe3, ascii("Meta camera maker data")),
      ...adobe,
      ...scan,
      ...EOI,
    ])
    const out = stripMetadata(input)

    expect(out.removed).toBe(3)
    expect(Array.from(out.bytes)).toEqual([...SOI, ...icc, ...adobe, ...scan, ...EOI])
  })

  it("cleans the segments between the scans of a progressive JPEG", () => {
    const dht = segment(0xc4, [0x00, 0x01, 0x02])
    const input = new Uint8Array([
      ...SOI,
      ...scan,
      ...dht,
      ...segment(0xe1, exif(false)),
      ...segment(0xfe, ascii("second-scan comment")),
      ...scan,
      ...EOI,
    ])
    const out = stripMetadata(input)

    expect(out.removed).toBe(2)
    expect(text(out.bytes)).not.toMatch(/GPS|comment/)
    expect(Array.from(out.bytes)).toEqual([
      ...SOI,
      ...orientationOnly(6),
      ...scan,
      ...dht,
      ...scan,
      ...EOI,
    ])
  })

  it("names a JPEG by its first bytes whatever it is called", () => {
    const input = new Uint8Array([...SOI, ...segment(0xfe, ascii("x")), ...scan, ...EOI])

    expect(stripMetadata(input).format).toBe("jpeg")
  })

  it("reports a JPEG it cannot parse as not checked", () => {
    const truncated = new Uint8Array([...SOI, 0xff, 0xe1, 0x00, 0x40, 0x01])
    const noEnd = new Uint8Array([...SOI, ...scan])

    expect(stripMetadata(truncated)).toEqual({
      bytes: truncated,
      removed: 0,
      checked: false,
      format: "jpeg",
    })
    expect(stripMetadata(noEnd).checked).toBe(false)
  })
})

// prettier-ignore
const orientationOnly = (o: number) => [
  0xff, 0xe1, 0x00, 0x22, ...ascii("Exif\0\0"), 0x4d, 0x4d, 0x00, 0x2a, 0x00, 0x00, 0x00, 0x08,
  0x00, 0x01, 0x01, 0x12, 0x00, 0x03, 0x00, 0x00, 0x00, 0x01, 0x00, o, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
]

describe("stripping PNG metadata", () => {
  const signature = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]
  const chunk = (type: string, data: number[]) => [
    ...[0, 0, 0, data.length],
    ...ascii(type),
    ...data,
    ...[0xde, 0xad, 0xbe, 0xef],
  ]
  const ihdr = chunk("IHDR", Array(13).fill(1))
  const srgb = chunk("sRGB", [0])
  const idat = chunk("IDAT", [9, 8, 7])
  const iend = chunk("IEND", [])

  it("keeps the image chunks and drops text, Exif, time, provenance and unknown chunks", () => {
    const input = new Uint8Array([
      ...signature,
      ...ihdr,
      ...chunk("tEXt", ascii("Author\0me")),
      ...chunk("eXIf", ascii("GPS")),
      ...chunk("tIME", [7, 234, 11, 25, 12, 0, 0]),
      ...srgb,
      ...chunk("caBX", ascii("c2pa Pixel 9")),
      ...idat,
      ...chunk("iTXt", ascii("XML:com.adobe.xmp\0\0\0\0\0Pixel")),
      ...iend,
      ...ascii("trailing camera data"),
    ])
    const out = stripMetadata(input)

    expect(out.format).toBe("png")
    expect(out.removed).toBe(6)
    expect(Array.from(out.bytes)).toEqual([...signature, ...ihdr, ...srgb, ...idat, ...iend])
  })

  it("reports a PNG it cannot parse as not checked", () => {
    const truncated = new Uint8Array([...signature, ...ihdr.slice(0, 10)])

    expect(stripMetadata(truncated).checked).toBe(false)
    expect(stripMetadata(truncated).format).toBe("png")
  })
})

describe("other files", () => {
  it("leaves them as they are", () => {
    const other = new Uint8Array([1, 2, 3])

    expect(stripMetadata(other)).toEqual({bytes: other, removed: 0, checked: false, format: null})
  })
})
