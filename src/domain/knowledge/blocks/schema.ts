/**
 * Hip Knowledge BlockNote schema: default blocks + dialect custom blocks/inline.
 */
import {
  BlockNoteSchema,
  defaultBlockSpecs,
  defaultInlineContentSpecs,
  defaultStyleSpecs,
} from '@blocknote/core'
import { calloutBlockSpec } from './calloutBlock'
import { mathBlockSpec } from './mathBlock'
import { mathInlineSpec } from './mathInline'
import { mermaidBlockSpec, svgBlockSpec } from './mermaidBlock'
import { embedBlockSpec } from './embedBlock'
import { attachmentBlockSpec } from './attachmentBlock'
import { toggleBlockSpec } from './toggleBlock'
import { columnsBlockSpec } from './columnsBlock'
import { wikiLinkInlineSpec, highlightStyleSpec } from './wikiInline'
import { createKnowledgeCodeBlockSpec } from './codeBlockHighlight'

const {
  // audio/video rarely used in knowledge notes — keep file/image
  audio: _audio,
  video: _video,
  // Replace default codeBlock (no highlighter) with hip Shiki-wired one.
  codeBlock: _defaultCodeBlock,
  ...restDefaultBlocks
} = defaultBlockSpecs

export const knowledgeBlockSchema = BlockNoteSchema.create({
  blockSpecs: {
    ...restDefaultBlocks,
    codeBlock: createKnowledgeCodeBlockSpec(),
    callout: calloutBlockSpec(),
    math: mathBlockSpec(),
    mermaid: mermaidBlockSpec(),
    svgBlock: svgBlockSpec(),
    embed: embedBlockSpec(),
    attachment: attachmentBlockSpec(),
    toggle: toggleBlockSpec(),
    columns: columnsBlockSpec(),
  },
  inlineContentSpecs: {
    ...defaultInlineContentSpecs,
    wikiLink: wikiLinkInlineSpec,
    mathInline: mathInlineSpec,
  },
  styleSpecs: {
    ...defaultStyleSpecs,
    highlight: highlightStyleSpec,
  },
})

export type KnowledgeBlockSchema = typeof knowledgeBlockSchema
export type KnowledgeEditor = typeof knowledgeBlockSchema.BlockNoteEditor
