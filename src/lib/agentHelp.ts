export type HelpStatus = 'available' | 'coming-soon'

/** `as const` keeps every i18n key a string literal so typed-t() accepts it. */
export const HELP_SECTIONS = [
  { id: 'overview', status: 'available', titleKey: 'settings.agents.help.overviewTitle', bodyKeys: ['settings.agents.help.overviewBody1', 'settings.agents.help.overviewBody2'] },
  { id: 'internal', status: 'available', titleKey: 'settings.agents.help.internalTitle', bodyKeys: ['settings.agents.help.internalBody1', 'settings.agents.help.internalBody2'] },
  { id: 'cli', status: 'available', titleKey: 'settings.agents.help.cliTitle', bodyKeys: ['settings.agents.help.cliBody1', 'settings.agents.help.cliBody2'] },
  { id: 'acp', status: 'available', titleKey: 'settings.agents.help.acpTitle', bodyKeys: ['settings.agents.help.acpBody1', 'settings.agents.help.acpBody2'] },
  { id: 'acp-opencode', status: 'available', titleKey: 'settings.agents.help.opencodeTitle', bodyKeys: ['settings.agents.help.opencodeBody1', 'settings.agents.help.opencodeBody2', 'settings.agents.help.opencodeBody3'] },
  { id: 'acp-claude-code', status: 'coming-soon', titleKey: 'settings.agents.help.claudeTitle', bodyKeys: ['settings.agents.help.comingSoonBody'] },
  { id: 'acp-codex', status: 'coming-soon', titleKey: 'settings.agents.help.codexTitle', bodyKeys: ['settings.agents.help.comingSoonBody'] },
  { id: 'acp-kimi-code', status: 'coming-soon', titleKey: 'settings.agents.help.kimiTitle', bodyKeys: ['settings.agents.help.comingSoonBody'] },
] as const

export type HelpSection = (typeof HELP_SECTIONS)[number]

export function helpSectionById(id: string): HelpSection | undefined {
  return HELP_SECTIONS.find((s) => s.id === id)
}
