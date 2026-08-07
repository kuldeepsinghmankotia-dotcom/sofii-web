import { ImageResponse } from 'next/og'
import type { NextRequest } from 'next/server'

// Backs manifest.ts's icons array. A query-param'd route (rather than a
// couple of static PNG files) so every install-icon size renders from the
// same gradient-orb definition as the rest of the UI instead of a
// hand-exported asset silently drifting from --accent-gradient over time.
// maskable=1 shrinks the orb further inside the canvas — Android/iOS crop
// maskable icons to a circle/squircle themselves, and without that safe
// margin the orb's edges get clipped.
export async function GET(request: NextRequest): Promise<ImageResponse> {
  const { searchParams } = new URL(request.url)
  const size = searchParams.get('size') === '192' ? 192 : 512
  const maskable = searchParams.get('maskable') === '1'
  const orbSize = Math.round(size * (maskable ? 0.55 : 0.72))

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
            width: orbSize,
            height: orbSize,
            borderRadius: '50%',
            display: 'flex',
            background: 'linear-gradient(135deg, #22d3ee, #8b5cf6)'
          }}
        />
      </div>
    ),
    { width: size, height: size }
  )
}
