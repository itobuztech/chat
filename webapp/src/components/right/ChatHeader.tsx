import { useEffect, useState } from 'react'
import { CardTitle, CardDescription } from '../ui/card'
import useUser from '@/hooks/useUser';
import { fetchGroup, type Group } from '@/lib/groupsApi'

function ChatHeader() {
  const { activeConversation, activePeerId } = useUser()
  const [group, setGroup] = useState<Group | null>(null)
  const [groupError, setGroupError] = useState<string | null>(null)
  const [isLoadingGroup, setIsLoadingGroup] = useState(false)

  useEffect(() => {
    if (activeConversation.kind !== "group") {
      setGroup(null)
      setGroupError(null)
      setIsLoadingGroup(false)
      return
    }

    let cancelled = false
    const loadGroup = async () => {
      setIsLoadingGroup(true)
      setGroupError(null)
      try {
        const result = await fetchGroup(activeConversation.groupId)
        if (!cancelled) {
          setGroup(result)
        }
      } catch (error) {
        if (!cancelled) {
          const message =
            error instanceof Error ? error.message : "Failed to load group."
          setGroupError(message)
          setGroup(null)
        }
      } finally {
        if (!cancelled) {
          setIsLoadingGroup(false)
        }
      }
    }

    void loadGroup()

    return () => {
      cancelled = true
    }
  }, [activeConversation])

  if (activeConversation.kind === "group") {
    return (
      <>
        <CardTitle className="text-lg">
          {group ? group.name : isLoadingGroup ? "Loading group…" : "Group unavailable"}
        </CardTitle>
        <CardDescription>
          {groupError
            ? groupError
            : group
              ? `${group.members.length} members · ${group.description ?? "No description"}`
              : "Fetching latest group details…"}
        </CardDescription>
      </>
    )
  }

  const title = activePeerId || "Select a conversation"

  return (
    <>
      <CardTitle className="text-lg">{title}</CardTitle>
      <CardDescription></CardDescription>
    </>
  )
}

export default ChatHeader
