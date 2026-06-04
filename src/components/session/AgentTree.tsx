import type { AgentState } from '../../store/sessionStore'

interface Props {
  agents: AgentState[]
}

export function AgentTree({ agents }: Props) {
  if (agents.length === 0) return null

  return (
    <div style={{ borderTop: '1px solid #1a1a1a', padding: '8px 16px', fontSize: 12, color: '#555' }}>
      {agents.map((a) => (
        <div key={a.id} style={{ display: 'flex', gap: 10, marginBottom: 2, alignItems: 'baseline' }}>
          <span style={{ color: '#6c63ff', minWidth: 70 }}>[{a.role}]</span>
          <span style={{ color: a.status === 'running' ? '#3adc8c' : '#444' }}>{a.status}</span>
          {a.tokens && (
            <span
              style={{
                color: '#888',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
                maxWidth: 400,
              }}
            >
              {a.tokens.slice(-80)}
            </span>
          )}
        </div>
      ))}
    </div>
  )
}
