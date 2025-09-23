// 파일명: WebRTCPlayer.ts

import { v4 as uuidv4 } from "uuid";
import {
    Player,
    PlayerState,
    PlayerCapabilities,
    PlayerPresence,
    SubscribePayload,
    Topic,
    MessageEvent,
    AdvertiseOptions,
    PublishPayload,
    TopicStats,
    PlayerProblem,
} from "@foxglove/studio-base/players/types";

import { RosDatatypes } from "@foxglove/studio-base/types/RosDatatypes";
import { Time } from "@foxglove/rostime";
import { ParameterValue } from "@foxglove/studio";
import { WebRTCConnection } from "./WebRTCConnection";
import { MessageProcessor } from "./MessageProcessor";
import { WebRTCPlayerOptions, WebRTCConnectionState } from "./types";

export default class WebRTCPlayer implements Player {
    private readonly _id: string = uuidv4();
    private _listener?: (playerState: PlayerState) => Promise<void>;
    private _closed: boolean = false;

    private connection: WebRTCConnection;
    private messageProcessor: MessageProcessor;

    private connectionState: WebRTCConnectionState = WebRTCConnectionState.DISCONNECTED;
    private _isPlaying: boolean = false;
    private _speed: number = 1.0;
    private _problems: PlayerProblem[] = [];

    private _topics: Topic[] = [];
    private _datatypes: RosDatatypes = new Map();
    private _subscriptions: Map<string, SubscribePayload> = new Map();
    private _messageQueue: MessageEvent<unknown>[] = [];
    private _topicStats: Map<string, TopicStats> = new Map();

    private _totalBytesReceived: number = 0;
    private _startTime: Time = { sec: 0, nsec: 0 };
    private _endTime: Time = { sec: 0, nsec: 0 };
    private _currentTime: Time = { sec: 0, nsec: 0 };

    private _lastEmitTime: number = 0;
    private readonly _emitInterval: number = 50;

    constructor(options: WebRTCPlayerOptions) {
        console.log(`[WebRTCPlayer] Initializing player for stream: ${options.streamId}`);
        this.messageProcessor = new MessageProcessor();
        this.connection = new WebRTCConnection(
            options.signalingUrl,
            options.streamId,
            this.handleMessage.bind(this),
            this.handleStateChange.bind(this)
        );
        this.initializeConnection();
    }

    private async initializeConnection(): Promise<void> {
        try {
            const connected = await this.connection.connect();
            if (connected) {
                this._isPlaying = true;
            } else {
                this.addProblem("Failed to establish WebRTC connection", "error");
            }
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : "Unknown error";
            this.addProblem(`Connection initialization error: ${errorMessage}`, "error");
        }
    }

    private handleMessage(data: any): void {
        const messages = this.messageProcessor.processMessage(data);
        if (messages.length === 0) return;

        let newTopicsFound = false;
        for (const message of messages) {
            if (!this._topics.find(t => t.name === message.topic)) {
                console.log(`[WebRTCPlayer] Discovered new topic: ${message.topic} (${message.schemaName})`);
                this._topics.push({ name: message.topic, schemaName: message.schemaName });
                if (!this._datatypes.has(message.schemaName)) {
                    // [수정] RosDatatypes 타입에 맞는 객체를 할당합니다.
                    this._datatypes.set(message.schemaName, { definitions: [] });
                }
                newTopicsFound = true;
            }
            this.updateTopicStatistics(message);
            if (this._startTime.sec === 0) this._startTime = message.receiveTime;
            this._endTime = message.receiveTime;
            this._currentTime = message.receiveTime;
            if (this._subscriptions.has(message.topic)) {
                this._messageQueue.push(message);
            }
        }
        if (newTopicsFound || this._messageQueue.length > 0) {
            this.throttledEmitState();
        }
    }

    private handleStateChange(newState: WebRTCConnectionState): void {
        console.log(`[WebRTCPlayer] Connection state changed: ${newState}`);
        this.connectionState = newState;
        this._isPlaying = (newState === WebRTCConnectionState.CONNECTED);

        if (newState === WebRTCConnectionState.CONNECTED) {
            this.clearProblems();
        } else if (newState === WebRTCConnectionState.FAILED || newState === WebRTCConnectionState.DISCONNECTED) {
            this.addProblem("Lost connection to data source.", "error");
        } else if (newState === WebRTCConnectionState.RECONNECTING) {
            this.addProblem("Attempting to reconnect...", "warn");
        }
        this.emitState();
    }

    private updateTopicStatistics(message: MessageEvent<unknown>): void {
        if (!this._topicStats.has(message.topic)) {
            this._topicStats.set(message.topic, {
                numMessages: 0,
                firstMessageTime: message.receiveTime,
                lastMessageTime: message.receiveTime,
            });
        }
        const stats = this._topicStats.get(message.topic)!;
        stats.numMessages++;
        stats.lastMessageTime = message.receiveTime;
        this._totalBytesReceived += message.sizeInBytes;
    }

    private throttledEmitState(): void {
        const now = Date.now();
        if (now - this._lastEmitTime >= this._emitInterval) {
            this._lastEmitTime = now;
            this.emitState();
        }
    }

    private emitState(): void {
        if (!this._listener || this._closed) return;

        const messages = [...this._messageQueue];
        this._messageQueue = [];
        let presence: PlayerPresence;
        switch (this.connectionState) {
            case WebRTCConnectionState.CONNECTED: presence = PlayerPresence.PRESENT; break;
            case WebRTCConnectionState.CONNECTING: case WebRTCConnectionState.RECONNECTING: presence = PlayerPresence.INITIALIZING; break;
            default: presence = PlayerPresence.ERROR; break;
        }

        const playerState: PlayerState = {
            presence,
            progress: {},
            capabilities: [PlayerCapabilities.playbackControl, PlayerCapabilities.setSpeed],
            profile: "ros1",
            playerId: this._id,
            activeData: {
                messages,
                totalBytesReceived: this._totalBytesReceived,
                startTime: this._startTime,
                endTime: this._endTime,
                currentTime: this._currentTime,
                isPlaying: this._isPlaying,
                speed: this._speed,
                lastSeekTime: 0,
                topics: this._topics,
                topicStats: this._topicStats,
                datatypes: this._datatypes,
                publishedTopics: new Map(),
                subscribedTopics: new Map(),
                services: new Map(),
                parameters: new Map(),
            },
            problems: this._problems.length > 0 ? this._problems : undefined,
        };
        void this._listener(playerState);
    }

    setListener(listener: (playerState: PlayerState) => Promise<void>): void { this._listener = listener; }
    close(): void { this._closed = true; this._isPlaying = false; void this.connection.close(); this._messageQueue = []; }
    setSubscriptions(subscriptions: SubscribePayload[]): void { this._subscriptions.clear(); for (const sub of subscriptions) { this._subscriptions.set(sub.topic, sub); } }
    setPublishers(_publishers: AdvertiseOptions[]): void { /* No-op */ }
    setParameter(_key: string, _value: ParameterValue): void { /* No-op */ }
    publish(_payload: PublishPayload): void { /* No-op */ }
    async callService(): Promise<unknown> { throw new Error("Service calls not supported"); }
    setGlobalVariables(): void { /* No-op */ }
    startPlayback(): void { this._isPlaying = true; this.emitState(); }
    pausePlayback(): void { this._isPlaying = false; this.emitState(); }
    setPlaybackSpeed(speed: number): void { this._speed = speed; }
    seekPlayback(_time: Time): void { console.warn("Seeking not supported in real-time stream"); }

    private addProblem(message: string, severity: "warn" | "error"): void {
        if (!this._problems.find(p => p.message === message)) {
            this._problems.push({ message, severity });
        }
    }
    private clearProblems(): void { this._problems = []; }
}






/**
 * DO NOT REMOVE IT !
 */
// import { v4 as uuidv4 } from "uuid";
// import {
//     Player,
//     PlayerState,
//     PlayerCapabilities,
//     PlayerPresence,
//     SubscribePayload,
//     Topic,
//     MessageEvent,
//     AdvertiseOptions,
//     PublishPayload,
//     PlayerProblem,
//     TopicStats
// } from "@foxglove/studio-base/players/types";
// import { Time } from "@foxglove/rostime";
// import { ParameterValue } from "@foxglove/studio";
// import { WebRTCConnection } from "./WebRTCConnection";
// import { MessageProcessor } from "./MessageProcessor";
// import { WebRTCPlayerOptions, WebRTCConnectionState } from "./types";

// interface PlayerStatistics {
//     totalMessagesReceived: number;
//     totalBytesReceived: number;
//     messagesPerSecond: number;
//     connectionUptime: number;
//     lastMessageTime: number;
//     droppedMessages: number;
//     processingErrors: number;
// }

// export default class WebRTCPlayer implements Player {
//     private readonly _id: string = uuidv4();
//     private _listener?: (playerState: PlayerState) => Promise<void>;
//     private _closed: boolean = false;

//     // Core components
//     private connection: WebRTCConnection;
//     private messageProcessor: MessageProcessor;

//     // State management
//     private connectionState: WebRTCConnectionState = WebRTCConnectionState.DISCONNECTED;
//     private _isPlaying: boolean = false;
//     private _speed: number = 1.0;

//     // Topic management
//     private _topics: Topic[] = [];
//     private _datatypes: Map<string, any> = new Map();
//     private _subscriptions: Map<string, SubscribePayload> = new Map();
//     private _advertisedTopics: Map<string, AdvertiseOptions> = new Map();

//     // Message handling
//     private _messageQueue: MessageEvent<unknown>[] = [];
//     private readonly _maxQueueSize: number = 1000;
//     private _lastEmitTime: number = 0;
//     private readonly _emitInterval: number = 50; // 20Hz update rate

//     // Statistics tracking
//     private _playerStats: PlayerStatistics = {
//         totalMessagesReceived: 0,
//         totalBytesReceived: 0,
//         messagesPerSecond: 0,
//         connectionUptime: 0,
//         lastMessageTime: 0,
//         droppedMessages: 0,
//         processingErrors: 0
//     };

//     private _topicStats: Map<string, TopicStats> = new Map();
//     private _problems: PlayerProblem[] = [];

//     // Timing
//     private _startTime: Time = { sec: 0, nsec: 0 };
//     private _endTime: Time = { sec: 0, nsec: 0 };
//     private _currentTime: Time = { sec: 0, nsec: 0 };

//     // Performance monitoring
//     private _performanceTimer?: number;
//     private _messageRateBuffer: number[] = [];

//     constructor(options: WebRTCPlayerOptions) {
//         console.log(`[WebRTCPlayer] Initializing with stream: ${options.streamId}`);

//         // Initialize message processor
//         this.messageProcessor = new MessageProcessor();

//         // Initialize WebRTC connection
//         this.connection = new WebRTCConnection(
//             options.signalingUrl,
//             options.streamId,
//             this.handleMessage.bind(this),
//             this.handleStateChange.bind(this)
//         );

//         // Initialize default topics based on expected sensor data
//         this.initializeDefaultTopics();

//         // Start connection
//         this.initializeConnection();

//         // Start performance monitoring
//         this.startPerformanceMonitoring();
//     }

//     private initializeDefaultTopics(): void {
//         // Camera topics
//         for (let i = 1; i <= 6; i++) {
//             const topicName = `/camera/cam_${i}/image_raw/compressed`;
//             this._topics.push({
//                 name: topicName,
//                 schemaName: "sensor_msgs/CompressedImage"
//             });
//             this._datatypes.set("sensor_msgs/CompressedImage", "sensor_msgs/CompressedImage");
//         }

//         // Radar point cloud topics
//         const radarCorners = ['fl', 'fr', 'rl', 'rr'];
//         for (const corner of radarCorners) {
//             const topicName = `/radar_points_3d/${corner}`;
//             this._topics.push({
//                 name: topicName,
//                 schemaName: "sensor_msgs/PointCloud2"
//             });
//             this._datatypes.set("sensor_msgs/PointCloud2", "sensor_msgs/PointCloud2");
//         }

//         // CAN signal topics
//         const canTopics = [
//             { name: "/vehicle/can/scan_index", type: "std_msgs/Int32" },
//             { name: "/vehicle/can/peak_count", type: "std_msgs/Int32" },
//             { name: "/vehicle/can/cycle_time", type: "std_msgs/Float64" }
//         ];

//         for (const topic of canTopics) {
//             this._topics.push({
//                 name: topic.name,
//                 schemaName: topic.type
//             });
//             this._datatypes.set(topic.type, topic.type);
//         }

//         console.log(`[WebRTCPlayer] Initialized ${this._topics.length} default topics`);
//     }

//     private async initializeConnection(): Promise<void> {
//         try {
//             console.log("[WebRTCPlayer] Starting WebRTC connection...");
//             const connected = await this.connection.connect();

//             if (connected) {
//                 console.log("[WebRTCPlayer] WebRTC connection established");
//                 this._isPlaying = true;
//             } else {
//                 console.error("[WebRTCPlayer] Failed to establish WebRTC connection");
//                 this.addProblem("CONNECTION_FAILED", "Failed to connect to data source", "error");
//             }
//         } catch (error) {
//             console.error("[WebRTCPlayer] Connection initialization error:", error);
//             this.addProblem("INIT_ERROR", `Initialization failed: ${error}`, "error");
//         }
//     }

//     private handleMessage(data: any): void {
//         try {
//             // Update statistics
//             this._playerStats.totalMessagesReceived++;
//             this._playerStats.lastMessageTime = Date.now();

//             // Enhanced logging for chunk data
//             if (typeof data === 'string' && data.includes('|') && data.includes('"msg_id"')) {
//                 console.debug(`[WebRTCPlayer] Received chunked data: ${data.substring(0, 200)}...`);
//             } else {
//                 console.debug(`[WebRTCPlayer] Received data type: ${typeof data}, length: ${data.length || 'unknown'}`);
//             }

//             // Process message through message processor (with chunk support)
//             const messages = this.messageProcessor.processMessage(data);

//             if (messages.length === 0) {
//                 this._playerStats.processingErrors++;
//                 console.debug("[WebRTCPlayer] No messages generated from received data");
//                 return;
//             }

//             console.debug(`[WebRTCPlayer] Generated ${messages.length} Foxglove messages`);

//             // Update timing based on message timestamps
//             for (const message of messages) {
//                 // Update topic statistics
//                 this.updateTopicStatistics(message);

//                 // Update global timing
//                 this.updateTiming(message.receiveTime);

//                 // Add to queue if subscribed
//                 if (this._subscriptions.has(message.topic)) {
//                     this.addMessageToQueue(message);
//                 } else {
//                     this._playerStats.droppedMessages++;
//                 }
//             }

//             // Emit state if enough time has passed
//             this.throttledEmitState();

//         } catch (error) {
//             console.error("[WebRTCPlayer] Error handling message:", error);
//             this._playerStats.processingErrors++;
//         }
//     }

//     private handleStateChange(newState: WebRTCConnectionState): void {
//         console.log(`[WebRTCPlayer] Connection state changed: ${newState}`);
//         this.connectionState = newState;

//         // Update playing state based on connection
//         this._isPlaying = (newState === WebRTCConnectionState.CONNECTED);

//         // Clear problems if connected
//         if (newState === WebRTCConnectionState.CONNECTED) {
//             this.clearProblems();
//             console.log("[WebRTCPlayer] Connection established, ready to receive data");
//         } else if (newState === WebRTCConnectionState.FAILED) {
//             this.addProblem("CONNECTION_LOST", "Lost connection to data source", "error");
//         } else if (newState === WebRTCConnectionState.RECONNECTING) {
//             this.addProblem("RECONNECTING", "Attempting to reconnect...", "warn");
//         }

//         // Always emit state on connection change
//         this.emitState();
//     }

//     private updateTopicStatistics(message: MessageEvent<unknown>): void {
//         const topicName = message.topic;

//         if (!this._topicStats.has(topicName)) {
//             this._topicStats.set(topicName, {
//                 numMessages: 0,
//                 firstMessageTime: message.receiveTime,
//                 lastMessageTime: message.receiveTime
//             });
//         }

//         const stats = this._topicStats.get(topicName)!;
//         stats.numMessages++;
//         stats.lastMessageTime = message.receiveTime;

//         this._playerStats.totalBytesReceived += message.sizeInBytes;
//     }

//     private updateTiming(messageTime: Time): void {
//         this._currentTime = messageTime;

//         // Initialize start time on first message
//         if (this._startTime.sec === 0 && this._startTime.nsec === 0) {
//             this._startTime = messageTime;
//         }

//         // Always update end time to latest message
//         this._endTime = messageTime;
//     }

//     private addMessageToQueue(message: MessageEvent<unknown>): void {
//         this._messageQueue.push(message);

//         // Limit queue size to prevent memory issues
//         if (this._messageQueue.length > this._maxQueueSize) {
//             const dropped = this._messageQueue.splice(0, this._messageQueue.length - this._maxQueueSize);
//             this._playerStats.droppedMessages += dropped.length;

//             if (dropped.length > 10) {
//                 console.warn(`[WebRTCPlayer] Dropped ${dropped.length} messages due to queue overflow`);
//             }
//         }
//     }

//     private throttledEmitState(): void {
//         const now = Date.now();

//         if (now - this._lastEmitTime >= this._emitInterval) {
//             this._lastEmitTime = now;
//             this.emitState();
//         }
//     }

//     private emitState(): void {
//         if (!this._listener || this._closed) {
//             return;
//         }

//         // Get messages from queue
//         const messages = [...this._messageQueue];
//         this._messageQueue = [];

//         // Calculate message rate
//         this.updateMessageRate(messages.length);

//         // Determine player presence based on connection state
//         let presence: PlayerPresence;
//         switch (this.connectionState) {
//             case WebRTCConnectionState.CONNECTED:
//                 presence = PlayerPresence.PRESENT;
//                 break;
//             case WebRTCConnectionState.CONNECTING:
//             case WebRTCConnectionState.RECONNECTING:
//                 presence = PlayerPresence.INITIALIZING;
//                 break;
//             case WebRTCConnectionState.DISCONNECTED:
//             case WebRTCConnectionState.FAILED:
//             default:
//                 presence = PlayerPresence.ERROR;
//                 break;
//         }

//         // Enhanced player state with processing info
//         const playerState: PlayerState = {
//             presence,
//             progress: {},
//             capabilities: [
//                 PlayerCapabilities.playbackControl,
//                 PlayerCapabilities.setSpeed
//             ],
//             profile: "webrtc-realtime-chunked",
//             playerId: this._id,
//             activeData: {
//                 messages,
//                 totalBytesReceived: this._playerStats.totalBytesReceived,
//                 startTime: this._startTime,
//                 endTime: this._endTime,
//                 currentTime: this._currentTime,
//                 isPlaying: this._isPlaying,
//                 speed: this._speed,
//                 lastSeekTime: 0,
//                 topics: this._topics,
//                 topicStats: this._topicStats,
//                 datatypes: new Map(),
//                 publishedTopics: new Map(),
//                 subscribedTopics: new Map(),
//                 services: new Map(),
//                 parameters: new Map()
//             },
//             problems: this._problems.length > 0 ? this._problems : undefined
//         };

//         // Emit state to Foxglove
//         void this._listener(playerState);
//     }

//     private updateMessageRate(messageCount: number): void {
//         this._messageRateBuffer.push(messageCount);

//         // Keep last 20 samples
//         if (this._messageRateBuffer.length > 20) {
//             this._messageRateBuffer.shift();
//         }

//         // Calculate average message rate (messages per emit interval)
//         const averageCount = this._messageRateBuffer.reduce((sum, count) => sum + count, 0) / this._messageRateBuffer.length;
//         this._playerStats.messagesPerSecond = averageCount * (1000 / this._emitInterval);
//     }

//     private startPerformanceMonitoring(): void {
//         this._performanceTimer = window.setInterval(() => {
//             const connectionStats = this.connection.getStatistics();
//             const processingStats = this.messageProcessor.getPerformanceSummary();

//             console.log("[WebRTCPlayer] Performance Report:", {
//                 connection: {
//                     state: this.connectionState,
//                     messagesReceived: connectionStats.messagesReceived,
//                     bytesReceived: connectionStats.bytesReceived,
//                     chunkedMessages: connectionStats.chunkedMessagesReceived,
//                     nonChunkedMessages: connectionStats.nonChunkedMessagesReceived,
//                     connectionHealth: connectionStats.connectionHealth,
//                     uptime: Math.round((Date.now() - connectionStats.connectionStartTime) / 1000) + "s"
//                 },
//                 processing: {
//                     ...processingStats,
//                     fragmentationRate: processingStats.networkStats ?
//                         (processingStats.networkStats.fragmentationEvents / Math.max(1, processingStats.networkStats.packetsReceived) * 100).toFixed(1) + '%' :
//                         'N/A'
//                 },
//                 player: {
//                     messagesPerSecond: Math.round(this._playerStats.messagesPerSecond),
//                     queueSize: this._messageQueue.length,
//                     droppedMessages: this._playerStats.droppedMessages,
//                     errors: this._playerStats.processingErrors
//                 }
//             });
//         }, 10000); // Every 10 seconds
//     }

//     private addProblem(_id: string, message: string, severity: "warn" | "error" = "warn"): void {
//         const problem: PlayerProblem = {
//             message,
//             severity,
//             tip: severity === "error"
//                 ? "Check network connection and data source"
//                 : "System is attempting to recover automatically"
//         };

//         // Remove existing problems with same message
//         this._problems = this._problems.filter(p => p.message !== message);
//         this._problems.push(problem);

//         console.warn(`[WebRTCPlayer] Problem added: ${message}`);
//     }

//     private clearProblems(): void {
//         if (this._problems.length > 0) {
//             console.log("[WebRTCPlayer] Problems cleared");
//             this._problems = [];
//         }
//     }

//     // Player Interface Implementation

//     setListener(listener: (playerState: PlayerState) => Promise<void>): void {
//         console.log("[WebRTCPlayer] Listener registered");
//         this._listener = listener;
//         this.emitState();
//     }

//     close(): void {
//         console.log("[WebRTCPlayer] Closing player...");

//         this._closed = true;
//         this._isPlaying = false;

//         // Clear performance timer
//         if (this._performanceTimer) {
//             clearInterval(this._performanceTimer);
//         }

//         // Close WebRTC connection
//         void this.connection.close();

//         // Clear message queue
//         this._messageQueue = [];

//         console.log("[WebRTCPlayer] Player closed");
//     }

//     setSubscriptions(subscriptions: SubscribePayload[]): void {
//         console.log(`[WebRTCPlayer] Updating subscriptions: ${subscriptions.length} topics`);

//         this._subscriptions.clear();

//         for (const subscription of subscriptions) {
//             this._subscriptions.set(subscription.topic, subscription);

//             // Add topic if not already known
//             if (!this._topics.find(t => t.name === subscription.topic)) {
//                 this._topics.push({
//                     name: subscription.topic,
//                     schemaName: this.guessSchemaName(subscription.topic)
//                 });
//             }
//         }

//         this.emitState();
//     }

//     setPublishers(publishers: AdvertiseOptions[]): void {
//         this._advertisedTopics.clear();
//         for (const publisher of publishers) {
//             this._advertisedTopics.set(publisher.topic, publisher);
//         }
//     }

//     setParameter(key: string, value: ParameterValue): void {
//         console.log(`[WebRTCPlayer] Parameter set: ${key} = ${value}`);
//     }

//     publish(_payload: PublishPayload): void {
//         console.warn("[WebRTCPlayer] Publishing not supported in WebRTC consumer mode");
//     }

//     async callService(): Promise<unknown> {
//         throw new Error("Service calls not supported in WebRTC player");
//     }

//     setGlobalVariables(): void {
//         // No-op for WebRTC player
//     }

//     startPlayback(): void {
//         console.log("[WebRTCPlayer] Starting playback");
//         this._isPlaying = true;
//         this.emitState();
//     }

//     pausePlayback(): void {
//         console.log("[WebRTCPlayer] Pausing playback");
//         this._isPlaying = false;
//         this.emitState();
//     }

//     setPlaybackSpeed(speed: number): void {
//         console.log(`[WebRTCPlayer] Speed set to ${speed}x (no effect on real-time stream)`);
//         this._speed = speed;
//         this.emitState();
//     }

//     seekPlayback(_time: Time): void {
//         console.warn("[WebRTCPlayer] Seeking not supported in real-time stream");
//     }

//     private guessSchemaName(topic: string): string {
//         if (topic.includes("image") || topic.includes("camera")) {
//             return "sensor_msgs/CompressedImage";
//         }
//         if (topic.includes("points") || topic.includes("cloud")) {
//             return "sensor_msgs/PointCloud2";
//         }
//         if (topic.includes("scan_index") || topic.includes("count")) {
//             return "std_msgs/Int32";
//         }
//         if (topic.includes("time") || topic.includes("speed")) {
//             return "std_msgs/Float64";
//         }
//         return "std_msgs/String";
//     }
// }
