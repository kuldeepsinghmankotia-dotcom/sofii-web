// Real photos are the actual root cause of a production bug (found live):
// vision models tokenize images based on resolution, and an unresized
// full-size phone photo alone can exceed Groq's 8000 TPM limit for the
// vision model in a single request — not just an accumulation-over-time
// problem. Resizing to a reasonable max dimension and re-encoding as JPEG
// bounds the cost regardless of the source photo's resolution, and as a
// side effect normalizes formats browsers/Groq can't reliably decode (HEIC
// from iPhones was the format that triggered the original bug) into one
// that both definitely support.
const MAX_DIMENSION = 1280
const JPEG_QUALITY = 0.82

export async function resizeImageToJpeg(file: File): Promise<File> {
  let bitmap: ImageBitmap
  try {
    bitmap = await createImageBitmap(file)
  } catch {
    throw new Error(
      `Could not read "${file.name}" as an image — this format (e.g. HEIC from an iPhone) may not be supported. Try JPG, PNG, or WEBP instead.`
    )
  }

  const scale = Math.min(1, MAX_DIMENSION / Math.max(bitmap.width, bitmap.height))
  const width = Math.round(bitmap.width * scale)
  const height = Math.round(bitmap.height * scale)

  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d')
  if (!ctx) {
    bitmap.close()
    throw new Error('Image resizing is not supported in this browser.')
  }
  ctx.drawImage(bitmap, 0, 0, width, height)
  bitmap.close()

  const blob = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob(resolve, 'image/jpeg', JPEG_QUALITY)
  )
  if (!blob) throw new Error('Could not encode the resized image.')

  const newName = file.name.replace(/\.[^.]+$/, '') + '.jpg'
  return new File([blob], newName, { type: 'image/jpeg' })
}
