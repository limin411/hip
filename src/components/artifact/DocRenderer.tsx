import ReactMarkdown from 'react-markdown'
import { mockDoc } from '@/mock/doc'

export function DocRenderer() {
  return (
    <article
      className="
        max-w-none text-[14px] leading-relaxed text-ink
        [&_h1]:mb-3 [&_h1]:mt-1 [&_h1]:text-[22px] [&_h1]:font-bold [&_h1]:tracking-tight
        [&_h2]:mb-2 [&_h2]:mt-6 [&_h2]:text-[16px] [&_h2]:font-bold [&_h2]:tracking-tight
        [&_p]:my-2.5
        [&_ul]:my-2.5 [&_ul]:list-disc [&_ul]:pl-5
        [&_pre]:my-3 [&_pre]:overflow-auto [&_pre]:rounded-md [&_pre]:bg-surface-muted [&_pre]:p-3 [&_pre]:font-mono [&_pre]:text-[12.5px]
        [&_code]:font-mono
        [&_blockquote]:my-2 [&_blockquote]:border-l-2 [&_blockquote]:border-border [&_blockquote]:pl-3 [&_blockquote]:text-ink-secondary
        [&_table]:my-3 [&_table]:w-full [&_table]:border-collapse
        [&_th]:border [&_th]:border-border [&_th]:bg-surface-muted [&_th]:px-2.5 [&_th]:py-1.5 [&_th]:text-left
        [&_td]:border [&_td]:border-border [&_td]:px-2.5 [&_td]:py-1.5
      "
    >
      <ReactMarkdown>{mockDoc}</ReactMarkdown>
    </article>
  )
}
