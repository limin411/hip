import { NewChatButton } from './NewChatButton'
import { SearchBox } from './SearchBox'
import { SessionList } from './SessionList'

export function Sidebar() {
  // 折叠按钮已上移到全宽标题栏（全局统一），侧栏顶部不再各自承载。
  return (
    <div className="flex h-full flex-col">
      <div className="flex flex-col gap-2.5 p-2 pt-3">
        <NewChatButton />
        <SearchBox />
      </div>
      <div className="flex-1 overflow-y-auto px-2">
        <SessionList />
      </div>
    </div>
  )
}
