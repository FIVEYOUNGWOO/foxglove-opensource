import { WebRTCConnectionState, SignalingMessage } from "./types";

export class WebRTCConnection {
  private websocket?: WebSocket;
  private peerConnection?: RTCPeerConnection;
  private dataChannel?: RTCDataChannel;
  private state: WebRTCConnectionState = WebRTCConnectionState.DISCONNECTED;
  private pendingRemoteCandidates: RTCIceCandidateInit[] = [];

  constructor(
    private signalingUrl: string,
    private streamId: string,
    private onMessage: (data: any) => void,
    private onStateChange: (state: WebRTCConnectionState) => void
  ) {}

  async connect(): Promise<boolean> {
    try {
      this.setState(WebRTCConnectionState.CONNECTING);
      await this.connectToSignalingServer();
      this.setupPeerConnection();
      await this.joinRoom();
      return true;
    } catch (error) {
      console.error("WebRTC connection failed:", error);
      this.setState(WebRTCConnectionState.FAILED);
      return false;
    }
  }

  private async connectToSignalingServer(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.websocket = new WebSocket(this.signalingUrl);

      this.websocket.onopen = () => {
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
        reject(error);
      };
    });
  }

  private setupPeerConnection(): void {
    const config: RTCConfiguration = {
      iceServers: [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:stun1.l.google.com:19302' }
      ]
    };

    this.peerConnection = new RTCPeerConnection(config);

    this.peerConnection.onicecandidate = (event) => {
      if (event.candidate && this.websocket && this.websocket.readyState === WebSocket.OPEN) {
        const message: SignalingMessage = {
          type: 'ice-candidate',
          candidate: event.candidate.toJSON() // RTCIceCandidateInit 반환
        };
        const messageStr = JSON.stringify(message);
        this.websocket.send(messageStr);
      }
    };

    this.peerConnection.onconnectionstatechange = () => {
      const state = this.peerConnection?.connectionState;
      if (state === 'connected') {
        this.setState(WebRTCConnectionState.CONNECTED);
      } else if (state === 'failed' || state === 'disconnected' || state === 'closed') {
        this.setState(WebRTCConnectionState.DISCONNECTED);
      }
    };

    this.peerConnection.ondatachannel = (event) => {
      const channel = event.channel;
      this.attachDataChannelHandlers(channel);
    };
  }

  private attachDataChannelHandlers(channel: RTCDataChannel) {
    this.dataChannel = channel;
    this.dataChannel.onopen = () => console.log("Data channel opened");
    this.dataChannel.onmessage = (ev) => this.onMessage(ev.data);
    this.dataChannel.onclose = () => console.warn("Data channel closed");
    this.dataChannel.onerror = (err) => console.error("Data channel error:", err);
  }

  private async createAndSendOffer(): Promise<void> {
    if (!this.peerConnection) return;

    if (!this.dataChannel) {
      const dc = this.peerConnection.createDataChannel('data');
      this.attachDataChannelHandlers(dc);
    }

    const offer = await this.peerConnection.createOffer();
    await this.peerConnection.setLocalDescription(offer);

    const offerMessage: SignalingMessage = {
      type: 'offer',
      sdp: offer.sdp ?? ""
    };

    if (this.websocket && this.websocket.readyState === WebSocket.OPEN) {
      const messageStr = JSON.stringify(offerMessage);
      this.websocket.send(messageStr);
    }
  }

  private async joinRoom(): Promise<void> {
    const joinMessage: SignalingMessage = {
      type: 'join-room',
      room: this.streamId
    };

    if (this.websocket && this.websocket.readyState === WebSocket.OPEN) {
      const messageStr = JSON.stringify(joinMessage);
      this.websocket.send(messageStr);
    }
  }

  private async handleSignalingMessage(message: SignalingMessage): Promise<void> {
    const pc = this.peerConnection;
    if (!pc) return;

    switch (message.type) {
      case 'start_connection':
        console.info("Received start_connection -> creating offer");
        await this.createAndSendOffer();
        break;

      case 'offer':
        if (!message.sdp) return;
        await pc.setRemoteDescription({ type: 'offer', sdp: message.sdp });

        for (const candidate of this.pendingRemoteCandidates) {
          try {
            await pc.addIceCandidate(candidate);
          } catch (e) {
            console.warn(e);
          }
        }
        this.pendingRemoteCandidates = [];

        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);

        if (this.websocket && this.websocket.readyState === WebSocket.OPEN) {
          const answerMessage = { type: 'answer', sdp: answer.sdp ?? "" };
          const messageStr = JSON.stringify(answerMessage);
          this.websocket.send(messageStr);
        }
        break;

      case 'answer':
        if (!message.sdp) return;
        await pc.setRemoteDescription({ type: 'answer', sdp: message.sdp });
        break;

      case 'ice-candidate':
        if (!message.candidate) return;
        try {
          if (pc.remoteDescription) {
            await pc.addIceCandidate(message.candidate);
          } else {
            this.pendingRemoteCandidates.push(message.candidate);
          }
        } catch (e) {
          console.warn("Failed to add ICE candidate:", e);
        }
        break;

      default:
        console.debug("Unhandled signaling message type:", message.type);
    }
  }

  private setState(newState: WebRTCConnectionState): void {
    if (this.state !== newState) {
      this.state = newState;
      this.onStateChange(newState);
    }
  }

  async close(): Promise<void> {
    this.dataChannel?.close();
    this.peerConnection?.close();
    this.websocket?.close();
  }
}

// // import { WebRTCConnectionState, SignalingMessage } from "./types";

// // export class WebRTCConnection {
// //   private websocket?: WebSocket;
// //   private peerConnection?: RTCPeerConnection;
// //   private dataChannel?: RTCDataChannel;
// //   private state: WebRTCConnectionState = WebRTCConnectionState.DISCONNECTED;

// //   constructor(
// //     private signalingUrl: string,
// //     private streamId: string,
// //     private onMessage: (data: any) => void,
// //     private onStateChange: (state: WebRTCConnectionState) => void
// //   ) {}

// //   async connect(): Promise<boolean> {
// //     try {
// //       this.setState(WebRTCConnectionState.CONNECTING);

// //       await this.connectToSignalingServer();
// //       this.setupPeerConnection();
// //       await this.joinRoom();

// //       return true;
// //     } catch (error) {
// //       console.error("WebRTC connection failed:", error);
// //       this.setState(WebRTCConnectionState.FAILED);
// //       return false;
// //     }
// //   }

// //   private async connectToSignalingServer(): Promise<void> {
// //     return new Promise((resolve, reject) => {
// //       this.websocket = new WebSocket(this.signalingUrl);

// //       this.websocket.onopen = () => {
// //         console.log("Connected to signaling server");
// //         resolve();
// //       };

// //       this.websocket.onmessage = (event) => {
// //         this.handleSignalingMessage(JSON.parse(event.data));
// //       };

// //       this.websocket.onerror = (error) => {
// //         reject(error);
// //       };
// //     });
// //   }

// //   private setupPeerConnection(): void {
// //     const config: RTCConfiguration = {
// //       iceServers: [
// //         { urls: 'stun:stun.l.google.com:19302' },
// //         { urls: 'stun:stun1.l.google.com:19302' }
// //       ]
// //     };

// //     this.peerConnection = new RTCPeerConnection(config);

// //     this.peerConnection.onicecandidate = (event) => {
// //       if (event.candidate && this.websocket?.readyState === WebSocket.OPEN) {
// //         const message: SignalingMessage = {
// //           type: 'ice-candidate',
// //           candidate: event.candidate
// //         };

// //         // Fix: Ensure websocket exists and stringify message
// //         const messageStr = JSON.stringify(message);
// //         if (messageStr) {
// //           this.websocket.send(messageStr);
// //         }
// //       }
// //     };

// //     this.peerConnection.onconnectionstatechange = () => {
// //       const state = this.peerConnection?.connectionState;
// //       if (state === 'connected') {
// //         this.setState(WebRTCConnectionState.CONNECTED);
// //       } else if (state === 'failed' || state === 'disconnected') {
// //         this.setState(WebRTCConnectionState.DISCONNECTED);
// //       }
// //     };

// //     this.peerConnection.ondatachannel = (event) => {
// //       const channel = event.channel;

// //       channel.onmessage = (messageEvent) => {
// //         this.onMessage(messageEvent.data);
// //       };
// //     };
// //   }

// //   private async joinRoom(): Promise<void> {
// //     const joinMessage: SignalingMessage = {
// //       type: 'join-room',
// //       room: this.streamId
// //     };

// //     // Fix: Ensure websocket exists and stringify message
// //     if (this.websocket && this.websocket.readyState === WebSocket.OPEN) {
// //       const messageStr = JSON.stringify(joinMessage);
// //       if (messageStr) {
// //         this.websocket.send(messageStr);
// //       }
// //     }
// //   }

// //   private async handleSignalingMessage(message: SignalingMessage): Promise<void> {
// //     switch (message.type) {
// //       case 'offer':
// //         await this.handleOffer(message);
// //         break;
// //       case 'ice-candidate':
// //         await this.handleIceCandidate(message);
// //         break;
// //     }
// //   }

// //   private async handleOffer(message: SignalingMessage): Promise<void> {
// //     if (!this.peerConnection || !message.sdp) return;

// //     await this.peerConnection.setRemoteDescription({
// //       type: 'offer',
// //       sdp: message.sdp
// //     });

// //     const answer = await this.peerConnection.createAnswer();
// //     await this.peerConnection.setLocalDescription(answer);

// //     const answerMessage: SignalingMessage = {
// //       type: 'answer',
// //       sdp: answer.sdp!
// //     };

// //     // Fix: Ensure websocket exists and stringify message
// //     if (this.websocket && this.websocket.readyState === WebSocket.OPEN) {
// //       const messageStr = JSON.stringify(answerMessage);
// //       if (messageStr) {
// //         this.websocket.send(messageStr);
// //       }
// //     }
// //   }

// //   private async handleIceCandidate(message: SignalingMessage): Promise<void> {
// //     if (!this.peerConnection || !message.candidate) return;
// //     await this.peerConnection.addIceCandidate(message.candidate);
// //   }

// //   private setState(newState: WebRTCConnectionState): void {
// //     if (this.state !== newState) {
// //       this.state = newState;
// //       this.onStateChange(newState);
// //     }
// //   }

// //   async close(): Promise<void> {
// //     if (this.dataChannel) {
// //       this.dataChannel.close();
// //     }
// //     if (this.peerConnection) {
// //       this.peerConnection.close();
// //     }
// //     if (this.websocket) {
// //       this.websocket.close();
// //     }
// //   }
// // }

// // // import { WebRTCConnectionState, SignalingMessage } from "./types";

// // // export class WebRTCConnection {
// // //   private websocket?: WebSocket;
// // //   private peerConnection?: RTCPeerConnection;
// // //   private dataChannel?: RTCDataChannel;
// // //   private state: WebRTCConnectionState = WebRTCConnectionState.DISCONNECTED;

// // //   constructor(
// // //     private signalingUrl: string,
// // //     private streamId: string,
// // //     private onMessage: (data: any) => void,
// // //     private onStateChange: (state: WebRTCConnectionState) => void
// // //   ) {}

// // //   async connect(): Promise<boolean> {
// // //     try {
// // //       this.setState(WebRTCConnectionState.CONNECTING);

// // //       await this.connectToSignalingServer();
// // //       this.setupPeerConnection();
// // //       await this.joinRoom();

// // //       return true;
// // //     } catch (error) {
// // //       console.error("WebRTC connection failed:", error);
// // //       this.setState(WebRTCConnectionState.FAILED);
// // //       return false;
// // //     }
// // //   }

// // //   private async connectToSignalingServer(): Promise<void> {
// // //     return new Promise((resolve, reject) => {
// // //       this.websocket = new WebSocket(this.signalingUrl);

// // //       this.websocket.onopen = () => {
// // //         console.log("Connected to signaling server");
// // //         resolve();
// // //       };

// // //       this.websocket.onmessage = (event) => {
// // //         this.handleSignalingMessage(JSON.parse(event.data));
// // //       };

// // //       this.websocket.onerror = (error) => {
// // //         reject(error);
// // //       };
// // //     });
// // //   }

// // //   private setupPeerConnection(): void {
// // //     const config: RTCConfiguration = {
// // //       iceServers: [
// // //         { urls: 'stun:stun.l.google.com:19302' },
// // //         { urls: 'stun:stun1.l.google.com:19302' }
// // //       ]
// // //     };

// // //     this.peerConnection = new RTCPeerConnection(config);

// // //     this.peerConnection.onicecandidate = (event) => {
// // //       if (event.candidate && this.websocket?.readyState === WebSocket.OPEN) {
// // //         const message: SignalingMessage = {
// // //           type: 'ice-candidate',
// // //           candidate: event.candidate
// // //         };

// // //         // ERROR in ./packages/studio-base/src/players/WebRTCPlayer/WebRTCConnection.ts:67:29
// // //         // TS2769: No overload matches this call.
// // //         //   Overload 1 of 2, '(data: string | Blob | ArrayBufferView | ArrayBufferLike): void', gave the following error.
// // //         //     Argument of type 'string | undefined' is not assignable to parameter of type 'string | Blob | ArrayBufferView | ArrayBufferLike'.
// // //         //   Overload 2 of 2, '(data: string | Blob | ArrayBufferView | ArrayBufferLike): void', gave the following error.
// // //         //     Argument of type 'string | undefined' is not assignable to parameter of type 'string | Blob | ArrayBufferView | ArrayBufferLike'.
// // //         //     65 |           candidate: event.candidate
// // //         //     66 |         };
// // //         //   > 67 |         this.websocket.send(JSON.stringify(message));
// // //         //        |                             ^^^^^^^^^^^^^^^^^^^^^^^
// // //         //     68 |       }
// // //         //     69 |     };
// // //         //     70 |

// // //         this.websocket.send(JSON.stringify(message));
// // //       }
// // //     };

// // //     this.peerConnection.onconnectionstatechange = () => {
// // //       const state = this.peerConnection?.connectionState;
// // //       if (state === 'connected') {
// // //         this.setState(WebRTCConnectionState.CONNECTED);
// // //       } else if (state === 'failed' || state === 'disconnected') {
// // //         this.setState(WebRTCConnectionState.DISCONNECTED);
// // //       }
// // //     };

// // //     this.peerConnection.ondatachannel = (event) => {
// // //       const channel = event.channel;

// // //       channel.onmessage = (messageEvent) => {
// // //         this.onMessage(messageEvent.data);
// // //       };
// // //     };
// // //   }

// // //   private async joinRoom(): Promise<void> {
// // //     const joinMessage: SignalingMessage = {
// // //       type: 'join-room',
// // //       room: this.streamId
// // //     };

// // //     // ERROR in ./packages/studio-base/src/players/WebRTCPlayer/WebRTCConnection.ts:95:26
// // //     // TS2769: No overload matches this call.
// // //     //   Overload 1 of 2, '(data: string | Blob | ArrayBufferView | ArrayBufferLike): void | undefined', gave the following error.
// // //     //     Argument of type 'string | undefined' is not assignable to parameter of type 'string | Blob | ArrayBufferView | ArrayBufferLike'.
// // //     //       Type 'undefined' is not assignable to type 'string | Blob | ArrayBufferView | ArrayBufferLike'.
// // //     //   Overload 2 of 2, '(data: string | Blob | ArrayBufferView | ArrayBufferLike): void | undefined', gave the following error.
// // //     //     Argument of type 'string | undefined' is not assignable to parameter of type 'string | Blob | ArrayBufferView | ArrayBufferLike'.
// // //     //     93 |     };
// // //     //     94 |
// // //     //   > 95 |     this.websocket?.send(JSON.stringify(joinMessage));
// // //     //       |                          ^^^^^^^^^^^^^^^^^^^^^^^^^^^
// // //     //     96 |   }
// // //     //     97 |
// // //     //     98 |   private async handleSignalingMessage(message: SignalingMessage): Promise<void> {

// // //     this.websocket?.send(JSON.stringify(joinMessage));
// // //   }

// // //   private async handleSignalingMessage(message: SignalingMessage): Promise<void> {
// // //     switch (message.type) {
// // //       case 'offer':
// // //         await this.handleOffer(message);
// // //         break;
// // //       case 'ice-candidate':
// // //         await this.handleIceCandidate(message);
// // //         break;
// // //     }
// // //   }

// // //   private async handleOffer(message: SignalingMessage): Promise<void> {
// // //     if (!this.peerConnection || !message.sdp) return;

// // //     await this.peerConnection.setRemoteDescription({
// // //       type: 'offer',
// // //       sdp: message.sdp
// // //     });

// // //     const answer = await this.peerConnection.createAnswer();
// // //     await this.peerConnection.setLocalDescription(answer);

// // //     const answerMessage: SignalingMessage = {
// // //       type: 'answer',
// // //       sdp: answer.sdp!
// // //     };

// // //     // ERROR in ./packages/studio-base/src/players/WebRTCPlayer/WebRTCConnection.ts:124:26
// // //     // TS2769: No overload matches this call.
// // //     //   Overload 1 of 2, '(data: string | Blob | ArrayBufferView | ArrayBufferLike): void | undefined', gave the following error.
// // //     //     Argument of type 'string | undefined' is not assignable to parameter of type 'string | Blob | ArrayBufferView | ArrayBufferLike'.
// // //     //   Overload 2 of 2, '(data: string | Blob | ArrayBufferView | ArrayBufferLike): void | undefined', gave the following error.
// // //     //     Argument of type 'string | undefined' is not assignable to parameter of type 'string | Blob | ArrayBufferView | ArrayBufferLike'.
// // //     //     122 |       sdp: answer.sdp!
// // //     //     123 |     };
// // //     //   > 124 |     this.websocket?.send(JSON.stringify(answerMessage));
// // //     //         |                          ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^
// // //     //     125 |   }
// // //     //     126 |
// // //     //     127 |   private async handleIceCandidate(message: SignalingMessage): Promise<void> {

// // //     this.websocket?.send(JSON.stringify(answerMessage));
// // //   }

// // //   private async handleIceCandidate(message: SignalingMessage): Promise<void> {
// // //     if (!this.peerConnection || !message.candidate) return;
// // //     await this.peerConnection.addIceCandidate(message.candidate);
// // //   }

// // //   private setState(newState: WebRTCConnectionState): void {
// // //     if (this.state !== newState) {
// // //       this.state = newState;
// // //       this.onStateChange(newState);
// // //     }
// // //   }

// // //   async close(): Promise<void> {
// // //     if (this.dataChannel) {
// // //       this.dataChannel.close();
// // //     }
// // //     if (this.peerConnection) {
// // //       this.peerConnection.close();
// // //     }
// // //     if (this.websocket) {
// // //       this.websocket.close();
// // //     }
// // //   }
// // // }
