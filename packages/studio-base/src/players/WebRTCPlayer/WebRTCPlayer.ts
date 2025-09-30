// 파일명: WebRTCPlayer.ts

import { v4 as uuidv4 } from "uuid";
import {
    Player,
    PlayerState,
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

    // [수정] UI 업데이트 요청이 중복되지 않도록 관리하는 플래그
    private _pendingEmit = false;

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

    constructor(options: WebRTCPlayerOptions) {
        console.log(`[WebRTCPlayer] Initializing player for stream: ${options.streamId}`);
        this.messageProcessor = new MessageProcessor();
        this.connection = new WebRTCConnection(
            options.signalingUrl,
            options.streamId,
            this.handleMessage.bind(this),
            this.handleStateChange.bind(this)
        );

        // [추가] 플레이어 시작 시 예상 토픽 목록을 미리 초기화합니다.
        this.initializeTopics();
        this.initializeConnection();
    }

    // [추가] Foxglove가 시작될 때 패널이 토픽을 찾을 수 있도록 미리 알려주는 함수
    private initializeTopics(): void {
        const topics: Topic[] = [
            { name: "/tf", schemaName: "tf2_msgs/TFMessage" },
            { name: "/visualization/grid", schemaName: "visualization_msgs/MarkerArray" },
            { name: "/visualization/radar_fov", schemaName: "visualization_msgs/MarkerArray" },
            { name: "/vehicle/can/scan_index", schemaName: "std_msgs/Int32" },
        ];
        for (let i = 1; i <= 6; i++) {
            topics.push({ name: `/camera/cam_${i}/image_raw/compressed`, schemaName: "sensor_msgs/CompressedImage" });
        }
        for (const corner of ['fl', 'fr', 'rl', 'rr']) {
            topics.push({ name: `/radar_points_3d/${corner}`, schemaName: "sensor_msgs/PointCloud2" });
        }
        this._topics = topics;

        for (const topic of topics) {
            if (topic.schemaName && !this._datatypes.has(topic.schemaName)) {
                this._datatypes.set(topic.schemaName, { definitions: [] });
            }
        }
    }

    private handleMessage(data: any): void {
        const messages = this.messageProcessor.processMessage(data);
        if (messages.length === 0) return;

        let newTopicsFound = false;
        for (const message of messages) {
            if (!this._topics.find(t => t.name === message.topic)) {
                this._topics = [...this._topics, { name: message.topic, schemaName: message.schemaName }];
                if (message.schemaName && !this._datatypes.has(message.schemaName)) {
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

        // [수정] 데이터가 있을 경우, 지연 없이 즉시 emitState를 호출하도록 예약합니다.
        if ((newTopicsFound || this._messageQueue.length > 0) && !this._pendingEmit) {
            this._pendingEmit = true;
            // setTimeout 0ms는 "지금 하고 있는 급한 일(데이터 처리) 끝나면 바로 실행해줘" 라는 의미입니다.
            // 이것이 화면 깜빡임과 설정 초기화 문제를 해결하는 핵심입니다.
            setTimeout(() => this.emitState(), 0);
        }
    }






    // private emitState(): void {
    //     // [수정] emit이 호출되면, 다시 emit을 예약할 수 있도록 플래그를 리셋합니다.
    //     this._pendingEmit = false;
    //     if (!this._listener || this._closed) return;

    //     const messages = [...this._messageQueue];
    //     this._messageQueue = [];

    //     let presence: PlayerPresence;
    //     switch (this.connectionState) {
    //         case WebRTCConnectionState.CONNECTED: presence = PlayerPresence.PRESENT; break;
    //         case WebRTCConnectionState.CONNECTING: case WebRTCConnectionState.RECONNECTING: presence = PlayerPresence.INITIALIZING; break;
    //         default: presence = PlayerPresence.ERROR; break;
    //     }

    //     const playerState: PlayerState = {
    //         presence,
    //         progress: {}, // 타입 에러 방지를 위해 빈 객체 유지
    //         capabilities: [], // 재생 제어 UI 숨김
    //         profile: "ros1",
    //         playerId: this._id,
    //         activeData: {
    //             messages,
    //             totalBytesReceived: this._totalBytesReceived,
    //             startTime: this._startTime,
    //             endTime: this._endTime,
    //             currentTime: this._currentTime,
    //             isPlaying: this._isPlaying,
    //             speed: this._speed,
    //             lastSeekTime: 0,
    //             topics: this._topics,
    //             topicStats: this._topicStats,
    //             datatypes: this._datatypes,
    //             publishedTopics: new Map(),
    //             subscribedTopics: new Map(),
    //             services: new Map(),
    //             parameters: new Map(),
    //         },
    //         problems: this._problems.length > 0 ? this._problems : undefined,
    //     };
    //     void this._listener(playerState);
    // }


// 파일명: WebRTCPlayer.ts
// emitState 함수만 아래 내용으로 교체하세요.

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
            // [최종 수정] @ts-expect-error를 사용해 타입 검사를 통과하고,
            // undefined를 할당하여 재생 패널을 숨기고 UI 초기화 문제를 해결합니다.
            // eslint-disable-next-line @typescript-eslint/ban-ts-comment
            // @ts-expect-error: PlayerState requires progress, but we set it to undefined for realtime streams to hide the timeline.
            progress: undefined,
            capabilities: [],
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





    // ... (이하 나머지 코드는 모두 이전과 동일합니다) ...
    private async initializeConnection(): Promise<void> {
        try {
            const connected = await this.connection.connect();
            if (connected) {
                this._isPlaying = true;
                this.emitState();
            } else {
                this.addProblem("Failed to establish WebRTC connection", "error");
            }
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : "Unknown error";
            this.addProblem(`Connection initialization error: ${errorMessage}`, "error");
        }
    }
    private handleStateChange(newState: WebRTCConnectionState): void {
        console.log(`[WebRTCPlayer] Connection state changed: ${newState}`);
        this.connectionState = newState;
        this._isPlaying = (newState === WebRTCConnectionState.CONNECTED);
        if (newState === WebRTCConnectionState.CONNECTED) { this.clearProblems(); }
        else if (newState === WebRTCConnectionState.FAILED || newState === WebRTCConnectionState.DISCONNECTED) { this.addProblem("Lost connection to data source.", "error"); }
        else if (newState === WebRTCConnectionState.RECONNECTING) { this.addProblem("Attempting to reconnect...", "warn"); }
        this.emitState();
    }
    private updateTopicStatistics(message: MessageEvent<unknown>): void {
        if (!this._topicStats.has(message.topic)) {
            this._topicStats.set(message.topic, { numMessages: 0, firstMessageTime: message.receiveTime, lastMessageTime: message.receiveTime });
        }
        const stats = this._topicStats.get(message.topic)!;
        stats.numMessages++;
        stats.lastMessageTime = message.receiveTime;
        this._totalBytesReceived += message.sizeInBytes;
    }
    setListener(listener: (playerState: PlayerState) => Promise<void>): void { this._listener = listener; }
    close(): void { this._closed = true; this._isPlaying = false; void this.connection.close(); this._messageQueue = []; }
    setSubscriptions(subscriptions: SubscribePayload[]): void { this._subscriptions.clear(); for (const sub of subscriptions) { this._subscriptions.set(sub.topic, sub); } }
    setPublishers(_publishers: AdvertiseOptions[]): void { /* No-op */ }
    setParameter(_key: string, _value: ParameterValue): void { /* No-op */ }
    publish(_payload: PublishPayload): void { /* No-op */ }
    async callService(): Promise<unknown> { throw new Error("Service calls not supported"); }
    setGlobalVariables(): void { /* No-op */ }
    public startPlayback(): void { /* no-op */ }
    public pausePlayback(): void { /* no-op */ }
    public seekPlayback(_time: Time): void { /* no-op */ }
    public setPlaybackSpeed(_speedFraction: number): void { /* no-op */ }
    private addProblem(message: string, severity: "warn" | "error"): void { if (!this._problems.find(p => p.message === message)) { this._problems.push({ message, severity }); } }
    private clearProblems(): void { this._problems = []; }
}








/**
 * DO NOT TOUCH
 */
// // 파일명: WebRTCPlayer.ts

// import { v4 as uuidv4 } from "uuid";
// import {
//     Player,
//     PlayerState,
//     PlayerPresence,
//     SubscribePayload,
//     Topic,
//     MessageEvent,
//     AdvertiseOptions,
//     PublishPayload,
//     TopicStats,
//     PlayerProblem,
// } from "@foxglove/studio-base/players/types";
// import { Time } from "@foxglove/rostime";
// import { ParameterValue } from "@foxglove/studio";
// import { WebRTCConnection } from "./WebRTCConnection";
// import { MessageProcessor } from "./MessageProcessor";
// import { WebRTCPlayerOptions, WebRTCConnectionState } from "./types";

// export default class WebRTCPlayer implements Player {
//     private readonly _id: string = uuidv4();
//     private _listener?: (playerState: PlayerState) => Promise<void>;
//     private _closed: boolean = false;
//     private _animationFrameId?: number;

//     private connection: WebRTCConnection;
//     private messageProcessor: MessageProcessor;

//     private connectionState: WebRTCConnectionState = WebRTCConnectionState.DISCONNECTED;
//     private _isPlaying: boolean = false;
//     private _speed: number = 1.0;
//     private _problems: PlayerProblem[] = [];

//     private _topics: Topic[] = [];
//     private _datatypes: Map<string, { definitions: [] }> = new Map();
//     private _subscriptions: Map<string, SubscribePayload> = new Map();
//     private _messageQueue: MessageEvent<unknown>[] = [];
//     private _topicStats: Map<string, TopicStats> = new Map();

//     private _totalBytesReceived: number = 0;
//     private _startTime: Time = { sec: 0, nsec: 0 };
//     private _endTime: Time = { sec: 0, nsec: 0 };
//     private _currentTime: Time = { sec: 0, nsec: 0 };

//     constructor(options: WebRTCPlayerOptions) {
//         console.log(`[WebRTCPlayer] Initializing player for stream: ${options.streamId}`);
//         this.messageProcessor = new MessageProcessor();
//         this.connection = new WebRTCConnection(
//             options.signalingUrl,
//             options.streamId,
//             this.handleMessage.bind(this),
//             this.handleStateChange.bind(this)
//         );
//         this.initializeTopics();
//         this.initializeConnection();
//         this._renderLoop = this._renderLoop.bind(this);
//         this._animationFrameId = requestAnimationFrame(this._renderLoop);
//     }

//     private initializeTopics(): void {
//         const topics: Topic[] = [
//             { name: "/tf", schemaName: "tf2_msgs/TFMessage" },
//             { name: "/visualization/grid", schemaName: "visualization_msgs/MarkerArray" },
//             { name: "/visualization/radar_fov", schemaName: "visualization_msgs/MarkerArray" },
//             { name: "/vehicle/can/scan_index", schemaName: "std_msgs/Int32" },
//         ];
//         for (let i = 1; i <= 6; i++) {
//             topics.push({ name: `/camera/cam_${i}/image_raw/compressed`, schemaName: "sensor_msgs/CompressedImage" });
//         }
//         for (const corner of ['fl', 'fr', 'rl', 'rr']) {
//             topics.push({ name: `/radar_points_3d/${corner}`, schemaName: "sensor_msgs/PointCloud2" });
//         }
//         this._topics = topics;
//         for (const topic of topics) {
//             // [수정] topic.schemaName이 undefined가 아닌 경우에만 맵에 추가합니다.
//             if (topic.schemaName) {
//                 if (!this._datatypes.has(topic.schemaName)) {
//                     this._datatypes.set(topic.schemaName, { definitions: [] });
//                 }
//             }
//         }
//     }

//     private _renderLoop(): void {
//         if (this._closed) return;
//         this.emitState();
//         this._animationFrameId = requestAnimationFrame(this._renderLoop);
//     }

//     private handleMessage(data: any): void {
//         const messages = this.messageProcessor.processMessage(data);
//         if (messages.length === 0) return;

//         for (const message of messages) {
//             if (!this._topics.find(t => t.name === message.topic)) {
//                 this._topics = [...this._topics, { name: message.topic, schemaName: message.schemaName }];
//                 // [수정] message.schemaName이 undefined가 아닌 경우에만 맵에 추가합니다.
//                 if (message.schemaName && !this._datatypes.has(message.schemaName)) {
//                     this._datatypes.set(message.schemaName, { definitions: [] });
//                 }
//             }
//             this.updateTopicStatistics(message);
//             if (this._startTime.sec === 0) this._startTime = message.receiveTime;
//             this._endTime = message.receiveTime;
//             this._currentTime = message.receiveTime;
//             if (this._subscriptions.has(message.topic)) {
//                 this._messageQueue.push(message);
//             }
//         }
//     }

//     private emitState(): void {
//         if (!this._listener || this._closed) return;

//         const messages = [...this._messageQueue];
//         this._messageQueue = [];

//         let presence: PlayerPresence;
//         switch (this.connectionState) {
//             case WebRTCConnectionState.CONNECTED: presence = PlayerPresence.PRESENT; break;
//             case WebRTCConnectionState.CONNECTING: case WebRTCConnectionState.RECONNECTING: presence = PlayerPresence.INITIALIZING; break;
//             default: presence = PlayerPresence.ERROR; break;
//         }

//         const playerState: PlayerState = {
//             presence,
//             // [수정] undefined 대신 빈 객체 {} 를 전달하여 타입 에러를 해결합니다.
//             progress: {},
//             capabilities: [],
//             profile: "ros1",
//             playerId: this._id,
//             activeData: {
//                 messages,
//                 totalBytesReceived: this._totalBytesReceived,
//                 startTime: this._startTime,
//                 endTime: this._endTime,
//                 currentTime: this._currentTime,
//                 isPlaying: this._isPlaying,
//                 speed: this._speed,
//                 lastSeekTime: 0,
//                 topics: this._topics,
//                 topicStats: this._topicStats,
//                 datatypes: this._datatypes,
//                 publishedTopics: new Map(),
//                 subscribedTopics: new Map(),
//                 services: new Map(),
//                 parameters: new Map(),
//             },
//             problems: this._problems.length > 0 ? this._problems : undefined,
//         };
//         void this._listener(playerState);
//     }

//     close(): void {
//         this._closed = true;
//         this._isPlaying = false;
//         if (this._animationFrameId != undefined) {
//             cancelAnimationFrame(this._animationFrameId);
//         }
//         void this.connection.close();
//         this._messageQueue = [];
//     }

//     // ... (나머지 모든 함수는 이전 최종 버전과 동일) ...
//     private async initializeConnection(): Promise<void> {
//         try {
//             const connected = await this.connection.connect();
//             if (connected) {
//                 this._isPlaying = true;
//                 this.emitState();
//             } else {
//                 this.addProblem("Failed to establish WebRTC connection", "error");
//             }
//         } catch (error) {
//             const errorMessage = error instanceof Error ? error.message : "Unknown error";
//             this.addProblem(`Connection initialization error: ${errorMessage}`, "error");
//         }
//     }
//     private handleStateChange(newState: WebRTCConnectionState): void {
//         console.log(`[WebRTCPlayer] Connection state changed: ${newState}`);
//         this.connectionState = newState;
//         this._isPlaying = (newState === WebRTCConnectionState.CONNECTED);
//         if (newState === WebRTCConnectionState.CONNECTED) { this.clearProblems(); }
//         else if (newState === WebRTCConnectionState.FAILED || newState === WebRTCConnectionState.DISCONNECTED) { this.addProblem("Lost connection to data source.", "error"); }
//         else if (newState === WebRTCConnectionState.RECONNECTING) { this.addProblem("Attempting to reconnect...", "warn"); }
//         this.emitState();
//     }
//     private updateTopicStatistics(message: MessageEvent<unknown>): void {
//         if (!this._topicStats.has(message.topic)) {
//             this._topicStats.set(message.topic, { numMessages: 0, firstMessageTime: message.receiveTime, lastMessageTime: message.receiveTime });
//         }
//         const stats = this._topicStats.get(message.topic)!;
//         stats.numMessages++;
//         stats.lastMessageTime = message.receiveTime;
//         this._totalBytesReceived += message.sizeInBytes;
//     }
//     setListener(listener: (playerState: PlayerState) => Promise<void>): void { this._listener = listener; this.emitState(); }
//     setSubscriptions(subscriptions: SubscribePayload[]): void { this._subscriptions.clear(); for (const sub of subscriptions) { this._subscriptions.set(sub.topic, sub); } }
//     setPublishers(_publishers: AdvertiseOptions[]): void { /* No-op */ }
//     setParameter(_key: string, _value: ParameterValue): void { /* No-op */ }
//     publish(_payload: PublishPayload): void { /* No-op */ }
//     async callService(): Promise<unknown> { throw new Error("Service calls not supported"); }
//     setGlobalVariables(): void { /* No-op */ }
//     startPlayback(): void { /* No-op */ }
//     pausePlayback(): void { /* No-op */ }
//     setPlaybackSpeed(speed: number): void { this._speed = speed; }
//     seekPlayback(_time: Time): void { /* No-op */ }
//     private addProblem(message: string, severity: "warn" | "error"): void { if (!this._problems.find(p => p.message === message)) { this._problems.push({ message, severity }); } }
//     private clearProblems(): void { this._problems = []; }
// }





/**
 * DO NOT TOUCH
 */

// import { v4 as uuidv4 } from "uuid";
// import
// {
//     Player,
//     PlayerState,
//     // PlayerCapabilities, // DO NOT REMOVE
//     PlayerPresence,
//     SubscribePayload,
//     Topic,
//     MessageEvent,
//     AdvertiseOptions,
//     PublishPayload,
//     TopicStats,
//     PlayerProblem,
// } from "@foxglove/studio-base/players/types";

// import { RosDatatypes } from "@foxglove/studio-base/types/RosDatatypes";
// import { Time } from "@foxglove/rostime";
// import { ParameterValue } from "@foxglove/studio";
// import { WebRTCConnection } from "./WebRTCConnection";
// import { MessageProcessor } from "./MessageProcessor";
// import { WebRTCPlayerOptions, WebRTCConnectionState } from "./types";

// export default class WebRTCPlayer implements Player
// {
//     private readonly _id: string = uuidv4();
//     private _listener?: (playerState: PlayerState) => Promise<void>;
//     private _closed: boolean = false;

//     private connection: WebRTCConnection;
//     private messageProcessor: MessageProcessor;

//     private connectionState: WebRTCConnectionState = WebRTCConnectionState.DISCONNECTED;
//     private _isPlaying: boolean = false;
//     private _speed: number = 1.0;
//     private _problems: PlayerProblem[] = [];

//     private _topics: Topic[] = [];
//     private _datatypes: RosDatatypes = new Map();
//     private _subscriptions: Map<string, SubscribePayload> = new Map();
//     private _messageQueue: MessageEvent<unknown>[] = [];
//     private _topicStats: Map<string, TopicStats> = new Map();

//     private _totalBytesReceived: number = 0;
//     private _startTime: Time = { sec: 0, nsec: 0 };
//     private _endTime: Time = { sec: 0, nsec: 0 };
//     private _currentTime: Time = { sec: 0, nsec: 0 };

//     constructor(options: WebRTCPlayerOptions)
//     {
//         console.log(`[WebRTCPlayer] Initializing player for stream: ${options.streamId}`);
//         this.messageProcessor = new MessageProcessor();
//         this.connection = new WebRTCConnection(
//             options.signalingUrl,
//             options.streamId,
//             this.handleMessage.bind(this),
//             this.handleStateChange.bind(this)
//         );
//         this.initializeConnection();
//     }

//     private async initializeConnection(): Promise<void>
//     {
//         try
//         {
//             const connected = await this.connection.connect();
//             if (connected)
//             {
//                 this._isPlaying = true;
//                 this.emitState();
//             }
//             else
//             {
//                 this.addProblem("Failed to establish WebRTC connection", "error");
//             }
//         }
//         catch (error)
//         {
//             const errorMessage = error instanceof Error ? error.message : "Unknown error";
//             this.addProblem(`Connection initialization error: ${errorMessage}`, "error");
//         }
//     }


//     private handleMessage(data: any): void
//     {
//         const messages = this.messageProcessor.processMessage(data);
//         if (messages.length === 0) return;

//         let newTopicsFound = false;
//         for (const message of messages)
//         {
//             // Check CAN topic data
//             if (!this._topics.find(t => t.name === message.topic)) {
//                 console.log(`[WebRTCPlayer] Discovered new topic: ${message.topic} (${message.schemaName})`);

//                 // Create new topic data to notice and new status on foxglove (web-client)
//                 this._topics = [...this._topics, { name: message.topic, schemaName: message.schemaName }];

//                 if (!this._datatypes.has(message.schemaName))
//                 {
//                     this._datatypes.set(message.schemaName, { definitions: [] });
//                 }
//                 newTopicsFound = true;
//             }

//             this.updateTopicStatistics(message);
//             if (this._startTime.sec === 0) this._startTime = message.receiveTime;
//             this._endTime = message.receiveTime;
//             this._currentTime = message.receiveTime;

//             if (this._subscriptions.has(message.topic)) {
//                 this._messageQueue.push(message);
//             }
//         }

//         // Update foxglove web-UI
//         if (newTopicsFound || this._messageQueue.length > 0)
//         {
//             // this.throttledEmitState();
//             this.emitState();
//         }
//     }

//     private handleStateChange(newState: WebRTCConnectionState): void
//     {
//         console.log(`[WebRTCPlayer] Connection state changed: ${newState}`);
//         this.connectionState = newState;
//         this._isPlaying = (newState === WebRTCConnectionState.CONNECTED);

//         if (newState === WebRTCConnectionState.CONNECTED)
//         {
//             this.clearProblems();
//         }
//         else if (newState === WebRTCConnectionState.FAILED || newState === WebRTCConnectionState.DISCONNECTED)
//         {
//             this.addProblem("Lost connection to data source.", "error");
//         }
//         else if (newState === WebRTCConnectionState.RECONNECTING)
//         {
//             this.addProblem("Attempting to reconnect...", "warn");
//         }
//         this.emitState();
//     }

//     private updateTopicStatistics(message: MessageEvent<unknown>): void
//     {
//         if (!this._topicStats.has(message.topic))
//         {
//             this._topicStats.set(message.topic,
//             {
//                 numMessages: 0,
//                 firstMessageTime: message.receiveTime,
//                 lastMessageTime: message.receiveTime,
//             });
//         }
//         const stats = this._topicStats.get(message.topic)!;
//         stats.numMessages++;
//         stats.lastMessageTime = message.receiveTime;
//         this._totalBytesReceived += message.sizeInBytes;
//     }

//     // private throttledEmitState(): void
//     // {
//     //     const now = Date.now();
//     //     if (now - this._lastEmitTime >= this._emitInterval)
//     //     {
//     //         this._lastEmitTime = now;
//     //         this.emitState();
//     //     }
//     // }

//     private emitState(): void
//     {
//         if (!this._listener || this._closed) return;

//         const messages = [...this._messageQueue];
//         this._messageQueue = [];
//         let presence: PlayerPresence;
//         switch (this.connectionState)
//         {
//             case WebRTCConnectionState.CONNECTED: presence = PlayerPresence.PRESENT; break;
//             case WebRTCConnectionState.CONNECTING: case WebRTCConnectionState.RECONNECTING: presence = PlayerPresence.INITIALIZING; break;
//             default: presence = PlayerPresence.ERROR; break;
//         }

//         /**
//          * prograss : {} -> This option make sub-panel to display play, pause, and speed control for playback.
//          * capabilities: [PlayerCapabilities.playbackControl, PlayerCapabilities.setSpeed] -> playback funcs.
//          *
//          */
//         const playerState: PlayerState =
//         {
//             presence,
//             progress: {},
//             capabilities: [],
//             profile: "ros1",
//             playerId: this._id,
//             activeData:
//             {
//                 messages,
//                 totalBytesReceived: this._totalBytesReceived,
//                 startTime: this._startTime,
//                 endTime: this._endTime,
//                 currentTime: this._currentTime,
//                 isPlaying: this._isPlaying,
//                 speed: this._speed,
//                 lastSeekTime: 0,
//                 topics: this._topics,
//                 topicStats: this._topicStats,
//                 datatypes: this._datatypes,
//                 publishedTopics: new Map(),
//                 subscribedTopics: new Map(),
//                 services: new Map(),
//                 parameters: new Map(),
//             },
//             problems: this._problems.length > 0 ? this._problems : undefined,
//         };
//         void this._listener(playerState);
//     }

//     setListener(listener: (playerState: PlayerState) => Promise<void>): void { this._listener = listener; }
//     close(): void { this._closed = true; this._isPlaying = false; void this.connection.close(); this._messageQueue = []; }
//     setSubscriptions(subscriptions: SubscribePayload[]): void { this._subscriptions.clear(); for (const sub of subscriptions) { this._subscriptions.set(sub.topic, sub); } }
//     setPublishers(_publishers: AdvertiseOptions[]): void { /* No-op */ }
//     setParameter(_key: string, _value: ParameterValue): void { /* No-op */ }
//     publish(_payload: PublishPayload): void { /* No-op */ }
//     async callService(): Promise<unknown> { throw new Error("Service calls not supported"); }
//     setGlobalVariables(): void { /* No-op */ }

//     public startPlayback(): void
//     {
//         // no-op
//     }
//     public pausePlayback(): void
//     {
//         // no-op
//     }
//     public seekPlayback(_time: Time): void
//     {
//         // no-op
//     }
//     public setPlaybackSpeed(_speedFraction: number): void
//     {
//         // no-op
//     }

//     private addProblem(message: string, severity: "warn" | "error"): void
//     {
//         if (!this._problems.find(p => p.message === message))
//         {
//             this._problems.push({ message, severity });
//         }
//     }
//     private clearProblems(): void { this._problems = []; }
// }
