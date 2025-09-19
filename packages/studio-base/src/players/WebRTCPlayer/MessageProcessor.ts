// Enhanced WebRTC Message Processor with Comprehensive Data Handling
// This module processes incoming WebRTC messages and converts them to Foxglove format

import { MessageEvent } from "@foxglove/studio-base/players/types";
import { WebRTCMessage, WebRTCBatchMessage, MessageProcessingStats } from "./types";

export class MessageProcessor {
  private topicStats = new Map<string, any>();
  private processingStats: MessageProcessingStats = {
    totalMessages: 0,
    validMessages: 0,
    invalidMessages: 0,
    averageProcessingTime: 0,
    lastProcessingTime: 0,
    messageTypeCounts: new Map()
  };
  private processingTimes: number[] = [];

  /**
   * Process incoming WebRTC message data and convert to Foxglove format
   * Handles both individual messages and batch messages
   */
  processMessage(data: string | ArrayBuffer | ArrayBufferView): MessageEvent<unknown>[] {
    const startTime = performance.now();

    try {
      this.processingStats.totalMessages++;

      const parsedMessage = this.parseWebRTCMessage(data);
      if (!parsedMessage) {
        this.processingStats.invalidMessages++;
        return [];
      }

      let messages: MessageEvent<unknown>[];

      if (this.isWebRTCBatchMessage(parsedMessage)) {
        messages = this.processBatchMessage(parsedMessage as WebRTCBatchMessage);
        console.debug(`Processed batch message with ${parsedMessage.messages.length} individual messages`);
      } else {
        messages = [this.convertToFoxgloveMessage(parsedMessage as WebRTCMessage)];
        console.debug(`Processed individual message for topic: ${(parsedMessage as WebRTCMessage).topic}`);
      }

      // Update statistics
      this.processingStats.validMessages++;
      const processingTime = performance.now() - startTime;
      this.updateProcessingStats(processingTime);

      return messages.filter(msg => msg !== null) as MessageEvent<unknown>[];

    } catch (error) {
      this.processingStats.invalidMessages++;
      console.error("Error processing WebRTC message:", error);
      return [];
    }
  }

  /**
   * Parse raw WebRTC message data into structured format
   */
  private parseWebRTCMessage(data: any): WebRTCMessage | WebRTCBatchMessage | null {
    try {
      let messageData: any;

      // Handle different data types from WebRTC data channel
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
        console.warn("Unsupported DataChannel data type:", typeof data);
        return null;
      }

      // Validate basic message structure
      if (!messageData || typeof messageData !== 'object') {
        console.warn("Invalid message data structure");
        return null;
      }

      return messageData;
    } catch (error) {
      console.error("Failed to parse WebRTC message:", error);
      return null;
    }
  }

  /**
   * Check if message is a batch message containing multiple individual messages
   */
  private isWebRTCBatchMessage(message: any): message is WebRTCBatchMessage {
    return message &&
           message.type === 'batch' &&
           Array.isArray(message.messages) &&
           message.messages.length > 0;
  }

  /**
   * Process batch message containing multiple individual messages
   */
  private processBatchMessage(batchMessage: WebRTCBatchMessage): MessageEvent<unknown>[] {
    const messages: MessageEvent<unknown>[] = [];

    for (const individualMessage of batchMessage.messages) {
      if (this.isValidWebRTCMessage(individualMessage)) {
        const foxgloveMessage = this.convertToFoxgloveMessage(individualMessage);
        if (foxgloveMessage) {
          messages.push(foxgloveMessage);
        }
      } else {
        console.warn("Invalid message in batch:", individualMessage);
      }
    }

    return messages;
  }

  /**
   * Validate individual WebRTC message structure
   */
  private isValidWebRTCMessage(message: any): message is WebRTCMessage {
    return message &&
           typeof message.topic === 'string' &&
           typeof message.messageType === 'string' &&
           typeof message.timestamp === 'number' &&
           message.data !== undefined;
  }

  /**
   * Convert WebRTC message to Foxglove MessageEvent format
   */
  private convertToFoxgloveMessage(webrtcMessage: WebRTCMessage): MessageEvent<unknown> | null {
    try {
      // Validate timestamp and convert to proper format
      let ts = webrtcMessage.timestamp ?? Date.now() / 1000;

      // Handle different timestamp formats (milliseconds vs seconds)
      if (ts > 1e12) {
        ts = ts / 1000; // Convert milliseconds to seconds
      }

      const sec = Math.floor(ts);
      const nsec = Math.floor((ts % 1) * 1e9);

      // Calculate message size in bytes
      let sizeInBytes = 0;
      if (webrtcMessage.data != null) {
        try {
          const jsonString = JSON.stringify(webrtcMessage.data);
          if (typeof TextEncoder !== 'undefined')
            {
            sizeInBytes = new TextEncoder().encode(jsonString).length;
          }
          else {
            // Fallback for environments without TextEncoder
            sizeInBytes = jsonString.length * 2; // Rough estimate for UTF-16
          }
        } catch (error) {
          console.warn("Failed to calculate message size:", error);
          sizeInBytes = 0;
        }
      }

      // Update topic statistics
      this.updateTopicStats(webrtcMessage.topic, sizeInBytes);

      // Update message type count
      const currentCount = this.processingStats.messageTypeCounts.get(webrtcMessage.messageType) || 0;
      this.processingStats.messageTypeCounts.set(webrtcMessage.messageType, currentCount + 1);

      // Create Foxglove MessageEvent
      const foxgloveMessage: MessageEvent<unknown> = {
        topic: webrtcMessage.topic,
        receiveTime: {
          sec,
          nsec
        },
        message: this.processMessageData(webrtcMessage.data, webrtcMessage.messageType),
        schemaName: webrtcMessage.messageType,
        sizeInBytes
      };

      return foxgloveMessage;

    } catch (error) {
      console.error("Error converting WebRTC message to Foxglove format:", error);
      return null;
    }
  }

  /**
   * Process message data based on message type
   */
  private processMessageData(data: any, messageType: string): any {
    try {
      switch (messageType) {
        case 'sensor_msgs/CompressedImage':
          return this.processCompressedImageData(data);

        case 'sensor_msgs/PointCloud2':
          return this.processPointCloudData(data);

        case 'std_msgs/Int32':
        case 'std_msgs/Float64':
        case 'std_msgs/String':
          return this.processStandardMessageData(data, messageType);

        default:
          // For unknown message types, return data as-is
          return data;
      }
    } catch (error) {
      console.warn(`Error processing message data for type ${messageType}:`, error);
      return data; // Return original data on error
    }
  }

  /**
   * Process compressed image data
   */
  private processCompressedImageData(data: any): any {
    if (!data || typeof data !== 'object') {
      return data;
    }

    // Ensure proper structure for compressed image
    return {
      header: {
        stamp: data.header?.stamp || { sec: 0, nanosec: 0 },
        frame_id: data.header?.frame_id || ""
      },
      format: data.format || "jpeg",
      data: data.data || ""
    };
  }

  /**
   * Process point cloud data
   */
  private processPointCloudData(data: any): any {
    if (!data || typeof data !== 'object') {
      return data;
    }

    // Ensure proper structure for point cloud
    return {
      header: {
        stamp: data.header?.stamp || { sec: 0, nanosec: 0 },
        frame_id: data.header?.frame_id || ""
      },
      height: data.height || 1,
      width: data.width || 0,
      fields: data.fields || [],
      is_bigendian: data.is_bigendian || false,
      point_step: data.point_step || 0,
      row_step: data.row_step || 0,
      data: data.data || [],
      is_dense: data.is_dense !== undefined ? data.is_dense : true
    };
  }

  /**
   * Process standard ROS message data
   */
  private processStandardMessageData(data: any, messageType: string): any {
    if (typeof data === 'object' && data !== null && 'data' in data) {
      return data; // Already in correct format
    }

    // Wrap primitive values in standard message format
    return { data: data };
  }

  /**
   * Update topic statistics
   */
  private updateTopicStats(topic: string, messageSize: number): void {
    if (!this.topicStats.has(topic)) {
      this.topicStats.set(topic, {
        messageCount: 0,
        totalBytes: 0,
        lastMessageTime: Date.now(),
        averageMessageSize: 0
      });
    }

    const stats = this.topicStats.get(topic)!;
    stats.messageCount++;
    stats.totalBytes += messageSize;
    stats.lastMessageTime = Date.now();
    stats.averageMessageSize = stats.totalBytes / stats.messageCount;
  }

  /**
   * Update processing performance statistics
   */
  private updateProcessingStats(processingTime: number): void {
    this.processingTimes.push(processingTime);

    // Keep only recent processing times to calculate rolling average
    if (this.processingTimes.length > 1000) {
      this.processingTimes = this.processingTimes.slice(-500);
    }

    this.processingStats.lastProcessingTime = processingTime;
    this.processingStats.averageProcessingTime =
      this.processingTimes.reduce((sum, time) => sum + time, 0) / this.processingTimes.length;
  }

  /**
   * Get topic statistics
   */
  getTopicStats(): Map<string, any> {
    return new Map(this.topicStats);
  }

  /**
   * Get processing statistics
   */
  getProcessingStats(): MessageProcessingStats {
    return {
      ...this.processingStats,
      messageTypeCounts: new Map(this.processingStats.messageTypeCounts)
    };
  }

  /**
   * Reset all statistics
   */
  resetStats(): void {
    this.topicStats.clear();
    this.processingStats = {
      totalMessages: 0,
      validMessages: 0,
      invalidMessages: 0,
      averageProcessingTime: 0,
      lastProcessingTime: 0,
      messageTypeCounts: new Map()
    };
    this.processingTimes = [];
  }

  /**
   * Get performance summary
   */
  getPerformanceSummary(): any {
    const stats = this.getProcessingStats();
    const topicCount = this.topicStats.size;
    const successRate = stats.totalMessages > 0 ? (stats.validMessages / stats.totalMessages) * 100 : 0;

    return {
      totalMessages: stats.totalMessages,
      validMessages: stats.validMessages,
      invalidMessages: stats.invalidMessages,
      successRate: Math.round(successRate * 100) / 100,
      averageProcessingTime: Math.round(stats.averageProcessingTime * 100) / 100,
      topicCount,
      messageTypes: Array.from(stats.messageTypeCounts.entries()).map(([type, count]) => ({
        type,
        count
      }))
    };
  }
}

// // WebRTC_MessageProcessor.ts — 주요 변경분
// import { MessageEvent } from "@foxglove/studio-base/players/types";
// import { WebRTCMessage, WebRTCBatchMessage } from "./types";

// export class MessageProcessor {
//   private topicStats = new Map<string, any>();

//   processMessage(data: string | ArrayBuffer | ArrayBufferView): MessageEvent<unknown>[] {
//     try {
//       const parsedMessage = this.parseWebRTCMessage(data);
//       if (!parsedMessage) return [];

//       if (this.isWebRTCBatchMessage(parsedMessage))
//       {
//         return parsedMessage.messages.map(msg => this.convertToFoxgloveMessage(msg));
//       } else
//       {
//         return [this.convertToFoxgloveMessage(parsedMessage as WebRTCMessage)];
//       }
//     } catch (error) {
//       console.error("Error processing WebRTC message:", error);
//       return [];
//     }
//   }

//   private parseWebRTCMessage(data: any): WebRTCMessage | WebRTCBatchMessage | null {
//     try {
//       let messageData: any;

//       // TODO
//       // check serialized JSON data
//       if (typeof data === 'string') {
//         messageData = JSON.parse(data);

//       } else if (data instanceof ArrayBuffer) {
//         const decoder = new TextDecoder();
//         const jsonString = decoder.decode(data);
//         messageData = JSON.parse(jsonString);
//       } else if (ArrayBuffer.isView(data)) {
//         const decoder = new TextDecoder();
//         const jsonString = decoder.decode((data as ArrayBufferView).buffer);
//         messageData = JSON.parse(jsonString);
//       } else {
//         // unsupported type
//         console.warn("Unsupported DataChannel data type:", typeof data);
//         return null;
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
//     let ts = webrtcMessage.timestamp ?? Date.now() / 1000;
//     // If timestamp looks like milliseconds, convert
//     if (ts > 1e12) ts = ts / 1000;
//     const sec = Math.floor(ts);
//     const nsec = Math.floor((ts % 1) * 1e9);

//     // Calculate actual message size in bytes with safe fallbacks
//     let sizeInBytes = 0;
//     if (webrtcMessage.data != null) {
//       try
//       {
//         const jsonString = JSON.stringify(webrtcMessage.data);
//         if (typeof TextEncoder !== 'undefined')
//         {
//           sizeInBytes = new TextEncoder().encode(jsonString).length;
//         }

//         // DO NOT TOUCH
//         // where the condition 'undefined' is not important on latest Chrome, Firefox, and MS Edge verison.
//         // else
//         // {
//         //   // fallback for older environments
//         //   try {
//         //     // @ts-ignore
//         //     sizeInBytes = new Blob([jsonString]).size;
//         //   }
//         //   catch (e)
//         //   {
//         //     sizeInBytes = jsonString.length;
//         //   }
//         // }

//       } catch (error) {
//         console.warn("Failed to calculate message size:", error);
//         sizeInBytes = 0;
//       }
//     }

//     return {
//       topic: webrtcMessage.topic,
//       receiveTime: {
//         sec,
//         nsec
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

// //     // Calculate actual message size in bytes with fallback
// //     let sizeInBytes = 0;
// //     if (webrtcMessage.data != null) {
// //       try {
// //         const jsonString = JSON.stringify(webrtcMessage.data);

// //         // DO NOT TOUCH
// //         // where the condition 'undefined' is not important on latest Chrome, Firefox, and MS Edge verison.
// //         if (jsonString && typeof TextEncoder !== 'undefined') {
// //           sizeInBytes = new TextEncoder().encode(jsonString).length;
// //         }
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

// // // import { MessageEvent } from "@foxglove/studio-base/players/types";
// // // import { WebRTCMessage, WebRTCBatchMessage } from "./types";

// // // export class MessageProcessor {
// // //   private topicStats = new Map<string, any>();

// // //   processMessage(data: string | ArrayBuffer): MessageEvent<unknown>[] {
// // //     try {
// // //       const parsedMessage = this.parseWebRTCMessage(data);
// // //       if (!parsedMessage) return [];

// // //       if (this.isWebRTCBatchMessage(parsedMessage)) {
// // //         return parsedMessage.messages.map(msg => this.convertToFoxgloveMessage(msg));
// // //       } else {
// // //         return [this.convertToFoxgloveMessage(parsedMessage as WebRTCMessage)];
// // //       }
// // //     } catch (error) {
// // //       console.error("Error processing WebRTC message:", error);
// // //       return [];
// // //     }
// // //   }

// // //   private parseWebRTCMessage(data: string | ArrayBuffer): WebRTCMessage | WebRTCBatchMessage | null {
// // //     try {
// // //       let messageData: any;

// // //       if (typeof data === 'string') {
// // //         messageData = JSON.parse(data);
// // //       } else {
// // //         const decoder = new TextDecoder();
// // //         const jsonString = decoder.decode(data);
// // //         messageData = JSON.parse(jsonString);
// // //       }

// // //       return messageData;
// // //     } catch (error) {
// // //       console.error("Failed to parse WebRTC message:", error);
// // //       return null;
// // //     }
// // //   }

// // //   private isWebRTCBatchMessage(message: any): message is WebRTCBatchMessage {
// // //     return message && message.type === 'batch' && Array.isArray(message.messages);
// // //   }

// // //   private convertToFoxgloveMessage(webrtcMessage: WebRTCMessage): MessageEvent<unknown> {
// // //     const timestamp = webrtcMessage.timestamp;

// // //     // Encoding the received JSON msg. to utf-8 byte array to calculate bytes size
// // //     let sizeInBytes = 0;
// // //     if (webrtcMessage.data != null) {
// // //       try {
// // //         const jsonString = JSON.stringify(webrtcMessage.data);
// // //         if (typeof TextEncoder !== 'undefined') {
// // //           sizeInBytes = new TextEncoder().encode(jsonString).length;
// // //         }
// // //         // else {
// // //         //   // Fallback for environments without TextEncoder
// // //         //   sizeInBytes = jsonString.length;
// // //         // }
// // //       } catch (error) {
// // //         console.warn("Failed to calculate message size:", error);
// // //         sizeInBytes = 0;
// // //       }
// // //     }

// // //     return {
// // //       topic: webrtcMessage.topic,
// // //       receiveTime: {
// // //         sec: Math.floor(timestamp),
// // //         nsec: (timestamp % 1) * 1e9
// // //       },
// // //       message: webrtcMessage.data,
// // //       schemaName: webrtcMessage.messageType,
// // //       sizeInBytes
// // //     };
// // //   }

// // //   getTopicStats() {
// // //     return this.topicStats;
// // //   }
// // // }
