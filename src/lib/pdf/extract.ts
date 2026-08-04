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
