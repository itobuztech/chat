import { Input } from '../ui/input'
import useUser from '@/hooks/useUser';

function MyInfo() {
  const {selfId, setSelfId, peerId, setPeerId} = useUser();

  return (
    <div className="space-y-3">
      <div className="space-y-1.5">
        <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
          Your ID
        </span>
        <Input
          value={selfId}
          placeholder="alice"
          onChange={(event) => setSelfId(event.target.value)}
        />
      </div>
      <div className="space-y-1.5">
        <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
          Peer ID
        </span>
        <Input
          value={peerId}
          placeholder="bob"
          onChange={(event) => setPeerId(event.target.value)}
        />
      </div>
    </div>
  )
}

export default MyInfo