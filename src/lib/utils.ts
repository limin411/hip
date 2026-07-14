import { clsx, type ClassValue } from 'clsx'
import { extendTailwindMerge } from 'tailwind-merge'

// Our Tailwind theme defines custom font-size tokens (tailwind.config.js → fontSize:
// caption/meta/body/prose/title/display/stat/page). tailwind-merge doesn't know them, so by
// default it mistakes e.g. `text-body` for a text *color* and, when both appear in one
// merge, drops the real color: `cn('text-white', 'text-body')` → `text-body` (white lost).
// That silently turned colored buttons/labels into inherited-gray text. Register the tokens
// under the font-size group so size and color never collide.
const twMerge = extendTailwindMerge({
  extend: {
    classGroups: {
      'font-size': [
        { text: ['caption', 'meta', 'body', 'prose', 'title', 'display', 'stat', 'page'] },
      ],
    },
  },
})

export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs))
}
