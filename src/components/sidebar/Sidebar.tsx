import { NewChatButton } from './NewChatButton'
import { SearchBox } from './SearchBox'
import { SessionList } from './SessionList'
import { UserMenu } from './UserMenu'

export function Sidebar() {
  return (
    <div className="flex h-full flex-col p-2">
      <div className="flex flex-col gap-2 p-1.5">
        <NewChatButton />
        <SearchBox />
      </div>

      <div className="flex-1 overflow-y-auto px-1">
        <SessionList />
      </div>

      <div className="border-t border-border p-1.5">
        <UserMenu />
      </div>
    </div>
  )
}
