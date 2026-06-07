import { zhCN } from './zh-CN'

declare module 'i18next' {
  interface CustomTypeOptions {
    resources: typeof zhCN
  }
}
