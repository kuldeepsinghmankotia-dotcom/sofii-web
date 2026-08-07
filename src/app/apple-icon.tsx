import { ImageResponse } from 'next/og'

// The actual icon iOS shows on the home screen after "Add to Home Screen" —
// full-bleed, no transparency (iOS applies its own corner rounding on top,
// so a transparent background here would show through as black/white).
export const size = { width: 180, height: 180 }
export const contentType = 'image/png'

export default function AppleIcon(): ImageResponse {
  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: '#05060b'
        }}
      >
        <div
          style={{
            width: 128,
            height: 128,
            borderRadius: '50%',
            display: 'flex',
            background: 'linear-gradient(135deg, #22d3ee, #8b5cf6)'
          }}
        />
      </div>
    ),
    { ...size }
  )
}
