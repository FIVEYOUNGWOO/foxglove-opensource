/**
 * Enhanced WebRTC Connection for Foxglove
 * Purpose: Establish P2P connection as CONSUMER to receive sensor data
 * Role: CONSUMER - Receives offer and creates answer
 *
 * Input: WebRTC signaling messages and data channel messages
 * Output: Processed sensor data to Foxglove visualization
 */

import { WebRTCConnectionState, SignalingMessage } from "./types";

interface ConnectionConfig {
    signalingUrl: string;
    streamId: string;
    onMessage: (data: any) => void;
    onStateChange: (state: WebRTCConnectionState) => void;
}

interface ConnectionStats {
    messagesReceived: number;
    bytesReceived: number;
    connectionAttempts: number;
    iceCandidatesSent: number;
    iceCandidatesReceived: number;
    connectionStartTime: number;
    lastMessageTime: number;
}

export class WebRTCConnection {
    private websocket?: WebSocket;
    private peerConnection?: RTCPeerConnection;
    private dataChannel?: RTCDataChannel;
    private state: WebRTCConnectionState = WebRTCConnectionState.DISCONNECTED;

    // ICE candidate management
    private pendingRemoteCandidates: RTCIceCandidateInit[] = [];
    private remoteDescriptionSet: boolean = false;

    // Connection management
    private connectionAttempts: number = 0;
    private readonly maxConnectionAttempts: number = 5;
    private readonly reconnectionDelay: number = 3000;
    private reconnectionTimer?: number;

    // Statistics tracking
    private stats: ConnectionStats = {
        messagesReceived: 0,
        bytesReceived: 0,
        connectionAttempts: 0,
        iceCandidatesSent: 0,
        iceCandidatesReceived: 0,
        connectionStartTime: 0,
        lastMessageTime: 0
    };

    // Configuration
    private readonly config: ConnectionConfig;
    private clientId?: string;
    private pairedProducerId?: string;

    constructor(
        signalingUrl: string,
        streamId: string,
        onMessage: (data: any) => void,
        onStateChange: (state: WebRTCConnectionState) => void
    ) {
        /**
         * Initialize WebRTC consumer connection
         * Input: Connection configuration
         * Output: Configured connection instance
         * Purpose: Set up consumer for receiving sensor data
         */
        this.config = {
            signalingUrl,
            streamId,
            onMessage,
            onStateChange
        };

        console.log(`[WebRTC] Consumer initialized for stream: ${streamId}`);
    }

    async connect(): Promise<boolean> {
        /**
         * Establish WebRTC connection as consumer
         * Input: None
         * Output: Connection success status
         * Purpose: Connect to producer and start receiving data
         */
        if (this.connectionAttempts >= this.maxConnectionAttempts) {
            console.error(`[WebRTC] Max connection attempts (${this.maxConnectionAttempts}) exceeded`);
            this.setState(WebRTCConnectionState.FAILED);
            return false;
        }

        try {
            this.connectionAttempts++;
            this.stats.connectionAttempts++;
            this.stats.connectionStartTime = Date.now();
            this.setState(WebRTCConnectionState.CONNECTING);

            console.log(`[WebRTC] Connection attempt ${this.connectionAttempts}/${this.maxConnectionAttempts}`);

            // Step 1: Connect to signaling server
            await this.connectToSignalingServer();

            // Step 2: Initialize peer connection
            this.setupPeerConnection();

            // Step 3: Join room as consumer
            await this.joinRoom();

            return true;
        } catch (error) {
            console.error("[WebRTC] Connection failed:", error);
            this.setState(WebRTCConnectionState.FAILED);

            // Schedule reconnection if attempts remaining
            if (this.connectionAttempts < this.maxConnectionAttempts) {
                this.scheduleReconnection();
            }

            return false;
        }
    }

    private async connectToSignalingServer(): Promise<void> {
        /**
         * Connect to WebSocket signaling server
         * Input: None
         * Output: Active WebSocket connection
         * Purpose: Establish signaling channel as consumer
         */
        return new Promise((resolve, reject) => {
            // Clean up existing connection
            if (this.websocket) {
                this.websocket.close();
            }

            const wsUrl = `${this.config.signalingUrl}?type=consumer&room=${this.config.streamId}`;
            console.log(`[WebRTC] Connecting to signaling server: ${wsUrl}`);

            this.websocket = new WebSocket(wsUrl);

            const connectionTimeout = setTimeout(() => {
                reject(new Error("Signaling server connection timeout"));
            }, 10000);

            this.websocket.onopen = () => {
                clearTimeout(connectionTimeout);
                console.log("[WebRTC] Connected to signaling server as CONSUMER");
                resolve();
            };

            this.websocket.onmessage = (event) => {
                try {
                    const msg = JSON.parse(event.data) as SignalingMessage;
                    void this.handleSignalingMessage(msg);
                } catch (error) {
                    console.error("[WebRTC] Invalid signaling message:", error);
                }
            };

            this.websocket.onerror = (error) => {
                clearTimeout(connectionTimeout);
                console.error("[WebRTC] Signaling server error:", error);
                reject(error);
            };

            this.websocket.onclose = (event) => {
                clearTimeout(connectionTimeout);
                console.log(`[WebRTC] Signaling connection closed: ${event.code} - ${event.reason}`);

                // Handle unexpected disconnection
                if (this.state === WebRTCConnectionState.CONNECTED ||
                    this.state === WebRTCConnectionState.CONNECTING) {
                    this.handleDisconnection();
                }
            };
        });
    }

    private setupPeerConnection(): void {
        /**
         * Initialize RTCPeerConnection for consumer
         * Input: None
         * Output: Configured peer connection ready to receive offer
         * Purpose: Set up P2P connection with proper ICE configuration
         */

        // Clean up existing connection
        if (this.peerConnection) {
            this.peerConnection.close();
        }

        const configuration: RTCConfiguration = {
            iceServers: [
                { urls: 'stun:stun.l.google.com:19302' },
                { urls: 'stun:stun1.l.google.com:19302' },
                { urls: 'stun:stun2.l.google.com:19302' }
            ],
            iceCandidatePoolSize: 10,
            bundlePolicy: 'max-bundle',
            rtcpMuxPolicy: 'require'
        };

        this.peerConnection = new RTCPeerConnection(configuration);
        console.log("[WebRTC] Peer connection created for consumer");

        // Connection state monitoring
        this.peerConnection.onconnectionstatechange = () => {
            const state = this.peerConnection?.connectionState;
            console.log(`[WebRTC] Connection state: ${state}`);

            switch (state) {
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
                case 'connecting':
                    console.log("[WebRTC] Establishing connection...");
                    break;
            }
        };

        // ICE connection state monitoring
        this.peerConnection.oniceconnectionstatechange = () => {
            const iceState = this.peerConnection?.iceConnectionState;
            console.log(`[WebRTC] ICE connection state: ${iceState}`);
        };

        // ICE gathering state monitoring
        this.peerConnection.onicegatheringstatechange = () => {
            const gatheringState = this.peerConnection?.iceGatheringState;
            console.log(`[WebRTC] ICE gathering state: ${gatheringState}`);
        };

        // ICE candidate generation
        this.peerConnection.onicecandidate = (event) => {
            if (event.candidate && this.websocket?.readyState === WebSocket.OPEN) {
                this.sendIceCandidate(event.candidate);
            }
        };

        // Data channel handler - Consumer receives channel from producer
        this.peerConnection.ondatachannel = (event) => {
            console.log(`[WebRTC] Received data channel: ${event.channel.label}`);
            this.attachDataChannelHandlers(event.channel);
        };
    }

    private attachDataChannelHandlers(channel: RTCDataChannel): void {
        /**
         * Attach event handlers to received data channel
         * Input: RTCDataChannel from producer
         * Output: Configured data channel ready to receive
         * Purpose: Handle incoming sensor data stream
         */
        this.dataChannel = channel;

        this.dataChannel.onopen = () => {
            console.log("[WebRTC] Data channel opened - ready to receive data");
            this.setState(WebRTCConnectionState.CONNECTED);
            this.connectionAttempts = 0; // Reset on successful connection
        };

        this.dataChannel.onmessage = (event) => {
            try {
                // Update statistics
                this.stats.messagesReceived++;
                this.stats.lastMessageTime = Date.now();

                // Handle different data types
                let messageData: any;

                if (typeof event.data === 'string') {
                    messageData = event.data;
                    this.stats.bytesReceived += event.data.length;
                } else if (event.data instanceof ArrayBuffer) {
                    messageData = event.data;
                    this.stats.bytesReceived += event.data.byteLength;
                } else if (event.data instanceof Blob) {
                    // Convert Blob to ArrayBuffer
                    event.data.arrayBuffer().then(buffer => {
                        this.stats.bytesReceived += buffer.byteLength;
                        this.config.onMessage(buffer);
                    }).catch(error => {
                        console.error("[WebRTC] Failed to process Blob data:", error);
                    });
                    return;
                } else {
                    console.warn("[WebRTC] Unsupported data type:", typeof event.data);
                    return;
                }

                // Pass data to message handler
                this.config.onMessage(messageData);

            } catch (error) {
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

        // Set buffer threshold for flow control
        this.dataChannel.bufferedAmountLowThreshold = 65536;
        this.dataChannel.onbufferedamountlow = () => {
            console.debug("[WebRTC] Data channel buffer low");
        };
    }

    private async joinRoom(): Promise<void> {
        /**
         * Join signaling room as consumer
         * Input: None
         * Output: Room membership and pairing
         * Purpose: Register with signaling server for producer pairing
         */
        const joinMessage: SignalingMessage = {
            type: 'join-room',
            room: this.config.streamId,
            data: {
                role: 'consumer',
                capabilities: ['data-channel', 'low-latency']
            }
        };

        if (this.websocket?.readyState === WebSocket.OPEN) {
            this.websocket.send(JSON.stringify(joinMessage));
            console.log(`[WebRTC] Joining room as consumer: ${this.config.streamId}`);
        } else {
            throw new Error("WebSocket not ready for joining room");
        }
    }

    private async handleSignalingMessage(message: SignalingMessage): Promise<void> {
        /**
         * Process signaling messages from server
         * Input: Signaling message
         * Output: Appropriate WebRTC actions
         * Purpose: Handle offer/answer exchange and ICE negotiation
         */
        const pc = this.peerConnection;
        if (!pc) {
            console.error("[WebRTC] Received message but peer connection not initialized");
            return;
        }

        try {
            console.debug(`[WebRTC] Handling signaling message: ${message.type}`);

            switch (message.type) {
                case 'role_assigned':
                    this.handleRoleAssigned(message);
                    break;

                case 'joined':
                    this.handleJoined(message);
                    break;

                case 'wait_for_offer':
                    console.info("[WebRTC] Waiting for offer from producer...");
                    this.pairedProducerId = message.data?.source_id;
                    break;

                case 'offer':
                    await this.handleOffer(message);
                    break;

                case 'ice-candidate':
                    await this.handleIceCandidate(message);
                    break;

                case 'peer_disconnected':
                    this.handlePeerDisconnected(message);
                    break;

                case 'pong':
                    // Keepalive response
                    break;

                default:
                    console.debug(`[WebRTC] Unhandled message type: ${message.type}`);
            }
        } catch (error) {
            console.error(`[WebRTC] Error handling ${message.type}:`, error);
        }
    }

    private handleRoleAssigned(message: SignalingMessage): void {
        /**
         * Handle role assignment from server
         * Input: Role assignment message
         * Output: Client ID and role confirmation
         * Purpose: Confirm consumer role assignment
         */
        this.clientId = message.data?.client_id;
        const role = message.data?.role;
        console.info(`[WebRTC] Assigned role: ${role}, Client ID: ${this.clientId}`);
    }

    private handleJoined(message: SignalingMessage): void {
        /**
         * Handle room join confirmation
         * Input: Join confirmation message
         * Output: Room membership confirmed
         * Purpose: Confirm successful room entry
         */
        const room = message.data?.room || message.room;
        console.info(`[WebRTC] Successfully joined room: ${room}`);
    }

    private async handleOffer(message: SignalingMessage): Promise<void> {
        /**
         * Process offer from producer and create answer
         * Input: SDP offer from producer
         * Output: SDP answer sent back
         * Purpose: Complete WebRTC negotiation as answerer
         */
        if (!message.sdp) {
            console.error("[WebRTC] Received offer without SDP");
            return;
        }

        const pc = this.peerConnection!;
        console.log("[WebRTC] Processing offer from producer");

        // Set remote description with offer
        await pc.setRemoteDescription({ type: 'offer', sdp: message.sdp });
        this.remoteDescriptionSet = true;
        console.log("[WebRTC] Remote description set with offer");

        // Process any buffered ICE candidates
        await this.processBufferedIceCandidates();

        // Create and send answer
        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);

        if (this.websocket?.readyState === WebSocket.OPEN) {
            const answerMessage: SignalingMessage = {
                type: 'answer',
                sdp: answer.sdp || ""
            };

            this.websocket.send(JSON.stringify(answerMessage));
            console.log("[WebRTC] Answer sent to producer");
        }
    }

    private async handleIceCandidate(message: SignalingMessage): Promise<void> {
        /**
         * Process ICE candidate from producer
         * Input: ICE candidate data
         * Output: Added candidate or buffered
         * Purpose: Complete NAT traversal
         */
        this.stats.iceCandidatesReceived++;

        if (!message.candidate) {
            console.debug("[WebRTC] Received end-of-candidates signal");
            return;
        }

        const pc = this.peerConnection!;

        try {
            if (this.remoteDescriptionSet) {
                await pc.addIceCandidate(message.candidate);
                console.debug("[WebRTC] ICE candidate added successfully");
            } else {
                // Buffer candidate until remote description is set
                this.pendingRemoteCandidates.push(message.candidate);
                console.debug(`[WebRTC] ICE candidate buffered (${this.pendingRemoteCandidates.length} total)`);
            }
        } catch (error) {
            console.warn("[WebRTC] Failed to add ICE candidate:", error);
        }
    }

    private async processBufferedIceCandidates(): Promise<void> {
        /**
         * Add buffered ICE candidates after remote description
         * Input: Buffered candidates array
         * Output: All candidates added to connection
         * Purpose: Handle candidates that arrived before offer
         */
        if (!this.pendingRemoteCandidates.length) {
            return;
        }

        const pc = this.peerConnection!;
        console.log(`[WebRTC] Processing ${this.pendingRemoteCandidates.length} buffered ICE candidates`);

        for (const candidate of this.pendingRemoteCandidates) {
            try {
                await pc.addIceCandidate(candidate);
                console.debug("[WebRTC] Buffered ICE candidate added");
            } catch (error) {
                console.error("[WebRTC] Failed to add buffered candidate:", error);
            }
        }

        this.pendingRemoteCandidates = [];
    }

    private sendIceCandidate(candidate: RTCIceCandidate): void {
        /**
         * Send ICE candidate to producer
         * Input: RTCIceCandidate object
         * Output: Candidate sent through signaling
         * Purpose: Share ICE candidates for NAT traversal
         */
        const message: SignalingMessage = {
            type: 'ice-candidate',
            candidate: candidate.toJSON()
        };

        try {
            if (this.websocket?.readyState === WebSocket.OPEN) {
                this.websocket.send(JSON.stringify(message));
                this.stats.iceCandidatesSent++;
                console.debug(`[WebRTC] ICE candidate sent (${this.stats.iceCandidatesSent} total)`);
            }
        } catch (error) {
            console.error("[WebRTC] Failed to send ICE candidate:", error);
        }
    }

    private handlePeerDisconnected(message: SignalingMessage): void {
        /**
         * Handle producer disconnection
         * Input: Disconnection notification
         * Output: Connection cleanup
         * Purpose: Gracefully handle producer disconnect
         */
        const peerId = message.data?.peer_id || message.peerId;
        console.warn(`[WebRTC] Producer disconnected: ${peerId}`);
        this.handleDisconnection();
    }

    private handleConnectionEstablished(): void {
        /**
         * Handle successful connection establishment
         * Input: None
         * Output: State update and statistics reset
         * Purpose: Mark connection as ready for data reception
         */
        this.setState(WebRTCConnectionState.CONNECTED);
        this.connectionAttempts = 0;
        console.info("[WebRTC] P2P connection established successfully");

        // Send periodic keepalive
        this.startKeepalive();
    }

    private handleConnectionFailed(): void {
        /**
         * Handle connection failure
         * Input: None
         * Output: Reconnection attempt or failure state
         * Purpose: Recover from connection failures
         */
        console.error("[WebRTC] Connection failed");
        this.setState(WebRTCConnectionState.FAILED);
        this.scheduleReconnection();
    }

    private handleDisconnection(): void {
        /**
         * Handle unexpected disconnection
         * Input: None
         * Output: Cleanup and reconnection attempt
         * Purpose: Maintain connection resilience
         */
        if (this.state === WebRTCConnectionState.DISCONNECTED) {
            return; // Already handling disconnection
        }

        console.warn("[WebRTC] Connection disconnected");
        this.setState(WebRTCConnectionState.DISCONNECTED);
        this.scheduleReconnection();
    }

    private scheduleReconnection(): void {
        /**
         * Schedule automatic reconnection attempt
         * Input: None
         * Output: Delayed reconnection
         * Purpose: Implement automatic recovery
         */
        if (this.connectionAttempts >= this.maxConnectionAttempts) {
            console.error("[WebRTC] Max reconnection attempts reached");
            return;
        }

        // Clear existing timer
        if (this.reconnectionTimer) {
            clearTimeout(this.reconnectionTimer);
        }

        console.log(`[WebRTC] Scheduling reconnection in ${this.reconnectionDelay}ms...`);
        this.reconnectionTimer = window.setTimeout(() => {
            this.setState(WebRTCConnectionState.RECONNECTING);
            void this.connect();
        }, this.reconnectionDelay);
    }

    private startKeepalive(): void {
        /**
         * Start periodic keepalive messages
         * Input: None
         * Output: Periodic ping messages
         * Purpose: Maintain connection health
         */
        const keepaliveInterval = 30000; // 30 seconds

        const sendPing = () => {
            if (this.websocket?.readyState === WebSocket.OPEN) {
                this.websocket.send(JSON.stringify({ type: 'ping' }));
            }
        };

        // Send initial ping
        sendPing();

        // Schedule periodic pings
        setInterval(sendPing, keepaliveInterval);
    }

    private setState(newState: WebRTCConnectionState): void {
        /**
         * Update connection state
         * Input: New connection state
         * Output: State change notification
         * Purpose: Track and notify state changes
         */
        if (this.state !== newState) {
            const oldState = this.state;
            this.state = newState;
            console.log(`[WebRTC] State change: ${oldState} -> ${newState}`);
            this.config.onStateChange(newState);
        }
    }

    public getState(): WebRTCConnectionState {
        /**
         * Get current connection state
         * Input: None
         * Output: Current state enum value
         * Purpose: Allow external state monitoring
         */
        return this.state;
    }

    public getStatistics(): ConnectionStats {
        /**
         * Get connection statistics
         * Input: None
         * Output: Statistics object
         * Purpose: Monitor connection performance
         */
        return {
            ...this.stats,
            connectionUptime: this.stats.connectionStartTime
                ? Date.now() - this.stats.connectionStartTime
                : 0
        };
    }

    public isReady(): boolean {
        /**
         * Check if connection is ready for data
         * Input: None
         * Output: Ready status
         * Purpose: Verify connection readiness
         */
        return this.state === WebRTCConnectionState.CONNECTED &&
               this.dataChannel?.readyState === 'open';
    }

    public async reconnect(): Promise<boolean> {
        /**
         * Force manual reconnection
         * Input: None
         * Output: Connection success status
         * Purpose: Allow manual connection recovery
         */
        console.log("[WebRTC] Manual reconnection requested");
        await this.close();
        this.connectionAttempts = 0;
        return await this.connect();
    }

    public async close(): Promise<void> {
        /**
         * Close all connections and cleanup
         * Input: None
         * Output: Cleaned up resources
         * Purpose: Graceful shutdown
         */
        console.log("[WebRTC] Closing connection...");

        this.setState(WebRTCConnectionState.DISCONNECTED);

        // Clear reconnection timer
        if (this.reconnectionTimer) {
            clearTimeout(this.reconnectionTimer);
            this.reconnectionTimer = undefined;
        }

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
            if (this.websocket.readyState === WebSocket.OPEN ||
                this.websocket.readyState === WebSocket.CONNECTING) {
                this.websocket.close();
            }
            this.websocket = undefined;
        }

        // Clear buffers
        this.pendingRemoteCandidates = [];
        this.remoteDescriptionSet = false;

        console.log("[WebRTC] Connection closed and resources cleaned");
    }
}











// import { WebRTCConnectionState, SignalingMessage } from "./types";

// export class WebRTCConnection {
//   private websocket?: WebSocket;
//   private peerConnection?: RTCPeerConnection;
//   private dataChannel?: RTCDataChannel;
//   private state: WebRTCConnectionState = WebRTCConnectionState.DISCONNECTED;
//   private pendingRemoteCandidates: RTCIceCandidateInit[] = [];
//   private connectionAttempts: number = 0;
//   private maxConnectionAttempts: number = 5;
//   private reconnectionDelay: number = 3000; // 3 seconds

//   constructor(
//     private signalingUrl: string,
//     private streamId: string,
//     private onMessage: (data: any) => void,
//     private onStateChange: (state: WebRTCConnectionState) => void
//   ) {}

//   async connect(): Promise<boolean> {
//     if (this.connectionAttempts >= this.maxConnectionAttempts) {
//       console.error(`Maximum connection attempts (${this.maxConnectionAttempts}) exceeded`);
//       this.setState(WebRTCConnectionState.FAILED);
//       return false;
//     }

//     try {
//       this.connectionAttempts++;
//       this.setState(WebRTCConnectionState.CONNECTING);

//       console.log(`WebRTC connection attempt ${this.connectionAttempts}/${this.maxConnectionAttempts}`);

//       await this.connectToSignalingServer();
//       this.setupPeerConnection();
//       await this.joinRoom();

//       return true;
//     } catch (error) {
//       console.error("WebRTC connection failed:", error);
//       this.setState(WebRTCConnectionState.FAILED);

//       // Attempt automatic reconnection if configured
//       if (this.connectionAttempts < this.maxConnectionAttempts) {
//         console.log(`Retrying connection in ${this.reconnectionDelay}ms...`);
//         setTimeout(() => {
//           void this.connect();
//         }, this.reconnectionDelay);
//       }

//       return false;
//     }
//   }

//   private async connectToSignalingServer(): Promise<void> {
//     return new Promise((resolve, reject) => {
//       // Clean up existing websocket if any
//       if (this.websocket) {
//         this.websocket.close();
//       }

//       this.websocket = new WebSocket(this.signalingUrl);

//       const connectionTimeout = setTimeout(() => {
//         reject(new Error("Signaling server connection timeout"));
//       }, 10000); // 10 second timeout

//       this.websocket.onopen = () => {
//         clearTimeout(connectionTimeout);
//         console.log("Connected to signaling server");
//         resolve();
//       };

//       this.websocket.onmessage = (event) => {
//         try {
//           const msg = JSON.parse(event.data) as SignalingMessage;
//           void this.handleSignalingMessage(msg);
//         } catch (e) {
//           console.error("Invalid signaling message:", e);
//         }
//       };

//       this.websocket.onerror = (error) => {
//         clearTimeout(connectionTimeout);
//         console.error("Signaling server connection error:", error);
//         reject(error);
//       };

//       this.websocket.onclose = (event) => {
//         clearTimeout(connectionTimeout);
//         console.log("Signaling server connection closed:", event.code, event.reason);

//         // Handle unexpected closures
//         if (this.state === WebRTCConnectionState.CONNECTED || this.state === WebRTCConnectionState.CONNECTING) {
//           this.setState(WebRTCConnectionState.RECONNECTING);

//           // Attempt to reconnect after a delay
//           setTimeout(() => {
//             void this.connect();
//           }, this.reconnectionDelay);
//         }
//       };
//     });
//   }

//   private setupPeerConnection(): void {
//     // Clean up existing peer connection if any
//     if (this.peerConnection) {
//       this.peerConnection.close();
//     }

//     const config: RTCConfiguration = {
//       iceServers: [
//         { urls: 'stun:stun.l.google.com:19302' },
//         { urls: 'stun:stun1.l.google.com:19302' },
//         { urls: 'stun:stun2.l.google.com:19302' }
//       ],
//       iceCandidatePoolSize: 10
//     };

//     this.peerConnection = new RTCPeerConnection(config);

//     // Set up connection state monitoring
//     this.peerConnection.onconnectionstatechange = () => {
//       const state = this.peerConnection?.connectionState;
//       console.log(`WebRTC peer connection state: ${state}`);

//       switch (state) {
//         case 'connected':
//           this.setState(WebRTCConnectionState.CONNECTED);
//           this.connectionAttempts = 0; // Reset attempts on successful connection
//           break;
//         case 'failed':
//         case 'disconnected':
//         case 'closed':
//           this.setState(WebRTCConnectionState.DISCONNECTED);
//           // Attempt reconnection for failed/disconnected states
//           if (state === 'failed' || state === 'disconnected') {
//             this.setState(WebRTCConnectionState.RECONNECTING);
//             setTimeout(() => {
//               void this.connect();
//             }, this.reconnectionDelay);
//           }
//           break;
//         case 'connecting':
//           this.setState(WebRTCConnectionState.CONNECTING);
//           break;
//       }
//     };

//     // ICE candidate handling with improved error handling and type safety
//     this.peerConnection.onicecandidate = (event) => {
//       if (event.candidate && this.websocket && this.websocket.readyState === WebSocket.OPEN) {
//         const message: SignalingMessage = {
//           type: 'ice-candidate',
//           candidate: event.candidate.toJSON() // Use toJSON() for proper serialization
//         };

//         try {
//           const messageStr = JSON.stringify(message);
//           if (messageStr) { // Ensure string is not empty
//             this.websocket.send(messageStr);
//             console.debug("ICE candidate sent successfully");
//           }
//         } catch (error) {
//           console.error("Failed to send ICE candidate:", error);
//         }
//       }
//     };

//     // ICE connection state monitoring
//     this.peerConnection.oniceconnectionstatechange = () => {
//       const iceState = this.peerConnection?.iceConnectionState;
//       console.log(`ICE connection state: ${iceState}`);

//       if (iceState === 'failed' || iceState === 'disconnected') {
//         console.warn("ICE connection failed, attempting to reconnect...");
//         this.setState(WebRTCConnectionState.RECONNECTING);
//         setTimeout(() => {
//           void this.connect();
//         }, this.reconnectionDelay);
//       }
//     };

//     // ICE gathering state monitoring
//     this.peerConnection.onicegatheringstatechange = () => {
//       const gatheringState = this.peerConnection?.iceGatheringState;
//       console.log(`ICE gathering state: ${gatheringState}`);
//     };

//     // Data channel handling - Foxglove receives the data channel from the offerer
//     this.peerConnection.ondatachannel = (event) => {
//       const channel = event.channel;
//       console.log(`Received data channel: ${channel.label}`);
//       this.attachDataChannelHandlers(channel);
//     };
//   }

//   private attachDataChannelHandlers(channel: RTCDataChannel) {
//     this.dataChannel = channel;

//     this.dataChannel.onopen = () => {
//       console.log("Data channel opened successfully");
//       this.setState(WebRTCConnectionState.CONNECTED);
//     };

//     this.dataChannel.onmessage = (ev) => {
//       try {
//         // Handle both string and binary data
//         let messageData: any;

//         if (typeof ev.data === 'string') {
//           messageData = ev.data;
//         } else if (ev.data instanceof ArrayBuffer) {
//           messageData = ev.data;
//         } else if (ev.data instanceof Blob) {
//           // Convert Blob to ArrayBuffer if needed
//           ev.data.arrayBuffer().then(buffer => {
//             this.onMessage(buffer);
//           }).catch(error => {
//             console.error("Failed to convert Blob to ArrayBuffer:", error);
//           });
//           return;
//         } else {
//           console.warn("Received unsupported data type:", typeof ev.data);
//           return;
//         }

//         this.onMessage(messageData);

//       } catch (error) {
//         console.error("Error processing data channel message:", error);
//       }
//     };

//     this.dataChannel.onclose = () => {
//       console.warn("Data channel closed");
//       this.setState(WebRTCConnectionState.DISCONNECTED);
//     };

//     this.dataChannel.onerror = (err) => {
//       console.error("Data channel error:", err);
//       this.setState(WebRTCConnectionState.FAILED);
//     };
//   }

//   private async joinRoom(): Promise<void> {
//     const joinMessage: SignalingMessage = {
//       type: 'join-room',
//       room: this.streamId
//     };

//     if (this.websocket && this.websocket.readyState === WebSocket.OPEN) {
//       const messageStr = JSON.stringify(joinMessage);
//       if (messageStr) { // Ensure string is not empty
//         this.websocket.send(messageStr);
//         console.log(`Joined room: ${this.streamId}`);
//       }
//     } else {
//       throw new Error("WebSocket not ready for joining room");
//     }
//   }

//   private async handleSignalingMessage(message: SignalingMessage): Promise<void> {
//     const pc = this.peerConnection;
//     if (!pc) {
//       console.error("Received signaling message but peer connection not initialized");
//       return;
//     }

//     try {
//       switch (message.type) {
//         case 'start_connection':
//           // Foxglove is the answerer, so it waits for an offer
//           console.info("Received start_connection signal - waiting for offer from peer");
//           // Do NOT create an offer here - wait for the offer from the Python client
//           break;

//         case 'offer':
//           if (!message.sdp) {
//             console.error("Received offer without SDP");
//             return;
//           }

//           console.log("Processing offer from peer");
//           await pc.setRemoteDescription({ type: 'offer', sdp: message.sdp });

//           // Process any buffered ICE candidates
//           for (const candidate of this.pendingRemoteCandidates) {
//             try {
//               await pc.addIceCandidate(candidate);
//               console.debug("Added buffered ICE candidate");
//             } catch (e) {
//               console.warn("Failed to add buffered ICE candidate:", e);
//             }
//           }
//           this.pendingRemoteCandidates = [];

//           // Create and send answer
//           const answer = await pc.createAnswer();
//           await pc.setLocalDescription(answer);

//           if (this.websocket && this.websocket.readyState === WebSocket.OPEN) {
//             const answerMessage: SignalingMessage = {
//               type: 'answer',
//               sdp: answer.sdp || ""
//             };
//             const messageStr = JSON.stringify(answerMessage);
//             if (messageStr) { // Ensure string is not empty
//               this.websocket.send(messageStr);
//               console.log("Answer sent successfully");
//             }
//           }
//           break;

//         case 'answer':
//           // Foxglove shouldn't receive answers since it's the answerer
//           console.warn("Received unexpected answer (Foxglove is answerer role)");
//           break;

//         case 'ice-candidate':
//           if (!message.candidate) {
//             console.debug("Received end-of-candidates signal");
//             return;
//           }

//           try {
//             if (pc.remoteDescription) {
//               await pc.addIceCandidate(message.candidate);
//               console.debug("ICE candidate added successfully");
//             } else {
//               // Buffer candidates until remote description is set
//               this.pendingRemoteCandidates.push(message.candidate);
//               console.debug("ICE candidate buffered (waiting for remote description)");
//             }
//           } catch (e) {
//             console.warn("Failed to add ICE candidate:", e);
//           }
//           break;

//         case 'peer_state_change':
//           const peerState = message.state || 'unknown';
//           console.log(`Peer state changed to: ${peerState}`);
//           break;

//         case 'peer_disconnected':
//           console.warn("Peer disconnected");
//           this.setState(WebRTCConnectionState.DISCONNECTED);
//           break;

//         case 'error':
//           console.error("Signaling error:", message.error);
//           this.setState(WebRTCConnectionState.FAILED);
//           break;

//         default:
//           console.debug("Unhandled signaling message type:", message.type);
//       }
//     } catch (error) {
//       console.error(`Error handling signaling message (${message.type}):`, error);
//     }
//   }

//   private setState(newState: WebRTCConnectionState): void {
//     if (this.state !== newState) {
//       const oldState = this.state;
//       this.state = newState;
//       console.log(`WebRTC state change: ${oldState} -> ${newState}`);
//       this.onStateChange(newState);
//     }
//   }

//   // Public method to send data through the data channel
//   public send(data: string | ArrayBuffer | ArrayBufferView): boolean {
//     if (!this.dataChannel || this.dataChannel.readyState !== 'open') {
//       console.warn("Data channel not ready for sending");
//       return false;
//     }

//     try {
//       this.dataChannel.send(data);
//       return true;
//     } catch (error) {
//       console.error("Failed to send data:", error);
//       return false;
//     }
//   }

//   // Get current connection statistics
//   public getStats(): Promise<RTCStatsReport> | null {
//     if (!this.peerConnection) {
//       return null;
//     }
//     return this.peerConnection.getStats();
//   }

//   // Get current connection state
//   public getState(): WebRTCConnectionState {
//     return this.state;
//   }

//   // Check if connection is ready for data transmission
//   public isReady(): boolean {
//     return this.state === WebRTCConnectionState.CONNECTED &&
//            this.dataChannel?.readyState === 'open';
//   }

//   // Force reconnection
//   public async reconnect(): Promise<boolean> {
//     console.log("Forcing WebRTC reconnection...");
//     await this.close();
//     this.connectionAttempts = 0; // Reset attempts for manual reconnection
//     return await this.connect();
//   }

//   // Close all connections and clean up resources
//   async close(): Promise<void> {
//     console.log("Closing WebRTC connection...");

//     this.setState(WebRTCConnectionState.DISCONNECTED);

//     // Close data channel
//     if (this.dataChannel) {
//       if (this.dataChannel.readyState === 'open') {
//         this.dataChannel.close();
//       }
//       this.dataChannel = undefined;
//     }

//     // Close peer connection
//     if (this.peerConnection) {
//       this.peerConnection.close();
//       this.peerConnection = undefined;
//     }

//     // Close WebSocket
//     if (this.websocket) {
//       if (this.websocket.readyState === WebSocket.OPEN || this.websocket.readyState === WebSocket.CONNECTING) {
//         this.websocket.close();
//       }
//       this.websocket = undefined;
//     }

//     // Clear pending candidates
//     this.pendingRemoteCandidates = [];

//     console.log("WebRTC connection closed and resources cleaned up");
//   }
// }
