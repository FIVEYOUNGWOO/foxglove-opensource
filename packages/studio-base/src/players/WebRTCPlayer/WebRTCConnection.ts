import { WebRTCConnectionState } from "./types";

interface SignalingMessage
{
    type: 'offer' | 'answer' | 'ice-candidate' | 'join-room' | 'peer-list' |
          'error' | 'start_connection' | 'peer_state_change' | 'peer_disconnected' |
          'role_assigned' | 'joined' | 'wait_for_offer' | 'pong' | 'ping' | 'join' | 'create_offer';
    data?: any;
    sdp?: string;
    candidate?: any;
    room?: string;
    peerId?: string;
    peers?: string[];
    error?: string;
    peer_id?: string;
    client_id?: string;
    role?: string;
    your_role?: string;
    state?: string;
    sdpMid?: string;
    sdpMLineIndex?: number;
    target_id?: string;
    source_id?: string;
}

interface ConnectionConfig
{
    signalingUrl: string;
    streamId: string;
    onMessage: (data: any) => void;
    onStateChange: (state: WebRTCConnectionState) => void;
}

interface ConnectionStats
{
    messagesReceived: number;
    bytesReceived: number;
    connectionAttempts: number;
    iceCandidatesSent: number;
    iceCandidatesReceived: number;
    connectionStartTime: number;
    lastMessageTime: number;
    chunkedMessagesReceived: number;
    nonChunkedMessagesReceived: number;
}

export class WebRTCConnection
{
    private websocket?: WebSocket;
    private peerConnection?: RTCPeerConnection;
    private dataChannel?: RTCDataChannel;
    private state: WebRTCConnectionState = WebRTCConnectionState.DISCONNECTED;

    private pendingRemoteCandidates: RTCIceCandidateInit[] = [];
    private remoteDescriptionSet: boolean = false;

    private connectionAttempts: number = 0;
    private readonly maxConnectionAttempts: number = 5;
    private readonly reconnectionDelay: number = 3000;
    private reconnectionTimer?: number;

    private stats: ConnectionStats =
    {
        messagesReceived: 0,
        bytesReceived: 0,
        connectionAttempts: 0,
        iceCandidatesSent: 0,
        iceCandidatesReceived: 0,
        connectionStartTime: 0,
        lastMessageTime: 0,
        chunkedMessagesReceived: 0,
        nonChunkedMessagesReceived: 0
    };

    private readonly config: ConnectionConfig;
    private clientId?: string;

    constructor(signalingUrl: string, streamId: string, onMessage: (data: any) => void, onStateChange: (state: WebRTCConnectionState) => void)
    {
        this.config = {signalingUrl, streamId, onMessage, onStateChange};
        console.log(`[WebRTC] Consumer initialized for stream: ${streamId}`);
    }

    async connect(): Promise<boolean>
    {
        if (this.connectionAttempts >= this.maxConnectionAttempts)
        {
            console.error(`[WebRTC] Max connection attempts (${this.maxConnectionAttempts}) exceeded`);
            this.setState(WebRTCConnectionState.FAILED);
            return false;
        }

        try
        {
            this.connectionAttempts++;
            this.stats.connectionAttempts++;
            this.stats.connectionStartTime = Date.now();
            this.setState(WebRTCConnectionState.CONNECTING);

            console.log(`[WebRTC] Connection attempt ${this.connectionAttempts}/${this.maxConnectionAttempts}`);

            await this.connectToSignalingServer();
            this.setupPeerConnection();
            await this.joinRoom();

            const maxWaitTime = 30000;
            const startTime = Date.now();

            while (Date.now() - startTime < maxWaitTime)
            {
                if (this.state === WebRTCConnectionState.CONNECTED &&
                    this.dataChannel?.readyState === 'open')
                {
                    console.log("[WebRTC] Connection established successfully!");
                    return true;
                }
                await new Promise(resolve => setTimeout(resolve, 100));
            }

            console.error("[WebRTC] Connection timeout - state:", this.state, "dataChannel:", this.dataChannel?.readyState);
            throw new Error("Connection timeout");
        }
        catch (error)
        {
            console.error("[WebRTC] Connection failed:", error);
            this.setState(WebRTCConnectionState.FAILED);

            if (this.connectionAttempts < this.maxConnectionAttempts)
            {
                this.scheduleReconnection();
            }

            return false;
        }
    }

    private async connectToSignalingServer(): Promise<void>
    {
        return new Promise((resolve, reject) =>
        {
            if (this.websocket)
            {
                this.websocket.close();
            }

            const wsUrl = this.config.signalingUrl;
            console.log(`[WebRTC] Connecting to signaling server: ${wsUrl}`);

            this.websocket = new WebSocket(wsUrl);

            const connectionTimeout = setTimeout(() =>
            {
                reject(new Error("Signaling server connection timeout"));
            }, 10000);

            this.websocket.onopen = () =>
            {
                clearTimeout(connectionTimeout);
                console.log("[WebRTC] Connected to signaling server");
                resolve();
            };

            this.websocket.onmessage = (event) =>
            {
                try
                {
                    const msg = JSON.parse(event.data) as SignalingMessage;
                    console.log("[WebRTC] Received signaling message:", msg.type);
                    void this.handleSignalingMessage(msg);
                }
                catch (error)
                {
                    console.error("[WebRTC] Invalid signaling message:", error);
                }
            };

            this.websocket.onerror = (error) =>
            {
                clearTimeout(connectionTimeout);
                console.error("[WebRTC] Signaling server error:", error);
                reject(error);
            };

            this.websocket.onclose = (event) =>
            {
                clearTimeout(connectionTimeout);
                console.log(`[WebRTC] Signaling connection closed: ${event.code} - ${event.reason}`);

                if (this.state === WebRTCConnectionState.CONNECTED ||
                    this.state === WebRTCConnectionState.CONNECTING)
                {
                    this.handleDisconnection();
                }
            };
        });
    }

    private setupPeerConnection(): void
    {
        if (this.peerConnection)
        {
            this.peerConnection.close();
        }

        const configuration: RTCConfiguration =
        {
            iceServers: [
                { urls: 'stun:stun.l.google.com:19302' }
            ],
            iceCandidatePoolSize: 10,
            bundlePolicy: 'max-bundle',
            rtcpMuxPolicy: 'require'
        };

        this.peerConnection = new RTCPeerConnection(configuration);
        console.log("[WebRTC] Peer connection created");

        this.peerConnection.onconnectionstatechange = () =>
        {
            const state = this.peerConnection?.connectionState;
            console.log(`[WebRTC] Connection state: ${state}`);

            switch (state)
            {
                case 'connected':
                    this.handleConnectionEstablished();
                    break;
                case 'failed':
                    this.handleConnectionFailed();
                    break;
                case 'disconnected':
                case 'closed':
                    this.handleDisconnection();
                    break;
            }
        };

        this.peerConnection.oniceconnectionstatechange = () =>
        {
            console.log(`[WebRTC] ICE connection state: ${this.peerConnection?.iceConnectionState}`);
        };

        this.peerConnection.onicegatheringstatechange = () =>
        {
            console.log(`[WebRTC] ICE gathering state: ${this.peerConnection?.iceGatheringState}`);
        };

        this.peerConnection.onicecandidate = (event) =>
        {
            if (event.candidate && this.websocket?.readyState === WebSocket.OPEN)
            {
                this.sendIceCandidate(event.candidate);
            }
        };

        this.peerConnection.ondatachannel = (event) =>
        {
            console.log(`[WebRTC] Received data channel: ${event.channel.label}`);
            this.attachDataChannelHandlers(event.channel);
        };
    }

    private attachDataChannelHandlers(channel: RTCDataChannel): void
    {
        this.dataChannel = channel;

        this.dataChannel.onopen = () =>
        {
            console.log("[WebRTC] Data channel opened");
            this.setState(WebRTCConnectionState.CONNECTED);
            this.connectionAttempts = 0;
        };

        this.dataChannel.onmessage = (event) =>
        {
            try
            {
                this.stats.messagesReceived++;
                this.stats.lastMessageTime = Date.now();

                let messageData: any;

                if (typeof event.data === 'string')
                {
                    messageData = event.data;
                    this.stats.bytesReceived += event.data.length;

                    if (this.isChunkedData(event.data))
                    {
                        this.stats.chunkedMessagesReceived++;
                    }
                    else
                    {
                        this.stats.nonChunkedMessagesReceived++;
                    }
                }
                else if (event.data instanceof ArrayBuffer)
                {
                    messageData = event.data;
                    this.stats.bytesReceived += event.data.byteLength;
                }
                else if (event.data instanceof Blob)
                {
                    event.data.arrayBuffer().then(buffer =>
                    {
                        this.stats.bytesReceived += buffer.byteLength;
                        this.config.onMessage(buffer);
                    }).catch(error => {
                        console.error("[WebRTC] Failed to process Blob data:", error);
                    });
                    return;
                }
                else
                {
                    console.warn("[WebRTC] Unsupported data type:", typeof event.data);
                    return;
                }

                this.config.onMessage(messageData);
            }
            catch (error)
            {
                console.error("[WebRTC] Error processing data channel message:", error);
            }
        };

        this.dataChannel.onclose = () => {
            console.warn("[WebRTC] Data channel closed");
            this.handleDisconnection();
        };

        this.dataChannel.onerror = (error) => {
            console.error("[WebRTC] Data channel error:", error);
        };

        this.dataChannel.bufferedAmountLowThreshold = 65536;
        this.dataChannel.onbufferedamountlow = () => {
            console.debug("[WebRTC] Data channel buffer low");
        };
    }

    private isChunkedData(data: string): boolean
    {
        return data.includes('|') && data.includes('"msg_id"') &&
               data.includes('"seq"') && data.includes('"total"');
    }

    private async joinRoom(): Promise<void>
    {
        const joinMessage: SignalingMessage =
        {
            type: 'join-room',
            room: this.config.streamId
        };

        if (this.websocket?.readyState === WebSocket.OPEN)
        {
            const messageStr = JSON.stringify(joinMessage);
            this.websocket.send(messageStr);
            console.log(`[WebRTC] Joining room: ${this.config.streamId}`);
        }
        else
        {
            throw new Error("WebSocket not ready for joining room");
        }
    }

    private async handleSignalingMessage(message: SignalingMessage): Promise<void>
    {
        const pc = this.peerConnection;
        if (!pc)
        {
            console.error("[WebRTC] No peer connection");
            return;
        }

        try
        {
            switch (message.type)
            {
                case 'role_assigned':
                    this.clientId = message.client_id;
                    console.log(`[WebRTC] Role assigned: ${message.role}, ID: ${this.clientId}`);
                    break;

                case 'joined':
                    console.log(`[WebRTC] Joined room: ${message.room}`);
                    break;

                case 'wait_for_offer':
                    console.log("[WebRTC] Waiting for offer from producer...");
                    break;

                case 'offer':
                    await this.handleOffer(message);
                    break;

                case 'ice-candidate':
                    await this.handleIceCandidate(message);
                    break;

                case 'peer_disconnected':
                    console.warn(`[WebRTC] Peer disconnected: ${message.peer_id}`);
                    this.handleDisconnection();
                    break;

                case 'pong':
                    console.debug("[WebRTC] Received pong");
                    break;

                default:
                    console.debug(`[WebRTC] Unhandled message: ${message.type}`);
            }
        }
        catch (error)
        {
            console.error(`[WebRTC] Error handling ${message.type}:`, error);
        }
    }

    private async handleOffer(message: SignalingMessage): Promise<void>
    {
        if (!message.sdp)
        {
            console.error("[WebRTC] Received offer without SDP");
            return;
        }

        const pc = this.peerConnection!;
        console.log("[WebRTC] Processing offer from producer");

        await pc.setRemoteDescription({ type: 'offer', sdp: message.sdp });
        this.remoteDescriptionSet = true;
        console.log("[WebRTC] Remote description set");

        await this.processBufferedIceCandidates();

        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);

        if (this.websocket?.readyState === WebSocket.OPEN)
        {
            const answerMessage: SignalingMessage =
            {
                type: 'answer',
                sdp: answer.sdp || ""
            };
            const messageStr = JSON.stringify(answerMessage);
            this.websocket.send(messageStr);
            console.log("[WebRTC] Answer sent");
        }
    }

    private async handleIceCandidate(message: SignalingMessage): Promise<void>
    {
        this.stats.iceCandidatesReceived++;

        const candidateData = message.candidate;

        if (!candidateData)
        {
            console.debug("[WebRTC] End-of-candidates signal");
            return;
        }

        try
        {
            let candidateInit: RTCIceCandidateInit;

            if (typeof candidateData === 'object' && candidateData.candidate)
            {
                candidateInit = {
                    candidate: candidateData.candidate,
                    sdpMid: candidateData.sdpMid || message.sdpMid || '0',
                    sdpMLineIndex: candidateData.sdpMLineIndex !== undefined
                        ? candidateData.sdpMLineIndex
                        : (message.sdpMLineIndex !== undefined ? message.sdpMLineIndex : 0)
                };
            }
            else if (typeof candidateData === 'string')
            {
                candidateInit = {
                    candidate: candidateData,
                    sdpMid: message.sdpMid || '0',
                    sdpMLineIndex: message.sdpMLineIndex !== undefined ? message.sdpMLineIndex : 0
                };
            }
            else
            {
                console.warn("[WebRTC] Invalid candidate format:", candidateData);
                return;
            }

            if (!candidateInit.candidate || candidateInit.candidate.trim() === '')
            {
                console.debug("[WebRTC] Empty candidate, skipping");
                return;
            }

            if (this.remoteDescriptionSet)
            {
                await this.peerConnection!.addIceCandidate(candidateInit);
                console.debug("[WebRTC] ICE candidate added");
            }
            else
            {
                this.pendingRemoteCandidates.push(candidateInit);
                console.debug(`[WebRTC] ICE candidate buffered (${this.pendingRemoteCandidates.length} total)`);
            }
        }
        catch (error)
        {
            console.warn("[WebRTC] Failed to add ICE candidate:", error);
        }
    }

    private async processBufferedIceCandidates(): Promise<void>
    {
        if (!this.pendingRemoteCandidates.length)
        {
            return;
        }

        console.log(`[WebRTC] Processing ${this.pendingRemoteCandidates.length} buffered ICE candidates`);

        for (const candidate of this.pendingRemoteCandidates)
        {
            try
            {
                await this.peerConnection!.addIceCandidate(candidate);
            }
            catch (error)
            {
                console.error("[WebRTC] Failed to add buffered candidate:", error);
            }
        }

        this.pendingRemoteCandidates = [];
    }

    private sendIceCandidate(candidate: RTCIceCandidate): void
    {
        const message: SignalingMessage =
        {
            type: 'ice-candidate',
            candidate: {
                candidate: candidate.candidate,
                sdpMid: candidate.sdpMid,
                sdpMLineIndex: candidate.sdpMLineIndex
            }
        };

        try
        {
            if (this.websocket?.readyState === WebSocket.OPEN)
            {
                const messageStr = JSON.stringify(message);
                this.websocket.send(messageStr);
                this.stats.iceCandidatesSent++;
                console.debug(`[WebRTC] ICE candidate sent (${this.stats.iceCandidatesSent} total)`);
            }
        }
        catch (error)
        {
            console.error("[WebRTC] Failed to send ICE candidate:", error);
        }
    }

    private handleConnectionEstablished(): void
    {
        this.setState(WebRTCConnectionState.CONNECTED);
        this.connectionAttempts = 0;
        console.log("[WebRTC] P2P connection established");
        this.startKeepalive();
    }

    private handleConnectionFailed(): void
    {
        console.error("[WebRTC] Connection failed");
        this.setState(WebRTCConnectionState.FAILED);
        this.scheduleReconnection();
    }

    private handleDisconnection(): void
    {
        if (this.state === WebRTCConnectionState.DISCONNECTED)
        {
            return;
        }

        console.warn("[WebRTC] Connection disconnected");
        this.setState(WebRTCConnectionState.DISCONNECTED);
        this.scheduleReconnection();
    }

    private scheduleReconnection(): void
    {
        if (this.connectionAttempts >= this.maxConnectionAttempts)
        {
            console.error("[WebRTC] Max reconnection attempts reached");
            return;
        }

        if (this.reconnectionTimer)
        {
            clearTimeout(this.reconnectionTimer);
        }

        console.log(`[WebRTC] Scheduling reconnection in ${this.reconnectionDelay}ms...`);
        this.reconnectionTimer = window.setTimeout(() =>
        {
            this.setState(WebRTCConnectionState.RECONNECTING);
            void this.connect();
        }, this.reconnectionDelay);
    }

    private startKeepalive(): void
    {
        const keepaliveInterval = 30000;

        const sendPing = () =>
        {
            if (this.websocket?.readyState === WebSocket.OPEN)
            {
                const pingMessage = JSON.stringify({ type: 'ping' });
                this.websocket.send(pingMessage);
            }
        };

        sendPing();
        setInterval(sendPing, keepaliveInterval);
    }

    private setState(newState: WebRTCConnectionState): void
    {
        if (this.state !== newState)
        {
            const oldState = this.state;
            this.state = newState;
            console.log(`[WebRTC] State change: ${oldState} -> ${newState}`);
            this.config.onStateChange(newState);
        }
    }

    public getState(): WebRTCConnectionState
    {
        return this.state;
    }

    public getStatistics(): ConnectionStats & { connectionHealth: string }
    {
        const baseStats = { ...this.stats };

        let connectionHealth = 'unknown';
        if (this.state === WebRTCConnectionState.CONNECTED)
        {
            const timeSinceLastMessage = Date.now() - this.stats.lastMessageTime;
            if (timeSinceLastMessage < 10000)
            {
                connectionHealth = 'excellent';
            }
            else if (timeSinceLastMessage < 30000)
            {
                connectionHealth = 'good';
            }
            else if (timeSinceLastMessage < 60000)
            {
                connectionHealth = 'fair';
            }
            else
            {
                connectionHealth = 'poor';
            }
        }
        else
        {
            connectionHealth = this.state;
        }

        return { ...baseStats, connectionHealth };
    }

    public isReady(): boolean
    {
        return this.state === WebRTCConnectionState.CONNECTED &&
               this.dataChannel?.readyState === 'open';
    }

    public async reconnect(): Promise<boolean>
    {
        console.log("[WebRTC] Manual reconnection requested");
        await this.close();
        this.connectionAttempts = 0;
        return await this.connect();
    }

    public async close(): Promise<void>
    {
        console.log("[WebRTC] Closing connection...");

        this.setState(WebRTCConnectionState.DISCONNECTED);

        if (this.reconnectionTimer)
        {
            clearTimeout(this.reconnectionTimer);
            this.reconnectionTimer = undefined;
        }

        if (this.dataChannel)
        {
            if (this.dataChannel.readyState === 'open')
            {
                this.dataChannel.close();
            }
            this.dataChannel = undefined;
        }

        if (this.peerConnection)
        {
            this.peerConnection.close();
            this.peerConnection = undefined;
        }

        if (this.websocket)
        {
            if (this.websocket.readyState === WebSocket.OPEN ||
                this.websocket.readyState === WebSocket.CONNECTING)
            {
                this.websocket.close();
            }
            this.websocket = undefined;
        }

        this.pendingRemoteCandidates = [];
        this.remoteDescriptionSet = false;

        console.log("[WebRTC] Connection closed");
    }
}


/**
 * DO NOT TOUCH
 */
// import { WebRTCConnectionState } from "./types";

// // Extended SignalingMessage interface
// interface SignalingMessage
// {
//     type: 'offer' | 'answer' | 'ice-candidate' | 'join-room' | 'peer-list' |
//           'error' | 'start_connection' | 'peer_state_change' | 'peer_disconnected' |
//           'role_assigned' | 'joined' | 'wait_for_offer' | 'pong' | 'ping' | 'join';
//     data?: any;
//     sdp?: string;
//     candidate?: RTCIceCandidateInit;
//     room?: string;
//     peerId?: string;
//     peers?: string[];
//     error?: string;
//     peer_id?: string;
//     your_role?: string;
//     state?: string;
//     sdpMid?: string;
//     sdpMLineIndex?: number;
// }

// interface ConnectionConfig
// {
//     signalingUrl: string;
//     streamId: string;
//     onMessage: (data: any) => void;
//     onStateChange: (state: WebRTCConnectionState) => void;
// }

// interface ConnectionStats
// {
//     messagesReceived: number;
//     bytesReceived: number;
//     connectionAttempts: number;
//     iceCandidatesSent: number;
//     iceCandidatesReceived: number;
//     connectionStartTime: number;
//     lastMessageTime: number;
//     chunkedMessagesReceived: number;
//     nonChunkedMessagesReceived: number;
// }

// export class WebRTCConnection
// {
//     private websocket?: WebSocket;
//     private peerConnection?: RTCPeerConnection;
//     private dataChannel?: RTCDataChannel;
//     private state: WebRTCConnectionState = WebRTCConnectionState.DISCONNECTED;

//     // ICE candidate management
//     private pendingRemoteCandidates: RTCIceCandidateInit[] = [];

//     // Connection management
//     private connectionAttempts: number = 0;
//     private readonly maxConnectionAttempts: number = 5;
//     private readonly reconnectionDelay: number = 3000;
//     private reconnectionTimer?: number;

//     // Statistics tracking
//     private stats: ConnectionStats =
//     {
//         messagesReceived: 0,
//         bytesReceived: 0,
//         connectionAttempts: 0,
//         iceCandidatesSent: 0,
//         iceCandidatesReceived: 0,
//         connectionStartTime: 0,
//         lastMessageTime: 0,
//         chunkedMessagesReceived: 0,
//         nonChunkedMessagesReceived: 0
//     };

//     // Configuration
//     private readonly config: ConnectionConfig;
//     private clientId?: string;

//     constructor(signalingUrl: string, streamId: string, onMessage: (data: any) => void, onStateChange: (state: WebRTCConnectionState) => void)
//     {
//         this.config = {signalingUrl, streamId, onMessage, onStateChange};
//         console.log(`[WebRTC] Consumer initialized for stream: ${streamId}`);
//     }

//     async connect(): Promise<boolean>
//     {
//         if (this.connectionAttempts >= this.maxConnectionAttempts)
//         {
//             console.error(`[WebRTC] Max connection attempts (${this.maxConnectionAttempts}) exceeded`);
//             this.setState(WebRTCConnectionState.FAILED);
//             return false;
//         }

//         try
//         {
//             this.connectionAttempts++;
//             this.stats.connectionAttempts++;
//             this.stats.connectionStartTime = Date.now();
//             this.setState(WebRTCConnectionState.CONNECTING);

//             console.log(`[WebRTC] Connection attempt ${this.connectionAttempts}/${this.maxConnectionAttempts}`);

//             // Step 1: Connect to signaling server
//             await this.connectToSignalingServer();

//             // Step 2: Initialize peer connection
//             this.setupPeerConnection();

//             // Step 3: Join room as consumer
//             await this.joinRoom();

//             return true;
//         }
//         catch (error)
//         {
//             console.error("[WebRTC] Connection failed:", error);
//             this.setState(WebRTCConnectionState.FAILED);

//             // Schedule reconnection if attempts remaining
//             if (this.connectionAttempts < this.maxConnectionAttempts)
//             {
//                 this.scheduleReconnection();
//             }

//             return false;
//         }
//     }

//     private async connectToSignalingServer(): Promise<void>
//     {
//         return new Promise((resolve, reject) =>
//         {
//             // Clean up existing connection
//             if (this.websocket)
//             {
//                 this.websocket.close();
//             }

//             const wsUrl = `${this.config.signalingUrl}?type=consumer&room=${this.config.streamId}`;
//             console.log(`[WebRTC] Connecting to signaling server: ${wsUrl}`);

//             this.websocket = new WebSocket(wsUrl);

//             const connectionTimeout = setTimeout(() =>
//             {
//                 reject(new Error("Signaling server connection timeout"));
//             }, 10000);

//             this.websocket.onopen = () =>
//             {
//                 clearTimeout(connectionTimeout);
//                 console.log("[WebRTC] Connected to signaling server as CONSUMER");
//                 resolve();
//             };

//             this.websocket.onmessage = (event) =>
//             {
//                 try
//                 {
//                     const msg = JSON.parse(event.data) as SignalingMessage;
//                     void this.handleSignalingMessage(msg);
//                 }
//                 catch (error)
//                 {
//                     console.error("[WebRTC] Invalid signaling message:", error);
//                 }
//             };

//             this.websocket.onerror = (error) =>
//             {
//                 clearTimeout(connectionTimeout);
//                 console.error("[WebRTC] Signaling server error:", error);
//                 reject(error);
//             };

//             this.websocket.onclose = (event) =>
//             {
//                 clearTimeout(connectionTimeout);
//                 console.log(`[WebRTC] Signaling connection closed: ${event.code} - ${event.reason}`);

//                 // Handle unexpected disconnection
//                 if (this.state === WebRTCConnectionState.CONNECTED || this.state === WebRTCConnectionState.CONNECTING)
//                 {
//                     this.handleDisconnection();
//                 }
//             };
//         });
//     }

//     private setupPeerConnection(): void
//     {
//         // Clean up existing connection
//         if (this.peerConnection)
//         {
//             this.peerConnection.close();
//         }

//         const configuration: RTCConfiguration =
//         {
//             // DO NOT TOUCH
//             iceServers: [
//                 { urls: 'stun:stun.l.google.com:19302' },
//                 { urls: 'stun:stun1.l.google.com:19302' },
//                 { urls: 'stun:stun2.l.google.com:19302' }
//             ],
//             iceCandidatePoolSize: 10,
//             bundlePolicy: 'max-bundle',
//             rtcpMuxPolicy: 'require'
//         };

//         this.peerConnection = new RTCPeerConnection(configuration);
//         console.log("[WebRTC] Peer connection created for consumer");

//         // Connection state monitoring
//         this.peerConnection.onconnectionstatechange = () =>
//         {
//             const state = this.peerConnection?.connectionState;
//             console.log(`[WebRTC] Connection state: ${state}`);

//             switch (state)
//             {
//                 case 'connected':
//                     this.handleConnectionEstablished();
//                     break;
//                 case 'failed':
//                     this.handleConnectionFailed();
//                     break;
//                 case 'disconnected':
//                 case 'closed':
//                     this.handleDisconnection();
//                     break;
//                 case 'connecting':
//                     console.log("[WebRTC] Establishing connection...");
//                     break;
//             }
//         };

//         // ICE connection state monitoring
//         this.peerConnection.oniceconnectionstatechange = () =>
//         {
//             const iceState = this.peerConnection?.iceConnectionState;
//             console.log(`[WebRTC] ICE connection state: ${iceState}`);
//         };

//         // ICE gathering state monitoring
//         this.peerConnection.onicegatheringstatechange = () =>
//         {
//             const gatheringState = this.peerConnection?.iceGatheringState;
//             console.log(`[WebRTC] ICE gathering state: ${gatheringState}`);
//         };

//         // ICE candidate generation
//         this.peerConnection.onicecandidate = (event) =>
//         {
//             if (event.candidate && this.websocket?.readyState === WebSocket.OPEN)
//             {
//                 this.sendIceCandidate(event.candidate);
//             }
//         };

//         // Data channel handler - Consumer receives channel from producer
//         this.peerConnection.ondatachannel = (event) =>
//         {
//             console.log(`[WebRTC] Received data channel: ${event.channel.label}`);
//             this.attachDataChannelHandlers(event.channel);
//         };
//     }

//     private attachDataChannelHandlers(channel: RTCDataChannel): void
//     {
//         this.dataChannel = channel;

//         this.dataChannel.onopen = () =>
//         {
//             console.log("[WebRTC] Data channel opened - ready to receive data");
//             this.setState(WebRTCConnectionState.CONNECTED);
//             this.connectionAttempts = 0; // Reset on successful connection
//         };

//         this.dataChannel.onmessage = (event) =>
//         {
//             try
//             {
//                 // Update statistics
//                 this.stats.messagesReceived++;
//                 this.stats.lastMessageTime = Date.now();

//                 let messageData: any;

//                 if (typeof event.data === 'string')
//                 {
//                     messageData = event.data;
//                     this.stats.bytesReceived += event.data.length;

//                     // Track chunk vs non-chunk messages
//                     if (this.isChunkedData(event.data))
//                     {
//                         this.stats.chunkedMessagesReceived++;
//                         console.debug(`[WebRTC] Received chunked message: ${event.data.substring(0, 100)}...`);
//                     }
//                     else
//                     {
//                         this.stats.nonChunkedMessagesReceived++;
//                         console.debug(`[WebRTC] Received non-chunked message: ${event.data.substring(0, 100)}...`);
//                     }

//                 }
//                 else if (event.data instanceof ArrayBuffer)
//                 {
//                     messageData = event.data;
//                     this.stats.bytesReceived += event.data.byteLength;
//                     console.debug(`[WebRTC] Received ArrayBuffer: ${event.data.byteLength} bytes`);
//                 }
//                 else if (event.data instanceof Blob)
//                 {
//                     // Convert Blob to ArrayBuffer
//                     event.data.arrayBuffer().then(buffer =>
//                     {
//                         this.stats.bytesReceived += buffer.byteLength;
//                         console.debug(`[WebRTC] Received Blob converted to ArrayBuffer: ${buffer.byteLength} bytes`);
//                         this.config.onMessage(buffer);
//                     }).catch(error => {console.error("[WebRTC] Failed to process Blob data:", error);});
//                     return;
//                 }
//                 else
//                 {
//                     console.warn("[WebRTC] Unsupported data type:", typeof event.data);
//                     return;
//                 }

//                 // Pass data to message handler
//                 this.config.onMessage(messageData);

//             }
//             catch (error)
//             {
//                 console.error("[WebRTC] Error processing data channel message:", error);
//             }
//         };

//         this.dataChannel.onclose = () => {console.warn("[WebRTC] Data channel closed"); this.handleDisconnection();};
//         this.dataChannel.onerror = (error) => {console.error("[WebRTC] Data channel error:", error);};

//         // Set buffer threshold for flow control
//         this.dataChannel.bufferedAmountLowThreshold = 65536;
//         this.dataChannel.onbufferedamountlow = () => {console.debug("[WebRTC] Data channel buffer low");};
//     }

//     private isChunkedData(data: string): boolean
//     {
//         return data.includes('|') && data.includes('"msg_id"') && data.includes('"seq"') && data.includes('"total"');
//     }

//     private async joinRoom(): Promise<void>
//     {
//         const joinMessage: SignalingMessage =
//         {
//             type: 'join-room',
//             room: this.config.streamId,
//             data: {role: 'consumer', capabilities: ['data-channel', 'low-latency']}
//         };

//         if (this.websocket?.readyState === WebSocket.OPEN)
//         {
//             const messageStr = JSON.stringify(joinMessage);
//             if (messageStr)
//             {
//                 this.websocket.send(messageStr);
//             }
//             console.log(`[WebRTC] Joining room as consumer: ${this.config.streamId}`);
//         } else {
//             throw new Error("WebSocket not ready for joining room");
//         }
//     }

//     private async handleSignalingMessage(message: SignalingMessage): Promise<void> {
//         const pc = this.peerConnection;
//         if (!pc) {
//             console.error("[WebRTC] Received message but peer connection not initialized");
//             return;
//         }

//         try {
//             console.debug(`[WebRTC] Handling signaling message: ${message.type}`);

//             switch (message.type) {
//                 case 'role_assigned':
//                     this.handleRoleAssigned(message);
//                     break;

//                 case 'joined':
//                     this.handleJoined(message);
//                     break;

//                 case 'wait_for_offer':
//                     console.info("[WebRTC] Waiting for offer from producer...");
//                     break;

//                 case 'offer':
//                     await this.handleOffer(message);
//                     break;

//                 case 'ice-candidate':
//                     await this.handleIceCandidate(message);
//                     break;

//                 case 'peer_disconnected':
//                     this.handlePeerDisconnected(message);
//                     break;

//                 case 'pong':
//                     console.debug("[WebRTC] Received pong from signaling server");
//                     break;

//                 default:
//                     console.debug(`[WebRTC] Unhandled message type: ${message.type}`);
//             }
//         } catch (error) {
//             console.error(`[WebRTC] Error handling ${message.type}:`, error);
//         }
//     }

//     private handleRoleAssigned(message: SignalingMessage): void {
//         this.clientId = message.data?.client_id;
//         const role = message.data?.role;
//         console.info(`[WebRTC] Assigned role: ${role}, Client ID: ${this.clientId}`);
//     }

//     private handleJoined(message: SignalingMessage): void {
//         const room = message.data?.room || message.room;
//         console.info(`[WebRTC] Successfully joined room: ${room}`);
//     }

//     private async handleOffer(message: SignalingMessage): Promise<void> {
//         if (!message.sdp) {
//             console.error("[WebRTC] Received offer without SDP");
//             return;
//         }

//         const pc = this.peerConnection!;
//         console.log("[WebRTC] Processing offer from producer");

//         // Set remote description with offer
//         await pc.setRemoteDescription({ type: 'offer', sdp: message.sdp });
//         console.log("[WebRTC] Remote description set with offer");

//         // Process any buffered ICE candidates
//         await this.processBufferedIceCandidates();

//         // Create and send answer
//         const answer = await pc.createAnswer();
//         await pc.setLocalDescription(answer);

//         if (this.websocket?.readyState === WebSocket.OPEN) {
//             const answerMessage: SignalingMessage = {
//                 type: 'answer',
//                 sdp: answer.sdp || ""
//             };

//             const messageStr = JSON.stringify(answerMessage);
//             if (messageStr) {
//                 this.websocket.send(messageStr);
//             }
//             console.log("[WebRTC] Answer sent to producer");
//         }
//     }

//     private async handleIceCandidate(message: SignalingMessage): Promise<void> {
//         this.stats.iceCandidatesReceived++;

//         if (!message.candidate) {
//             console.debug("[WebRTC] Received end-of-candidates signal");
//             return;
//         }

//         const pc = this.peerConnection!;

//         try {
//             let candidateInit: RTCIceCandidateInit;

//             // Handle different candidate formats
//             if (typeof message.candidate === 'string') {
//                 candidateInit = {
//                     candidate: message.candidate,
//                     sdpMid: message.sdpMid || '0',
//                     sdpMLineIndex: message.sdpMLineIndex !== undefined ? message.sdpMLineIndex : 0
//                 };
//             } else if (typeof message.candidate === 'object') {
//                 candidateInit = {
//                     candidate: message.candidate.candidate || String(message.candidate),
//                     sdpMid: message.candidate.sdpMid || message.sdpMid || '0',
//                     sdpMLineIndex: message.candidate.sdpMLineIndex !== undefined
//                         ? message.candidate.sdpMLineIndex
//                         : (message.sdpMLineIndex !== undefined ? message.sdpMLineIndex : 0)
//                 };
//             } else {
//                 console.warn("[WebRTC] Invalid candidate format:", typeof message.candidate);
//                 return;
//             }

//             // Validate candidate
//             if (!candidateInit.candidate || candidateInit.candidate.trim() === '') {
//                 console.debug("[WebRTC] Empty candidate, skipping");
//                 return;
//             }

//             // Add candidate
//             if (this.peerConnection?.remoteDescription) {
//                 await pc.addIceCandidate(candidateInit);
//                 console.debug("[WebRTC] ICE candidate added successfully");
//             } else {
//                 // Buffer candidate until remote description is set
//                 this.pendingRemoteCandidates.push(candidateInit);
//                 console.debug(`[WebRTC] ICE candidate buffered (${this.pendingRemoteCandidates.length} total)`);
//             }
//         } catch (error) {
//             console.warn("[WebRTC] Failed to add ICE candidate:", error);
//             console.debug("Candidate data:", message.candidate);
//         }
//     }

//     private async processBufferedIceCandidates(): Promise<void> {
//         if (!this.pendingRemoteCandidates.length) {
//             return;
//         }

//         const pc = this.peerConnection!;
//         console.log(`[WebRTC] Processing ${this.pendingRemoteCandidates.length} buffered ICE candidates`);

//         for (const candidate of this.pendingRemoteCandidates) {
//             try {
//                 await pc.addIceCandidate(candidate);
//                 console.debug("[WebRTC] Buffered ICE candidate added");
//             } catch (error) {
//                 console.error("[WebRTC] Failed to add buffered candidate:", error);
//             }
//         }

//         this.pendingRemoteCandidates = [];
//     }

//     private sendIceCandidate(candidate: RTCIceCandidate): void {
//         const message: SignalingMessage = {
//             type: 'ice-candidate',
//             candidate: candidate.toJSON()
//         };

//         try {
//             if (this.websocket?.readyState === WebSocket.OPEN) {
//                 const messageStr = JSON.stringify(message);
//                 if (messageStr) {
//                     this.websocket.send(messageStr);
//                 }
//                 this.stats.iceCandidatesSent++;
//                 console.debug(`[WebRTC] ICE candidate sent (${this.stats.iceCandidatesSent} total)`);
//             }
//         } catch (error) {
//             console.error("[WebRTC] Failed to send ICE candidate:", error);
//         }
//     }

//     private handlePeerDisconnected(message: SignalingMessage): void {
//         const peerId = message.data?.peer_id || message.peerId;
//         console.warn(`[WebRTC] Producer disconnected: ${peerId}`);
//         this.handleDisconnection();
//     }

//     private handleConnectionEstablished(): void {
//         this.setState(WebRTCConnectionState.CONNECTED);
//         this.connectionAttempts = 0;
//         console.info("[WebRTC] P2P connection established successfully");

//         // Send periodic keepalive
//         this.startKeepalive();
//     }

//     private handleConnectionFailed(): void {
//         console.error("[WebRTC] Connection failed");
//         this.setState(WebRTCConnectionState.FAILED);
//         this.scheduleReconnection();
//     }

//     private handleDisconnection(): void {
//         if (this.state === WebRTCConnectionState.DISCONNECTED) {
//             return; // Already handling disconnection
//         }

//         console.warn("[WebRTC] Connection disconnected");
//         this.setState(WebRTCConnectionState.DISCONNECTED);
//         this.scheduleReconnection();
//     }

//     private scheduleReconnection(): void {
//         if (this.connectionAttempts >= this.maxConnectionAttempts) {
//             console.error("[WebRTC] Max reconnection attempts reached");
//             return;
//         }

//         // Clear existing timer
//         if (this.reconnectionTimer) {
//             clearTimeout(this.reconnectionTimer);
//         }

//         console.log(`[WebRTC] Scheduling reconnection in ${this.reconnectionDelay}ms...`);
//         this.reconnectionTimer = window.setTimeout(() => {
//             this.setState(WebRTCConnectionState.RECONNECTING);
//             void this.connect();
//         }, this.reconnectionDelay);
//     }

//     private startKeepalive(): void {
//         const keepaliveInterval = 30000; // 30 seconds

//         const sendPing = () => {
//             if (this.websocket?.readyState === WebSocket.OPEN) {
//                 const pingMessage = JSON.stringify({ type: 'ping' });
//                 if (pingMessage) {
//                     this.websocket.send(pingMessage);
//                 }
//             }
//         };

//         // Send initial ping
//         sendPing();

//         // Schedule periodic pings
//         setInterval(sendPing, keepaliveInterval);
//     }

//     private setState(newState: WebRTCConnectionState): void {
//         if (this.state !== newState) {
//             const oldState = this.state;
//             this.state = newState;
//             console.log(`[WebRTC] State change: ${oldState} -> ${newState}`);
//             this.config.onStateChange(newState);
//         }
//     }

//     public getState(): WebRTCConnectionState {
//         return this.state;
//     }

//     public getStatistics(): ConnectionStats & { connectionHealth: string } {
//         const baseStats = { ...this.stats };

//         // Calculate connection health
//         let connectionHealth = 'unknown';
//         if (this.state === WebRTCConnectionState.CONNECTED) {
//             const timeSinceLastMessage = Date.now() - this.stats.lastMessageTime;
//             if (timeSinceLastMessage < 10000) {
//                 connectionHealth = 'excellent';
//             } else if (timeSinceLastMessage < 30000) {
//                 connectionHealth = 'good';
//             } else if (timeSinceLastMessage < 60000) {
//                 connectionHealth = 'fair';
//             } else {
//                 connectionHealth = 'poor';
//             }
//         } else {
//             connectionHealth = this.state;
//         }

//         return {
//             ...baseStats,
//             connectionHealth
//         };
//     }

//     public isReady(): boolean {
//         return this.state === WebRTCConnectionState.CONNECTED &&
//                this.dataChannel?.readyState === 'open';
//     }

//     public async reconnect(): Promise<boolean> {
//         console.log("[WebRTC] Manual reconnection requested");
//         await this.close();
//         this.connectionAttempts = 0;
//         return await this.connect();
//     }

//     public async close(): Promise<void> {
//         console.log("[WebRTC] Closing connection...");

//         this.setState(WebRTCConnectionState.DISCONNECTED);

//         // Clear reconnection timer
//         if (this.reconnectionTimer) {
//             clearTimeout(this.reconnectionTimer);
//             this.reconnectionTimer = undefined;
//         }

//         // Close data channel
//         if (this.dataChannel) {
//             if (this.dataChannel.readyState === 'open') {
//                 this.dataChannel.close();
//             }
//             this.dataChannel = undefined;
//         }

//         // Close peer connection
//         if (this.peerConnection) {
//             this.peerConnection.close();
//             this.peerConnection = undefined;
//         }

//         // Close WebSocket
//         if (this.websocket) {
//             if (this.websocket.readyState === WebSocket.OPEN ||
//                 this.websocket.readyState === WebSocket.CONNECTING) {
//                 this.websocket.close();
//             }
//             this.websocket = undefined;
//         }

//         // Clear buffers
//         this.pendingRemoteCandidates = [];

//         console.log("[WebRTC] Connection closed and resources cleaned");
//     }
// }
// z
