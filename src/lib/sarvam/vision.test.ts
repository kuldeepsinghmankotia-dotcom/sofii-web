import { describe, it, expect } from 'vitest'
import { collectMarkdown, MAX_PAGES, MAX_FILE_BYTES } from './vision'
import realResponse from './__fixtures__/vision-digitise.json'

// The fixture is an actual Sarvam Vision response, captured from the live
// API by OCRing a mixed Hindi/English invoice. Written down rather than
// invented because the shape was not what the docs implied: results arrive
// as documents[] -> pages[] -> blocks[], gzip-encoded, with a reading_order
// that does not match array order.
describe('collectMarkdown, against a real API response', () => {
  const text = collectMarkdown(realResponse)

  it('extracts the English text', () => {
    expect(text).toContain('Name: Abhinav Rana')
    expect(text).toContain('Date: 22 August 2026')
  })

  it('extracts the Devanagari, which is the whole point', () => {
    expect(text).toContain('राशि: 4,250 रुपये')
    expect(text).toContain('बिल')
  })

  it('does not repeat text that an image block duplicates', () => {
    // The real response carried both "Invoice / बिल" (paragraph) and a
    // separate "बिल" block tagged `image`. Emitting both would feed the
    // duplicate into chunking and embedding.
    const occurrences = text.split('बिल').length - 1
    expect(occurrences).toBe(1)
  })

  it('reads in reading_order', () => {
    expect(text.indexOf('Name: Abhinav Rana')).toBeLessThan(text.indexOf('राशि'))
    expect(text.indexOf('राशि')).toBeLessThan(text.indexOf('Date: 22 August 2026'))
  })
})

describe('collectMarkdown ordering and structure', () => {
  const page = (num: number, blocks: { text: string; order: number; tag?: string }[]) => ({
    page_num: num,
    blocks: blocks.map((b) => ({ text: b.text, reading_order: b.order, layout_tag: b.tag ?? 'paragraph' }))
  })

  it('sorts blocks by reading order, not array order', () => {
    const payload = {
      documents: [{ pages: [page(1, [{ text: 'second', order: 2 }, { text: 'first', order: 1 }])] }]
    }
    expect(collectMarkdown(payload)).toBe('first\nsecond')
  })

  it('sorts pages by page number', () => {
    const payload = {
      documents: [
        { pages: [page(2, [{ text: 'page two', order: 1 }]), page(1, [{ text: 'page one', order: 1 }])] }
      ]
    }
    const out = collectMarkdown(payload)
    expect(out.indexOf('page one')).toBeLessThan(out.indexOf('page two'))
  })

  it('keeps an image block that carries genuinely new text', () => {
    // Deduping is narrow on purpose: a picture with its own content is not
    // a duplicate just because it is a picture.
    const payload = {
      documents: [
        {
          pages: [
            page(1, [
              { text: 'Heading only', order: 1 },
              { text: 'Text inside a diagram', order: 2, tag: 'image' }
            ])
          ]
        }
      ]
    }
    expect(collectMarkdown(payload)).toContain('Text inside a diagram')
  })

  it('handles a multi-document payload', () => {
    const payload = {
      documents: [
        { pages: [page(1, [{ text: 'doc one', order: 1 }])] },
        { pages: [page(1, [{ text: 'doc two', order: 1 }])] }
      ]
    }
    const out = collectMarkdown(payload)
    expect(out).toContain('doc one')
    expect(out).toContain('doc two')
  })
})

describe('collectMarkdown fallbacks', () => {
  it('falls back to a loose walk for an unrecognised shape', () => {
    // An unfamiliar payload should cost formatting, not the document.
    expect(collectMarkdown({ result: { markdown: 'legacy shape' } })).toBe('legacy shape')
    expect(collectMarkdown({ output: [{ text: 'nested text' }] })).toBe('nested text')
  })

  it('returns empty rather than throwing on empty or absent content', () => {
    expect(collectMarkdown({})).toBe('')
    expect(collectMarkdown(null)).toBe('')
    expect(collectMarkdown({ documents: [] })).toBe('')
    expect(collectMarkdown({ usage: { pages_total: 3 } })).toBe('')
  })

  it('ignores blocks with blank text', () => {
    const payload = {
      documents: [
        { pages: [{ page_num: 1, blocks: [{ text: '  ', reading_order: 1 }, { text: 'real', reading_order: 2 }] }] }
      ]
    }
    expect(collectMarkdown(payload)).toBe('real')
  })
})

describe('documented limits', () => {
  it('matches Sarvam Vision’s published ceilings', () => {
    expect(MAX_PAGES).toBe(10)
    expect(MAX_FILE_BYTES).toBe(200 * 1024 * 1024)
  })
})
