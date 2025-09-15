import { PlayerMetricsCollectorInterface } from "@foxglove/studio-base/players/types";

export interface WebRTCPlayerOptions {
  signalingUrl: string;
  streamId: string;
  autoReconnect?: boolean;
  bufferSize?: number;
  metricsCollector?: PlayerMetricsCollectorInterface;
  sourceId: string;
}

export interface WebRTCMessage {
  type: string;
  topic: string;
  data: any;
  timestamp: number;
  messageType: string;
}

export interface WebRTCBatchMessage {
  type: 'batch';
  messages: WebRTCMessage[];
  count: number;
  timestamp: number;
}

export interface SignalingMessage {
  type: 'offer' | 'answer' | 'ice-candidate' | 'join-room' | 'peer-list' | 'error';
  data?: any;
  sdp?: string;
  candidate?: RTCIceCandidate;
  room?: string;
  peerId?: string;
  peers?: string[];
  error?: string;
}

export enum WebRTCConnectionState {
  DISCONNECTED = "disconnected",
  CONNECTING = "connecting",
  CONNECTED = "connected",
  RECONNECTING = "reconnecting",
  FAILED = "failed"
}
