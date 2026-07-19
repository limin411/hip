import { describe, it, expect } from 'vitest'
import {
  selectEmptyGreeting,
  resolveCalendarRegion,
  timeOfDayBucket,
  resolveWeekEdge,
  localParts,
  dailyUnit,
  dayKey,
  timeCacheBucket,
} from './emptyGreeting'
import { EMPTY_GREETING } from './emptyGreeting.keys'
import { matchHoliday, nthWeekdayOfMonth } from './emptyGreeting.holidays'

/** Fixed instant that is afternoon in US Eastern on a Tuesday (2026-07-07). */
function atUtc(iso: string): Date {
  return new Date(iso)
}

describe('timeOfDayBucket', () => {
  it('maps local hours to fine-grained buckets', () => {
    expect(timeOfDayBucket(5)).toBe('earlyMorning')
    expect(timeOfDayBucket(7)).toBe('earlyMorning')
    expect(timeOfDayBucket(8)).toBe('morning')
    expect(timeOfDayBucket(11)).toBe('morning')
    expect(timeOfDayBucket(12)).toBe('afternoon')
    expect(timeOfDayBucket(17)).toBe('afternoon')
    expect(timeOfDayBucket(18)).toBe('evening')
    expect(timeOfDayBucket(20)).toBe('evening')
    expect(timeOfDayBucket(21)).toBe('lateEvening')
    expect(timeOfDayBucket(22)).toBe('lateEvening')
    expect(timeOfDayBucket(23)).toBe('lateNight')
    expect(timeOfDayBucket(0)).toBe('lateNight')
    expect(timeOfDayBucket(1)).toBe('lateNight')
    expect(timeOfDayBucket(2)).toBe('deepNight')
    expect(timeOfDayBucket(4)).toBe('deepNight')
  })
})

describe('resolveWeekEdge', () => {
  it('detects Sunday evening / late and Monday early', () => {
    expect(resolveWeekEdge(0, 19)).toBe('sunday-evening')
    expect(resolveWeekEdge(0, 23)).toBe('sunday-late')
    expect(resolveWeekEdge(1, 1)).toBe('monday-early')
    expect(resolveWeekEdge(1, 6)).toBe('none')
    expect(resolveWeekEdge(3, 23)).toBe('none')
  })
})

describe('timeCacheBucket', () => {
  it('changes across hours and week edges', () => {
    const a = timeCacheBucket(
      { year: 2026, month: 7, day: 19, hour: 23, weekday: 0 },
      'sunday-late',
    )
    const b = timeCacheBucket(
      { year: 2026, month: 7, day: 20, hour: 0, weekday: 1 },
      'monday-early',
    )
    expect(a).not.toBe(b)
    expect(a).toContain('sunday-late')
    expect(b).toContain('monday-early')
  })
})

describe('resolveCalendarRegion', () => {
  const cases: Array<[Parameters<typeof resolveCalendarRegion>[0], string, string]> = [
    ['zh-CN', 'Asia/Shanghai', 'CN'],
    ['zh-CN', 'Asia/Chongqing', 'CN'],
    ['zh-CN', 'Asia/Taipei', 'TW'],
    ['zh-CN', 'Asia/Tokyo', 'CN'],
    ['zh-CN', 'America/New_York', 'CN'],
    ['zh-CN', 'Asia/Hong_Kong', 'CN'],
    ['zh-TW', 'Asia/Taipei', 'TW'],
    ['zh-TW', 'Asia/Shanghai', 'TW'],
    ['zh-TW', 'America/New_York', 'TW'],
    ['ja', 'Asia/Tokyo', 'JP'],
    ['ja', 'America/New_York', 'JP'],
    ['ko', 'Asia/Seoul', 'GENERIC'],
    ['ko', 'Asia/Tokyo', 'JP'],
    ['en', 'America/New_York', 'US'],
    ['en', 'America/Los_Angeles', 'US'],
    ['en', 'America/Toronto', 'GENERIC'],
    ['en', 'America/Vancouver', 'GENERIC'],
    ['en', 'America/Sao_Paulo', 'GENERIC'],
    ['en', 'America/Mexico_City', 'GENERIC'],
    ['en', 'America/Juneau', 'GENERIC'],
    ['en', 'Asia/Shanghai', 'CN'],
    ['en', 'Asia/Tokyo', 'JP'],
    ['en', 'Asia/Taipei', 'TW'],
    ['en', 'Asia/Hong_Kong', 'GENERIC'],
    ['en', 'Asia/Macau', 'GENERIC'],
    ['en', 'Europe/London', 'GB'],
    ['en', 'Europe/Berlin', 'GENERIC'],
    ['en', 'Australia/Sydney', 'AU'],
    ['en', 'Australia/Darwin', 'GENERIC'],
    ['en', 'UTC', 'GENERIC'],
    ['en', 'Etc/UTC', 'GENERIC'],
  ]

  it.each(cases)('%s + %s → %s', (lang, tz, region) => {
    expect(resolveCalendarRegion(lang, tz)).toBe(region)
  })
})

describe('localParts', () => {
  it('resolves wall clock in the given timezone', () => {
    // 2026-07-04 16:00 UTC = 12:00 America/New_York (EDT)
    const parts = localParts(atUtc('2026-07-04T16:00:00.000Z'), 'America/New_York')
    expect(parts.year).toBe(2026)
    expect(parts.month).toBe(7)
    expect(parts.day).toBe(4)
    expect(parts.hour).toBe(12)
    expect(parts.weekday).toBe(6) // Saturday
  })
})

describe('nthWeekdayOfMonth / Thanksgiving', () => {
  it('2026 US Thanksgiving is Nov 26', () => {
    expect(nthWeekdayOfMonth(2026, 11, 4, 4)).toBe(26)
  })

  it('matchHoliday finds us-thanksgiving for US on that day', () => {
    const def = matchHoliday('US', {
      year: 2026,
      month: 11,
      day: 26,
      hour: 12,
      weekday: 4,
    })
    expect(def?.id).toBe('us-thanksgiving')
  })
})

describe('matchHoliday', () => {
  it('cn-national-day window 10/1–10/3', () => {
    expect(
      matchHoliday('CN', { year: 2026, month: 10, day: 1, hour: 9, weekday: 4 })?.id,
    ).toBe('cn-national-day')
    expect(
      matchHoliday('CN', { year: 2026, month: 10, day: 3, hour: 9, weekday: 6 })?.id,
    ).toBe('cn-national-day')
    expect(
      matchHoliday('CN', { year: 2026, month: 10, day: 4, hour: 9, weekday: 0 }),
    ).toBeNull()
  })

  it('Toronto en does not get US Independence Day', () => {
    const parts = localParts(atUtc('2026-07-04T16:00:00.000Z'), 'America/Toronto')
    expect(resolveCalendarRegion('en', 'America/Toronto')).toBe('GENERIC')
    expect(matchHoliday('GENERIC', parts)?.id).not.toBe('us-independence-day')
  })

  it('US Independence Day for America/New_York', () => {
    const parts = localParts(atUtc('2026-07-04T16:00:00.000Z'), 'America/New_York')
    expect(matchHoliday('US', parts)?.id).toBe('us-independence-day')
  })

  it('spring festival eve through day3 for 2026', () => {
    // Anchor D1 = 2026-02-17; eve=16, D3=19
    expect(
      matchHoliday('CN', { year: 2026, month: 2, day: 16, hour: 10, weekday: 1 })?.id,
    ).toBe('cn-spring-festival')
    expect(
      matchHoliday('CN', { year: 2026, month: 2, day: 17, hour: 10, weekday: 2 })?.id,
    ).toBe('cn-spring-festival')
    expect(
      matchHoliday('CN', { year: 2026, month: 2, day: 19, hour: 10, weekday: 4 })?.id,
    ).toBe('cn-spring-festival')
    expect(
      matchHoliday('CN', { year: 2026, month: 2, day: 20, hour: 10, weekday: 5 }),
    ).toBeNull()
  })

  it('missing lunar year does not match', () => {
    expect(
      matchHoliday('CN', { year: 2035, month: 2, day: 17, hour: 10, weekday: 1 }),
    ).toBeNull()
  })

  it('christmas not for CN/GENERIC', () => {
    const parts = { year: 2026, month: 12, day: 25, hour: 10, weekday: 5 }
    expect(matchHoliday('CN', parts)).toBeNull()
    expect(matchHoliday('GENERIC', parts)).toBeNull()
    expect(matchHoliday('US', parts)?.id).toBe('christmas')
  })

  it('zh-CN + Tokyo does not get Golden Week', () => {
    expect(resolveCalendarRegion('zh-CN', 'Asia/Tokyo')).toBe('CN')
    expect(
      matchHoliday('CN', { year: 2026, month: 4, day: 30, hour: 10, weekday: 4 }),
    ).toBeNull()
    expect(
      matchHoliday('JP', { year: 2026, month: 4, day: 30, hour: 10, weekday: 4 })?.id,
    ).toBe('jp-golden-week')
  })
})

describe('selectEmptyGreeting', () => {
  it('returns holiday full pair on CN National Day', () => {
    const pick = selectEmptyGreeting({
      now: atUtc('2026-10-01T01:00:00.000Z'), // 09:00 Shanghai
      timeZone: 'Asia/Shanghai',
      language: 'zh-CN',
      surface: 'chat',
      rng: () => 0,
    })
    expect(pick.tier).toBe('holiday')
    expect(pick.id).toBe('holiday:cn-national-day')
    expect(pick.titleKey).toBe(EMPTY_GREETING.holiday['cn-national-day'].title)
    expect(pick.subKey).toBe(EMPTY_GREETING.holiday['cn-national-day'].sub)
    expect(pick.region).toBe('CN')
  })

  it('TOD title with tip subtitle on ordinary weekday', () => {
    // Tuesday 2026-07-07 18:00 UTC = 14:00 New York
    const pick = selectEmptyGreeting({
      now: atUtc('2026-07-07T18:00:00.000Z'),
      timeZone: 'America/New_York',
      language: 'en',
      surface: 'chat',
      rng: () => 0,
    })
    expect(pick.tier).toBe('timeOfDay')
    expect(pick.timeOfDay).toBe('afternoon')
    expect(pick.titleKey).toBe(EMPTY_GREETING.tod.afternoon.title)
    expect(pick.tipId).toBeDefined()
    expect(pick.subKey).not.toBe(EMPTY_GREETING.tod.afternoon.sub)
    expect(pick.localHour).toBe(14)
    expect(pick.weekEdge).toBe('none')
  })

  it('Sunday late night uses weekEdge sunday-late', () => {
    // 2026-07-19 is Sunday; 15:00 UTC = 23:00 Asia/Shanghai
    const pick = selectEmptyGreeting({
      now: atUtc('2026-07-19T15:00:00.000Z'),
      timeZone: 'Asia/Shanghai',
      language: 'zh-CN',
      surface: 'chat',
      rng: () => 0,
    })
    expect(pick.weekEdge).toBe('sunday-late')
    expect(pick.tier).toBe('weekEdge')
    expect(pick.timeOfDay).toBe('lateNight')
    expect(pick.titleKey).toBe(EMPTY_GREETING.weekEdge['sunday-late'].title)
  })

  it('Monday early uses weekEdge monday-early', () => {
    // 2026-07-19 16:30 UTC = 2026-07-20 00:30 Asia/Shanghai (Monday)
    const pick = selectEmptyGreeting({
      now: atUtc('2026-07-19T16:30:00.000Z'),
      timeZone: 'Asia/Shanghai',
      language: 'zh-CN',
      surface: 'chat',
      rng: () => 0,
    })
    expect(pick.weekEdge).toBe('monday-early')
    expect(pick.tier).toBe('weekEdge')
    expect(pick.titleKey).toBe(EMPTY_GREETING.weekEdge['monday-early'].title)
  })

  it('tips never own non-holiday title', () => {
    const pick = selectEmptyGreeting({
      now: atUtc('2026-07-07T18:00:00.000Z'),
      timeZone: 'America/New_York',
      language: 'en',
      surface: 'chat',
      rng: () => 0.5,
    })
    expect(pick.tier).toBe('timeOfDay')
    expect(pick.titleKey.startsWith('chat.emptyGreeting.timeOfDay.')).toBe(true)
  })

  it('excludes recent tip ids when possible', () => {
    const allChatTips = Object.values(EMPTY_GREETING.tip)
      .filter((t) => (t.surfaces as readonly string[]).includes('chat'))
      .map((t) => t.id)

    const first = selectEmptyGreeting({
      now: atUtc('2026-07-07T18:00:00.000Z'),
      timeZone: 'America/New_York',
      language: 'en',
      surface: 'chat',
      rng: () => 0,
    })
    expect(first.tipId).toBeDefined()

    const second = selectEmptyGreeting({
      now: atUtc('2026-07-07T18:00:00.000Z'),
      timeZone: 'America/New_York',
      language: 'en',
      surface: 'chat',
      recentTipIds: [first.tipId!],
      rng: () => 0,
    })
    expect(second.tipId).toBeDefined()
    if (allChatTips.length > 1) {
      expect(second.tipId).not.toBe(first.tipId)
    }
  })

  it('code surface on holiday prefers code tip as sub', () => {
    const pick = selectEmptyGreeting({
      now: atUtc('2026-10-01T01:00:00.000Z'),
      timeZone: 'Asia/Shanghai',
      language: 'zh-CN',
      surface: 'code',
      rng: () => 0,
    })
    expect(pick.tier).toBe('holiday')
    expect(pick.titleKey).toBe(EMPTY_GREETING.holiday['cn-national-day'].title)
    expect(pick.tipId).toBeDefined()
    expect(pick.subKey).not.toBe(EMPTY_GREETING.holiday['cn-national-day'].sub)
  })

  it('en + Toronto on July 4 is not US independence', () => {
    const pick = selectEmptyGreeting({
      now: atUtc('2026-07-04T16:00:00.000Z'),
      timeZone: 'America/Toronto',
      language: 'en',
      surface: 'chat',
      rng: () => 0,
    })
    expect(pick.id).not.toContain('us-independence-day')
    expect(pick.tier).not.toBe('holiday')
  })

  it('dailyUnit is stable for same dayKey', () => {
    const a = dailyUnit('2026-7-4', 'weekend-title')
    const b = dailyUnit('2026-7-4', 'weekend-title')
    expect(a).toBe(b)
    expect(a).toBeGreaterThanOrEqual(0)
    expect(a).toBeLessThan(1)
  })

  it('dayKey formats consistently', () => {
    expect(dayKey({ year: 2026, month: 7, day: 4 })).toBe('2026-7-4')
  })
})
