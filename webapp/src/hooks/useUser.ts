import { useState, useEffect } from 'react'


const storageKeys = {
  selfId: "p2p-chat:selfId",
  peerId: "p2p-chat:peerId",
}

function useUser() {
  const [selfId, setSelfId] = useState(() => {
    if (typeof window === "undefined") {
      return ""
    }
    return window.localStorage.getItem(storageKeys.selfId) ?? ""
  })
  const [peerId, setPeerId] = useState(() => {
    if (typeof window === "undefined") {
      return ""
    }
    return window.localStorage.getItem(storageKeys.peerId) ?? ""
  })

  useEffect(() => {
    if (typeof window === "undefined") {
      return
    }
    window.localStorage.setItem(storageKeys.selfId, selfId)
  }, [selfId])

  useEffect(() => {
    if (typeof window === "undefined") {
      return
    }
    window.localStorage.setItem(storageKeys.peerId, peerId)
  }, [peerId])

  return { selfId, setSelfId, peerId, setPeerId, conversationReady: selfId.length > 0 && peerId.length > 0 }
}

export default useUser
