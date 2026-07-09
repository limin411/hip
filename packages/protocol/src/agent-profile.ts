/** Agent profile info advertised to the UI. */
export interface AgentProfileInfo {
  id: string
  name: string
  description?: string
  mode: 'primary' | 'subagent'
}
