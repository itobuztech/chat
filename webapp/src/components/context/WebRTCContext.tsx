import useUser from '@/hooks/useUser';
import { PresenceStatus, fetchConversation } from '@/lib/messagesApi';
import { createContext, useContext, useEffect, useRef } from 'react';

const WebRTCContext = createContext(WebRTC);

function WebRTC({ children }: { children: React.ReactNode }) {

  return (
    <WebRTCContext.Provider value={{}}>
      {children}
    </WebRTCContext.Provider>
  )
}

export const useWebRTCContext = () => useContext(WebRTCContext);
