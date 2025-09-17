import { WebRTCConnectionState, SignalingMessage } from "./types";

export class WebRTCConnection {
  private websocket?: WebSocket;
  private peerConnection?: RTCPeerConnection;
  private dataChannel?: RTCDataChannel;
  private state: WebRTCConnectionState = WebRTCConnectionState.DISCONNECTED;

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
        this.handleSignalingMessage(JSON.parse(event.data));
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
      if (event.candidate && this.websocket?.readyState === WebSocket.OPEN) {
        const message: SignalingMessage = {
          type: 'ice-candidate',
          candidate: event.candidate
        };

        // ERROR in ./packages/studio-base/src/players/WebRTCPlayer/WebRTCConnection.ts:67:29
        // TS2769: No overload matches this call.
        //   Overload 1 of 2, '(data: string | Blob | ArrayBufferView | ArrayBufferLike): void', gave the following error.
        //     Argument of type 'string | undefined' is not assignable to parameter of type 'string | Blob | ArrayBufferView | ArrayBufferLike'.
        //   Overload 2 of 2, '(data: string | Blob | ArrayBufferView | ArrayBufferLike): void', gave the following error.
        //     Argument of type 'string | undefined' is not assignable to parameter of type 'string | Blob | ArrayBufferView | ArrayBufferLike'.
        //     65 |           candidate: event.candidate
        //     66 |         };
        //   > 67 |         this.websocket.send(JSON.stringify(message));
        //        |                             ^^^^^^^^^^^^^^^^^^^^^^^
        //     68 |       }
        //     69 |     };
        //     70 |

        this.websocket.send(JSON.stringify(message));
      }
    };

    this.peerConnection.onconnectionstatechange = () => {
      const state = this.peerConnection?.connectionState;
      if (state === 'connected') {
        this.setState(WebRTCConnectionState.CONNECTED);
      } else if (state === 'failed' || state === 'disconnected') {
        this.setState(WebRTCConnectionState.DISCONNECTED);
      }
    };

    this.peerConnection.ondatachannel = (event) => {
      const channel = event.channel;

      channel.onmessage = (messageEvent) => {
        this.onMessage(messageEvent.data);
      };
    };
  }

  private async joinRoom(): Promise<void> {
    const joinMessage: SignalingMessage = {
      type: 'join-room',
      room: this.streamId
    };

    // ERROR in ./packages/studio-base/src/players/WebRTCPlayer/WebRTCConnection.ts:95:26
    // TS2769: No overload matches this call.
    //   Overload 1 of 2, '(data: string | Blob | ArrayBufferView | ArrayBufferLike): void | undefined', gave the following error.
    //     Argument of type 'string | undefined' is not assignable to parameter of type 'string | Blob | ArrayBufferView | ArrayBufferLike'.
    //       Type 'undefined' is not assignable to type 'string | Blob | ArrayBufferView | ArrayBufferLike'.
    //   Overload 2 of 2, '(data: string | Blob | ArrayBufferView | ArrayBufferLike): void | undefined', gave the following error.
    //     Argument of type 'string | undefined' is not assignable to parameter of type 'string | Blob | ArrayBufferView | ArrayBufferLike'.
    //     93 |     };
    //     94 |
    //   > 95 |     this.websocket?.send(JSON.stringify(joinMessage));
    //       |                          ^^^^^^^^^^^^^^^^^^^^^^^^^^^
    //     96 |   }
    //     97 |
    //     98 |   private async handleSignalingMessage(message: SignalingMessage): Promise<void> {

    this.websocket?.send(JSON.stringify(joinMessage));
  }

  private async handleSignalingMessage(message: SignalingMessage): Promise<void> {
    switch (message.type) {
      case 'offer':
        await this.handleOffer(message);
        break;
      case 'ice-candidate':
        await this.handleIceCandidate(message);
        break;
    }
  }

  private async handleOffer(message: SignalingMessage): Promise<void> {
    if (!this.peerConnection || !message.sdp) return;

    await this.peerConnection.setRemoteDescription({
      type: 'offer',
      sdp: message.sdp
    });

    const answer = await this.peerConnection.createAnswer();
    await this.peerConnection.setLocalDescription(answer);

    const answerMessage: SignalingMessage = {
      type: 'answer',
      sdp: answer.sdp!
    };

    // ERROR in ./packages/studio-base/src/players/WebRTCPlayer/WebRTCConnection.ts:124:26
    // TS2769: No overload matches this call.
    //   Overload 1 of 2, '(data: string | Blob | ArrayBufferView | ArrayBufferLike): void | undefined', gave the following error.
    //     Argument of type 'string | undefined' is not assignable to parameter of type 'string | Blob | ArrayBufferView | ArrayBufferLike'.
    //   Overload 2 of 2, '(data: string | Blob | ArrayBufferView | ArrayBufferLike): void | undefined', gave the following error.
    //     Argument of type 'string | undefined' is not assignable to parameter of type 'string | Blob | ArrayBufferView | ArrayBufferLike'.
    //     122 |       sdp: answer.sdp!
    //     123 |     };
    //   > 124 |     this.websocket?.send(JSON.stringify(answerMessage));
    //         |                          ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^
    //     125 |   }
    //     126 |
    //     127 |   private async handleIceCandidate(message: SignalingMessage): Promise<void> {

    this.websocket?.send(JSON.stringify(answerMessage));
  }

  private async handleIceCandidate(message: SignalingMessage): Promise<void> {
    if (!this.peerConnection || !message.candidate) return;
    await this.peerConnection.addIceCandidate(message.candidate);
  }

  private setState(newState: WebRTCConnectionState): void {
    if (this.state !== newState) {
      this.state = newState;
      this.onStateChange(newState);
    }
  }

  async close(): Promise<void> {
    if (this.dataChannel) {
      this.dataChannel.close();
    }
    if (this.peerConnection) {
      this.peerConnection.close();
    }
    if (this.websocket) {
      this.websocket.close();
    }
  }
}
