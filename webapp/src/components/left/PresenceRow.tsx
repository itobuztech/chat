import { PresenceStatus } from '@/lib/messagesApi'
import { Badge } from './ui/badge'
import { cn } from '@/lib/utils'

interface PresenceRowProps {
  label: string
  status: PresenceStatus
}

const presenceBadgeStyles: Record<PresenceStatus, string> = {
  online: "border-emerald-500/40 bg-emerald-500/15 text-emerald-500",
  away: "border-amber-500/40 bg-amber-500/15 text-amber-500",
  offline: "border-border/60 bg-muted text-muted-foreground",
}

export function PresenceRow({ label, status }: PresenceRowProps) {
  return (
    <div className="flex items-center justify-between rounded-lg bg-background/60 px-3 py-2">
      <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
        {label}
      </span>
      <Badge
        variant="outline"
        className={cn("text-xs font-semibold capitalize", presenceBadgeStyles[status])}
      >
        {status}
      </Badge>
    </div>
  )
}
