// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import {
  IDataSourceFactory,
  DataSourceFactoryInitializeArgs,
} from "@foxglove/studio-base/context/PlayerSelectionContext";
import { WebRTCPlayer } from "@foxglove/studio-base/players/WebRTCPlayer";
import { Player } from "@foxglove/studio-base/players/types";

// Define proper Field type to match IDataSourceFactory requirements
type Field = {
  id: string;
  label: string;
  defaultValue: string;
  validate?: (newValue: string) => Error | undefined;
  type?: undefined;
} | {
  id: string;
  label: string;
  type: "boolean";
  defaultValue: string; // Changed from boolean to string to match Field interface
  validate?: undefined;
};

export default class WebRTCDataSourceFactory implements IDataSourceFactory {
  public id = "webrtc-connection";
  public type: IDataSourceFactory["type"] = "connection";
  public displayName = "WebRTC";
  public iconName: IDataSourceFactory["iconName"] = "Flow";
  public description = "Connect to the RADAR streaming server via the WebRTC protocol.";

  public docsLinks = [
      { url: "https://webrtc.org/" },
    ];

  // Fix: Ensure Field types match interface requirements
  public formConfig = {
    fields: [
      {
        id: "signalingUrl",
        label: "Signaling Server URL",
        // Herein, the default value set as Ubuntu 20.04 static IP address
        defaultValue: "ws://localhost:8000",
        validate: (newValue: string): Error | undefined => {
          try {
            const url = new URL(newValue);
            if (url.protocol !== "ws:" && url.protocol !== "wss:") {
              return new Error(`Invalid protocol: ${url.protocol}. Use ws:// or wss://`);
            }
            return undefined;
          } catch (err) {
            return new Error("Enter a valid WebSocket URL");
          }
        },
      },
      {
        id: "streamId",
        label: "Stream ID",
        defaultValue: "radar_stream_1",
        validate: (newValue: string): Error | undefined => {
          if (!newValue || newValue.trim().length === 0) {
            return new Error("Stream ID cannot be empty");
          }
          return undefined;
        },
      },
      {
        id: "autoReconnect",
        label: "Auto Reconnect",
        type: "boolean" as const,
        // defaultValue: "true", // Changed from boolean to string
        defaultValue: "false",
      },
    ] as Field[],
  };

  public initialize(args: DataSourceFactoryInitializeArgs): Player | undefined {
    const signalingUrl = args.params?.signalingUrl;
    const streamId = args.params?.streamId;
    // Fix: Parse string to boolean for autoReconnect - handle both string and boolean types
    const autoReconnectParam = args.params?.autoReconnect;
    const autoReconnect = typeof autoReconnectParam === "string"
      ? autoReconnectParam === "true"
      : Boolean(autoReconnectParam);

    if (!signalingUrl) {
      return;
    }

    // Create WebRTCPlayer which now implements setPublishers
    return new WebRTCPlayer({
      signalingUrl,
      streamId: streamId || "radar_stream_1",
      autoReconnect,
      metricsCollector: args.metricsCollector,
      sourceId: this.id,
    });
  }
}
