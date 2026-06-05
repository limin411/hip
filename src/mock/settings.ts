export interface MockSettingItem {
  id: string
  label: string
  description: string
  type: 'toggle' | 'select' | 'number'
  value: string | boolean | number
  options?: string[]
}

export interface MockSettingGroup {
  title: string
  items: MockSettingItem[]
}

export const mockSettings: MockSettingGroup[] = [
  {
    title: '通用',
    items: [
      { id: 'lang', label: '界面语言', description: '应用界面的显示语言', type: 'select', value: '简体中文', options: ['简体中文', 'English', '日本語'] },
      { id: 'autosave', label: '自动保存会话', description: '离开应用时自动保存当前对话', type: 'toggle', value: true },
      { id: 'notify', label: '桌面通知', description: 'agent 任务完成时发送通知', type: 'toggle', value: true },
    ],
  },
  {
    title: '模型偏好',
    items: [
      { id: 'defaultModel', label: '默认模型', description: '新会话使用的默认大模型', type: 'select', value: 'claude-opus-4-8', options: ['claude-opus-4-8', 'claude-sonnet-4-6', 'gpt-4o'] },
      { id: 'temperature', label: '温度 (Temperature)', description: '越高回答越创造性，越低越保守', type: 'number', value: 0.7 },
      { id: 'maxTokens', label: '最大 Token 数', description: '单次回复的最大长度限制', type: 'number', value: 4096 },
    ],
  },
  {
    title: '界面',
    items: [
      { id: 'fontSize', label: '编辑器字号', description: '代码编辑区域的字体大小', type: 'select', value: '14px', options: ['12px', '14px', '16px', '18px'] },
      { id: 'animations', label: '启用动画', description: '面板切换与流式输出的过渡动画', type: 'toggle', value: true },
      { id: 'sidebarDefault', label: '默认展开侧边栏', description: '启动应用时自动展开侧边栏', type: 'toggle', value: true },
    ],
  },
]
