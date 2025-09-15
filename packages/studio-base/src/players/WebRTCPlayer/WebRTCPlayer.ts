import { v4 as uuidv4 } from "uuid";
import {
  Player,
  PlayerState,
  PlayerCapabilities,
  PlayerPresence,
  SubscribePayload,
  Topic,
  MessageEvent
} from "@foxglove/studio-base/players/types";
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

  constructor(private options: WebRTCPlayerOptions) {
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
        startTime: undefined,
        endTime: undefined,
        currentTime: { sec: Math.floor(Date.now() / 1000), nsec: 0 },
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

  // 필수 Player 인터페이스 메서드들
  setPublications(): void {}
  setParameter(): void {}
  publish(): void {}
  async callService(): Promise<unknown> { throw new Error("Not supported"); }
  setGlobalVariables(): void {}
  startPlayback(): void {}
  pausePlayback(): void {}
  setPlaybackSpeed(): void {}
  seekPlayback(): void {}
}
