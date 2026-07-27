export type KeybindHelpLabelKey =
  | 'commandPalette.shortcuts.openPalette'
  | 'commandPalette.shortcuts.slash'
  | 'commandPalette.shortcuts.voiceToggle'
  | 'commandPalette.shortcuts.hotkeys'
  | 'commandPalette.shortcuts.prefixCmd'
  | 'commandPalette.shortcuts.prefixSess'
  | 'commandPalette.shortcuts.prefixSkill'
  | 'commandPalette.shortcuts.prefixSlash'
  | 'commandPalette.shortcuts.favorite'
  | 'commandPalette.shortcuts.nestEsc'

export type KeybindHelpEntry = {
  id: string
  combo: string
  labelKey: KeybindHelpLabelKey
  /** Optional section for grouped help UI. */
  section?: 'palette' | 'composer' | 'navigation'
}

/** Canonical keybind table — palette help and docs read from here. */
export function getKeybindHelp(isMac: boolean): KeybindHelpEntry[] {
  const mod = isMac ? '⌘' : 'Ctrl+'
  return [
    {
      id: 'palette',
      combo: `${mod}K`,
      labelKey: 'commandPalette.shortcuts.openPalette',
      section: 'palette',
    },
    {
      id: 'slash',
      combo: '/',
      labelKey: 'commandPalette.shortcuts.slash',
      section: 'composer',
    },
    {
      id: 'voice-toggle',
      combo: isMac ? '⌘⇧M' : 'Ctrl+Shift+M',
      labelKey: 'commandPalette.shortcuts.voiceToggle',
      section: 'composer',
    },
    {
      id: 'hotkeys',
      combo: `${mod}1–${mod}9`,
      labelKey: 'commandPalette.shortcuts.hotkeys',
      section: 'palette',
    },
    {
      id: 'prefix-cmd',
      combo: '>',
      labelKey: 'commandPalette.shortcuts.prefixCmd',
      section: 'palette',
    },
    {
      id: 'prefix-sess',
      combo: '#',
      labelKey: 'commandPalette.shortcuts.prefixSess',
      section: 'palette',
    },
    {
      id: 'prefix-skill',
      combo: '@',
      labelKey: 'commandPalette.shortcuts.prefixSkill',
      section: 'palette',
    },
    {
      id: 'prefix-slash',
      combo: '/',
      labelKey: 'commandPalette.shortcuts.prefixSlash',
      section: 'palette',
    },
    {
      id: 'favorite',
      combo: '☆',
      labelKey: 'commandPalette.shortcuts.favorite',
      section: 'palette',
    },
    {
      id: 'nest-esc',
      combo: 'Esc',
      labelKey: 'commandPalette.shortcuts.nestEsc',
      section: 'palette',
    },
  ]
}

export function detectIsMac(): boolean {
  if (typeof navigator === 'undefined') return false
  return /Mac|iPhone|iPad|iPod/i.test(navigator.platform || navigator.userAgent)
}
