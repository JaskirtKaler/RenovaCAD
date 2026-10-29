import { axisScreenVectors, cameraDirection, type Camera } from '../viewport'

interface AxisIndicatorProps {
  camera: Camera
}

export function AxisIndicator({ camera }: AxisIndicatorProps) {
  const size = 72
  const center = size / 2
  const axisLen = 20
  const colors: Record<string, string> = { X: '#ff453a', Y: '#30d158', Z: '#0a84ff' }
  const axes: { label: 'X' | 'Y' | 'Z'; vec: { x: number; y: number; z: number } }[] = [
    { label: 'X', vec: { x: 1, y: 0, z: 0 } },
    { label: 'Y', vec: { x: 0, y: 1, z: 0 } },
    { label: 'Z', vec: { x: 0, y: 0, z: 1 } },
  ]
  const vecs = axisScreenVectors(camera)
  const dir = cameraDirection(camera)
  // Map label to screen vector and depth
  const items = axes.map((a) => {
    const v = a.label === 'X' ? vecs.x : a.label === 'Y' ? vecs.y : vecs.z
    const len = Math.hypot(v.x, v.y)
    const depth = a.vec.x * dir.x + a.vec.y * dir.y + a.vec.z * dir.z
    return { label: a.label, v, len, depth }
  })
  // Draw back-to-front
  const sorted = [...items].sort((a, b) => a.depth - b.depth)
  const shortThreshold = 0.18

  return (
    <div
      className="axis-indicator"
      role="img"
      aria-label="Orientation indicator: X right, Y up, Z forward in world coordinates. View follows camera."
      title="X: width (right) · Y: height (up) · Z: depth (forward)"
    >
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden="true">
        {/* subtle background for contrast, no border */}
        <circle cx={center} cy={center} r={center - 2} fill="#0e1110" opacity={0.92} />
        {/* center dot */}
        <circle cx={center} cy={center} r={1.4} fill="#cbd8ce" opacity={0.9} />
        {sorted.map(({ label, v, len, depth }) => {
          const isShort = len < shortThreshold
          const nx = len > 0.0001 ? (v.x / len) * axisLen : 0
          const ny = len > 0.0001 ? (v.y / len) * axisLen : 0
          const x2 = center + nx
          const y2 = center + ny
          const toward = depth > 0.1
          const color = colors[label]
          if (isShort) {
            // Small dot indicator when axis points toward/away from viewer
            const dotR = toward ? 4.2 : 3.6
            const labelOffset = 11
            const lx = center + (len > 0.0001 ? (v.x / len) * (axisLen + labelOffset) : 0)
            const ly = center + (len > 0.0001 ? (v.y / len) * (axisLen + labelOffset) : -axisLen - labelOffset)
            // Even when len ~0, keep label slightly offset to avoid overlap; use depth-based quadrant
            const lx2 = len < 0.01 ? center + (label === 'X' ? 14 : label === 'Z' ? -14 : 0) : lx
            const ly2 = len < 0.01 ? center + (label === 'Y' ? -14 : label === 'X' ? 4 : 4) : ly
            return (
              <g key={label}>
                <circle
                  cx={x2}
                  cy={y2}
                  r={dotR}
                  fill={toward ? color : 'none'}
                  stroke={color}
                  strokeWidth={toward ? 1.2 : 1.6}
                  opacity={toward ? 0.95 : 0.85}
                />
                {toward && <circle cx={x2} cy={y2} r={1.2} fill="#fff" opacity={0.95} />}
                <g>
                  <text
                    x={lx2}
                    y={ly2}
                    dy={3.2}
                    textAnchor="middle"
                    fontSize={8.5}
                    fontWeight={700}
                    fill={color}
                    stroke="#0e1110"
                    strokeWidth={3}
                    paintOrder="stroke"
                    fontFamily="ui-monospace, monospace"
                  >
                    {label}
                  </text>
                </g>
              </g>
            )
          }
          // Normal arrow: line + arrowhead triangle
          const angle = Math.atan2(ny, nx)
          const headLen = 7
          const headWidth = 5.5
          const tipX = x2
          const tipY = y2
          const baseX = tipX - Math.cos(angle) * headLen
          const baseY = tipY - Math.sin(angle) * headLen
          const perpX = -Math.sin(angle)
          const perpY = Math.cos(angle)
          const p1x = baseX + perpX * headWidth * 0.5
          const p1y = baseY + perpY * headWidth * 0.5
          const p2x = baseX - perpX * headWidth * 0.5
          const p2y = baseY - perpY * headWidth * 0.5
          const labelDist = 10
          const lx = tipX + Math.cos(angle) * labelDist
          const ly = tipY + Math.sin(angle) * labelDist
          // Clamp label inside view
          const clampedLx = Math.max(10, Math.min(size - 10, lx))
          const clampedLy = Math.max(10, Math.min(size - 10, ly))
          return (
            <g key={label}>
              <line x1={center} y1={center} x2={baseX} y2={baseY} stroke={color} strokeWidth={2} strokeLinecap="round" opacity={0.98} />
              <polygon points={`${tipX},${tipY} ${p1x},${p1y} ${p2x},${p2y}`} fill={color} stroke={color} strokeLinejoin="round" opacity={0.98} />
              <text
                x={clampedLx}
                y={clampedLy}
                dy={3}
                textAnchor="middle"
                fontSize={8.5}
                fontWeight={700}
                fill={color}
                stroke="#0e1110"
                strokeWidth={3}
                paintOrder="stroke"
                fontFamily="ui-monospace, monospace"
              >
                {label}
              </text>
            </g>
          )
        })}
      </svg>
    </div>
  )
}
