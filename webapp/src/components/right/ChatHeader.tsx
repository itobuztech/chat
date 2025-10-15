import React from 'react'
import { CardTitle, CardDescription } from '../ui/card'
import useUser from '@/hooks/useUser';

function ChatHeader() {
  const { peerId } = useUser();
  return (
    <>
      <CardTitle className="text-lg">
        {peerId || "Select a conversation"}
      </CardTitle>
      <CardDescription>
        
      </CardDescription>
    </>
  )
}

export default ChatHeader