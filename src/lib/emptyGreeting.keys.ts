/**
 * Shared empty-greeting ids and i18n key paths.
 * Keep engine + locale trees aligned via this single source.
 */

export type Surface = 'chat' | 'code'

export const EMPTY_GREETING = {
  tod: {
    earlyMorning: {
      title: 'chat.emptyGreeting.timeOfDay.earlyMorning.title',
      sub: 'chat.emptyGreeting.timeOfDay.earlyMorning.sub',
    },
    morning: {
      title: 'chat.emptyGreeting.timeOfDay.morning.title',
      sub: 'chat.emptyGreeting.timeOfDay.morning.sub',
    },
    afternoon: {
      title: 'chat.emptyGreeting.timeOfDay.afternoon.title',
      sub: 'chat.emptyGreeting.timeOfDay.afternoon.sub',
    },
    evening: {
      title: 'chat.emptyGreeting.timeOfDay.evening.title',
      sub: 'chat.emptyGreeting.timeOfDay.evening.sub',
    },
    lateEvening: {
      title: 'chat.emptyGreeting.timeOfDay.lateEvening.title',
      sub: 'chat.emptyGreeting.timeOfDay.lateEvening.sub',
    },
    lateNight: {
      title: 'chat.emptyGreeting.timeOfDay.lateNight.title',
      sub: 'chat.emptyGreeting.timeOfDay.lateNight.sub',
    },
    deepNight: {
      title: 'chat.emptyGreeting.timeOfDay.deepNight.title',
      sub: 'chat.emptyGreeting.timeOfDay.deepNight.sub',
    },
  },
  weekend: {
    title: 'chat.emptyGreeting.weekend.title',
    sub: 'chat.emptyGreeting.weekend.sub',
  },
  /** Sunday night → Monday dawn specials (override TOD when not holiday). */
  weekEdge: {
    'sunday-evening': {
      title: 'chat.emptyGreeting.weekEdge.sunday-evening.title',
      sub: 'chat.emptyGreeting.weekEdge.sunday-evening.sub',
    },
    'sunday-late': {
      title: 'chat.emptyGreeting.weekEdge.sunday-late.title',
      sub: 'chat.emptyGreeting.weekEdge.sunday-late.sub',
    },
    'monday-early': {
      title: 'chat.emptyGreeting.weekEdge.monday-early.title',
      sub: 'chat.emptyGreeting.weekEdge.monday-early.sub',
    },
  },
  holiday: {
    'new-year': {
      id: 'holiday:new-year',
      title: 'chat.emptyGreeting.holiday.new-year.title',
      sub: 'chat.emptyGreeting.holiday.new-year.sub',
    },
    'cn-spring-festival': {
      id: 'holiday:cn-spring-festival',
      title: 'chat.emptyGreeting.holiday.cn-spring-festival.title',
      sub: 'chat.emptyGreeting.holiday.cn-spring-festival.sub',
    },
    'cn-labor-day': {
      id: 'holiday:cn-labor-day',
      title: 'chat.emptyGreeting.holiday.cn-labor-day.title',
      sub: 'chat.emptyGreeting.holiday.cn-labor-day.sub',
    },
    'cn-national-day': {
      id: 'holiday:cn-national-day',
      title: 'chat.emptyGreeting.holiday.cn-national-day.title',
      sub: 'chat.emptyGreeting.holiday.cn-national-day.sub',
    },
    'tw-national-day': {
      id: 'holiday:tw-national-day',
      title: 'chat.emptyGreeting.holiday.tw-national-day.title',
      sub: 'chat.emptyGreeting.holiday.tw-national-day.sub',
    },
    'cn-mid-autumn': {
      id: 'holiday:cn-mid-autumn',
      title: 'chat.emptyGreeting.holiday.cn-mid-autumn.title',
      sub: 'chat.emptyGreeting.holiday.cn-mid-autumn.sub',
    },
    'jp-golden-week': {
      id: 'holiday:jp-golden-week',
      title: 'chat.emptyGreeting.holiday.jp-golden-week.title',
      sub: 'chat.emptyGreeting.holiday.jp-golden-week.sub',
    },
    'us-independence-day': {
      id: 'holiday:us-independence-day',
      title: 'chat.emptyGreeting.holiday.us-independence-day.title',
      sub: 'chat.emptyGreeting.holiday.us-independence-day.sub',
    },
    'us-thanksgiving': {
      id: 'holiday:us-thanksgiving',
      title: 'chat.emptyGreeting.holiday.us-thanksgiving.title',
      sub: 'chat.emptyGreeting.holiday.us-thanksgiving.sub',
    },
    christmas: {
      id: 'holiday:christmas',
      title: 'chat.emptyGreeting.holiday.christmas.title',
      sub: 'chat.emptyGreeting.holiday.christmas.sub',
    },
  },
  tip: {
    'chat-paste': {
      id: 'tip:chat-paste',
      sub: 'chat.emptyGreeting.tip.chat-paste.sub',
      surfaces: ['chat', 'code'] as const,
    },
    'chat-slash': {
      id: 'tip:chat-slash',
      sub: 'chat.emptyGreeting.tip.chat-slash.sub',
      surfaces: ['chat', 'code'] as const,
    },
    'chat-model': {
      id: 'tip:chat-model',
      sub: 'chat.emptyGreeting.tip.chat-model.sub',
      surfaces: ['chat', 'code'] as const,
    },
    'code-folder': {
      id: 'tip:code-folder',
      sub: 'chat.emptyGreeting.tip.code-folder.sub',
      surfaces: ['code'] as const,
    },
    'code-plan': {
      id: 'tip:code-plan',
      sub: 'chat.emptyGreeting.tip.code-plan.sub',
      surfaces: ['code'] as const,
    },
  },
  surface: {
    chat: {
      title: 'chat.newConversationGreeting',
      sub: 'chat.greetingSub.default',
    },
    code: {
      title: 'chat.codeGreeting',
      sub: 'chat.greetingSub.default',
    },
  },
} as const

export type HolidayKey = keyof typeof EMPTY_GREETING.holiday
export type TipKey = keyof typeof EMPTY_GREETING.tip
