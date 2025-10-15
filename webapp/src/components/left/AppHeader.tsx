import { CardTitle, CardDescription } from '../ui/card'

function AppHeader() {
  return (
    <div>
      <CardTitle className="text-xl">P2P Chat</CardTitle>
      <CardDescription>
        Configure your identifiers and pick a conversation to start chatting.
      </CardDescription>
    </div>
  )
}

export default AppHeader