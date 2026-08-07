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
import { mermaidBlockSpec, svgBlockSpec } from './mermaidBlock'
import { embedBlockSpec } from './embedBlock'
import { toggleBlockSpec } from './toggleBlock'
import { wikiLinkInlineSpec, highlightStyleSpec } from './wikiInline'

const {
  // audio/video rarely used in knowledge notes — keep file/image
  audio: _audio,
  video: _video,
  ...restDefaultBlocks
} = defaultBlockSpecs

export const knowledgeBlockSchema = BlockNoteSchema.create({
  blockSpecs: {
    ...restDefaultBlocks,
    callout: calloutBlockSpec(),
    math: mathBlockSpec(),
    mermaid: mermaidBlockSpec(),
    svgBlock: svgBlockSpec(),
    embed: embedBlockSpec(),
    toggle: toggleBlockSpec(),
  },
  inlineContentSpecs: {
    ...defaultInlineContentSpecs,
    wikiLink: wikiLinkInlineSpec,
  },
  styleSpecs: {
    ...defaultStyleSpecs,
    highlight: highlightStyleSpec,
  },
})

export type KnowledgeBlockSchema = typeof knowledgeBlockSchema
export type KnowledgeEditor = typeof knowledgeBlockSchema.BlockNoteEditor
