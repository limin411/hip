import { describe, it, expect } from 'vitest'
import { AIMessage, HumanMessage, SystemMessage } from '@langchain/core/messages'
import { stripImageContentParts } from './session.js'

describe('stripImageContentParts', () => {
  it('returns non-HumanMessages unchanged', () => {
    const messages = [new SystemMessage('context'), new AIMessage('reply')]
    expect(stripImageContentParts(messages)).toEqual(messages)
  })

  it('returns string HumanMessages unchanged', () => {
    const messages = [new HumanMessage('plain text')]
    expect(stripImageContentParts(messages)).toEqual(messages)
  })

  it('removes image_url parts from mixed content, keeping text parts', () => {
    const messages = [
      new HumanMessage({
        content: [
          { type: 'text', text: 'describe this' },
          { type: 'image_url', image_url: { url: 'data:image/png;base64,abc' } },
        ],
      }),
    ]
    const stripped = stripImageContentParts(messages)
    expect(stripped).toHaveLength(1)
    expect(stripped[0]).toBeInstanceOf(HumanMessage)
    expect(stripped[0].content).toBe('describe this')
  })

  it('returns an empty string when only image_url parts are present', () => {
    const messages = [
      new HumanMessage({
        content: [{ type: 'image_url', image_url: { url: 'data:image/png;base64,abc' } }],
      }),
    ]
    const stripped = stripImageContentParts(messages)
    expect(stripped).toHaveLength(1)
    expect(stripped[0]).toBeInstanceOf(HumanMessage)
    expect(stripped[0].content).toBe('')
  })

  it('keeps structured content unchanged when no image_url parts exist', () => {
    const content = [
      { type: 'text', text: 'first' },
      { type: 'text', text: 'second' },
    ]
    const messages = [new HumanMessage({ content })]
    const stripped = stripImageContentParts(messages)
    expect(stripped).toHaveLength(1)
    expect(stripped[0]).toBeInstanceOf(HumanMessage)
    expect(stripped[0].content).toEqual(content)
  })
})
