import { describe, expect, it } from 'vitest'
import { INBOX_LIST_ID, mintWorkItemId, mintWorkListId } from './ids'
import {
  clampUtf8Bytes,
  DUE_ON_RE,
  emptyDefaultCatalog,
  isValidDueOn,
  normalizeCatalog,
  utf8ByteLength,
  WORK_ITEM_NOTES_MAX,
  WORK_ITEM_TAG_MAX_LEN,
  WORK_ITEM_TAGS_MAX,
  WORK_ITEM_TITLE_MAX,
} from './normalize'

describe('ids', () => {
  it('mints wi_ / wl_ prefixes', () => {
    expect(mintWorkItemId()).toMatch(/^wi_/)
    expect(mintWorkListId()).toMatch(/^wl_/)
    expect(INBOX_LIST_ID).toBe('wl_inbox')
  })
})

describe('emptyDefaultCatalog', () => {
  it('returns version 1 with Inbox only and no items', () => {
    const cat = emptyDefaultCatalog(100)
    expect(cat.version).toBe(1)
    expect(cat.items).toEqual([])
    expect(cat.lists).toHaveLength(1)
    expect(cat.lists[0]).toMatchObject({
      id: INBOX_LIST_ID,
      system: 'inbox',
      name: 'Inbox',
      sortOrder: 0,
      createdAt: 100,
      updatedAt: 100,
    })
  })
})

describe('normalizeCatalog', () => {
  it('returns default catalog for null/invalid raw', () => {
    expect(normalizeCatalog(null).lists[0]!.id).toBe(INBOX_LIST_ID)
    expect(normalizeCatalog(undefined).items).toEqual([])
    expect(normalizeCatalog('x').version).toBe(1)
    expect(normalizeCatalog({ version: 2 }).version).toBe(1)
  })

  it('ensures Inbox even when lists empty', () => {
    const cat = normalizeCatalog({ version: 1, lists: [], items: [] })
    expect(cat.lists.some((l) => l.id === INBOX_LIST_ID && l.system === 'inbox')).toBe(
      true,
    )
  })

  it('forces system:inbox on wl_inbox and keeps user lists', () => {
    const cat = normalizeCatalog({
      version: 1,
      lists: [
        { id: 'wl_inbox', name: '收集箱', sortOrder: 0, createdAt: 1, updatedAt: 1 },
        {
          id: 'wl_custom',
          name: 'Work',
          sortOrder: 2,
          createdAt: 1,
          updatedAt: 1,
        },
      ],
      items: [],
    })
    const inbox = cat.lists.find((l) => l.id === INBOX_LIST_ID)!
    expect(inbox.system).toBe('inbox')
    expect(inbox.name).toBe('收集箱')
    expect(cat.lists.map((l) => l.id)).toContain('wl_custom')
  })

  it('strips forged system:inbox from non-inbox lists', () => {
    const cat = normalizeCatalog({
      version: 1,
      lists: [
        {
          id: 'wl_forged',
          name: 'Fake Inbox',
          sortOrder: 1,
          createdAt: 1,
          updatedAt: 1,
          system: 'inbox',
        },
      ],
      items: [],
    })
    const forged = cat.lists.find((l) => l.id === 'wl_forged')!
    expect(forged.system).toBeUndefined()
    expect(cat.lists.find((l) => l.id === INBOX_LIST_ID)!.system).toBe('inbox')
  })

  it('drops invalid item ids and list ids', () => {
    const cat = normalizeCatalog({
      version: 1,
      lists: [
        { id: 'bad_list', name: 'X', sortOrder: 1, createdAt: 1, updatedAt: 1 },
        { id: 'wl_ok', name: 'OK', sortOrder: 1, createdAt: 1, updatedAt: 1 },
      ],
      items: [
        {
          id: 'not_wi',
          title: 'no',
          status: 'todo',
          priority: 'none',
          listId: 'wl_ok',
          tags: [],
          notes: '',
          dueOn: null,
          createdAt: 1,
          updatedAt: 1,
          completedAt: null,
          archivedAt: null,
          links: {},
        },
        {
          id: 'wi_good',
          title: 'yes',
          status: 'todo',
          priority: 'none',
          listId: 'wl_ok',
          tags: [],
          notes: '',
          dueOn: null,
          createdAt: 1,
          updatedAt: 1,
          completedAt: null,
          archivedAt: null,
          links: {},
        },
      ],
    })
    expect(cat.lists.map((l) => l.id).sort()).toEqual(
      [INBOX_LIST_ID, 'wl_ok'].sort(),
    )
    expect(cat.items.map((i) => i.id)).toEqual(['wi_good'])
  })

  it('rehomes unknown listId to inbox', () => {
    const cat = normalizeCatalog({
      version: 1,
      lists: [],
      items: [
        {
          id: 'wi_1',
          title: 'x',
          status: 'todo',
          priority: 'none',
          listId: 'wl_missing',
          tags: [],
          notes: '',
          dueOn: null,
          createdAt: 1,
          updatedAt: 1,
          completedAt: null,
          archivedAt: null,
          links: {},
        },
      ],
    })
    expect(cat.items[0]!.listId).toBe(INBOX_LIST_ID)
  })

  it('validates dueOn: null or real calendar YYYY-MM-DD only', () => {
    expect(DUE_ON_RE.test('2026-07-25')).toBe(true)
    expect(DUE_ON_RE.test('2026-7-5')).toBe(false)
    expect(isValidDueOn('2026-07-25')).toBe(true)
    expect(isValidDueOn('2026-02-31')).toBe(false)
    expect(isValidDueOn('2026-13-01')).toBe(false)

    const cat = normalizeCatalog({
      version: 1,
      lists: [],
      items: [
        {
          id: 'wi_1',
          title: 'a',
          status: 'todo',
          priority: 'none',
          listId: INBOX_LIST_ID,
          tags: [],
          notes: '',
          dueOn: '2026-07-25T12:00:00Z',
          createdAt: 1,
          updatedAt: 1,
          completedAt: null,
          archivedAt: null,
          links: {},
        },
        {
          id: 'wi_2',
          title: 'b',
          status: 'todo',
          priority: 'none',
          listId: INBOX_LIST_ID,
          tags: [],
          notes: '',
          dueOn: '2026-07-25',
          createdAt: 1,
          updatedAt: 1,
          completedAt: null,
          archivedAt: null,
          links: {},
        },
        {
          id: 'wi_3',
          title: 'c',
          status: 'todo',
          priority: 'none',
          listId: INBOX_LIST_ID,
          tags: [],
          notes: '',
          dueOn: '2026-02-31',
          createdAt: 1,
          updatedAt: 1,
          completedAt: null,
          archivedAt: null,
          links: {},
        },
      ],
    })
    expect(cat.items.find((i) => i.id === 'wi_1')!.dueOn).toBeNull()
    expect(cat.items.find((i) => i.id === 'wi_2')!.dueOn).toBe('2026-07-25')
    expect(cat.items.find((i) => i.id === 'wi_3')!.dueOn).toBeNull()
  })

  it('trims item titles (whitespace-only becomes empty)', () => {
    const cat = normalizeCatalog({
      version: 1,
      lists: [],
      items: [
        {
          id: 'wi_ws',
          title: '  hello  ',
          status: 'todo',
          priority: 'none',
          listId: INBOX_LIST_ID,
          tags: [],
          notes: '',
          dueOn: null,
          createdAt: 1,
          updatedAt: 1,
          completedAt: null,
          archivedAt: null,
          links: {},
        },
        {
          id: 'wi_blank',
          title: '   ',
          status: 'todo',
          priority: 'none',
          listId: INBOX_LIST_ID,
          tags: [],
          notes: '',
          dueOn: null,
          createdAt: 1,
          updatedAt: 1,
          completedAt: null,
          archivedAt: null,
          links: {},
        },
      ],
    })
    expect(cat.items.find((i) => i.id === 'wi_ws')!.title).toBe('hello')
    expect(cat.items.find((i) => i.id === 'wi_blank')!.title).toBe('')
  })

  it('clamps title and notes (notes by UTF-8 bytes, Rust parity)', () => {
    const cat = normalizeCatalog({
      version: 1,
      lists: [],
      items: [
        {
          id: 'wi_long',
          title: 't'.repeat(WORK_ITEM_TITLE_MAX + 50),
          status: 'todo',
          priority: 'none',
          listId: INBOX_LIST_ID,
          tags: [],
          notes: 'n'.repeat(WORK_ITEM_NOTES_MAX + 10),
          dueOn: null,
          createdAt: 1,
          updatedAt: 1,
          completedAt: null,
          archivedAt: null,
          links: {},
        },
      ],
    })
    expect(cat.items[0]!.title).toHaveLength(WORK_ITEM_TITLE_MAX)
    // ASCII: byte length == string length
    expect(utf8ByteLength(cat.items[0]!.notes)).toBe(WORK_ITEM_NOTES_MAX)
    expect(cat.items[0]!.notes).toHaveLength(WORK_ITEM_NOTES_MAX)
  })

  it('clamps multi-byte (CJK) notes by UTF-8 bytes so save will not reject', () => {
    // CJK ideograph is 3 UTF-8 bytes; char-count clamp at 64KiB would leave ~192KiB bytes.
    const over = '字'.repeat(Math.floor(WORK_ITEM_NOTES_MAX / 3) + 200)
    expect(utf8ByteLength(over)).toBeGreaterThan(WORK_ITEM_NOTES_MAX)
    expect(over.length).toBeLessThan(WORK_ITEM_NOTES_MAX) // would pass a char-only clamp

    const cat = normalizeCatalog({
      version: 1,
      lists: [],
      items: [
        {
          id: 'wi_cjk',
          title: 'cjk',
          status: 'todo',
          priority: 'none',
          listId: INBOX_LIST_ID,
          tags: [],
          notes: over,
          dueOn: null,
          createdAt: 1,
          updatedAt: 1,
          completedAt: null,
          archivedAt: null,
          links: {},
        },
      ],
    })
    const notes = cat.items[0]!.notes
    expect(utf8ByteLength(notes)).toBeLessThanOrEqual(WORK_ITEM_NOTES_MAX)
    // Filled to the last whole code point under the budget
    expect(utf8ByteLength(notes + '字')).toBeGreaterThan(WORK_ITEM_NOTES_MAX)
    expect(clampUtf8Bytes(over, WORK_ITEM_NOTES_MAX)).toBe(notes)
  })

  it('normalizes tags: trim, dedupe case-insensitive, max count/len', () => {
    const tags = [
      '  Foo  ',
      'foo',
      'Bar',
      'x'.repeat(WORK_ITEM_TAG_MAX_LEN + 5),
      ...Array.from({ length: WORK_ITEM_TAGS_MAX + 5 }, (_, i) => `t${i}`),
    ]
    const cat = normalizeCatalog({
      version: 1,
      lists: [],
      items: [
        {
          id: 'wi_tags',
          title: '',
          status: 'todo',
          priority: 'none',
          listId: INBOX_LIST_ID,
          tags,
          notes: '',
          dueOn: null,
          createdAt: 1,
          updatedAt: 1,
          completedAt: null,
          archivedAt: null,
          links: {},
        },
      ],
    })
    const out = cat.items[0]!.tags
    expect(out.length).toBeLessThanOrEqual(WORK_ITEM_TAGS_MAX)
    expect(out.filter((t) => t.toLowerCase() === 'foo')).toHaveLength(1)
    expect(out[0]).toBe('Foo') // first casing wins
    expect(out.every((t) => t.length <= WORK_ITEM_TAG_MAX_LEN)).toBe(true)
  })

  it('coerces bad status/priority and completedAt invariant', () => {
    const cat = normalizeCatalog({
      version: 1,
      lists: [],
      items: [
        {
          id: 'wi_open',
          title: '',
          status: 'nope',
          priority: 'urgent',
          listId: INBOX_LIST_ID,
          tags: [],
          notes: '',
          dueOn: null,
          createdAt: 1,
          updatedAt: 5,
          completedAt: 99,
          archivedAt: null,
          links: {},
        },
        {
          id: 'wi_done',
          title: '',
          status: 'done',
          priority: 'high',
          listId: INBOX_LIST_ID,
          tags: [],
          notes: '',
          dueOn: null,
          createdAt: 1,
          updatedAt: 5,
          completedAt: null,
          archivedAt: null,
          links: {},
        },
      ],
    })
    const open = cat.items.find((i) => i.id === 'wi_open')!
    expect(open.status).toBe('todo')
    expect(open.priority).toBe('none')
    expect(open.completedAt).toBeNull()

    const done = cat.items.find((i) => i.id === 'wi_done')!
    expect(done.completedAt).toBe(5)
  })

  it('keeps valid links and strips junk', () => {
    const cat = normalizeCatalog({
      version: 1,
      lists: [],
      items: [
        {
          id: 'wi_l',
          title: '',
          status: 'todo',
          priority: 'none',
          listId: INBOX_LIST_ID,
          tags: [],
          notes: '',
          dueOn: null,
          createdAt: 1,
          updatedAt: 1,
          completedAt: null,
          archivedAt: null,
          links: {
            sessionId: 'sess_1',
            knowledge: { spaceId: 'spc_1', docId: 'doc_1' },
            url: 'https://example.com',
            extra: true,
          },
        },
      ],
    })
    expect(cat.items[0]!.links).toEqual({
      sessionId: 'sess_1',
      knowledge: { spaceId: 'spc_1', docId: 'doc_1' },
      url: 'https://example.com',
    })
  })

  it('dedupes item ids (first wins)', () => {
    const cat = normalizeCatalog({
      version: 1,
      lists: [],
      items: [
        {
          id: 'wi_dup',
          title: 'first',
          status: 'todo',
          priority: 'none',
          listId: INBOX_LIST_ID,
          tags: [],
          notes: '',
          dueOn: null,
          createdAt: 1,
          updatedAt: 1,
          completedAt: null,
          archivedAt: null,
          links: {},
        },
        {
          id: 'wi_dup',
          title: 'second',
          status: 'done',
          priority: 'high',
          listId: INBOX_LIST_ID,
          tags: [],
          notes: '',
          dueOn: null,
          createdAt: 1,
          updatedAt: 1,
          completedAt: 1,
          archivedAt: null,
          links: {},
        },
      ],
    })
    expect(cat.items).toHaveLength(1)
    expect(cat.items[0]!.title).toBe('first')
  })

  it('does not invent sortOrder on items', () => {
    const cat = normalizeCatalog({
      version: 1,
      lists: [],
      items: [
        {
          id: 'wi_1',
          title: 'x',
          status: 'todo',
          priority: 'none',
          listId: INBOX_LIST_ID,
          tags: [],
          notes: '',
          dueOn: null,
          createdAt: 1,
          updatedAt: 1,
          completedAt: null,
          archivedAt: null,
          links: {},
          sortOrder: 99,
        },
      ],
    })
    expect(cat.items[0]).not.toHaveProperty('sortOrder')
  })
})
