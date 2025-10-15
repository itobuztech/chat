import { WebRTCProvider } from "./components/context/WebRTCContext"
import { VisibilityProvider } from "./components/context/VisibilityContext"

import AppHeader from "./components/left/AppHeader"
import Conversations from "./components/left/Conversations"
import MyInfo from "./components/left/MyInfo"
import ChatHeader from "./components/right/ChatHeader"
import Conversation from "./components/right/Conversation"
import { Card, CardContent, CardHeader } from "./components/ui/card"

function App(): JSX.Element {

  return (
    <WebRTCProvider>
      <VisibilityProvider>
        <div className="min-h-screen bg-background text-foreground">
          <div className="mx-auto flex h-screen max-w-6xl flex-col gap-4 p-4 md:flex-row">
            <Card className="flex h-full flex-col md:w-80">
              <CardHeader className="space-y-4">
                <AppHeader />
                <MyInfo />
              </CardHeader>

              <CardContent className="flex flex-1 flex-col gap-4 overflow-hidden">
                <Conversations />
              </CardContent>
            </Card>

            <Card className="flex h-full flex-1 flex-col">
              <CardHeader className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
                <ChatHeader />
              </CardHeader>
              <CardContent className="flex min-h-0 flex-1 flex-col gap-4">
                <Conversation />
              </CardContent>
            </Card>
          </div>
        </div>
      </VisibilityProvider>
    </WebRTCProvider>
  )
}

export default App
