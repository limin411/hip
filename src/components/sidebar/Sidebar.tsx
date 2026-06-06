import { NewChatButton } from './NewChatButton'
import { SearchBox } from './SearchBox'
import { SessionList } from './SessionList'
import { UserMenu } from './UserMenu'

export function Sidebar() {
  return (
    <div className="flex h-full flex-col">
      <div className="flex flex-col gap-2 p-2.5">
        <NewChatButton />
        <SearchBox />
      </div>

      <div className="flex-1 overflow-y-auto px-2">
        <SessionList />
      </div>

      <div className="border-t border-border p-2">
        <UserMenu />
      </div>
    </div>
  )
}
