export interface MockProfile {
  name: string
  email: string
  avatarUrl?: string
  role: string
  organization: string
  bio: string
  joinedAt: string
  location: string
  timezone: string
}

export const mockProfile: MockProfile = {
  name: 'Shane Hughes',
  email: 'shane@brew-master.com',
  role: '高级开发者',
  organization: 'Brew Master Studio',
  bio: '全栈开发者，专注于智能体工具链与开发者体验设计。热爱开源与自动化工作流。',
  joinedAt: '2024-03-15',
  location: '上海',
  timezone: 'Asia/Shanghai',
}
