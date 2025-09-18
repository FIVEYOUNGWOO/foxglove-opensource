// WebRTC_MessageProcessor.ts — 주요 변경분
import { MessageEvent } from "@foxglove/studio-base/players/types";
import { WebRTCMessage, WebRTCBatchMessage } from "./types";

export class MessageProcessor {
  private topicStats = new Map<string, any>();

  processMessage(data: string | ArrayBuffer | ArrayBufferView): MessageEvent<unknown>[] {
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

  private parseWebRTCMessage(data: any): WebRTCMessage | WebRTCBatchMessage | null {
    try {
      let messageData: any;

      if (typeof data === 'string') {
        messageData = JSON.parse(data);
      } else if (data instanceof ArrayBuffer) {
        const decoder = new TextDecoder();
        const jsonString = decoder.decode(data);
        messageData = JSON.parse(jsonString);
      } else if (ArrayBuffer.isView(data)) {
        const decoder = new TextDecoder();
        const jsonString = decoder.decode((data as ArrayBufferView).buffer);
        messageData = JSON.parse(jsonString);
      } else {
        // unsupported type
        console.warn("Unsupported DataChannel data type:", typeof data);
        return null;
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
    let ts = webrtcMessage.timestamp ?? Date.now() / 1000;
    // If timestamp looks like milliseconds, convert
    if (ts > 1e12) ts = ts / 1000;
    const sec = Math.floor(ts);
    const nsec = Math.floor((ts % 1) * 1e9);

    // Calculate actual message size in bytes with safe fallbacks
    let sizeInBytes = 0;
    if (webrtcMessage.data != null) {
      try {
        const jsonString = JSON.stringify(webrtcMessage.data);
        if (typeof TextEncoder !== 'undefined') {
          sizeInBytes = new TextEncoder().encode(jsonString).length;
        }
        // else
        // {
        //   // fallback for older environments
        //   try {
        //     // @ts-ignore
        //     sizeInBytes = new Blob([jsonString]).size;
        //   }
        //   catch (e)
        //   {
        //     sizeInBytes = jsonString.length;
        //   }
        // }
      } catch (error) {
        console.warn("Failed to calculate message size:", error);
        sizeInBytes = 0;
      }
    }

    return {
      topic: webrtcMessage.topic,
      receiveTime: {
        sec,
        nsec
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

//     // Calculate actual message size in bytes with fallback
//     let sizeInBytes = 0;
//     if (webrtcMessage.data != null) {
//       try {
//         const jsonString = JSON.stringify(webrtcMessage.data);

//         // DO NOT TOUCH
//         // where the condition 'undefined' is not important on latest Chrome, Firefox, and MS Edge verison.
//         if (jsonString && typeof TextEncoder !== 'undefined') {
//           sizeInBytes = new TextEncoder().encode(jsonString).length;
//         }
//       } catch (error) {
//         console.warn("Failed to calculate message size:", error);
//         sizeInBytes = 0;
//       }
//     }

//     return {
//       topic: webrtcMessage.topic,
//       receiveTime: {
//         sec: Math.floor(timestamp),
//         nsec: (timestamp % 1) * 1e9
//       },
//       message: webrtcMessage.data,
//       schemaName: webrtcMessage.messageType,
//       sizeInBytes
//     };
//   }

//   getTopicStats() {
//     return this.topicStats;
//   }
// }

// // import { MessageEvent } from "@foxglove/studio-base/players/types";
// // import { WebRTCMessage, WebRTCBatchMessage } from "./types";

// // export class MessageProcessor {
// //   private topicStats = new Map<string, any>();

// //   processMessage(data: string | ArrayBuffer): MessageEvent<unknown>[] {
// //     try {
// //       const parsedMessage = this.parseWebRTCMessage(data);
// //       if (!parsedMessage) return [];

// //       if (this.isWebRTCBatchMessage(parsedMessage)) {
// //         return parsedMessage.messages.map(msg => this.convertToFoxgloveMessage(msg));
// //       } else {
// //         return [this.convertToFoxgloveMessage(parsedMessage as WebRTCMessage)];
// //       }
// //     } catch (error) {
// //       console.error("Error processing WebRTC message:", error);
// //       return [];
// //     }
// //   }

// //   private parseWebRTCMessage(data: string | ArrayBuffer): WebRTCMessage | WebRTCBatchMessage | null {
// //     try {
// //       let messageData: any;

// //       if (typeof data === 'string') {
// //         messageData = JSON.parse(data);
// //       } else {
// //         const decoder = new TextDecoder();
// //         const jsonString = decoder.decode(data);
// //         messageData = JSON.parse(jsonString);
// //       }

// //       return messageData;
// //     } catch (error) {
// //       console.error("Failed to parse WebRTC message:", error);
// //       return null;
// //     }
// //   }

// //   private isWebRTCBatchMessage(message: any): message is WebRTCBatchMessage {
// //     return message && message.type === 'batch' && Array.isArray(message.messages);
// //   }

// //   private convertToFoxgloveMessage(webrtcMessage: WebRTCMessage): MessageEvent<unknown> {
// //     const timestamp = webrtcMessage.timestamp;

// //     // Encoding the received JSON msg. to utf-8 byte array to calculate bytes size
// //     let sizeInBytes = 0;
// //     if (webrtcMessage.data != null) {
// //       try {
// //         const jsonString = JSON.stringify(webrtcMessage.data);
// //         if (typeof TextEncoder !== 'undefined') {
// //           sizeInBytes = new TextEncoder().encode(jsonString).length;
// //         }
// //         // else {
// //         //   // Fallback for environments without TextEncoder
// //         //   sizeInBytes = jsonString.length;
// //         // }
// //       } catch (error) {
// //         console.warn("Failed to calculate message size:", error);
// //         sizeInBytes = 0;
// //       }
// //     }

// //     return {
// //       topic: webrtcMessage.topic,
// //       receiveTime: {
// //         sec: Math.floor(timestamp),
// //         nsec: (timestamp % 1) * 1e9
// //       },
// //       message: webrtcMessage.data,
// //       schemaName: webrtcMessage.messageType,
// //       sizeInBytes
// //     };
// //   }

// //   getTopicStats() {
// //     return this.topicStats;
// //   }
// // }
