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
  PublishPayload
} from "@foxglove/studio-base/players/types";
import { Time } from "@foxglove/rostime"; // Fix: Import Time from correct module
import { ParameterValue } from "@foxglove/studio";
import { WebRTCConnection } from "./WebRTCConnection";
import { MessageProcessor } from "./MessageProcessor";
import { WebRTCPlayerOptions, WebRTCConnectionState } from "./types";

export default class WebRTCPlayer implements Player {
  private _id = uuidv4();
  private _listener?: (playerState: PlayerState) => Promise<void>;
  private _closed = false;

  private connection: WebRTCConnection;
  private messageProcessor: MessageProcessor;
  private connectionState: WebRTCConnectionState = WebRTCConnectionState.DISCONNECTED;

  private _topics: Topic[] = [];
  private _subscriptions = new Set<string>();
  private _messageQueue: MessageEvent<unknown>[] = [];

  constructor(private _options: WebRTCPlayerOptions) { // Fix: Use _options consistently
    this.messageProcessor = new MessageProcessor();

    this.connection = new WebRTCConnection(
      _options.signalingUrl,  // Fix: Use _options
      _options.streamId,      // Fix: Use _options
      this.handleMessage.bind(this),
      this.handleStateChange.bind(this)
    );

    this.initializeConnection();
  }

  private async initializeConnection(): Promise<void> {
    try {
      await this.connection.connect();
    } catch (error) {
      console.error("Failed to initialize WebRTC connection:", error);
    }
  }

  private handleMessage(data: any): void {
    const messages = this.messageProcessor.processMessage(data);

    for (const message of messages) {
      if (this._subscriptions.has(message.topic)) {
        this._messageQueue.push(message);
      }
    }

    this.emitState();
  }

  private handleStateChange(newState: WebRTCConnectionState): void {
    this.connectionState = newState;
    this.emitState();
  }

  private emitState(): void {
    if (!this._listener || this._closed) return;

    const messages = [...this._messageQueue];
    this._messageQueue = [];

    // Get current timestamp
    const currentTimestamp = Date.now() / 1000;
    const currentTime: Time = {
      sec: Math.floor(currentTimestamp),
      nsec: (currentTimestamp % 1) * 1e9
    };

    const playerState: PlayerState = {
      presence: this.connectionState === WebRTCConnectionState.CONNECTED
        ? PlayerPresence.PRESENT
        : PlayerPresence.INITIALIZING,
      progress: {},
      capabilities: [PlayerCapabilities.setSpeed, PlayerCapabilities.playbackControl],
      profile: "webrtc",
      playerId: this._id,
      activeData: {
        messages,
        totalBytesReceived: 0,
        // Fix: Provide proper Time objects instead of undefined
        startTime: currentTime,
        endTime: currentTime,
        currentTime,
        isPlaying: this.connectionState === WebRTCConnectionState.CONNECTED,
        speed: 1,
        lastSeekTime: 0,
        topics: this._topics,
        topicStats: this.messageProcessor.getTopicStats(),
        datatypes: new Map(),
        publishedTopics: new Map(),
        subscribedTopics: new Map(),
        services: new Map(),
        parameters: new Map(),
      },
      problems: [],
    };

    void this._listener(playerState);
  }

  setListener(listener: (playerState: PlayerState) => Promise<void>): void {
    this._listener = listener;
    this.emitState();
  }

  close(): void {
    this._closed = true;
    void this.connection.close();
  }

  setSubscriptions(subscriptions: SubscribePayload[]): void {
    this._subscriptions.clear();

    for (const subscription of subscriptions) {
      this._subscriptions.add(subscription.topic);
    }

    this._topics = subscriptions.map(sub => ({
      name: sub.topic,
      schemaName: this.guessSchemaName(sub.topic)
    }));

    this.emitState();
  }

  private guessSchemaName(topic: string): string {
    if (topic.includes("image")) return "sensor_msgs/CompressedImage";
    if (topic.includes("points")) return "sensor_msgs/PointCloud2";
    if (topic.includes("scan_index")) return "std_msgs/Int32";
    return "unknown";
  }

  // Required Player interface methods

  // Fix: Implement setPublishers method that was missing
  setPublishers(publishers: AdvertiseOptions[]): void {
    // WebRTC doesn't typically support publishing back to the stream
    // but we implement this to satisfy the interface
    // We don't need to store publishers for WebRTC real-time streaming
    console.log(`WebRTC Player: setPublishers called with ${publishers.length} publishers`);
  }

  setPublications(): void {
    // No-op for WebRTC player
  }

  setParameter(_key: string, _value: ParameterValue): void {
    // No-op for WebRTC player
  }

  publish(_payload: PublishPayload): void {
    // No-op for WebRTC player - could be implemented if bidirectional communication is needed
  }

  async callService(): Promise<unknown> {
    throw new Error("Service calls not supported in WebRTC player");
  }

  setGlobalVariables(): void {
    // No-op for WebRTC player
  }

  startPlayback(): void {
    // No-op for WebRTC player - it's always "playing" when connected
  }

  pausePlayback(): void {
    // No-op for WebRTC player
  }

  setPlaybackSpeed(): void {
    // No-op for WebRTC player
  }

  seekPlayback(): void {
    // No-op for WebRTC player - real-time stream can't seek
  }
}

// import { v4 as uuidv4 } from "uuid";
// import {
//   Player,
//   PlayerState,
//   PlayerCapabilities,
//   PlayerPresence,
//   SubscribePayload,
//   Topic,
//   MessageEvent
// } from "@foxglove/studio-base/players/types";
// import { WebRTCConnection } from "./WebRTCConnection";
// import { MessageProcessor } from "./MessageProcessor";
// import { WebRTCPlayerOptions, WebRTCConnectionState } from "./types";


// // ERROR in ./packages/studio-base/src/players/WebRTCPlayer/WebRTCPlayer.ts:15:22
// // TS2420: Class 'WebRTCPlayer' incorrectly implements interface 'Player'.
// //   Property 'setPublishers' is missing in type 'WebRTCPlayer' but required in type 'Player'.
// //     13 | import { WebRTCPlayerOptions, WebRTCConnectionState } from "./types";
// //     14 |
// //   > 15 | export default class WebRTCPlayer implements Player {
// //       |                      ^^^^^^^^^^^^
// //     16 |   private _id = uuidv4();
// //     17 |   private _listener?: (playerState: PlayerState) => Promise<void>;
// //     18 |   private _closed = false;
// export default class WebRTCPlayer implements Player {
//   private _id = uuidv4();
//   private _listener?: (playerState: PlayerState) => Promise<void>;
//   private _closed = false;

//   private connection: WebRTCConnection;
//   private messageProcessor: MessageProcessor;
//   private connectionState: WebRTCConnectionState = WebRTCConnectionState.DISCONNECTED;

//   private _topics: Topic[] = [];
//   private _subscriptions = new Set<string>();
//   private _messageQueue: MessageEvent<unknown>[] = [];


//   // ERROR in ./packages/studio-base/src/players/WebRTCPlayer/WebRTCPlayer.ts:28:23
//   // TS6138: Property 'options' is declared but its value is never read.
//   //     26 |   private _messageQueue: MessageEvent<unknown>[] = [];
//   //     27 |
//   //   > 28 |   constructor(private options: WebRTCPlayerOptions) {
//   //        |                       ^^^^^^^
//   //     29 |     this.messageProcessor = new MessageProcessor();
//   //     30 |
//   //     31 |     this.connection = new WebRTCConnection(

//   constructor(private options: WebRTCPlayerOptions) {
//     this.messageProcessor = new MessageProcessor();

//     this.connection = new WebRTCConnection(
//       options.signalingUrl,
//       options.streamId,
//       this.handleMessage.bind(this),
//       this.handleStateChange.bind(this)
//     );

//     this.initializeConnection();
//   }

//   private async initializeConnection(): Promise<void> {
//     try {
//       await this.connection.connect();
//     } catch (error) {
//       console.error("Failed to initialize WebRTC connection:", error);
//     }
//   }

//   private handleMessage(data: any): void {
//     const messages = this.messageProcessor.processMessage(data);

//     for (const message of messages) {
//       if (this._subscriptions.has(message.topic)) {
//         this._messageQueue.push(message);
//       }
//     }

//     this.emitState();
//   }

//   private handleStateChange(newState: WebRTCConnectionState): void {
//     this.connectionState = newState;
//     this.emitState();
//   }

//   private emitState(): void {
//     if (!this._listener || this._closed) return;

//     const messages = [...this._messageQueue];
//     this._messageQueue = [];

//     const playerState: PlayerState = {
//       presence: this.connectionState === WebRTCConnectionState.CONNECTED
//         ? PlayerPresence.PRESENT
//         : PlayerPresence.INITIALIZING,
//       progress: {},
//       capabilities: [PlayerCapabilities.setSpeed, PlayerCapabilities.playbackControl],
//       profile: "webrtc",
//       playerId: this._id,
//       activeData: {
//         messages,

//         // ERROR in ./packages/studio-base/src/players/WebRTCPlayer/WebRTCPlayer.ts:84:9
//         // TS2322: Type 'undefined' is not assignable to type 'Time'.
//         //     82 |         totalBytesReceived: 0,
//         //     83 |         startTime: undefined,
//         //   > 84 |         endTime: undefined,
//         //        |         ^^^^^^^
//         //     85 |         currentTime: { sec: Math.floor(Date.now() / 1000), nsec: 0 },
//         //     86 |         isPlaying: this.connectionState === WebRTCConnectionState.CONNECTED,
//         //     87 |         speed: 1,

//         totalBytesReceived: 0,
//         startTime: undefined,
//         endTime: undefined,
//         currentTime: { sec: Math.floor(Date.now() / 1000), nsec: 0 },
//         isPlaying: this.connectionState === WebRTCConnectionState.CONNECTED,
//         speed: 1,
//         lastSeekTime: 0,
//         topics: this._topics,
//         topicStats: this.messageProcessor.getTopicStats(),
//         datatypes: new Map(),
//         publishedTopics: new Map(),
//         subscribedTopics: new Map(),
//         services: new Map(),
//         parameters: new Map(),
//       },
//       problems: [],
//     };

//     void this._listener(playerState);
//   }

//   setListener(listener: (playerState: PlayerState) => Promise<void>): void {
//     this._listener = listener;
//     this.emitState();
//   }

//   close(): void {
//     this._closed = true;
//     void this.connection.close();
//   }

//   setSubscriptions(subscriptions: SubscribePayload[]): void {
//     this._subscriptions.clear();

//     for (const subscription of subscriptions) {
//       this._subscriptions.add(subscription.topic);
//     }

//     this._topics = subscriptions.map(sub => ({
//       name: sub.topic,
//       schemaName: this.guessSchemaName(sub.topic)
//     }));

//     this.emitState();
//   }

//   private guessSchemaName(topic: string): string {
//     if (topic.includes("image")) return "sensor_msgs/CompressedImage";
//     if (topic.includes("points")) return "sensor_msgs/PointCloud2";
//     if (topic.includes("scan_index")) return "std_msgs/Int32";
//     return "unknown";
//   }

//   // 필수 Player 인터페이스 메서드들
//   setPublications(): void {}
//   setParameter(): void {}
//   publish(): void {}
//   async callService(): Promise<unknown> { throw new Error("Not supported"); }
//   setGlobalVariables(): void {}
//   startPlayback(): void {}
//   pausePlayback(): void {}
//   setPlaybackSpeed(): void {}
//   seekPlayback(): void {}
// }
