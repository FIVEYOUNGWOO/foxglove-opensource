/**
 * Enhanced WebRTC Message Processor for Sensor Data
 * Purpose: Process and transform WebRTC messages for Foxglove visualization
 * Focus: CAN signals, camera images, and radar point clouds
 *
 * Input: Raw WebRTC DataChannel messages (JSON/Binary)
 * Output: Foxglove MessageEvent format
 */

import { MessageEvent } from "@foxglove/studio-base/players/types";
import { Time } from "@foxglove/rostime";

interface WebRTCMessage {
    type: string;
    topic?: string;
    data: any;
    timestamp: number;
    messageType?: string;
    scan_index?: number;
}

interface BatchMessage {
    type: 'batch';
    messages: WebRTCMessage[];
    count: number;
    timestamp: number;
    scan_index?: number;
}

interface SensorDataMessage {
    type: 'sensor_update';
    scan_index: number;
    timestamp: number;
    can_data?: Record<string, any>;
    camera_data?: Record<string, string>;
    radar_data?: Record<string, any>;
    [key: string]: any;
}

interface ProcessingStatistics {
    totalMessages: number;
    validMessages: number;
    invalidMessages: number;
    batchMessages: number;
    sensorMessages: number;
    canMessages: number;
    cameraMessages: number;
    radarMessages: number;
    averageProcessingTime: number;
    lastProcessingTime: number;
    parseErrors: number;
    conversionErrors: number;
}

export class MessageProcessor {
    // Statistics tracking
    private stats: ProcessingStatistics = {
        totalMessages: 0,
        validMessages: 0,
        invalidMessages: 0,
        batchMessages: 0,
        sensorMessages: 0,
        canMessages: 0,
        cameraMessages: 0,
        radarMessages: 0,
        averageProcessingTime: 0,
        lastProcessingTime: 0,
        parseErrors: 0,
        conversionErrors: 0
    };

    // Performance tracking
    private processingTimes: number[] = [];
    private readonly maxProcessingTimeSamples = 100;

    // Topic mapping for sensor data with index signatures
    private readonly topicMappings = {
        can: {
            'scan_index': '/vehicle/can/scan_index',
            'peak_count': '/vehicle/can/peak_count',
            'cycle_time': '/vehicle/can/cycle_time',
            'speed': '/vehicle/speed',
            'rpm': '/vehicle/rpm'
        } as Record<string, string>,
        camera: {
            'camera_1': '/camera/cam_1/image_raw/compressed',
            'camera_2': '/camera/cam_2/image_raw/compressed',
            'camera_3': '/camera/cam_3/image_raw/compressed',
            'camera_4': '/camera/cam_4/image_raw/compressed',
            'camera_5': '/camera/cam_5/image_raw/compressed',
            'camera_6': '/camera/cam_6/image_raw/compressed'
        } as Record<string, string>,
        radar: {
            'FL': '/radar_points_3d/fl',
            'FR': '/radar_points_3d/fr',
            'RL': '/radar_points_3d/rl',
            'RR': '/radar_points_3d/rr'
        } as Record<string, string>
    };

    /**
     * Process incoming WebRTC message
     * Input: Raw data from DataChannel (string, ArrayBuffer, or typed array)
     * Output: Array of Foxglove MessageEvents
     * Purpose: Convert various message formats to Foxglove format
     */
    processMessage(data: string | ArrayBuffer | ArrayBufferView): MessageEvent<unknown>[] {
        const startTime = performance.now();
        this.stats.totalMessages++;

        try {
            // Parse the raw data
            const parsedData = this.parseRawData(data);
            if (!parsedData) {
                this.stats.invalidMessages++;
                return [];
            }

            let messages: MessageEvent<unknown>[] = [];

            // Determine message type and process accordingly
            if (this.isBatchMessage(parsedData)) {
                messages = this.processBatchMessage(parsedData as BatchMessage);
                this.stats.batchMessages++;
            } else if (this.isSensorDataMessage(parsedData)) {
                messages = this.processSensorDataMessage(parsedData as SensorDataMessage);
                this.stats.sensorMessages++;
            } else if (this.isStandardMessage(parsedData)) {
                const msg = this.processStandardMessage(parsedData as WebRTCMessage);
                if (msg) messages = [msg];
            } else {
                console.warn("[MessageProcessor] Unknown message format:", parsedData);
                this.stats.invalidMessages++;
            }

            // Update statistics
            if (messages.length > 0) {
                this.stats.validMessages++;
            }

            const processingTime = performance.now() - startTime;
            this.updateProcessingStats(processingTime);

            return messages;

        } catch (error) {
            console.error("[MessageProcessor] Processing error:", error);
            this.stats.conversionErrors++;
            return [];
        }
    }

    /**
     * Parse raw data from DataChannel
     * Input: Various data formats from WebRTC
     * Output: Parsed JavaScript object or null
     * Purpose: Handle different data encodings
     */
    private parseRawData(data: any): any {
        try {
            // Handle string data (JSON)
            if (typeof data === 'string') {
                return JSON.parse(data);
            }

            // Handle ArrayBuffer
            if (data instanceof ArrayBuffer) {
                const decoder = new TextDecoder();
                const jsonString = decoder.decode(data);
                return JSON.parse(jsonString);
            }

            // Handle typed arrays
            if (ArrayBuffer.isView(data)) {
                const decoder = new TextDecoder();
                const jsonString = decoder.decode(data);
                return JSON.parse(jsonString);
            }

            // Direct object (shouldn't happen but handle it)
            if (typeof data === 'object' && data !== null) {
                return data;
            }

            console.warn("[MessageProcessor] Unsupported data type:", typeof data);
            return null;

        } catch (error) {
            console.error("[MessageProcessor] Parse error:", error);
            this.stats.parseErrors++;
            return null;
        }
    }

    /**
     * Check if message is a batch message
     * Input: Parsed message object
     * Output: Boolean indicating batch message
     * Purpose: Identify multi-message batches
     */
    private isBatchMessage(data: any): boolean {
        return data &&
               data.type === 'batch' &&
               Array.isArray(data.messages) &&
               data.messages.length > 0;
    }

    /**
     * Check if message is sensor data message
     * Input: Parsed message object
     * Output: Boolean indicating sensor message
     * Purpose: Identify comprehensive sensor updates
     */
    private isSensorDataMessage(data: any): boolean {
        return data &&
               data.type === 'sensor_update' &&
               typeof data.scan_index === 'number' &&
               typeof data.timestamp === 'number';
    }

    /**
     * Check if message is standard WebRTC message
     * Input: Parsed message object
     * Output: Boolean indicating standard message
     * Purpose: Identify pre-formatted messages
     */
    private isStandardMessage(data: any): boolean {
        return data &&
               typeof data.topic === 'string' &&
               data.data !== undefined;
    }

    /**
     * Process batch message containing multiple messages
     * Input: Batch message with message array
     * Output: Array of Foxglove MessageEvents
     * Purpose: Handle multiple messages in single transmission
     */
    private processBatchMessage(batch: BatchMessage): MessageEvent<unknown>[] {
        const messages: MessageEvent<unknown>[] = [];

        for (const msg of batch.messages) {
            const processed = this.processStandardMessage(msg);
            if (processed) {
                messages.push(processed);
            }
        }

        console.debug(`[MessageProcessor] Processed batch with ${messages.length}/${batch.count} messages`);
        return messages;
    }

    /**
     * Process sensor data message with CAN, camera, and radar data
     * Input: Comprehensive sensor data message
     * Output: Array of topic-separated Foxglove messages
     * Purpose: Split combined sensor data into topic-specific messages
     */
    private processSensorDataMessage(sensorData: SensorDataMessage): MessageEvent<unknown>[] {
        const messages: MessageEvent<unknown>[] = [];
        const baseTimestamp = this.normalizeTimestamp(sensorData.timestamp);

        // Process CAN data
        if (sensorData.can_data) {
            const canMessages = this.processCanData(
                sensorData.can_data,
                baseTimestamp,
                sensorData.scan_index
            );
            messages.push(...canMessages);
            this.stats.canMessages += canMessages.length;
        }

        // Process camera data
        if (sensorData.camera_data) {
            const cameraMessages = this.processCameraData(
                sensorData.camera_data,
                baseTimestamp,
                sensorData.scan_index
            );
            messages.push(...cameraMessages);
            this.stats.cameraMessages += cameraMessages.length;
        }

        // Process radar data (from raw CAN signals)
        const radarMessages = this.extractRadarData(
            sensorData,
            baseTimestamp,
            sensorData.scan_index
        );
        messages.push(...radarMessages);
        this.stats.radarMessages += radarMessages.length;

        return messages;
    }

    /**
     * Process CAN signal data
     * Input: CAN data object with signal values
     * Output: Array of CAN signal messages
     * Purpose: Convert CAN signals to ROS standard messages
     */
    private processCanData(canData: Record<string, any>, timestamp: Time, scanIndex: number): MessageEvent<unknown>[] {
        const messages: MessageEvent<unknown>[] = [];

        // Always include scan index
        messages.push(this.createMessage(
            '/vehicle/can/scan_index',
            'std_msgs/Int32',
            { data: scanIndex },
            timestamp
        ));

        // Process known CAN signals
        for (const [signal, value] of Object.entries(canData)) {
            const topic = this.topicMappings.can[signal];
            if (!topic) continue;

            let messageType: string;
            let messageData: any;

            // Determine message type based on value
            if (typeof value === 'number') {
                if (Number.isInteger(value)) {
                    messageType = 'std_msgs/Int32';
                    messageData = { data: value };
                } else {
                    messageType = 'std_msgs/Float64';
                    messageData = { data: value };
                }
            } else if (typeof value === 'string') {
                messageType = 'std_msgs/String';
                messageData = { data: value };
            } else if (typeof value === 'boolean') {
                messageType = 'std_msgs/Bool';
                messageData = { data: value };
            } else {
                continue;
            }

            messages.push(this.createMessage(topic, messageType, messageData, timestamp));
        }

        return messages;
    }

    /**
     * Process camera image data
     * Input: Camera data object with base64 images
     * Output: Array of CompressedImage messages
     * Purpose: Convert base64 JPEG to ROS CompressedImage
     */
    private processCameraData(cameraData: Record<string, string>, timestamp: Time, scanIndex: number): MessageEvent<unknown>[] {
        const messages: MessageEvent<unknown>[] = [];

        for (const [cameraKey, imageData] of Object.entries(cameraData)) {
            const topic = this.topicMappings.camera[cameraKey];
            if (!topic || !imageData) continue;

            // Create CompressedImage message
            const cameraMessage = {
                header: {
                    stamp: timestamp,
                    frame_id: cameraKey,
                    seq: scanIndex
                },
                format: 'jpeg',
                data: imageData // Base64 encoded JPEG
            };

            messages.push(this.createMessage(
                topic,
                'sensor_msgs/CompressedImage',
                cameraMessage,
                timestamp
            ));
        }

        return messages;
    }

    /**
     * Extract and process radar data from CAN signals
     * Input: Full sensor data containing radar signals
     * Output: Array of PointCloud2 messages
     * Purpose: Convert radar detections to point cloud format
     */
    private extractRadarData(sensorData: any, timestamp: Time, scanIndex: number): MessageEvent<unknown>[] {
        const messages: MessageEvent<unknown>[] = [];
        const radarCorners = ['FL', 'FR', 'RL', 'RR'];

        for (const corner of radarCorners) {
            const points = this.extractRadarPoints(sensorData, corner);

            if (points.length > 0) {
                const pointCloud = this.createPointCloud2Message(
                    points,
                    corner.toLowerCase(),
                    timestamp,
                    scanIndex
                );

                const topic = this.topicMappings.radar[corner];
                if (topic) {
                    messages.push(this.createMessage(
                        topic,
                        'sensor_msgs/PointCloud2',
                        pointCloud,
                        timestamp
                    ));
                }
            }
        }

        return messages;
    }

    /**
     * Extract radar points for specific corner
     * Input: Sensor data and corner identifier
     * Output: Array of 3D points with intensity
     * Purpose: Parse radar detections from CAN signals
     */
    private extractRadarPoints(sensorData: any, corner: string): Array<{x: number, y: number, z: number, intensity: number}> {
        const points = [];
        const maxPoints = 200; // Maximum radar detections per corner

        for (let i = 0; i < maxPoints; i++) {
            const rangeKey = `${corner}__Range_${i}`;
            // const velocityKey = `${corner}__Velocity_${i}`;  // Reserved for future use
            const aziKey = `${corner}__AziAng_${i}`;
            const eleKey = `${corner}__EleAng_${i}`;
            const powerKey = `${corner}__Power_${i}`;

            // Check if this detection exists
            if (!(rangeKey in sensorData)) break;

            const range = parseFloat(sensorData[rangeKey] || 0);
            // const velocity = parseFloat(sensorData[velocityKey] || 0); // Reserved for future use
            const azimuth = parseFloat(sensorData[aziKey] || 0);
            const elevation = parseFloat(sensorData[eleKey] || 0);
            const power = parseFloat(sensorData[powerKey] || 0);

            // Filter out invalid detections
            if (range <= 0.1 || range > 250) continue;

            // Convert spherical to Cartesian coordinates
            const azimuthRad = azimuth * Math.PI / 180;
            const elevationRad = elevation * Math.PI / 180;

            const x = range * Math.cos(elevationRad) * Math.cos(azimuthRad);
            const y = range * Math.cos(elevationRad) * Math.sin(azimuthRad);
            const z = range * Math.sin(elevationRad);

            points.push({
                x: x,
                y: y,
                z: z,
                intensity: power
            });
        }

        return points;
    }

    /**
     * Create PointCloud2 message from radar points
     * Input: Array of 3D points, corner ID, timestamp
     * Output: PointCloud2 message object
     * Purpose: Format radar data for 3D visualization
     */
    private createPointCloud2Message(
        points: Array<{x: number, y: number, z: number, intensity: number}>,
        corner: string,
        timestamp: Time,
        scanIndex: number
    ): any {
        // Create binary data buffer for points
        const pointStep = 16; // 4 floats * 4 bytes
        const rowStep = pointStep * points.length;
        const dataArray = new Float32Array(points.length * 4);

        for (let i = 0; i < points.length; i++) {
            const point = points[i];
            if (!point) continue;
            const offset = i * 4;
            dataArray[offset] = point.x;
            dataArray[offset + 1] = point.y;
            dataArray[offset + 2] = point.z;
            dataArray[offset + 3] = point.intensity;
        }

        return {
            header: {
                stamp: timestamp,
                frame_id: `radar_${corner}`,
                seq: scanIndex
            },
            height: 1,
            width: points.length,
            fields: [
                { name: 'x', offset: 0, datatype: 7, count: 1 },
                { name: 'y', offset: 4, datatype: 7, count: 1 },
                { name: 'z', offset: 8, datatype: 7, count: 1 },
                { name: 'intensity', offset: 12, datatype: 7, count: 1 }
            ],
            is_bigendian: false,
            point_step: pointStep,
            row_step: rowStep,
            data: Array.from(new Uint8Array(dataArray.buffer)),
            is_dense: true
        };
    }

    /**
     * Process standard WebRTC message
     * Input: Pre-formatted WebRTC message
     * Output: Single Foxglove MessageEvent
     * Purpose: Handle already formatted messages
     */
    private processStandardMessage(msg: WebRTCMessage): MessageEvent<unknown> | null {
        try {
            const topic = msg.topic || '/unknown';
            const messageType = msg.messageType || this.guessMessageType(topic);
            const timestamp = this.normalizeTimestamp(msg.timestamp);

            return this.createMessage(topic, messageType, msg.data, timestamp);

        } catch (error) {
            console.error("[MessageProcessor] Error processing standard message:", error);
            this.stats.conversionErrors++;
            return null;
        }
    }

    /**
     * Create Foxglove MessageEvent
     * Input: Topic, type, data, and timestamp
     * Output: Properly formatted MessageEvent
     * Purpose: Standardize message creation
     */
    private createMessage(
        topic: string,
        messageType: string,
        data: any,
        timestamp: Time
    ): MessageEvent<unknown> {
        // Calculate message size
        let sizeInBytes = 0;
        try {
            const jsonString = JSON.stringify(data);
            sizeInBytes = new TextEncoder().encode(jsonString).length;
        } catch {
            sizeInBytes = 0;
        }

        return {
            topic,
            receiveTime: timestamp,
            message: data,
            schemaName: messageType,
            sizeInBytes
        };
    }

    /**
     * Normalize timestamp to ROS Time format
     * Input: Timestamp in various formats
     * Output: ROS Time object with sec and nsec
     * Purpose: Handle different timestamp formats
     */
    private normalizeTimestamp(timestamp: number | undefined): Time {
        let ts = timestamp || Date.now() / 1000;

        // Convert milliseconds to seconds if needed
        if (ts > 1e12) {
            ts = ts / 1000;
        }

        const sec = Math.floor(ts);
        const nsec = Math.floor((ts - sec) * 1e9);

        return { sec, nsec };
    }

    /**
     * Guess message type from topic name
     * Input: Topic name string
     * Output: ROS message type string
     * Purpose: Auto-detect message types
     */
    private guessMessageType(topic: string): string {
        if (topic.includes('image') || topic.includes('camera')) {
            return 'sensor_msgs/CompressedImage';
        }
        if (topic.includes('points') || topic.includes('cloud') || topic.includes('radar')) {
            return 'sensor_msgs/PointCloud2';
        }
        if (topic.includes('scan_index') || topic.includes('count')) {
            return 'std_msgs/Int32';
        }
        if (topic.includes('time') || topic.includes('speed')) {
            return 'std_msgs/Float64';
        }
        return 'std_msgs/String';
    }

    /**
     * Update processing statistics
     * Input: Processing time for current message
     * Output: Updated statistics
     * Purpose: Track performance metrics
     */
    private updateProcessingStats(processingTime: number): void {
        this.processingTimes.push(processingTime);

        if (this.processingTimes.length > this.maxProcessingTimeSamples) {
            this.processingTimes.shift();
        }

        this.stats.lastProcessingTime = processingTime;
        this.stats.averageProcessingTime =
            this.processingTimes.reduce((sum, t) => sum + t, 0) / this.processingTimes.length;
    }

    /**
     * Get processing statistics
     * Input: None
     * Output: Current statistics object
     * Purpose: Monitor processor performance
     */
    getStatistics(): ProcessingStatistics {
        return { ...this.stats };
    }

    /**
     * Get performance summary
     * Input: None
     * Output: Performance metrics summary
     * Purpose: Provide performance overview
     */
    getPerformanceSummary(): any {
        const successRate = this.stats.totalMessages > 0
            ? (this.stats.validMessages / this.stats.totalMessages) * 100
            : 0;

        return {
            totalMessages: this.stats.totalMessages,
            validMessages: this.stats.validMessages,
            successRate: Math.round(successRate * 100) / 100,
            averageProcessingTime: Math.round(this.stats.averageProcessingTime * 1000) / 1000,
            messageBreakdown: {
                batch: this.stats.batchMessages,
                sensor: this.stats.sensorMessages,
                can: this.stats.canMessages,
                camera: this.stats.cameraMessages,
                radar: this.stats.radarMessages
            },
            errors: {
                parse: this.stats.parseErrors,
                conversion: this.stats.conversionErrors,
                invalid: this.stats.invalidMessages
            }
        };
    }

    /**
     * Reset all statistics
     * Input: None
     * Output: Cleared statistics
     * Purpose: Reset counters for fresh start
     */
    resetStatistics(): void {
        this.stats = {
            totalMessages: 0,
            validMessages: 0,
            invalidMessages: 0,
            batchMessages: 0,
            sensorMessages: 0,
            canMessages: 0,
            cameraMessages: 0,
            radarMessages: 0,
            averageProcessingTime: 0,
            lastProcessingTime: 0,
            parseErrors: 0,
            conversionErrors: 0
        };
        this.processingTimes = [];
    }
}
