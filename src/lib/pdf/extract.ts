import path from 'path'
import { PDFParse } from 'pdf-parse'

// pdf-parse (via pdfjs-dist) computes its worker script path relative to its
// own bundled location by default, which breaks under Next.js/Turbopack's
// server bundling — verified in two stages: first it looked inside
// .next/dev/server/chunks/ (doesn't exist there), and even after excluding
// pdf-parse/pdfjs-dist from bundling via serverExternalPackages, resolving
// the path via require.resolve()/import.meta.url still came back as the
// literal string "[project]" (a Turbopack-internal placeholder leaking
// through). A plain path.join from process.cwd() avoids any
// bundler-sensitive resolution mechanism entirely.
PDFParse.setWorker(
  path.join(process.cwd(), 'node_modules/pdfjs-dist/legacy/build/pdf.worker.mjs')
)

// pdf-parse depends on @napi-rs/canvas (a native module) to polyfill
// DOMMatrix/ImageData/Path2D for rendering-related code paths. That native
// binary doesn't survive Vercel's serverless file-tracing once pdf-parse is
// externalized (verified live: worked locally where the package happened to
// be present, then failed in production with "DOMMatrix is not defined").
// Only getText() is used here — no rendering — so minimal stubs are enough
// to satisfy pdf.js's typeof checks without needing the real polyfill at all.
for (const name of ['DOMMatrix', 'ImageData', 'Path2D'] as const) {
  if (typeof (globalThis as Record<string, unknown>)[name] === 'undefined') {
    ;(globalThis as Record<string, unknown>)[name] = class {}
  }
}

/**
 * Extracts plain text from a PDF buffer. Throws on a corrupt/invalid file
 * (InvalidPDFException etc. from pdf-parse) — the caller decides how to
 * surface that to the user.
 */
export async function extractPdfText(buffer: Buffer): Promise<string> {
  const parser = new PDFParse({ data: buffer })
  try {
    const result = await parser.getText()
    return result.text
  } finally {
    await parser.destroy()
  }
}
