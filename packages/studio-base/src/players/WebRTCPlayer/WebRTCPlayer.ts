// 파일명: WebRTCPlayer.ts

import { v4 as uuidv4 } from "uuid";
import
{
    Player,
    PlayerState,
    // PlayerCapabilities, // DO NOT REMOVE
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

export default class WebRTCPlayer implements Player
{
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

    // private _lastEmitTime: number = 0;

    // // DOTO
    // // remove emit interval to real-time displaying, Kvaser client already sent data for every 50ms interval.
    // private readonly _emitInterval: number = 16;
    // // DOTO

    constructor(options: WebRTCPlayerOptions)
    {
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

    private async initializeConnection(): Promise<void>
    {
        try
        {
            const connected = await this.connection.connect();
            if (connected)
            {
                this._isPlaying = true;
                this.emitState();
            }
            else
            {
                this.addProblem("Failed to establish WebRTC connection", "error");
            }
        }
        catch (error)
        {
            const errorMessage = error instanceof Error ? error.message : "Unknown error";
            this.addProblem(`Connection initialization error: ${errorMessage}`, "error");
        }
    }


    private handleMessage(data: any): void
    {
        const messages = this.messageProcessor.processMessage(data);
        if (messages.length === 0) return;

        let newTopicsFound = false;
        for (const message of messages)
        {
            // Check CAN topic data
            if (!this._topics.find(t => t.name === message.topic)) {
                console.log(`[WebRTCPlayer] Discovered new topic: ${message.topic} (${message.schemaName})`);

                // Create new topic data to notice and new status on foxglove (web-client)
                this._topics = [...this._topics, { name: message.topic, schemaName: message.schemaName }];

                if (!this._datatypes.has(message.schemaName))
                {
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

        // Update foxglove web-UI
        if (newTopicsFound || this._messageQueue.length > 0)
        {
            // this.throttledEmitState();
            this.emitState();
        }
    }

    private handleStateChange(newState: WebRTCConnectionState): void
    {
        console.log(`[WebRTCPlayer] Connection state changed: ${newState}`);
        this.connectionState = newState;
        this._isPlaying = (newState === WebRTCConnectionState.CONNECTED);

        if (newState === WebRTCConnectionState.CONNECTED)
        {
            this.clearProblems();
        }
        else if (newState === WebRTCConnectionState.FAILED || newState === WebRTCConnectionState.DISCONNECTED)
        {
            this.addProblem("Lost connection to data source.", "error");
        }
        else if (newState === WebRTCConnectionState.RECONNECTING)
        {
            this.addProblem("Attempting to reconnect...", "warn");
        }
        this.emitState();
    }

    private updateTopicStatistics(message: MessageEvent<unknown>): void
    {
        if (!this._topicStats.has(message.topic))
        {
            this._topicStats.set(message.topic,
            {
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

    // private throttledEmitState(): void
    // {
    //     const now = Date.now();
    //     if (now - this._lastEmitTime >= this._emitInterval)
    //     {
    //         this._lastEmitTime = now;
    //         this.emitState();
    //     }
    // }

    private emitState(): void
    {
        if (!this._listener || this._closed) return;

        const messages = [...this._messageQueue];
        this._messageQueue = [];
        let presence: PlayerPresence;
        switch (this.connectionState)
        {
            case WebRTCConnectionState.CONNECTED: presence = PlayerPresence.PRESENT; break;
            case WebRTCConnectionState.CONNECTING: case WebRTCConnectionState.RECONNECTING: presence = PlayerPresence.INITIALIZING; break;
            default: presence = PlayerPresence.ERROR; break;
        }

        /**
         * prograss : {} -> This option make sub-panel to display play, pause, and speed control for playback.
         * capabilities: [PlayerCapabilities.playbackControl, PlayerCapabilities.setSpeed] -> playback funcs.
         *
         */
        const playerState: PlayerState =
        {
            presence,
            progress: {},
            capabilities: [],
            profile: "ros1",
            playerId: this._id,
            activeData:
            {
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


    /**
     * Sub-panel (play, stop)
     */
    // startPlayback(): void { this._isPlaying = true; this.emitState(); }
    // pausePlayback(): void { this._isPlaying = false; this.emitState(); }
    // setPlaybackSpeed(_speedFraction: number): void { this._speedFraction = speed; }
    // seekPlayback(_time: Time): void { console.warn("Seeking not supported in real-time stream"); }

    public startPlayback(): void
    {
        // no-op
    }
    public pausePlayback(): void
    {
        // no-op
    }
    public seekPlayback(_time: Time): void
    {
        // no-op
    }
    public setPlaybackSpeed(_speedFraction: number): void
    {
        // no-op
    }

    private addProblem(message: string, severity: "warn" | "error"): void
    {
        if (!this._problems.find(p => p.message === message))
        {
            this._problems.push({ message, severity });
        }
    }
    private clearProblems(): void { this._problems = []; }
}







// // 파일명: WebRTCPlayer.ts

// import { v4 as uuidv4 } from "uuid";
// import
// {
//     Player,
//     PlayerState,
//     PlayerCapabilities,
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

//     private _lastEmitTime: number = 0;

//     // DOTO
//     // remove emit interval to real-time displaying, Kvaser client already sent data for every 50ms interval.
//     private readonly _emitInterval: number = 16;
//     // DOTO

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
//             this.throttledEmitState();
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

//     private throttledEmitState(): void
//     {
//         const now = Date.now();
//         if (now - this._lastEmitTime >= this._emitInterval)
//         {
//             this._lastEmitTime = now;
//             this.emitState();
//         }
//     }

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
//             progress: undefined,
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


//     /**
//      * Sub-panel (play, stop)
//      */
//     // startPlayback(): void { this._isPlaying = true; this.emitState(); }
//     // pausePlayback(): void { this._isPlaying = false; this.emitState(); }
//     // setPlaybackSpeed(_speedFraction: number): void { this._speedFraction = speed; }
//     // seekPlayback(_time: Time): void { console.warn("Seeking not supported in real-time stream"); }

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
