import type { ZoneId } from '../workbenchTypes'

/**
 * Detailed pixel landmarks per surface (inline SVG, crisp edges).
 */
export function PlotBuilding({ zoneId }: { zoneId: ZoneId }) {
  return (
    <div className={`px-build px-build--${zoneId}`} aria-hidden data-zone={zoneId}>
      {zoneId === 'sessions' && <SessionsTent />}
      {zoneId === 'tasks' && <TasksCrate />}
      {zoneId === 'automations' && <AutoWindmill />}
      {zoneId === 'knowledge' && <KnowledgeShelf />}
      {zoneId === 'terminals' && <TerminalsDesk />}
      {zoneId === 'workflows' && <WorkflowGate />}
    </div>
  )
}

function SessionsTent() {
  return (
    <svg className="px-build-svg" viewBox="0 0 64 56" width="64" height="56" shapeRendering="crispEdges">
      <rect x="28" y="40" width="8" height="12" fill="#6b4423" />
      <polygon points="32,4 58,38 6,38" fill="var(--plot-accent)" />
      <polygon points="32,10 50,36 14,36" fill="color-mix(in srgb, var(--plot-accent) 70%, #fff)" />
      <rect x="22" y="38" width="20" height="14" fill="#f0e0c0" stroke="#3d2914" strokeWidth="2" />
      <rect x="28" y="42" width="8" height="10" fill="#3d2914" />
      <rect x="8" y="36" width="6" height="4" fill="#ffe566" />
      <rect x="50" y="34" width="5" height="4" fill="#fff8ee" opacity="0.85" />
    </svg>
  )
}

function TasksCrate() {
  return (
    <svg className="px-build-svg" viewBox="0 0 64 56" width="64" height="56" shapeRendering="crispEdges">
      <rect x="10" y="22" width="44" height="28" fill="#c48a4a" stroke="#5a3210" strokeWidth="2" />
      <rect x="10" y="22" width="44" height="6" fill="#d4a060" />
      <rect x="10" y="34" width="44" height="3" fill="#8b5a2b" />
      <rect x="18" y="14" width="10" height="10" fill="var(--plot-accent)" stroke="#3d2914" strokeWidth="2" />
      <rect x="30" y="10" width="12" height="14" fill="#e8c878" stroke="#3d2914" strokeWidth="2" />
      <rect x="36" y="28" width="8" height="8" fill="#fff6d0" stroke="#3d2914" strokeWidth="1" />
      <path d="M14 48h36" stroke="#5a3210" strokeWidth="2" />
    </svg>
  )
}

function AutoWindmill() {
  return (
    <svg className="px-build-svg" viewBox="0 0 64 56" width="64" height="56" shapeRendering="crispEdges">
      <rect x="26" y="24" width="12" height="28" fill="#8a9098" stroke="#3a4048" strokeWidth="2" />
      <rect x="22" y="44" width="20" height="8" fill="#6b4423" stroke="#3d2914" strokeWidth="2" />
      <g className="px-mill-blades">
        <rect x="30" y="4" width="4" height="22" fill="var(--plot-accent)" />
        <rect x="18" y="14" width="28" height="4" fill="var(--plot-accent)" />
      </g>
      <rect x="28" y="14" width="8" height="8" fill="#f0e0c0" stroke="#3d2914" strokeWidth="2" />
      <rect x="28" y="30" width="8" height="6" fill="#1a2a1a" />
    </svg>
  )
}

function KnowledgeShelf() {
  return (
    <svg className="px-build-svg" viewBox="0 0 64 56" width="64" height="56" shapeRendering="crispEdges">
      <rect x="8" y="12" width="48" height="40" fill="#8b5a2b" stroke="#4a2e12" strokeWidth="2" />
      <rect x="10" y="14" width="44" height="3" fill="#6b4423" />
      <rect x="10" y="30" width="44" height="3" fill="#6b4423" />
      <rect x="12" y="18" width="7" height="11" fill="#e74c3c" />
      <rect x="21" y="17" width="6" height="12" fill="#3498db" />
      <rect x="29" y="19" width="8" height="10" fill="#2ecc71" />
      <rect x="39" y="18" width="6" height="11" fill="#f1c40f" />
      <rect x="47" y="17" width="5" height="12" fill="#9b59b6" />
      <rect x="14" y="35" width="8" height="14" fill="#e67e22" />
      <rect x="24" y="34" width="6" height="15" fill="#1abc9c" />
      <rect x="32" y="36" width="10" height="13" fill="#c0392b" />
      <rect x="44" y="35" width="7" height="14" fill="#2980b9" />
      <rect x="18" y="4" width="28" height="8" fill="var(--plot-accent)" stroke="#3d2914" strokeWidth="2" />
    </svg>
  )
}

function TerminalsDesk() {
  return (
    <svg className="px-build-svg" viewBox="0 0 64 56" width="64" height="56" shapeRendering="crispEdges">
      <rect x="6" y="38" width="52" height="12" fill="#6b4a28" stroke="#3a2810" strokeWidth="2" />
      <rect x="10" y="48" width="6" height="6" fill="#4a3018" />
      <rect x="48" y="48" width="6" height="6" fill="#4a3018" />
      <rect x="16" y="14" width="32" height="24" fill="#1a2420" stroke="#0a1010" strokeWidth="2" />
      <rect x="20" y="18" width="24" height="14" fill="#0d1f12" />
      <rect x="22" y="20" width="4" height="2" fill="#3d8f45" />
      <rect x="22" y="24" width="12" height="2" fill="#3d8f45" />
      <rect x="22" y="28" width="8" height="2" fill="#3d8f45" />
      <rect x="28" y="36" width="8" height="3" fill="#4a4a4a" />
      <rect x="44" y="32" width="10" height="6" fill="#c0c0c0" stroke="#3d2914" strokeWidth="1" />
      <rect x="8" y="30" width="6" height="8" fill="var(--plot-accent)" />
    </svg>
  )
}

function WorkflowGate() {
  return (
    <svg className="px-build-svg" viewBox="0 0 64 56" width="64" height="56" shapeRendering="crispEdges">
      <rect x="6" y="10" width="8" height="42" fill="#8b6340" stroke="#4a3018" strokeWidth="2" />
      <rect x="50" y="10" width="8" height="42" fill="#8b6340" stroke="#4a3018" strokeWidth="2" />
      <rect x="6" y="14" width="52" height="6" fill="#6b4423" stroke="#3d2914" strokeWidth="2" />
      <rect x="14" y="28" width="36" height="5" fill="var(--plot-accent)" stroke="#3d2914" strokeWidth="2" />
      <rect x="22" y="36" width="6" height="6" fill="#f0e0c0" />
      <rect x="36" y="36" width="6" height="6" fill="#f0e0c0" />
      <polygon points="32,4 40,14 24,14" fill="#e74c3c" />
    </svg>
  )
}
