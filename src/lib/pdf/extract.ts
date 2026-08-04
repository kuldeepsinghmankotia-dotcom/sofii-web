import path from 'path'

// pdf-parse depends on @napi-rs/canvas (a native module) to polyfill
// DOMMatrix/ImageData/Path2D for pdf.js's rendering code paths. That native
// binary doesn't survive Vercel's serverless file-tracing once pdf-parse is
// externalized (verified live: worked locally where the package happened to
// be present, then failed in production with "DOMMatrix is not defined").
// Only getText() is used here — no rendering — so minimal stubs are enough
// to satisfy pdf.js's typeof checks without needing the real polyfill.
//
// These must be set before pdf-parse is ever imported, not just before it's
// *used* — a static `import ... from 'pdf-parse'` at the top of this file
// would be hoisted and evaluated before any of this code runs regardless of
// source order, which is exactly what broke the first attempt at this fix
// (pdfjs-dist's own module-level code threw before the stubs existed). A
// dynamic import(), by contrast, genuinely only runs when awaited.
for (const name of ['DOMMatrix', 'ImageData', 'Path2D'] as const) {
  if (typeof (globalThis as Record<string, unknown>)[name] === 'undefined') {
    ;(globalThis as Record<string, unknown>)[name] = class {}
  }
}

let pdfParsePromise: Promise<typeof import('pdf-parse')> | undefined

async function loadPDFParse(): Promise<typeof import('pdf-parse').PDFParse> {
  if (!pdfParsePromise) {
    pdfParsePromise = import('pdf-parse')
  }
  const { PDFParse } = await pdfParsePromise

  // pdf-parse (via pdfjs-dist) computes its worker script path relative to
  // its own bundled location by default, which breaks under Turbopack's
  // server bundling — verified in two stages: first it looked inside
  // .next/dev/server/chunks/ (doesn't exist there), and even after
  // excluding pdf-parse/pdfjs-dist from bundling via serverExternalPackages,
  // resolving the path via require.resolve()/import.meta.url still came
  // back as the literal string "[project]" (a Turbopack-internal
  // placeholder leaking through). A plain path.join from process.cwd()
  // avoids any bundler-sensitive resolution mechanism entirely.
  PDFParse.setWorker(
    path.join(process.cwd(), 'node_modules/pdfjs-dist/legacy/build/pdf.worker.mjs')
  )

  return PDFParse
}

/**
 * Extracts plain text from a PDF buffer. Throws on a corrupt/invalid file
 * (InvalidPDFException etc. from pdf-parse) — the caller decides how to
 * surface that to the user.
 */
export async function extractPdfText(buffer: Buffer): Promise<string> {
  const PDFParse = await loadPDFParse()
  const parser = new PDFParse({ data: buffer })
  try {
    const result = await parser.getText()
    return result.text
  } finally {
    await parser.destroy()
  }
}
