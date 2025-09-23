// 파일명: MessageProcessor.ts

import { MessageEvent } from "@foxglove/studio-base/players/types";
import { Time } from "@foxglove/rostime";

// Producer가 보내는 데이터 구조에 대한 인터페이스 정의
interface SensorDataMessage {
    type: 'sensor_update';
    scan_index: number;
    timestamp: number;
    can_data?: Record<string, any>;
    camera_data?: Record<string, string>;
    [key: string]: any; // 다른 데이터가 포함될 수 있도록 유연하게 정의
}

export class MessageProcessor {
    // Producer -> Consumer 토픽 이름 매핑
    private readonly topicMappings = {
        camera: {
            'camera_1': '/camera/cam_1/image_raw/compressed',
            'camera_2': '/camera/cam_2/image_raw/compressed',
            'camera_3': '/camera/cam_3/image_raw/compressed',
            'camera_4': '/camera/cam_4/image_raw/compressed',
            'camera_5': '/camera/cam_5/image_raw/compressed',
            'camera_6': '/camera/cam_6/image_raw/compressed',
        } as Record<string, string>,
        radar: {
            'FL': '/radar_points_3d/fl',
            'FR': '/radar_points_3d/fr',
            'RL': '/radar_points_3d/rl',
            'RR': '/radar_points_3d/rr',
        } as Record<string, string>
    };

    public processMessage(data: string | ArrayBuffer | ArrayBufferView): MessageEvent<unknown>[] {
        try {
            // [수정] WebRTC는 자동으로 재조립하므로, 청크 확인 로직 제거하고 바로 JSON 파싱
            const textData = (typeof data === 'string') ? data : new TextDecoder().decode(data);
            const parsedData = JSON.parse(textData) as SensorDataMessage;

            if (parsedData && parsedData.type === 'sensor_update') {
                return this.processSensorDataMessage(parsedData);
            }

            console.warn("[MessageProcessor] Received message of unknown type:", parsedData?.type);
            return [];

        } catch (error) {
            console.error("[MessageProcessor] Failed to parse message:", error);
            return [];
        }
    }

    private processSensorDataMessage(sensorData: SensorDataMessage): MessageEvent<unknown>[] {
        const messages: MessageEvent<unknown>[] = [];
        const baseTimestamp = this.normalizeTimestamp(sensorData.timestamp);
        const scanIndex = sensorData.scan_index;

        messages.push(this.createMessage('/vehicle/can/scan_index', 'std_msgs/Int32', { data: scanIndex }, baseTimestamp));

        if (sensorData.can_data) {
            messages.push(...this.processCanData(sensorData.can_data, baseTimestamp));
        }
        if (sensorData.camera_data) {
            messages.push(...this.processCameraData(sensorData.camera_data, baseTimestamp, scanIndex));
        }

        // Radar 데이터는 can_data 내에 포함되어 있으므로 can_data를 넘겨줍니다.
        if (sensorData.can_data) {
            messages.push(...this.extractRadarData(sensorData.can_data, baseTimestamp, scanIndex));
        }

        return messages;
    }

    private processCanData(canData: Record<string, any>, timestamp: Time): MessageEvent<unknown>[] {
        const messages: MessageEvent<unknown>[] = [];
        // can_data 객체 내의 모든 신호를 동적으로 토픽으로 변환
        for (const [signalName, value] of Object.entries(canData)) {
            const topic = `/vehicle/can/raw/${signalName}`;
            // ROS 메시지 타입 추론 (더 정교한 로직 추가 가능)
            let schemaName = 'std_msgs/Float64';
            if (Number.isInteger(value)) {
                schemaName = 'std_msgs/Int32';
            } else if (typeof value === 'string') {
                schemaName = 'std_msgs/String';
            }
            messages.push(this.createMessage(topic, schemaName, { data: value }, timestamp));
        }
        return messages;
    }

    private processCameraData(cameraData: Record<string, string>, timestamp: Time, scanIndex: number): MessageEvent<unknown>[] {
        const messages: MessageEvent<unknown>[] = [];
        for (const [cameraKey, imageData] of Object.entries(cameraData)) {
            if (!imageData) continue;

            const topic = this.topicMappings.camera[cameraKey];
            if (!topic) continue;

            const cameraMessage = {
                header: { stamp: timestamp, frame_id: cameraKey, seq: scanIndex },
                format: 'jpeg',
                data: imageData,
            };
            messages.push(this.createMessage(topic, 'sensor_msgs/CompressedImage', cameraMessage, timestamp));
        }
        return messages;
    }

    private extractRadarData(canData: any, timestamp: Time, scanIndex: number): MessageEvent<unknown>[] {
        const messages: MessageEvent<unknown>[] = [];
        const radarCorners = ['FL', 'FR', 'RL', 'RR'];

        for (const corner of radarCorners) {
            const points = this.extractRadarPoints(canData, corner);
            if (points.length > 0) {
                const pointCloud = this.createPointCloud2Message(points, corner.toLowerCase(), timestamp, scanIndex);
                const topic = this.topicMappings.radar[corner];
                if (topic) {
                    messages.push(this.createMessage(topic, 'sensor_msgs/PointCloud2', pointCloud, timestamp));
                }
            }
        }
        return messages;
    }

    private extractRadarPoints(canData: any, corner: string): Array<{x: number, y: number, z: number, intensity: number}> {
        const points: {x: number, y: number, z: number, intensity: number}[] = [];
        for (let i = 0; i < 200; i++) {
            const rangeKey = `${corner}__Range_${i}`;
            if (!(rangeKey in canData)) break;

            const range = parseFloat(canData[rangeKey] ?? 0);
            if (range <= 0.1) continue;

            const azimuth = parseFloat(canData[`${corner}__AziAng_${i}`] ?? 0);
            const elevation = parseFloat(canData[`${corner}__EleAng_${i}`] ?? 0);
            const power = parseFloat(canData[`${corner}__Power_${i}`] ?? 0);

            const azimuthRad = azimuth * Math.PI / 180;
            const elevationRad = elevation * Math.PI / 180;

            const x = range * Math.cos(elevationRad) * Math.cos(azimuthRad);
            const y = range * Math.cos(elevationRad) * Math.sin(azimuthRad);
            const z = range * Math.sin(elevationRad);

            points.push({ x, y, z, intensity: power });
        }
        return points;
    }

    private createPointCloud2Message(points: Array<{x: number, y: number, z: number, intensity: number}>, frameId: string, timestamp: Time, scanIndex: number): any {
        const pointStep = 16;
        const dataArray = new Float32Array(points.length * 4);

        for (let i = 0; i < points.length; i++) {
            const point = points[i]!;
            dataArray[i * 4 + 0] = point.x;
            dataArray[i * 4 + 1] = point.y;
            dataArray[i * 4 + 2] = point.z;
            dataArray[i * 4 + 3] = point.intensity;
        }

        return {
            header: { stamp: timestamp, frame_id: `radar_${frameId}`, seq: scanIndex },
            height: 1,
            width: points.length,
            fields: [
                { name: 'x', offset: 0, datatype: 7, count: 1 },
                { name: 'y', offset: 4, datatype: 7, count: 1 },
                { name: 'z', offset: 8, datatype: 7, count: 1 },
                { name: 'intensity', offset: 12, datatype: 7, count: 1 },
            ],
            is_bigendian: false,
            point_step: pointStep,
            row_step: pointStep * points.length,
            data: Array.from(new Uint8Array(dataArray.buffer)),
            is_dense: true,
        };
    }

    private createMessage(topic: string, schemaName: string, message: any, receiveTime: Time): MessageEvent<unknown> {
        return {
            topic,
            receiveTime,
            message,
            schemaName,
            sizeInBytes: JSON.stringify(message).length,
        };
    }

    private normalizeTimestamp(timestamp: number): Time {
        const sec = Math.floor(timestamp);
        const nsec = Math.round((timestamp - sec) * 1e9);
        return { sec, nsec };
    }
}



// import { MessageEvent } from "@foxglove/studio-base/players/types";
// import { Time } from "@foxglove/rostime";

// interface WebRTCMessage {
//     type: string;
//     topic?: string;
//     data: any;
//     timestamp: number;
//     messageType?: string;
//     scan_index?: number;
// }

// interface BatchMessage {
//     type: 'batch';
//     messages: WebRTCMessage[];
//     count: number;
//     timestamp: number;
//     scan_index?: number;
// }

// interface SensorDataMessage {
//     type: 'sensor_update';
//     scan_index: number;
//     timestamp: number;
//     can_data?: Record<string, any>;
//     camera_data?: Record<string, string>;
//     radar_data?: Record<string, any>;
//     [key: string]: any;
// }

// interface ProcessingStatistics {
//     totalMessages: number;
//     validMessages: number;
//     invalidMessages: number;
//     batchMessages: number;
//     sensorMessages: number;
//     canMessages: number;
//     cameraMessages: number;
//     radarMessages: number;
//     averageProcessingTime: number;
//     lastProcessingTime: number;
//     parseErrors: number;
//     conversionErrors: number;
// }

// interface ChunkHeader {
//     msg_id: string;
//     seq: number;
//     total: number;
//     timestamp: number;
// }

// interface FragmentMetadata {
//     total: number;
//     timestamp: number;
//     received_count: number;
// }

// export class MessageProcessor {
//     // Statistics tracking
//     private stats: ProcessingStatistics = {
//         totalMessages: 0,
//         validMessages: 0,
//         invalidMessages: 0,
//         batchMessages: 0,
//         sensorMessages: 0,
//         canMessages: 0,
//         cameraMessages: 0,
//         radarMessages: 0,
//         averageProcessingTime: 0,
//         lastProcessingTime: 0,
//         parseErrors: 0,
//         conversionErrors: 0
//     };

//     // Performance tracking
//     private processingTimes: number[] = [];
//     private readonly maxProcessingTimeSamples = 100;

//     // Chunk reassembly storage (based on UDP fragment pattern)
//     private fragments: Map<string, Map<number, string>> = new Map();
//     private fragmentMetadata: Map<string, FragmentMetadata> = new Map();
//     private readonly fragmentTimeout = 5000; // 5 seconds timeout
//     private lastCleanupTime = 0;

//     // Network statistics
//     private networkStats = {
//         packetsReceived: 0,
//         totalBytesReceived: 0,
//         fragmentationEvents: 0,
//         packetLossCount: 0,
//         reassembledMessages: 0
//     };

//     // Topic mapping for sensor data with index signatures
//     private readonly topicMappings = {
//         can: {
//             'scan_index': '/vehicle/can/scan_index',
//             'peak_count': '/vehicle/can/peak_count',
//             'cycle_time': '/vehicle/can/cycle_time',
//             'speed': '/vehicle/speed',
//             'rpm': '/vehicle/rpm'
//         } as Record<string, string>,
//         camera: {
//             'camera_1': '/camera/cam_1/image_raw/compressed',
//             'camera_2': '/camera/cam_2/image_raw/compressed',
//             'camera_3': '/camera/cam_3/image_raw/compressed',
//             'camera_4': '/camera/cam_4/image_raw/compressed',
//             'camera_5': '/camera/cam_5/image_raw/compressed',
//             'camera_6': '/camera/cam_6/image_raw/compressed'
//         } as Record<string, string>,
//         radar: {
//             'FL': '/radar_points_3d/fl',
//             'FR': '/radar_points_3d/fr',
//             'RL': '/radar_points_3d/rl',
//             'RR': '/radar_points_3d/rr'
//         } as Record<string, string>
//     };

//     processMessage(data: string | ArrayBuffer | ArrayBufferView): MessageEvent<unknown>[] {
//         const startTime = performance.now();
//         this.stats.totalMessages++;

//         try {
//             const textData = this.convertToText(data);
//             if (!textData) {
//                 this.stats.invalidMessages++;
//                 return [];
//             }

//             // Check if this is a chunked message
//             if (this.isChunkedMessage(textData)) {
//                 return this.receiveWebRTCMessage(textData);
//             }

//             // Handle non-chunked messages with existing logic
//             const parsedData = this.parseRawData(data);
//             if (!parsedData) {
//                 this.stats.invalidMessages++;
//                 return [];
//             }

//             let messages: MessageEvent<unknown>[] = [];

//             // Determine message type and process accordingly
//             if (this.isBatchMessage(parsedData)) {
//                 messages = this.processBatchMessage(parsedData as BatchMessage);
//                 this.stats.batchMessages++;
//             } else if (this.isSensorDataMessage(parsedData)) {
//                 messages = this.processSensorDataMessage(parsedData as SensorDataMessage);
//                 this.stats.sensorMessages++;
//             } else if (this.isStandardMessage(parsedData)) {
//                 const msg = this.processStandardMessage(parsedData as WebRTCMessage);
//                 if (msg) messages = [msg];
//             } else {
//                 console.warn("[MessageProcessor] Unknown message format:", parsedData);
//                 this.stats.invalidMessages++;
//             }

//             // Update statistics
//             if (messages.length > 0) {
//                 this.stats.validMessages++;
//             }

//             const processingTime = performance.now() - startTime;
//             this.updateProcessingStats(processingTime);

//             return messages;

//         } catch (error) {
//             console.error("[MessageProcessor] Processing error:", error);
//             this.stats.conversionErrors++;
//             return [];
//         }
//     }

//     private convertToText(data: any): string {
//         if (typeof data === 'string') {
//             return data;
//         }
//         if (data instanceof ArrayBuffer) {
//             const decoder = new TextDecoder();
//             return decoder.decode(data);
//         }
//         if (ArrayBuffer.isView(data)) {
//             const decoder = new TextDecoder();
//             return decoder.decode(data);
//         }
//         return '';
//     }

//     private isChunkedMessage(text: string): boolean {
//         return text.includes('|') &&
//                text.includes('"msg_id"') &&
//                text.includes('"seq"') &&
//                text.includes('"total"');
//     }

//     private receiveWebRTCMessage(data: string): MessageEvent<unknown>[] {
//         try {
//             // Split header and payload (matching UDP logic)
//             const separatorIndex = data.indexOf('|');
//             if (separatorIndex === -1) {
//                 this.stats.parseErrors++;
//                 return [];
//             }

//             const headerRaw = data.substring(0, separatorIndex);
//             const payload = data.substring(separatorIndex + 1);

//             let header: ChunkHeader;
//             try {
//                 header = JSON.parse(headerRaw);
//             } catch (error) {
//                 console.error("[MessageProcessor] Invalid chunk header:", error);
//                 this.stats.parseErrors++;
//                 return [];
//             }

//             // Update network statistics
//             this.networkStats.packetsReceived++;
//             this.networkStats.totalBytesReceived += data.length;
//             if (header.total > 1) {
//                 this.networkStats.fragmentationEvents++;
//             }

//             // Reassemble message
//             const completeMessage = this.reassembleWebRTCMessage(header, payload);

//             if (completeMessage) {
//                 this.stats.validMessages++;
//                 this.networkStats.reassembledMessages++;

//                 // Process as sensor data message
//                 const messages = this.processSensorDataMessage(completeMessage);
//                 console.debug(`[MessageProcessor] Successfully processed reassembled message ${header.msg_id}, generated ${messages.length} Foxglove messages`);
//                 return messages;
//             } else {
//                 // Periodic cleanup (matching UDP pattern)
//                 const currentTime = Date.now();
//                 if (currentTime - this.lastCleanupTime > 10000) { // Every 10 seconds
//                     this.cleanupExpiredFragments();
//                     this.lastCleanupTime = currentTime;
//                 }
//                 return [];
//             }

//         } catch (error) {
//             console.error("[MessageProcessor] WebRTC message receive error:", error);
//             this.networkStats.packetLossCount++;
//             return [];
//         }
//     }

//     private reassembleWebRTCMessage(header: ChunkHeader, payload: string): any {
//         const { msg_id, seq, total, timestamp } = header;

//         // Initialize fragment storage for new message
//         if (!this.fragmentMetadata.has(msg_id)) {
//             this.fragmentMetadata.set(msg_id, {
//                 total: total,
//                 timestamp: timestamp,
//                 received_count: 0
//             });
//             this.fragments.set(msg_id, new Map());
//         }

//         const messageFragments = this.fragments.get(msg_id)!;
//         const metadata = this.fragmentMetadata.get(msg_id)!;

//         // Add fragment if not already received
//         if (!messageFragments.has(seq)) {
//             messageFragments.set(seq, payload);
//             metadata.received_count++;
//         }

//         // Check if all fragments received
//         if (metadata.received_count === total) {
//             // Reconstruct complete payload
//             let completePayload = "";
//             for (let i = 0; i < total; i++) {
//                 if (messageFragments.has(i)) {
//                     completePayload += messageFragments.get(i);
//                 } else {
//                     console.warn(`[MessageProcessor] Missing fragment ${i}/${total} for message ${msg_id}`);
//                     // Cleanup incomplete message
//                     this.fragments.delete(msg_id);
//                     this.fragmentMetadata.delete(msg_id);
//                     return null;
//                 }
//             }

//             // Cleanup fragments
//             this.fragments.delete(msg_id);
//             this.fragmentMetadata.delete(msg_id);

//             try {
//                 const message = JSON.parse(completePayload);
//                 console.debug(`[MessageProcessor] Successfully reassembled message ${msg_id} from ${total} fragments`);
//                 return message;
//             } catch (error) {
//                 console.error(`[MessageProcessor] JSON parse error for reassembled message ${msg_id}:`, error);
//                 this.stats.parseErrors++;
//                 return null;
//             }
//         }

//         return null;
//     }

//     private cleanupExpiredFragments(): void {
//         const currentTime = Date.now();
//         const expiredMessages: string[] = [];

//         // Find expired messages
//         for (const [msgId, metadata] of this.fragmentMetadata.entries()) {
//             if (currentTime - metadata.timestamp > this.fragmentTimeout) {
//                 expiredMessages.push(msgId);
//             }
//         }

//         // Remove expired fragments
//         for (const msgId of expiredMessages) {
//             this.fragments.delete(msgId);
//             this.fragmentMetadata.delete(msgId);
//         }

//         if (expiredMessages.length > 0) {
//             console.warn(`[MessageProcessor] Cleaned up ${expiredMessages.length} expired fragment groups`);
//         }
//     }

//     private parseRawData(data: any): any {
//         try {
//             // Handle string data (JSON)
//             if (typeof data === 'string') {
//                 return JSON.parse(data);
//             }

//             // Handle ArrayBuffer
//             if (data instanceof ArrayBuffer) {
//                 const decoder = new TextDecoder();
//                 const jsonString = decoder.decode(data);
//                 return JSON.parse(jsonString);
//             }

//             // Handle typed arrays
//             if (ArrayBuffer.isView(data)) {
//                 const decoder = new TextDecoder();
//                 const jsonString = decoder.decode(data);
//                 return JSON.parse(jsonString);
//             }

//             // Direct object (shouldn't happen but handle it)
//             if (typeof data === 'object' && data !== null) {
//                 return data;
//             }

//             console.warn("[MessageProcessor] Unsupported data type:", typeof data);
//             return null;

//         } catch (error) {
//             console.error("[MessageProcessor] Parse error:", error);
//             this.stats.parseErrors++;
//             return null;
//         }
//     }

//     private isBatchMessage(data: any): boolean {
//         return data &&
//                data.type === 'batch' &&
//                Array.isArray(data.messages) &&
//                data.messages.length > 0;
//     }

//     private isSensorDataMessage(data: any): boolean {
//         return data &&
//                (data.type === 'sensor_update' || data.scan_index !== undefined) &&
//                typeof data.timestamp === 'number';
//     }

//     private isStandardMessage(data: any): boolean {
//         return data &&
//                typeof data.topic === 'string' &&
//                data.data !== undefined;
//     }

//     private processBatchMessage(batch: BatchMessage): MessageEvent<unknown>[] {
//         const messages: MessageEvent<unknown>[] = [];

//         for (const msg of batch.messages) {
//             const processed = this.processStandardMessage(msg);
//             if (processed) {
//                 messages.push(processed);
//             }
//         }

//         console.debug(`[MessageProcessor] Processed batch with ${messages.length}/${batch.count} messages`);
//         return messages;
//     }

//     private processSensorDataMessage(sensorData: SensorDataMessage | any): MessageEvent<unknown>[] {
//         const messages: MessageEvent<unknown>[] = [];
//         const baseTimestamp = this.normalizeTimestamp(sensorData.timestamp);

//         // Process CAN data
//         if (sensorData.can_data) {
//             const canMessages = this.processCanData(
//                 sensorData.can_data,
//                 baseTimestamp,
//                 sensorData.scan_index
//             );
//             messages.push(...canMessages);
//             this.stats.canMessages += canMessages.length;
//         }

//         // Process camera data from camera_data field
//         if (sensorData.camera_data) {
//             const cameraMessages = this.processCameraData(
//                 sensorData.camera_data,
//                 baseTimestamp,
//                 sensorData.scan_index
//             );
//             messages.push(...cameraMessages);
//             this.stats.cameraMessages += cameraMessages.length;
//         }

//         // Process individual camera fields (camera_1, camera_2, etc.)
//         const individualCameraData: Record<string, string> = {};
//         for (let i = 1; i <= 6; i++) {
//             const cameraKey = `camera_${i}`;
//             if (sensorData[cameraKey] && typeof sensorData[cameraKey] === 'string') {
//                 individualCameraData[cameraKey] = sensorData[cameraKey];
//             }
//         }
//         if (Object.keys(individualCameraData).length > 0) {
//             const cameraMessages = this.processCameraData(
//                 individualCameraData,
//                 baseTimestamp,
//                 sensorData.scan_index
//             );
//             messages.push(...cameraMessages);
//             this.stats.cameraMessages += cameraMessages.length;
//         }

//         // Process radar data (from raw CAN signals)
//         const radarMessages = this.extractRadarData(
//             sensorData,
//             baseTimestamp,
//             sensorData.scan_index
//         );
//         messages.push(...radarMessages);
//         this.stats.radarMessages += radarMessages.length;

//         return messages;
//     }

//     private processCanData(canData: Record<string, any>, timestamp: Time, scanIndex: number): MessageEvent<unknown>[] {
//         const messages: MessageEvent<unknown>[] = [];

//         // Always include scan index
//         messages.push(this.createMessage(
//             '/vehicle/can/scan_index',
//             'std_msgs/Int32',
//             { data: scanIndex },
//             timestamp
//         ));

//         // Process known CAN signals
//         for (const [signal, value] of Object.entries(canData)) {
//             const topic = this.topicMappings.can[signal];
//             if (!topic) continue;

//             let messageType: string;
//             let messageData: any;

//             // Determine message type based on value
//             if (typeof value === 'number') {
//                 if (Number.isInteger(value)) {
//                     messageType = 'std_msgs/Int32';
//                     messageData = { data: value };
//                 } else {
//                     messageType = 'std_msgs/Float64';
//                     messageData = { data: value };
//                 }
//             } else if (typeof value === 'string') {
//                 messageType = 'std_msgs/String';
//                 messageData = { data: value };
//             } else if (typeof value === 'boolean') {
//                 messageType = 'std_msgs/Bool';
//                 messageData = { data: value };
//             } else {
//                 continue;
//             }

//             messages.push(this.createMessage(topic, messageType, messageData, timestamp));
//         }

//         return messages;
//     }

//     private processCameraData(cameraData: Record<string, string>, timestamp: Time, scanIndex: number): MessageEvent<unknown>[] {
//         const messages: MessageEvent<unknown>[] = [];

//         for (const [cameraKey, imageData] of Object.entries(cameraData)) {
//             // Skip empty camera data
//             if (!imageData || imageData.trim() === '') {
//                 continue;
//             }

//             const topic = this.topicMappings.camera[cameraKey];
//             if (!topic) continue;

//             try {
//                 // Create CompressedImage message
//                 const cameraMessage = {
//                     header: {
//                         stamp: timestamp,
//                         frame_id: cameraKey,
//                         seq: scanIndex
//                     },
//                     format: 'jpeg',
//                     data: imageData // Base64 encoded JPEG
//                 };

//                 messages.push(this.createMessage(
//                     topic,
//                     'sensor_msgs/CompressedImage',
//                     cameraMessage,
//                     timestamp
//                 ));

//                 console.debug(`[MessageProcessor] Processed camera ${cameraKey}: ${imageData.length} bytes`);
//             } catch (error) {
//                 console.error(`[MessageProcessor] Error processing camera ${cameraKey}:`, error);
//             }
//         }

//         return messages;
//     }

//     private extractRadarData(sensorData: any, timestamp: Time, scanIndex: number): MessageEvent<unknown>[] {
//         const messages: MessageEvent<unknown>[] = [];
//         const radarCorners = ['FL', 'FR', 'RL', 'RR'];

//         for (const corner of radarCorners) {
//             const points = this.extractRadarPoints(sensorData, corner);

//             if (points.length > 0) {
//                 const pointCloud = this.createPointCloud2Message(
//                     points,
//                     corner.toLowerCase(),
//                     timestamp,
//                     scanIndex
//                 );

//                 const topic = this.topicMappings.radar[corner];
//                 if (topic) {
//                     messages.push(this.createMessage(
//                         topic,
//                         'sensor_msgs/PointCloud2',
//                         pointCloud,
//                         timestamp
//                     ));
//                 }
//             }
//         }

//         return messages;
//     }

//     private extractRadarPoints(sensorData: any, corner: string): Array<{x: number, y: number, z: number, intensity: number}> {
//         const points = [];
//         const maxPoints = 200; // Maximum radar detections per corner

//         for (let i = 0; i < maxPoints; i++) {
//             const rangeKey = `${corner}__Range_${i}`;
//             // const velocityKey = `${corner}__Velocity_${i}`;
//             const aziKey = `${corner}__AziAng_${i}`;
//             const eleKey = `${corner}__EleAng_${i}`;
//             const powerKey = `${corner}__Power_${i}`;

//             // Check if this detection exists
//             if (!(rangeKey in sensorData)) break;

//             const range = parseFloat(sensorData[rangeKey] || 0);
//             // const velocity = parseFloat(sensorData[velocityKey] || 0);
//             const azimuth = parseFloat(sensorData[aziKey] || 0);
//             const elevation = parseFloat(sensorData[eleKey] || 0);
//             const power = parseFloat(sensorData[powerKey] || 0);

//             // Filter out invalid detections
//             if (range <= 0.1 || range > 250) continue;

//             // Convert spherical to Cartesian coordinates
//             const azimuthRad = azimuth * Math.PI / 180;
//             const elevationRad = elevation * Math.PI / 180;

//             const x = range * Math.cos(elevationRad) * Math.cos(azimuthRad);
//             const y = range * Math.cos(elevationRad) * Math.sin(azimuthRad);
//             const z = range * Math.sin(elevationRad);

//             points.push({
//                 x: x,
//                 y: y,
//                 z: z,
//                 intensity: power
//             });
//         }

//         return points;
//     }

//     private createPointCloud2Message(
//         points: Array<{x: number, y: number, z: number, intensity: number}>,
//         corner: string,
//         timestamp: Time,
//         scanIndex: number
//     ): any {
//         // Create binary data buffer for points
//         const pointStep = 16; // 4 floats * 4 bytes
//         const rowStep = pointStep * points.length;
//         const dataArray = new Float32Array(points.length * 4);

//         for (let i = 0; i < points.length; i++) {
//             const point = points[i];
//             if (!point) continue;
//             const offset = i * 4;
//             dataArray[offset] = point.x;
//             dataArray[offset + 1] = point.y;
//             dataArray[offset + 2] = point.z;
//             dataArray[offset + 3] = point.intensity;
//         }

//         return {
//             header: {
//                 stamp: timestamp,
//                 frame_id: `radar_${corner}`,
//                 seq: scanIndex
//             },
//             height: 1,
//             width: points.length,
//             fields: [
//                 { name: 'x', offset: 0, datatype: 7, count: 1 },
//                 { name: 'y', offset: 4, datatype: 7, count: 1 },
//                 { name: 'z', offset: 8, datatype: 7, count: 1 },
//                 { name: 'intensity', offset: 12, datatype: 7, count: 1 }
//             ],
//             is_bigendian: false,
//             point_step: pointStep,
//             row_step: rowStep,
//             data: Array.from(new Uint8Array(dataArray.buffer)),
//             is_dense: true
//         };
//     }

//     private processStandardMessage(msg: WebRTCMessage): MessageEvent<unknown> | null {
//         try {
//             const topic = msg.topic || '/unknown';
//             const messageType = msg.messageType || this.guessMessageType(topic);
//             const timestamp = this.normalizeTimestamp(msg.timestamp);

//             return this.createMessage(topic, messageType, msg.data, timestamp);

//         } catch (error) {
//             console.error("[MessageProcessor] Error processing standard message:", error);
//             this.stats.conversionErrors++;
//             return null;
//         }
//     }

//     private createMessage(
//         topic: string,
//         messageType: string,
//         data: any,
//         timestamp: Time
//     ): MessageEvent<unknown> {
//         // Calculate message size
//         let sizeInBytes = 0;
//         try {
//             const jsonString = JSON.stringify(data);
//             sizeInBytes = new TextEncoder().encode(jsonString).length;
//         } catch {
//             sizeInBytes = 0;
//         }

//         return {
//             topic,
//             receiveTime: timestamp,
//             message: data,
//             schemaName: messageType,
//             sizeInBytes
//         };
//     }

//     private normalizeTimestamp(timestamp: number | undefined): Time {
//         let ts = timestamp || Date.now() / 1000;

//         // Convert milliseconds to seconds if needed
//         if (ts > 1e12) {
//             ts = ts / 1000;
//         }

//         const sec = Math.floor(ts);
//         const nsec = Math.floor((ts - sec) * 1e9);

//         return { sec, nsec };
//     }

//     private guessMessageType(topic: string): string {
//         if (topic.includes('image') || topic.includes('camera')) {
//             return 'sensor_msgs/CompressedImage';
//         }
//         if (topic.includes('points') || topic.includes('cloud') || topic.includes('radar')) {
//             return 'sensor_msgs/PointCloud2';
//         }
//         if (topic.includes('scan_index') || topic.includes('count')) {
//             return 'std_msgs/Int32';
//         }
//         if (topic.includes('time') || topic.includes('speed')) {
//             return 'std_msgs/Float64';
//         }
//         return 'std_msgs/String';
//     }

//     private updateProcessingStats(processingTime: number): void {
//         this.processingTimes.push(processingTime);

//         if (this.processingTimes.length > this.maxProcessingTimeSamples) {
//             this.processingTimes.shift();
//         }

//         this.stats.lastProcessingTime = processingTime;
//         this.stats.averageProcessingTime =
//             this.processingTimes.reduce((sum, t) => sum + t, 0) / this.processingTimes.length;
//     }

//     getStatistics(): ProcessingStatistics {
//         return { ...this.stats };
//     }

//     getPerformanceSummary(): any {
//         const successRate = this.stats.totalMessages > 0
//             ? (this.stats.validMessages / this.stats.totalMessages) * 100
//             : 0;

//         return {
//             totalMessages: this.stats.totalMessages,
//             validMessages: this.stats.validMessages,
//             successRate: Math.round(successRate * 100) / 100,
//             averageProcessingTime: Math.round(this.stats.averageProcessingTime * 1000) / 1000,
//             pendingFragments: this.fragments.size,
//             networkStats: this.networkStats,
//             messageBreakdown: {
//                 batch: this.stats.batchMessages,
//                 sensor: this.stats.sensorMessages,
//                 can: this.stats.canMessages,
//                 camera: this.stats.cameraMessages,
//                 radar: this.stats.radarMessages
//             },
//             errors: {
//                 parse: this.stats.parseErrors,
//                 conversion: this.stats.conversionErrors,
//                 invalid: this.stats.invalidMessages
//             }
//         };
//     }

//     resetStatistics(): void {
//         this.stats = {
//             totalMessages: 0,
//             validMessages: 0,
//             invalidMessages: 0,
//             batchMessages: 0,
//             sensorMessages: 0,
//             canMessages: 0,
//             cameraMessages: 0,
//             radarMessages: 0,
//             averageProcessingTime: 0,
//             lastProcessingTime: 0,
//             parseErrors: 0,
//             conversionErrors: 0
//         };
//         this.processingTimes = [];

//         // Reset network stats
//         this.networkStats = {
//             packetsReceived: 0,
//             totalBytesReceived: 0,
//             fragmentationEvents: 0,
//             packetLossCount: 0,
//             reassembledMessages: 0
//         };

//         // Clear any pending fragments
//         this.fragments.clear();
//         this.fragmentMetadata.clear();
//     }
// }
















// import { MessageEvent } from "@foxglove/studio-base/players/types";
// import { Time } from "@foxglove/rostime";

// interface WebRTCMessage {
//     type: string;
//     topic?: string;
//     data: any;
//     timestamp: number;
//     messageType?: string;
//     scan_index?: number;
// }

// interface BatchMessage {
//     type: 'batch';
//     messages: WebRTCMessage[];
//     count: number;
//     timestamp: number;
//     scan_index?: number;
// }

// interface SensorDataMessage {
//     type: 'sensor_update';
//     scan_index: number;
//     timestamp: number;
//     can_data?: Record<string, any>;
//     camera_data?: Record<string, string>;
//     radar_data?: Record<string, any>;
//     [key: string]: any;
// }

// interface ProcessingStatistics {
//     totalMessages: number;
//     validMessages: number;
//     invalidMessages: number;
//     batchMessages: number;
//     sensorMessages: number;
//     canMessages: number;
//     cameraMessages: number;
//     radarMessages: number;
//     averageProcessingTime: number;
//     lastProcessingTime: number;
//     parseErrors: number;
//     conversionErrors: number;
// }

// export class MessageProcessor {
//     // Statistics tracking
//     private stats: ProcessingStatistics = {
//         totalMessages: 0,
//         validMessages: 0,
//         invalidMessages: 0,
//         batchMessages: 0,
//         sensorMessages: 0,
//         canMessages: 0,
//         cameraMessages: 0,
//         radarMessages: 0,
//         averageProcessingTime: 0,
//         lastProcessingTime: 0,
//         parseErrors: 0,
//         conversionErrors: 0
//     };

//     // Performance tracking
//     private processingTimes: number[] = [];
//     private readonly maxProcessingTimeSamples = 100;

//     // Topic mapping for sensor data with index signatures
//     private readonly topicMappings = {
//         can: {
//             'scan_index': '/vehicle/can/scan_index',
//             'peak_count': '/vehicle/can/peak_count',
//             'cycle_time': '/vehicle/can/cycle_time',
//             'speed': '/vehicle/speed',
//             'rpm': '/vehicle/rpm'
//         } as Record<string, string>,
//         camera: {
//             'camera_1': '/camera/cam_1/image_raw/compressed',
//             'camera_2': '/camera/cam_2/image_raw/compressed',
//             'camera_3': '/camera/cam_3/image_raw/compressed',
//             'camera_4': '/camera/cam_4/image_raw/compressed',
//             'camera_5': '/camera/cam_5/image_raw/compressed',
//             'camera_6': '/camera/cam_6/image_raw/compressed'
//         } as Record<string, string>,
//         radar: {
//             'FL': '/radar_points_3d/fl',
//             'FR': '/radar_points_3d/fr',
//             'RL': '/radar_points_3d/rl',
//             'RR': '/radar_points_3d/rr'
//         } as Record<string, string>
//     };

//     processMessage(data: string | ArrayBuffer | ArrayBufferView): MessageEvent<unknown>[] {
//         const startTime = performance.now();
//         this.stats.totalMessages++;

//         try {
//             // Parse the raw data
//             const parsedData = this.parseRawData(data);
//             if (!parsedData) {
//                 this.stats.invalidMessages++;
//                 return [];
//             }

//             let messages: MessageEvent<unknown>[] = [];

//             // Determine message type and process accordingly
//             if (this.isBatchMessage(parsedData)) {
//                 messages = this.processBatchMessage(parsedData as BatchMessage);
//                 this.stats.batchMessages++;
//             } else if (this.isSensorDataMessage(parsedData)) {
//                 messages = this.processSensorDataMessage(parsedData as SensorDataMessage);
//                 this.stats.sensorMessages++;
//             } else if (this.isStandardMessage(parsedData)) {
//                 const msg = this.processStandardMessage(parsedData as WebRTCMessage);
//                 if (msg) messages = [msg];
//             } else {
//                 console.warn("[MessageProcessor] Unknown message format:", parsedData);
//                 this.stats.invalidMessages++;
//             }

//             // Update statistics
//             if (messages.length > 0) {
//                 this.stats.validMessages++;
//             }

//             const processingTime = performance.now() - startTime;
//             this.updateProcessingStats(processingTime);

//             return messages;

//         } catch (error) {
//             console.error("[MessageProcessor] Processing error:", error);
//             this.stats.conversionErrors++;
//             return [];
//         }
//     }

//     private parseRawData(data: any): any {
//         try {
//             // Handle string data (JSON)
//             if (typeof data === 'string') {
//                 return JSON.parse(data);
//             }

//             // Handle ArrayBuffer
//             if (data instanceof ArrayBuffer) {
//                 const decoder = new TextDecoder();
//                 const jsonString = decoder.decode(data);
//                 return JSON.parse(jsonString);
//             }

//             // Handle typed arrays
//             if (ArrayBuffer.isView(data)) {
//                 const decoder = new TextDecoder();
//                 const jsonString = decoder.decode(data);
//                 return JSON.parse(jsonString);
//             }

//             // Direct object (shouldn't happen but handle it)
//             if (typeof data === 'object' && data !== null) {
//                 return data;
//             }

//             console.warn("[MessageProcessor] Unsupported data type:", typeof data);
//             return null;

//         } catch (error) {
//             console.error("[MessageProcessor] Parse error:", error);
//             this.stats.parseErrors++;
//             return null;
//         }
//     }

//     private isBatchMessage(data: any): boolean {
//         return data &&
//                data.type === 'batch' &&
//                Array.isArray(data.messages) &&
//                data.messages.length > 0;
//     }

//     private isSensorDataMessage(data: any): boolean {
//         return data &&
//                data.type === 'sensor_update' &&
//                typeof data.scan_index === 'number' &&
//                typeof data.timestamp === 'number';
//     }

//     private isStandardMessage(data: any): boolean {
//         return data &&
//                typeof data.topic === 'string' &&
//                data.data !== undefined;
//     }

//     private processBatchMessage(batch: BatchMessage): MessageEvent<unknown>[] {
//         const messages: MessageEvent<unknown>[] = [];

//         for (const msg of batch.messages) {
//             const processed = this.processStandardMessage(msg);
//             if (processed) {
//                 messages.push(processed);
//             }
//         }

//         console.debug(`[MessageProcessor] Processed batch with ${messages.length}/${batch.count} messages`);
//         return messages;
//     }

//     private processSensorDataMessage(sensorData: SensorDataMessage): MessageEvent<unknown>[] {
//         const messages: MessageEvent<unknown>[] = [];
//         const baseTimestamp = this.normalizeTimestamp(sensorData.timestamp);

//         // Process CAN data
//         if (sensorData.can_data) {
//             const canMessages = this.processCanData(
//                 sensorData.can_data,
//                 baseTimestamp,
//                 sensorData.scan_index
//             );
//             messages.push(...canMessages);
//             this.stats.canMessages += canMessages.length;
//         }

//         // Process camera data
//         if (sensorData.camera_data) {
//             const cameraMessages = this.processCameraData(
//                 sensorData.camera_data,
//                 baseTimestamp,
//                 sensorData.scan_index
//             );
//             messages.push(...cameraMessages);
//             this.stats.cameraMessages += cameraMessages.length;
//         }

//         // Process radar data (from raw CAN signals)
//         const radarMessages = this.extractRadarData(
//             sensorData,
//             baseTimestamp,
//             sensorData.scan_index
//         );
//         messages.push(...radarMessages);
//         this.stats.radarMessages += radarMessages.length;

//         return messages;
//     }

//     private processCanData(canData: Record<string, any>, timestamp: Time, scanIndex: number): MessageEvent<unknown>[] {
//         const messages: MessageEvent<unknown>[] = [];

//         // Always include scan index
//         messages.push(this.createMessage(
//             '/vehicle/can/scan_index',
//             'std_msgs/Int32',
//             { data: scanIndex },
//             timestamp
//         ));

//         // Process known CAN signals
//         for (const [signal, value] of Object.entries(canData)) {
//             const topic = this.topicMappings.can[signal];
//             if (!topic) continue;

//             let messageType: string;
//             let messageData: any;

//             // Determine message type based on value
//             if (typeof value === 'number') {
//                 if (Number.isInteger(value)) {
//                     messageType = 'std_msgs/Int32';
//                     messageData = { data: value };
//                 } else {
//                     messageType = 'std_msgs/Float64';
//                     messageData = { data: value };
//                 }
//             } else if (typeof value === 'string') {
//                 messageType = 'std_msgs/String';
//                 messageData = { data: value };
//             } else if (typeof value === 'boolean') {
//                 messageType = 'std_msgs/Bool';
//                 messageData = { data: value };
//             } else {
//                 continue;
//             }

//             messages.push(this.createMessage(topic, messageType, messageData, timestamp));
//         }

//         return messages;
//     }

//     private processCameraData(cameraData: Record<string, string>, timestamp: Time, scanIndex: number): MessageEvent<unknown>[] {
//         const messages: MessageEvent<unknown>[] = [];

//         for (const [cameraKey, imageData] of Object.entries(cameraData)) {
//             const topic = this.topicMappings.camera[cameraKey];
//             if (!topic || !imageData) continue;

//             // Create CompressedImage message
//             const cameraMessage = {
//                 header: {
//                     stamp: timestamp,
//                     frame_id: cameraKey,
//                     seq: scanIndex
//                 },
//                 format: 'jpeg',
//                 data: imageData // Base64 encoded JPEG
//             };

//             messages.push(this.createMessage(
//                 topic,
//                 'sensor_msgs/CompressedImage',
//                 cameraMessage,
//                 timestamp
//             ));
//         }

//         return messages;
//     }

//     private extractRadarData(sensorData: any, timestamp: Time, scanIndex: number): MessageEvent<unknown>[] {
//         const messages: MessageEvent<unknown>[] = [];
//         const radarCorners = ['FL', 'FR', 'RL', 'RR'];

//         for (const corner of radarCorners) {
//             const points = this.extractRadarPoints(sensorData, corner);

//             if (points.length > 0) {
//                 const pointCloud = this.createPointCloud2Message(
//                     points,
//                     corner.toLowerCase(),
//                     timestamp,
//                     scanIndex
//                 );

//                 const topic = this.topicMappings.radar[corner];
//                 if (topic) {
//                     messages.push(this.createMessage(
//                         topic,
//                         'sensor_msgs/PointCloud2',
//                         pointCloud,
//                         timestamp
//                     ));
//                 }
//             }
//         }

//         return messages;
//     }

//     /**
//      *
//      DOTO
//      - Apply Unity 3D mapping logic on below method
//      */
//     private extractRadarPoints(sensorData: any, corner: string): Array<{x: number, y: number, z: number, intensity: number}> {
//         const points = [];
//         const maxPoints = 200; // Maximum radar detections per corner

//         for (let i = 0; i < maxPoints; i++) {
//             const rangeKey = `${corner}__Range_${i}`;
//             const velocityKey = `${corner}__Velocity_${i}`;
//             const aziKey = `${corner}__AziAng_${i}`;
//             const eleKey = `${corner}__EleAng_${i}`;
//             const powerKey = `${corner}__Power_${i}`;

//             // Check if this detection exists
//             if (!(rangeKey in sensorData)) break;

//             const range = parseFloat(sensorData[rangeKey] || 0);
//             const velocity = parseFloat(sensorData[velocityKey] || 0);
//             const azimuth = parseFloat(sensorData[aziKey] || 0);
//             const elevation = parseFloat(sensorData[eleKey] || 0);
//             const power = parseFloat(sensorData[powerKey] || 0);

//             // Filter out invalid detections
//             if (range <= 0.1 || range > 250) continue;

//             // Convert spherical to Cartesian coordinates
//             const azimuthRad = azimuth * Math.PI / 180;
//             const elevationRad = elevation * Math.PI / 180;

//             const x = range * Math.cos(elevationRad) * Math.cos(azimuthRad);
//             const y = range * Math.cos(elevationRad) * Math.sin(azimuthRad);
//             const z = range * Math.sin(elevationRad);

//             points.push({
//                 x: x,
//                 y: y,
//                 z: z,
//                 intensity: power
//             });
//         }

//         return points;
//     }

//     private createPointCloud2Message(
//         points: Array<{x: number, y: number, z: number, intensity: number}>,
//         corner: string,
//         timestamp: Time,
//         scanIndex: number
//     ): any {
//         // Create binary data buffer for points
//         const pointStep = 16; // 4 floats * 4 bytes
//         const rowStep = pointStep * points.length;
//         const dataArray = new Float32Array(points.length * 4);

//         for (let i = 0; i < points.length; i++) {
//             const point = points[i];
//             if (!point) continue;
//             const offset = i * 4;
//             dataArray[offset] = point.x;
//             dataArray[offset + 1] = point.y;
//             dataArray[offset + 2] = point.z;
//             dataArray[offset + 3] = point.intensity;
//         }

//         return {
//             header: {
//                 stamp: timestamp,
//                 frame_id: `radar_${corner}`,
//                 seq: scanIndex
//             },
//             height: 1,
//             width: points.length,
//             fields: [
//                 { name: 'x', offset: 0, datatype: 7, count: 1 },
//                 { name: 'y', offset: 4, datatype: 7, count: 1 },
//                 { name: 'z', offset: 8, datatype: 7, count: 1 },
//                 { name: 'intensity', offset: 12, datatype: 7, count: 1 }
//             ],
//             is_bigendian: false,
//             point_step: pointStep,
//             row_step: rowStep,
//             data: Array.from(new Uint8Array(dataArray.buffer)),
//             is_dense: true
//         };
//     }

//     private processStandardMessage(msg: WebRTCMessage): MessageEvent<unknown> | null {
//         try {
//             const topic = msg.topic || '/unknown';
//             const messageType = msg.messageType || this.guessMessageType(topic);
//             const timestamp = this.normalizeTimestamp(msg.timestamp);

//             return this.createMessage(topic, messageType, msg.data, timestamp);

//         } catch (error) {
//             console.error("[MessageProcessor] Error processing standard message:", error);
//             this.stats.conversionErrors++;
//             return null;
//         }
//     }

//     private createMessage(
//         topic: string,
//         messageType: string,
//         data: any,
//         timestamp: Time
//     ): MessageEvent<unknown> {
//         // Calculate message size
//         let sizeInBytes = 0;
//         try {
//             const jsonString = JSON.stringify(data);
//             sizeInBytes = new TextEncoder().encode(jsonString).length;
//         } catch {
//             sizeInBytes = 0;
//         }

//         return {
//             topic,
//             receiveTime: timestamp,
//             message: data,
//             schemaName: messageType,
//             sizeInBytes
//         };
//     }

//     private normalizeTimestamp(timestamp: number | undefined): Time {
//         let ts = timestamp || Date.now() / 1000;

//         // Convert milliseconds to seconds if needed
//         if (ts > 1e12) {
//             ts = ts / 1000;
//         }

//         const sec = Math.floor(ts);
//         const nsec = Math.floor((ts - sec) * 1e9);

//         return { sec, nsec };
//     }

//     private guessMessageType(topic: string): string {
//         if (topic.includes('image') || topic.includes('camera')) {
//             return 'sensor_msgs/CompressedImage';
//         }
//         if (topic.includes('points') || topic.includes('cloud') || topic.includes('radar')) {
//             return 'sensor_msgs/PointCloud2';
//         }
//         if (topic.includes('scan_index') || topic.includes('count')) {
//             return 'std_msgs/Int32';
//         }
//         if (topic.includes('time') || topic.includes('speed')) {
//             return 'std_msgs/Float64';
//         }
//         return 'std_msgs/String';
//     }

//     private updateProcessingStats(processingTime: number): void {
//         this.processingTimes.push(processingTime);

//         if (this.processingTimes.length > this.maxProcessingTimeSamples) {
//             this.processingTimes.shift();
//         }

//         this.stats.lastProcessingTime = processingTime;
//         this.stats.averageProcessingTime =
//             this.processingTimes.reduce((sum, t) => sum + t, 0) / this.processingTimes.length;
//     }

//     getStatistics(): ProcessingStatistics {
//         return { ...this.stats };
//     }

//     getPerformanceSummary(): any {
//         const successRate = this.stats.totalMessages > 0
//             ? (this.stats.validMessages / this.stats.totalMessages) * 100
//             : 0;

//         return {
//             totalMessages: this.stats.totalMessages,
//             validMessages: this.stats.validMessages,
//             successRate: Math.round(successRate * 100) / 100,
//             averageProcessingTime: Math.round(this.stats.averageProcessingTime * 1000) / 1000,
//             messageBreakdown: {
//                 batch: this.stats.batchMessages,
//                 sensor: this.stats.sensorMessages,
//                 can: this.stats.canMessages,
//                 camera: this.stats.cameraMessages,
//                 radar: this.stats.radarMessages
//             },
//             errors: {
//                 parse: this.stats.parseErrors,
//                 conversion: this.stats.conversionErrors,
//                 invalid: this.stats.invalidMessages
//             }
//         };
//     }

//     resetStatistics(): void {
//         this.stats = {
//             totalMessages: 0,
//             validMessages: 0,
//             invalidMessages: 0,
//             batchMessages: 0,
//             sensorMessages: 0,
//             canMessages: 0,
//             cameraMessages: 0,
//             radarMessages: 0,
//             averageProcessingTime: 0,
//             lastProcessingTime: 0,
//             parseErrors: 0,
//             conversionErrors: 0
//         };
//         this.processingTimes = [];
//     }
// }
