import { ImageResponse } from 'next/og'

// Supplements the static favicon.ico with a PNG that actually matches the
// brand (favicon.ico is still the framework-default triangle — Next can't
// code-generate .ico files, only .png/.svg via this convention).
export const size = { width: 32, height: 32 }
export const contentType = 'image/png'

export default function Icon(): ImageResponse {
  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          borderRadius: '50%',
          display: 'flex',
          background: 'linear-gradient(135deg, #22d3ee, #8b5cf6)'
        }}
      />
    ),
    { ...size }
  )
}
