import { MessageEvent } from "@foxglove/studio-base/players/types";
import { WebRTCMessage, WebRTCBatchMessage } from "./types";

export class MessageProcessor {
  private topicStats = new Map<string, any>();

  processMessage(data: string | ArrayBuffer): MessageEvent<unknown>[] {
    try {
      const parsedMessage = this.parseWebRTCMessage(data);
      if (!parsedMessage) return [];

      if (this.isWebRTCBatchMessage(parsedMessage)) {
        return parsedMessage.messages.map(msg => this.convertToFoxgloveMessage(msg));
      } else {
        return [this.convertToFoxgloveMessage(parsedMessage as WebRTCMessage)];
      }
    } catch (error) {
      console.error("Error processing WebRTC message:", error);
      return [];
    }
  }

  private parseWebRTCMessage(data: string | ArrayBuffer): WebRTCMessage | WebRTCBatchMessage | null {
    try {
      let messageData: any;

      if (typeof data === 'string') {
        messageData = JSON.parse(data);
      } else {
        const decoder = new TextDecoder();
        const jsonString = decoder.decode(data);
        messageData = JSON.parse(jsonString);
      }

      return messageData;
    } catch (error) {
      console.error("Failed to parse WebRTC message:", error);
      return null;
    }
  }

  private isWebRTCBatchMessage(message: any): message is WebRTCBatchMessage {
    return message && message.type === 'batch' && Array.isArray(message.messages);
  }

  private convertToFoxgloveMessage(webrtcMessage: WebRTCMessage): MessageEvent<unknown> {
    const timestamp = webrtcMessage.timestamp;

    // Encoding the received JSON msg. to utf-8 byte array to calculate bytes size
    let sizeInBytes = 0;
    if (webrtcMessage.data != null) {
      try {
        const jsonString = JSON.stringify(webrtcMessage.data);
        if (typeof TextEncoder !== 'undefined') {
          sizeInBytes = new TextEncoder().encode(jsonString).length;
        }
        // else {
        //   // Fallback for environments without TextEncoder
        //   sizeInBytes = jsonString.length;
        // }
      } catch (error) {
        console.warn("Failed to calculate message size:", error);
        sizeInBytes = 0;
      }
    }

    return {
      topic: webrtcMessage.topic,
      receiveTime: {
        sec: Math.floor(timestamp),
        nsec: (timestamp % 1) * 1e9
      },
      message: webrtcMessage.data,
      schemaName: webrtcMessage.messageType,
      sizeInBytes
    };
  }

  getTopicStats() {
    return this.topicStats;
  }
}




// import { MessageEvent } from "@foxglove/studio-base/players/types";
// import { WebRTCMessage, WebRTCBatchMessage } from "./types";

// export class MessageProcessor {
//   private topicStats = new Map<string, any>();

//   processMessage(data: string | ArrayBuffer): MessageEvent<unknown>[] {
//     try {
//       const parsedMessage = this.parseWebRTCMessage(data);
//       if (!parsedMessage) return [];

//       if (this.isWebRTCBatchMessage(parsedMessage)) {
//         return parsedMessage.messages.map(msg => this.convertToFoxgloveMessage(msg));
//       } else {
//         return [this.convertToFoxgloveMessage(parsedMessage as WebRTCMessage)];
//       }
//     } catch (error) {
//       console.error("Error processing WebRTC message:", error);
//       return [];
//     }
//   }

//   private parseWebRTCMessage(data: string | ArrayBuffer): WebRTCMessage | WebRTCBatchMessage | null {
//     try {
//       let messageData: any;

//       if (typeof data === 'string') {
//         messageData = JSON.parse(data);
//       } else {
//         const decoder = new TextDecoder();
//         const jsonString = decoder.decode(data);
//         messageData = JSON.parse(jsonString);
//       }

//       return messageData;
//     } catch (error) {
//       console.error("Failed to parse WebRTC message:", error);
//       return null;
//     }
//   }

//   private isWebRTCBatchMessage(message: any): message is WebRTCBatchMessage {
//     return message && message.type === 'batch' && Array.isArray(message.messages);
//   }

//   private convertToFoxgloveMessage(webrtcMessage: WebRTCMessage): MessageEvent<unknown> {
//     const timestamp = webrtcMessage.timestamp;

//     return {
//       topic: webrtcMessage.topic,
//       receiveTime: {
//         sec: Math.floor(timestamp),
//         nsec: (timestamp % 1) * 1e9
//       },
//       message: webrtcMessage.data,
//       schemaName: webrtcMessage.messageType,

//       // ERROR in ./packages/studio-base/src/players/WebRTCPlayer/MessageProcessor.ts:57:20
//       // TS2532: Object is possibly 'undefined'.
//       //     55 |       message: webrtcMessage.data,
//       //     56 |       schemaName: webrtcMessage.messageType,
//       //   > 57 |       sizeInBytes: JSON.stringify(webrtcMessage.data).length
//       //        |                    ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^
//       //     58 |     };
//       //     59 |   }
//       //     60 |
//       sizeInBytes: JSON.stringify(webrtcMessage.data).length
//     };
//   }

//   getTopicStats() {
//     return this.topicStats;
//   }
// }
