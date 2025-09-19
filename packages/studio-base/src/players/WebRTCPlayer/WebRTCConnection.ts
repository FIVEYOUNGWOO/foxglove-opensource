// WebRTCConnection.ts - 수정된 완전한 코드

import { WebRTCConnectionState, SignalingMessage } from "./types";

export class WebRTCConnection {
  private websocket?: WebSocket;
  private peerConnection?: RTCPeerConnection;
  private dataChannel?: RTCDataChannel;
  private state: WebRTCConnectionState = WebRTCConnectionState.DISCONNECTED;
  private pendingRemoteCandidates: RTCIceCandidateInit[] = [];
  private connectionAttempts: number = 0;
  private maxConnectionAttempts: number = 5;
  private reconnectionDelay: number = 3000; // 3 seconds

  constructor(
    private signalingUrl: string,
    private streamId: string,
    private onMessage: (data: any) => void,
    private onStateChange: (state: WebRTCConnectionState) => void
  ) {}

  async connect(): Promise<boolean> {
    if (this.connectionAttempts >= this.maxConnectionAttempts) {
      console.error(`Maximum connection attempts (${this.maxConnectionAttempts}) exceeded`);
      this.setState(WebRTCConnectionState.FAILED);
      return false;
    }

    try {
      this.connectionAttempts++;
      this.setState(WebRTCConnectionState.CONNECTING);

      console.log(`WebRTC connection attempt ${this.connectionAttempts}/${this.maxConnectionAttempts}`);

      await this.connectToSignalingServer();
      this.setupPeerConnection();
      await this.joinRoom();

      return true;
    } catch (error) {
      console.error("WebRTC connection failed:", error);
      this.setState(WebRTCConnectionState.FAILED);

      // Attempt automatic reconnection if configured
      if (this.connectionAttempts < this.maxConnectionAttempts) {
        console.log(`Retrying connection in ${this.reconnectionDelay}ms...`);
        setTimeout(() => {
          void this.connect();
        }, this.reconnectionDelay);
      }

      return false;
    }
  }

  private async connectToSignalingServer(): Promise<void> {
    return new Promise((resolve, reject) => {
      // Clean up existing websocket if any
      if (this.websocket) {
        this.websocket.close();
      }

      this.websocket = new WebSocket(this.signalingUrl);

      const connectionTimeout = setTimeout(() => {
        reject(new Error("Signaling server connection timeout"));
      }, 10000); // 10 second timeout

      this.websocket.onopen = () => {
        clearTimeout(connectionTimeout);
        console.log("Connected to signaling server");
        resolve();
      };

      this.websocket.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data) as SignalingMessage;
          void this.handleSignalingMessage(msg);
        } catch (e) {
          console.error("Invalid signaling message:", e);
        }
      };

      this.websocket.onerror = (error) => {
        clearTimeout(connectionTimeout);
        console.error("Signaling server connection error:", error);
        reject(error);
      };

      this.websocket.onclose = (event) => {
        clearTimeout(connectionTimeout);
        console.log("Signaling server connection closed:", event.code, event.reason);

        // Handle unexpected closures
        if (this.state === WebRTCConnectionState.CONNECTED || this.state === WebRTCConnectionState.CONNECTING) {
          this.setState(WebRTCConnectionState.RECONNECTING);

          // Attempt to reconnect after a delay
          setTimeout(() => {
            void this.connect();
          }, this.reconnectionDelay);
        }
      };
    });
  }

  private setupPeerConnection(): void {
    // Clean up existing peer connection if any
    if (this.peerConnection) {
      this.peerConnection.close();
    }

    const config: RTCConfiguration = {
      iceServers: [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:stun1.l.google.com:19302' },
        { urls: 'stun:stun2.l.google.com:19302' }
      ],
      iceCandidatePoolSize: 10
    };

    this.peerConnection = new RTCPeerConnection(config);

    // Set up connection state monitoring
    this.peerConnection.onconnectionstatechange = () => {
      const state = this.peerConnection?.connectionState;
      console.log(`WebRTC peer connection state: ${state}`);

      switch (state) {
        case 'connected':
          this.setState(WebRTCConnectionState.CONNECTED);
          this.connectionAttempts = 0; // Reset attempts on successful connection
          break;
        case 'failed':
        case 'disconnected':
        case 'closed':
          this.setState(WebRTCConnectionState.DISCONNECTED);
          // Attempt reconnection for failed/disconnected states
          if (state === 'failed' || state === 'disconnected') {
            this.setState(WebRTCConnectionState.RECONNECTING);
            setTimeout(() => {
              void this.connect();
            }, this.reconnectionDelay);
          }
          break;
        case 'connecting':
          this.setState(WebRTCConnectionState.CONNECTING);
          break;
      }
    };

    // ICE candidate handling with improved error handling and type safety
    this.peerConnection.onicecandidate = (event) => {
      if (event.candidate && this.websocket && this.websocket.readyState === WebSocket.OPEN) {
        const message: SignalingMessage = {
          type: 'ice-candidate',
          candidate: event.candidate.toJSON() // Use toJSON() for proper serialization
        };

        try {
          const messageStr = JSON.stringify(message);
          if (messageStr) { // Ensure string is not empty
            this.websocket.send(messageStr);
            console.debug("ICE candidate sent successfully");
          }
        } catch (error) {
          console.error("Failed to send ICE candidate:", error);
        }
      }
    };

    // ICE connection state monitoring
    this.peerConnection.oniceconnectionstatechange = () => {
      const iceState = this.peerConnection?.iceConnectionState;
      console.log(`ICE connection state: ${iceState}`);

      if (iceState === 'failed' || iceState === 'disconnected') {
        console.warn("ICE connection failed, attempting to reconnect...");
        this.setState(WebRTCConnectionState.RECONNECTING);
        setTimeout(() => {
          void this.connect();
        }, this.reconnectionDelay);
      }
    };

    // ICE gathering state monitoring
    this.peerConnection.onicegatheringstatechange = () => {
      const gatheringState = this.peerConnection?.iceGatheringState;
      console.log(`ICE gathering state: ${gatheringState}`);
    };

    // Data channel handling - Foxglove receives the data channel from the offerer
    this.peerConnection.ondatachannel = (event) => {
      const channel = event.channel;
      console.log(`Received data channel: ${channel.label}`);
      this.attachDataChannelHandlers(channel);
    };
  }

  private attachDataChannelHandlers(channel: RTCDataChannel) {
    this.dataChannel = channel;

    this.dataChannel.onopen = () => {
      console.log("Data channel opened successfully");
      this.setState(WebRTCConnectionState.CONNECTED);
    };

    this.dataChannel.onmessage = (ev) => {
      try {
        // Handle both string and binary data
        let messageData: any;

        if (typeof ev.data === 'string') {
          messageData = ev.data;
        } else if (ev.data instanceof ArrayBuffer) {
          messageData = ev.data;
        } else if (ev.data instanceof Blob) {
          // Convert Blob to ArrayBuffer if needed
          ev.data.arrayBuffer().then(buffer => {
            this.onMessage(buffer);
          }).catch(error => {
            console.error("Failed to convert Blob to ArrayBuffer:", error);
          });
          return;
        } else {
          console.warn("Received unsupported data type:", typeof ev.data);
          return;
        }

        this.onMessage(messageData);

      } catch (error) {
        console.error("Error processing data channel message:", error);
      }
    };

    this.dataChannel.onclose = () => {
      console.warn("Data channel closed");
      this.setState(WebRTCConnectionState.DISCONNECTED);
    };

    this.dataChannel.onerror = (err) => {
      console.error("Data channel error:", err);
      this.setState(WebRTCConnectionState.FAILED);
    };
  }

  private async joinRoom(): Promise<void> {
    const joinMessage: SignalingMessage = {
      type: 'join-room',
      room: this.streamId
    };

    if (this.websocket && this.websocket.readyState === WebSocket.OPEN) {
      const messageStr = JSON.stringify(joinMessage);
      if (messageStr) { // Ensure string is not empty
        this.websocket.send(messageStr);
        console.log(`Joined room: ${this.streamId}`);
      }
    } else {
      throw new Error("WebSocket not ready for joining room");
    }
  }

  private async handleSignalingMessage(message: SignalingMessage): Promise<void> {
    const pc = this.peerConnection;
    if (!pc) {
      console.error("Received signaling message but peer connection not initialized");
      return;
    }

    try {
      switch (message.type) {
        case 'start_connection':
          // Foxglove is the answerer, so it waits for an offer
          console.info("Received start_connection signal - waiting for offer from peer");
          // Do NOT create an offer here - wait for the offer from the Python client
          break;

        case 'offer':
          if (!message.sdp) {
            console.error("Received offer without SDP");
            return;
          }

          console.log("Processing offer from peer");
          await pc.setRemoteDescription({ type: 'offer', sdp: message.sdp });

          // Process any buffered ICE candidates
          for (const candidate of this.pendingRemoteCandidates) {
            try {
              await pc.addIceCandidate(candidate);
              console.debug("Added buffered ICE candidate");
            } catch (e) {
              console.warn("Failed to add buffered ICE candidate:", e);
            }
          }
          this.pendingRemoteCandidates = [];

          // Create and send answer
          const answer = await pc.createAnswer();
          await pc.setLocalDescription(answer);

          if (this.websocket && this.websocket.readyState === WebSocket.OPEN) {
            const answerMessage: SignalingMessage = {
              type: 'answer',
              sdp: answer.sdp || ""
            };
            const messageStr = JSON.stringify(answerMessage);
            if (messageStr) { // Ensure string is not empty
              this.websocket.send(messageStr);
              console.log("Answer sent successfully");
            }
          }
          break;

        case 'answer':
          // Foxglove shouldn't receive answers since it's the answerer
          console.warn("Received unexpected answer (Foxglove is answerer role)");
          break;

        case 'ice-candidate':
          if (!message.candidate) {
            console.debug("Received end-of-candidates signal");
            return;
          }

          try {
            if (pc.remoteDescription) {
              await pc.addIceCandidate(message.candidate);
              console.debug("ICE candidate added successfully");
            } else {
              // Buffer candidates until remote description is set
              this.pendingRemoteCandidates.push(message.candidate);
              console.debug("ICE candidate buffered (waiting for remote description)");
            }
          } catch (e) {
            console.warn("Failed to add ICE candidate:", e);
          }
          break;

        case 'peer_state_change':
          const peerState = message.state || 'unknown';
          console.log(`Peer state changed to: ${peerState}`);
          break;

        case 'peer_disconnected':
          console.warn("Peer disconnected");
          this.setState(WebRTCConnectionState.DISCONNECTED);
          break;

        case 'error':
          console.error("Signaling error:", message.error);
          this.setState(WebRTCConnectionState.FAILED);
          break;

        default:
          console.debug("Unhandled signaling message type:", message.type);
      }
    } catch (error) {
      console.error(`Error handling signaling message (${message.type}):`, error);
    }
  }

  private setState(newState: WebRTCConnectionState): void {
    if (this.state !== newState) {
      const oldState = this.state;
      this.state = newState;
      console.log(`WebRTC state change: ${oldState} -> ${newState}`);
      this.onStateChange(newState);
    }
  }

  // Public method to send data through the data channel
  public send(data: string | ArrayBuffer | ArrayBufferView): boolean {
    if (!this.dataChannel || this.dataChannel.readyState !== 'open') {
      console.warn("Data channel not ready for sending");
      return false;
    }

    try {
      this.dataChannel.send(data);
      return true;
    } catch (error) {
      console.error("Failed to send data:", error);
      return false;
    }
  }

  // Get current connection statistics
  public getStats(): Promise<RTCStatsReport> | null {
    if (!this.peerConnection) {
      return null;
    }
    return this.peerConnection.getStats();
  }

  // Get current connection state
  public getState(): WebRTCConnectionState {
    return this.state;
  }

  // Check if connection is ready for data transmission
  public isReady(): boolean {
    return this.state === WebRTCConnectionState.CONNECTED &&
           this.dataChannel?.readyState === 'open';
  }

  // Force reconnection
  public async reconnect(): Promise<boolean> {
    console.log("Forcing WebRTC reconnection...");
    await this.close();
    this.connectionAttempts = 0; // Reset attempts for manual reconnection
    return await this.connect();
  }

  // Close all connections and clean up resources
  async close(): Promise<void> {
    console.log("Closing WebRTC connection...");

    this.setState(WebRTCConnectionState.DISCONNECTED);

    // Close data channel
    if (this.dataChannel) {
      if (this.dataChannel.readyState === 'open') {
        this.dataChannel.close();
      }
      this.dataChannel = undefined;
    }

    // Close peer connection
    if (this.peerConnection) {
      this.peerConnection.close();
      this.peerConnection = undefined;
    }

    // Close WebSocket
    if (this.websocket) {
      if (this.websocket.readyState === WebSocket.OPEN || this.websocket.readyState === WebSocket.CONNECTING) {
        this.websocket.close();
      }
      this.websocket = undefined;
    }

    // Clear pending candidates
    this.pendingRemoteCandidates = [];

    console.log("WebRTC connection closed and resources cleaned up");
  }
}
