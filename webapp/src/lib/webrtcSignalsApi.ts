import { API_BASE_URL } from "./messagesApi.js";

export type SignalType = "offer" | "answer" | "candidate" | "bye";

export interface WebRtcSignal<TPayload = Record<string, unknown> | null> {
  id: string;
  sessionId: string;
  senderId: string;
  recipientId: string;
  type: SignalType;
  payload: TPayload;
  createdAt: string;
  consumed: boolean;
  consumedAt?: string;
}

export interface IceConfigResponse {
  iceServers: RTCIceServer[];
  ttlSeconds: number;
  source: "default" | "custom";
}

export interface SendSignalPayload {
  sessionId: string;
  senderId: string;
  recipientId: string;
  type: SignalType;
  payload?: Record<string, unknown> | null;
}

async function parseResponse<T>(response: Response): Promise<T> {
  if (!response.ok) {
    const message = await response
      .json()
      .catch(() => ({ error: response.statusText }));
    throw new Error(
      typeof message?.error === "string"
        ? message.error
        : `Request failed with status ${response.status}`,
    );
  }

  return response.json() as Promise<T>;
}

export async function fetchIceConfig(): Promise<IceConfigResponse> {
  const response = await fetch(`${API_BASE_URL}/api/webrtc/ice-config`);
  return parseResponse<IceConfigResponse>(response);
}

export async function persistSignal<TPayload extends Record<string, unknown> | null>(
  payload: SendSignalPayload & { payload?: TPayload },
): Promise<WebRtcSignal<TPayload>> {
  const response = await fetch(`${API_BASE_URL}/api/webrtc/signals`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      sessionId: payload.sessionId,
      senderId: payload.senderId,
      recipientId: payload.recipientId,
      type: payload.type,
      payload: payload.payload ?? null,
    }),
  });

  const data = await parseResponse<{ signal: WebRtcSignal<TPayload> }>(response);
  return data.signal;
}

export async function fetchPendingSignals(
  recipientId: string,
  sessionId?: string,
): Promise<WebRtcSignal[]> {
  const params = new URLSearchParams();
  if (sessionId) {
    params.set("sessionId", sessionId);
  }

  const query = params.toString();
  const response = await fetch(
    `${API_BASE_URL}/api/webrtc/signals/pending/${encodeURIComponent(recipientId)}${query ? `?${query}` : ""}`,
  );

  const data = await parseResponse<{ signals: WebRtcSignal[] }>(response);
  return data.signals;
}
