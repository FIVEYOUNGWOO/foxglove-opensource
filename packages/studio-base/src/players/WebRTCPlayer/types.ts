// Enhanced WebRTC Types for Foxglove Integration
// This file contains comprehensive type definitions for WebRTC player functionality

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

// Enhanced SignalingMessage interface with all required message types
export interface SignalingMessage {
  type: 'offer' | 'answer' | 'ice-candidate' | 'join-room' | 'peer-list' | 'error' | 'start_connection' | 'peer_state_change' | 'peer_disconnected';
  data?: any;
  sdp?: string;
  candidate?: RTCIceCandidateInit;  // Use proper RTCIceCandidateInit type
  room?: string;
  peerId?: string;
  peers?: string[];
  error?: string;
  peer_id?: string;  // For start_connection messages
  your_role?: string;  // For role assignment
  state?: string;  // For peer state changes
}

export enum WebRTCConnectionState {
  DISCONNECTED = "disconnected",
  CONNECTING = "connecting",
  CONNECTED = "connected",
  RECONNECTING = "reconnecting",
  FAILED = "failed"
}

// Enhanced configuration for WebRTC connection with proper types
export interface WebRTCConnectionConfig {
  iceServers: RTCIceServer[];
  iceTransportPolicy?: RTCIceTransportPolicy;
  bundlePolicy?: RTCBundlePolicy;
  rtcpMuxPolicy?: RTCRtcpMuxPolicy;
  iceCandidatePoolSize?: number;
}

// Data channel configuration with proper types
export interface DataChannelConfig {
  ordered?: boolean;
  maxRetransmits?: number;
  maxRetransmitTime?: number;
  protocol?: string;
  negotiated?: boolean;
  id?: number;
}

// Camera data interface for compressed images
export interface CameraData {
  header: {
    stamp: {
      sec: number;
      nanosec: number;
    };
    frame_id: string;
  };
  format: string;
  data: string;  // Base64 encoded JPEG data
}

// Radar point cloud data interface
export interface RadarPointCloudData {
  header: {
    stamp: {
      sec: number;
      nanosec: number;
    };
    frame_id: string;
  };
  height: number;
  width: number;
  fields: Array<{
    name: string;
    offset: number;
    datatype: number;
    count: number;
  }>;
  is_bigendian: boolean;
  point_step: number;
  row_step: number;
  data: any;  // Binary point cloud data
  is_dense: boolean;
}

// CAN signal data interface
export interface CANSignalData {
  data: number | string | boolean;
}

// Connection statistics interface
export interface ConnectionStatistics {
  connected: boolean;
  messagesReceived: number;
  bytesReceived: number;
  connectionUptime: number;
  lastMessageTime?: number;
  errorCount: number;
  reconnectionCount: number;
}

// Quality of Service settings for WebRTC
export interface WebRTCQoSSettings {
  maxBitrate?: number;
  minBitrate?: number;
  preferredCodec?: string;
  enableAdaptiveBitrate?: boolean;
  bufferSize?: number;
}

// Message processing statistics
export interface MessageProcessingStats {
  totalMessages: number;
  validMessages: number;
  invalidMessages: number;
  averageProcessingTime: number;
  lastProcessingTime: number;
  messageTypeCounts: Map<string, number>;
}

// Topic information for Foxglove
export interface FoxgloveTopicInfo {
  name: string;
  messageType: string;
  description?: string;
  frequency?: number;
  lastMessageTime?: number;
}

// Enhanced error information
export interface WebRTCError {
  code: string;
  message: string;
  timestamp: number;
  details?: any;
  recoverable: boolean;
}
