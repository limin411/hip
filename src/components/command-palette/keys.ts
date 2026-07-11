export type KeybindHelpLabelKey =
  | 'commandPalette.shortcuts.openPalette'
  | 'commandPalette.shortcuts.slash'

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
  ]
}

export function detectIsMac(): boolean {
  if (typeof navigator === 'undefined') return false
  return /Mac|iPhone|iPad|iPod/i.test(navigator.platform || navigator.userAgent)
}
