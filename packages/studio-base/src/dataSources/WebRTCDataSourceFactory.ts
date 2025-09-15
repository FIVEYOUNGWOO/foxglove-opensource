// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import {
    IDataSourceFactory,
    DataSourceFactoryInitializeArgs,
  } from "@foxglove/studio-base/context/PlayerSelectionContext";
  import { WebRTCPlayer } from "@foxglove/studio-base/players/WebRTCPlayer";
  import { Player } from "@foxglove/studio-base/players/types";

  export default class WebRTCDataSourceFactory implements IDataSourceFactory {
    public id = "webrtc-connection";
    public type: IDataSourceFactory["type"] = "connection";
    public displayName = "WebRTC Real-time";
    public iconName: IDataSourceFactory["iconName"] = "Flow";
    public description = "Connect to real-time RADAR and camera data streams using WebRTC protocol for ultra-low-latency transmission.";

    public docsLinks = [
      {
        label: "WebRTC Setup Guide",
        url: "https://docs.example.com/webrtc-setup",
      },
    ];

    public formConfig = {
      fields: [
        {
          id: "signalingUrl",
          label: "Signaling Server URL",
          defaultValue: "ws://10.225.23.142:8000",
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
          defaultValue: true,
        },
      ],
    };

    public initialize(args: DataSourceFactoryInitializeArgs): Player | undefined {
      const signalingUrl = args.params?.signalingUrl;
      const streamId = args.params?.streamId;
      const autoReconnect = args.params?.autoReconnect ?? true;

      if (!signalingUrl) {
        return;
      }

      return new WebRTCPlayer({
        signalingUrl,
        streamId: streamId || "radar_stream_1",
        autoReconnect,
        metricsCollector: args.metricsCollector,
        sourceId: this.id,
      });
    }
  }
