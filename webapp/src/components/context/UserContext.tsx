import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react"

type ActiveConversation =
  | { kind: "none" }
  | { kind: "direct"; peerId: string }
  | { kind: "group"; groupId: string }

interface UserContextValue {
  selfId: string
  setSelfId: (value: string) => void
  peerId: string
  setPeerId: (peerId: string) => void
  activeConversation: ActiveConversation
  activePeerId: string
  activeGroupId: string
  setActiveGroupId: (groupId: string | null) => void
  clearConversation: () => void
  conversationReady: boolean
}

const storageKeys = {
  selfId: "p2p-chat:selfId",
  peerDraft: "p2p-chat:peerId",
  activeConversation: "p2p-chat:activeConversation",
}

function readFromStorage(key: string): string | null {
  if (typeof window === "undefined") {
    return null
  }
  try {
    return window.localStorage.getItem(key)
  } catch {
    return null
  }
}

function parseActiveConversation(raw: string | null): ActiveConversation {
  if (!raw) {
    return { kind: "none" }
  }
  try {
    const parsed = JSON.parse(raw) as ActiveConversation
    if (!parsed || typeof parsed !== "object" || typeof parsed.kind !== "string") {
      return { kind: "none" }
    }
    if (parsed.kind === "direct" && typeof parsed.peerId === "string") {
      return { kind: "direct", peerId: parsed.peerId }
    }
    if (parsed.kind === "group" && typeof parsed.groupId === "string") {
      return { kind: "group", groupId: parsed.groupId }
    }
    return { kind: "none" }
  } catch {
    return { kind: "none" }
  }
}

const UserContext = createContext<UserContextValue | undefined>(undefined)

export function UserProvider({ children }: { children: ReactNode }) {
  const [selfId, setSelfId] = useState(() => readFromStorage(storageKeys.selfId) ?? "")
  const [peerDraft, setPeerDraft] = useState(
    () => readFromStorage(storageKeys.peerDraft) ?? "",
  )
  const [activeConversation, setActiveConversation] = useState<ActiveConversation>(() =>
    parseActiveConversation(readFromStorage(storageKeys.activeConversation)),
  )

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
    window.localStorage.setItem(storageKeys.peerDraft, peerDraft)
  }, [peerDraft])

  useEffect(() => {
    if (typeof window === "undefined") {
      return
    }
    window.localStorage.setItem(storageKeys.activeConversation, JSON.stringify(activeConversation))
  }, [activeConversation])

  const selectDirectConversation = useCallback((peerId: string) => {
    setPeerDraft(peerId)
    const trimmed = peerId.trim()
    if (trimmed.length === 0) {
      setActiveConversation({ kind: "none" })
    } else {
      setActiveConversation({ kind: "direct", peerId: trimmed })
    }
  }, [])

  const selectGroupConversation = useCallback((groupId: string | null) => {
    if (!groupId) {
      setActiveConversation({ kind: "none" })
      return
    }
    setActiveConversation({ kind: "group", groupId })
  }, [])

  const clearConversation = useCallback(() => {
    setActiveConversation({ kind: "none" })
  }, [])

  const activePeerId = activeConversation.kind === "direct" ? activeConversation.peerId : ""
  const activeGroupId = activeConversation.kind === "group" ? activeConversation.groupId : ""

  const conversationReady = useMemo(() => {
    const normalizedSelf = selfId.trim()
    return (
      normalizedSelf.length > 0 &&
      activeConversation.kind === "direct" &&
      activeConversation.peerId.trim().length > 0
    )
  }, [activeConversation, selfId])

  const value = useMemo<UserContextValue>(
    () => ({
      selfId,
      setSelfId,
      peerId: peerDraft,
      setPeerId: selectDirectConversation,
      activeConversation,
      activePeerId,
      activeGroupId,
      setActiveGroupId: selectGroupConversation,
      clearConversation,
      conversationReady,
    }),
    [
      selfId,
      peerDraft,
      selectDirectConversation,
      activeConversation,
      activePeerId,
      activeGroupId,
      selectGroupConversation,
      clearConversation,
      conversationReady,
    ],
  )

  return <UserContext.Provider value={value}>{children}</UserContext.Provider>
}

export function useUserContext(): UserContextValue {
  const context = useContext(UserContext)
  if (!context) {
    throw new Error("useUser must be used within a UserProvider")
  }
  return context
}

