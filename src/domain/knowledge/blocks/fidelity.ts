/**
 * Knowledge Live↔Source↔Disk fidelity matrix (L0–L3).
 * See docs/design/knowledge-editor-experience-spec.md §4.
 */

export type FidelityLevel = 'L0' | 'L1' | 'L2' | 'L3'

export type FidelityEntry = {
  id: string
  level: FidelityLevel
  /** Probe that must match after Live serialize + soft process when level ≥ L2. */
  probe: RegExp
  description: string
}

/**
 * Documented matrix — tests assert probes survive carrier round-trips.
 * L3 = full structure; L2 = content+type (UI state may drop); L1 = text only.
 */
export const FIDELITY_MATRIX: readonly FidelityEntry[] = [
  {
    id: 'paragraph',
    level: 'L3',
    probe: /.+/,
    description: 'Plain paragraphs / ATX headings',
  },
  {
    id: 'callout',
    level: 'L3',
    probe: /\[!(?:note|tip|info|warning|danger|caution|important)\]/i,
    description: 'GFM/Obsidian callout > [!type]',
  },
  {
    id: 'math',
    level: 'L3',
    probe: /\$\$[\s\S]*?\$\$/,
    description: 'Display math $$...$$',
  },
  {
    id: 'inline-math',
    level: 'L3',
    probe: /(?<!\$)\$[^\s$][^$\n]*\$(?![\d$])/,
    description: 'Inline math $...$',
  },
  {
    id: 'mermaid',
    level: 'L3',
    probe: /```mermaid\b/i,
    description: 'Mermaid fenced code',
  },
  {
    id: 'svg',
    level: 'L3',
    probe: /```svg\b/i,
    description: 'SVG fenced code',
  },
  {
    id: 'wiki',
    level: 'L3',
    probe: /\[\[[^\]]+\]\]/,
    description: 'Wiki link [[title]] / [[t|a]]',
  },
  {
    id: 'embed',
    level: 'L2',
    probe: /!\[\[[^\]]*\]\]/,
    description: 'Embed ![[title#frag]]',
  },
  {
    id: 'toggle',
    level: 'L2',
    probe: /<details[\s\S]*?<\/details>/i,
    description: 'Toggle via <details><summary>',
  },
  {
    id: 'highlight',
    level: 'L2',
    probe: /==[^=\n]+==/,
    description: 'Obsidian highlight ==text==',
  },
  {
    id: 'textColor',
    level: 'L2',
    probe: /<span\b[^>]*data-hip-color=/i,
    description: 'Text color <span data-hip-color> carrier',
  },
  {
    id: 'backgroundColor',
    level: 'L2',
    probe: /<span\b[^>]*data-hip-bg-color=/i,
    description: 'Background color <span data-hip-bg-color> carrier',
  },
  {
    id: 'image',
    level: 'L2',
    probe: /!\[[^\]]*\]\([^)]+\)/,
    description: 'Image with optional title caption',
  },
  {
    id: 'attachment',
    level: 'L2',
    probe: /!\[[^\]]*\]\([^)]*\.(?:pdf|zip|docx?|xlsx?|pptx?|txt)\)/i,
    description: 'Attachment card ![name](assets/file.pdf)',
  },
  {
    id: 'table',
    level: 'L2',
    probe: /\|.+\|/,
    description: 'GFM table (column widths L2-droppable)',
  },
] as const

/** Markers that must not silently disappear after Live serialize (honesty toast). */
export const DIALECT_PRESERVE_PROBES: ReadonlyArray<{ id: string; probe: RegExp }> =
  FIDELITY_MATRIX.filter((e) =>
    [
      'callout',
      'math',
      'inline-math',
      'mermaid',
      'svg',
      'wiki',
      'embed',
      'toggle',
      'highlight',
      'textColor',
      'backgroundColor',
      'attachment',
    ].includes(e.id),
  ).map((e) => ({ id: e.id, probe: e.probe }))

/** Golden MD fixtures used by blockRoundTrip tests. */
export const FIDELITY_GOLDENS: ReadonlyArray<{ id: string; md: string }> = [
  {
    id: 'callout',
    md: '> [!note] Title\n> body line\n',
  },
  {
    id: 'callout-tip',
    md: '> [!tip]\n> tip body\n',
  },
  {
    id: 'callout-warning',
    md: '> [!warning] Careful\n> warn body\n',
  },
  {
    id: 'callout-danger',
    md: '> [!danger] Stop\n> danger body\n',
  },
  {
    id: 'callout-info',
    md: '> [!info] FYI\n> info body\n',
  },
  {
    id: 'callout-important',
    md: '> [!important] Read\n> important body\n',
  },
  {
    id: 'math',
    md: '$$\nx^2 + y^2 = z^2\n$$\n',
  },
  {
    id: 'inline-math',
    md: 'Inline $e^{i\\pi} + 1 = 0$ here.\n',
  },
  {
    id: 'mermaid',
    md: '```mermaid\nflowchart LR\n  A --> B\n```\n',
  },
  {
    id: 'svg',
    md: '```svg\n<svg xmlns="http://www.w3.org/2000/svg"></svg>\n```\n',
  },
  {
    id: 'wiki',
    md: 'See [[Other Doc]] and [[Target|alias]] here.\n',
  },
  {
    id: 'embed',
    md: '![[Other Doc#Heading]]\n',
  },
  {
    id: 'toggle',
    md: '<details>\n<summary>Fold me</summary>\n\nHidden body\n\n</details>\n',
  },
  {
    id: 'highlight',
    md: 'This has ==highlighted== text.\n',
  },
  {
    id: 'textColor',
    md: 'Red <span data-hip-color="red">words</span> here.\n',
  },
  {
    id: 'backgroundColor',
    md: 'Note <span data-hip-bg-color="yellow">mark</span>.\n',
  },
  {
    id: 'image-caption',
    md: '![alt](assets/pic.png "A caption")\n',
  },
  {
    id: 'attachment',
    md: '![doc.pdf](assets/doc.pdf)\n',
  },
]
