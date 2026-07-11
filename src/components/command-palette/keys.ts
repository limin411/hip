export type KeybindHelpLabelKey =
  | 'commandPalette.shortcuts.openPalette'
  | 'commandPalette.shortcuts.slash'
  | 'commandPalette.shortcuts.hotkeys'
  | 'commandPalette.shortcuts.prefixCmd'
  | 'commandPalette.shortcuts.prefixSess'
  | 'commandPalette.shortcuts.prefixSkill'
  | 'commandPalette.shortcuts.favorite'
  | 'commandPalette.shortcuts.nestEsc'

export type KeybindHelpEntry = {
  id: string
  combo: string
  labelKey: KeybindHelpLabelKey
}

export function getKeybindHelp(isMac: boolean): KeybindHelpEntry[] {
  const mod = isMac ? '⌘' : 'Ctrl+'
  return [
    {
      id: 'palette',
      combo: `${mod}K`,
      labelKey: 'commandPalette.shortcuts.openPalette',
    },
    {
      id: 'slash',
      combo: '/',
      labelKey: 'commandPalette.shortcuts.slash',
    },
    {
      id: 'hotkeys',
      combo: `${mod}1–${mod}9`,
      labelKey: 'commandPalette.shortcuts.hotkeys',
    },
    {
      id: 'prefix-cmd',
      combo: '>',
      labelKey: 'commandPalette.shortcuts.prefixCmd',
    },
    {
      id: 'prefix-sess',
      combo: '#',
      labelKey: 'commandPalette.shortcuts.prefixSess',
    },
    {
      id: 'prefix-skill',
      combo: '@',
      labelKey: 'commandPalette.shortcuts.prefixSkill',
    },
    {
      id: 'favorite',
      combo: '☆',
      labelKey: 'commandPalette.shortcuts.favorite',
    },
    {
      id: 'nest-esc',
      combo: 'Esc',
      labelKey: 'commandPalette.shortcuts.nestEsc',
    },
  ]
}

export function detectIsMac(): boolean {
  if (typeof navigator === 'undefined') return false
  return /Mac|iPhone|iPad|iPod/i.test(navigator.platform || navigator.userAgent)
}
