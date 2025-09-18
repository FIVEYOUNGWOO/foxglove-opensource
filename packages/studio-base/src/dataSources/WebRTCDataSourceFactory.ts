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
        defaultValue: "true", // Changed from boolean to string
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


// // This Source Code Form is subject to the terms of the Mozilla Public
// // License, v2.0. If a copy of the MPL was not distributed with this
// // file, You can obtain one at http://mozilla.org/MPL/2.0/

// import {
//     IDataSourceFactory,
//     DataSourceFactoryInitializeArgs,
//   } from "@foxglove/studio-base/context/PlayerSelectionContext";
//   import { WebRTCPlayer } from "@foxglove/studio-base/players/WebRTCPlayer";
//   import { Player } from "@foxglove/studio-base/players/types";

//   export default class WebRTCDataSourceFactory implements IDataSourceFactory {
//     public id = "webrtc-connection";
//     public type: IDataSourceFactory["type"] = "connection";
//     public displayName = "WebRTC Real-time";
//     public iconName: IDataSourceFactory["iconName"] = "Flow";
//     public description = "Connect to real-time RADAR and camera data streams using WebRTC protocol for ultra-low-latency transmission.";

//     public docsLinks = [
//         { url: "https://webrtc.org/" },
//       ];


//     // ERROR in ./packages/studio-base/src/dataSources/WebRTCDataSourceFactory.ts:23:12
//     // TS2416: Property 'formConfig' in type 'WebRTCDataSourceFactory' is not assignable to the same property in base type 'IDataSourceFactory'.
//     //   Type '{ fields: ({ id: string; label: string; defaultValue: string; validate: (newValue: string) => Error | undefined; type?: undefined; } | { id: string; label: string; type: "boolean"; defaultValue: boolean; validate?: undefined; })[]; }' is not assignable to type '{ fields: Field[]; }'.
//     //     Types of property 'fields' are incompatible.
//     //       Type '({ id: string; label: string; defaultValue: string; validate: (newValue: string) => Error | undefined; type?: undefined; } | { id: string; label: string; type: "boolean"; defaultValue: boolean; validate?: undefined; })[]' is not assignable to type 'Field[]'.
//     //         Type '{ id: string; label: string; defaultValue: string; validate: (newValue: string) => Error | undefined; type?: undefined; } | { id: string; label: string; type: "boolean"; defaultValue: boolean; validate?: undefined; }' is not assignable to type 'Field'.
//     //           Type '{ id: string; label: string; type: "boolean"; defaultValue: boolean; validate?: undefined; }' is not assignable to type 'Field'.
//     //             Types of property 'defaultValue' are incompatible.
//     //               Type 'boolean' is not assignable to type 'string'.
//     //     21 |       ];
//     //     22 |
//     //   > 23 |     public formConfig = {
//     //        |            ^^^^^^^^^^
//     //     24 |       fields: [
//     //     25 |         {
//     //     26 |           id: "signalingUrl",

//     public formConfig = {
//       fields: [
//         {
//           id: "signalingUrl",
//           label: "Signaling Server URL",
//           defaultValue: "ws://10.225.23.142:8000",
//           validate: (newValue: string): Error | undefined => {
//             try {
//               const url = new URL(newValue);
//               if (url.protocol !== "ws:" && url.protocol !== "wss:") {
//                 return new Error(`Invalid protocol: ${url.protocol}. Use ws:// or wss://`);
//               }
//               return undefined;
//             } catch (err) {
//               return new Error("Enter a valid WebSocket URL");
//             }
//           },
//         },
//         {
//           id: "streamId",
//           label: "Stream ID",
//           defaultValue: "radar_stream_1",
//           validate: (newValue: string): Error | undefined => {
//             if (!newValue || newValue.trim().length === 0) {
//               return new Error("Stream ID cannot be empty");
//             }
//             return undefined;
//           },
//         },
//         {
//           id: "autoReconnect",
//           label: "Auto Reconnect",
//           type: "boolean" as const,
//           defaultValue: true,
//         },
//       ],
//     };

//     public initialize(args: DataSourceFactoryInitializeArgs): Player | undefined {
//       const signalingUrl = args.params?.signalingUrl;
//       const streamId = args.params?.streamId;
//       const autoReconnect = args.params?.autoReconnect ?? true;

//       if (!signalingUrl) {
//         return;
//       }



//       // ERROR in ./packages/studio-base/src/dataSources/WebRTCDataSourceFactory.ts:70:7
//       // TS2741: Property 'setPublishers' is missing in type 'WebRTCPlayer' but required in type 'Player'.
//       //     68 |       }
//       //     69 |
//       //   > 70 |       return new WebRTCPlayer({
//       //        |       ^^^^^^
//       //     71 |         signalingUrl,
//       //     72 |         streamId: streamId || "radar_stream_1",
//       //     73 |         autoReconnect,

//       // ERROR in ./packages/studio-base/src/dataSources/WebRTCDataSourceFactory.ts:73:9
//       // TS2322: Type 'string | true' is not assignable to type 'boolean | undefined'.
//       //   Type 'string' is not assignable to type 'boolean | undefined'.
//       //     71 |         signalingUrl,
//       //     72 |         streamId: streamId || "radar_stream_1",
//       //   > 73 |         autoReconnect,
//       //        |         ^^^^^^^^^^^^^
//       //     74 |         metricsCollector: args.metricsCollector,
//       //     75 |         sourceId: this.id,
//       //     76 |       });

//     // Also, the defination setPublishers () as below :

//     // public setPublishers(publishers: AdvertiseOptions[]): void {
//     //   // Since `setPublishers` is rarely called, we can get away with just throwing away the old
//     //   // Roslib.Topic objects and creating new ones.
//     //   for (const publisher of this.#topicPublishers.values()) {
//     //     publisher.unadvertise();
//     //   }
//     //   this.#topicPublishers.clear();
//     //   this.#advertisements = publishers;
//     //   this.#setupPublishers();
//     // }

//       return new WebRTCPlayer({
//         signalingUrl,
//         streamId: streamId || "radar_stream_1",
//         autoReconnect,
//         metricsCollector: args.metricsCollector,
//         sourceId: this.id,
//       });
//     }
//   }
