// 파일명: MessageProcessor.ts

import { MessageEvent } from "@foxglove/studio-base/players/types";
import { Time } from "@foxglove/rostime";

interface SensorDataMessage
{
    type: 'sensor_update';
    scan_index: number;
    timestamp: number;
    can_data?: Record<string, any>;
    camera_data?: Record<string, string>;
    [key: string]: any;
}

export class MessageProcessor
{
    private readonly topicMappings =
    {
        camera:
        {
            'camera_1': '/cam_1',
            'camera_2': '/cam_2',
            'camera_3': '/cam_3',
            'camera_4': '/cam_4',
            'camera_5': '/cam_5',
            'camera_6': '/cam_6',
        } as Record<string, string>,

        radar:
        {
            'FL': '/radar_points_3d/fl',
            'FR': '/radar_points_3d/fr',
            'RL': '/radar_points_3d/rl',
            'RR': '/radar_points_3d/rr',
        } as Record<string, string>
    };

    public processMessage(data: string | ArrayBuffer | ArrayBufferView): MessageEvent<unknown>[]
    {
        try
        {
            const textData = (typeof data === 'string') ? data : new TextDecoder().decode(data);
            const parsedData = JSON.parse(textData) as SensorDataMessage;

            if (parsedData && parsedData.type === 'sensor_update')
            {
                return this.processSensorDataMessage(parsedData);
            }
            return [];
        }
        catch (error)
        {
            console.error("[MessageProcessor] Failed to parse message:", error);
            return [];
        }
    }

    private processSensorDataMessage(sensorData: SensorDataMessage): MessageEvent<unknown>[]
    {
        const messages: MessageEvent<unknown>[] = [];
        const baseTimestamp = this.normalizeTimestamp(sensorData.timestamp);
        const scanIndex = sensorData.scan_index;

        messages.push(this.createMessage('/can/scan_index', 'std_msgs/Int32', { data: scanIndex }, baseTimestamp));

        if (sensorData.can_data)
        {
            messages.push(...this.processCanData(sensorData.can_data, baseTimestamp));
        }
        if (sensorData.camera_data)
        {
            messages.push(...this.processCameraData(sensorData.camera_data, baseTimestamp, scanIndex));
        }
        if (sensorData.can_data)
        {
            messages.push(...this.extractRadarData(sensorData.can_data, baseTimestamp, scanIndex));
        }

        return messages;
    }

    private processCanData(canData: Record<string, any>, timestamp: Time): MessageEvent<unknown>[]
    {
        const messages: MessageEvent<unknown>[] = [];
        for (const [signalName, value] of Object.entries(canData))
        {
            const topic = `/can/${signalName}`;
            let schemaName = 'std_msgs/Float64';

            if (Number.isInteger(value))
            {
                schemaName = 'std_msgs/Int32';
            }
            else if (typeof value === 'string')
            {
                schemaName = 'std_msgs/String';
            }
            messages.push(this.createMessage(topic, schemaName, { data: value }, timestamp));
        }
        return messages;
    }

    // private processCameraData(cameraData: Record<string, string>, timestamp: Time, scanIndex: number): MessageEvent<unknown>[] {
    //     const messages: MessageEvent<unknown>[] = [];
    //     for (const [cameraKey, imageData] of Object.entries(cameraData))
    //     {
    //         if (!imageData) continue;
    //         const topic = this.topicMappings.camera[cameraKey];

    //         if (!topic) continue;
    //         const cameraMessage =
    //         {
    //             header: { stamp: timestamp, frame_id: cameraKey, seq: scanIndex },
    //             format: 'jpeg',
    //             data: imageData,
    //         };
    //         messages.push(this.createMessage(topic, 'sensor_msgs/CompressedImage', cameraMessage, timestamp));
    //     }
    //     return messages;
    // }

    private processCameraData(cameraData: Record<string, string>, timestamp: Time, scanIndex: number): MessageEvent<unknown>[] {
        const messages: MessageEvent<unknown>[] = [];
        for (const [cameraKey, imageData] of Object.entries(cameraData)) {
            if (!imageData) continue;

            const topic = this.topicMappings.camera[cameraKey];
            if (!topic) continue;

            try {
                // [수정] Base64 문자열을 디코딩하여 Uint8Array(바이트 배열)로 변환합니다.
                const binaryString = atob(imageData);
                const bytes = new Uint8Array(binaryString.length);
                for (let i = 0; i < binaryString.length; i++) {
                    bytes[i] = binaryString.charCodeAt(i);
                }

                const cameraMessage = {
                    header: { stamp: timestamp, frame_id: cameraKey, seq: scanIndex },
                    format: 'jpeg',
                    // [수정] 원본 문자열 대신 변환된 바이트 배열을 데이터로 할당합니다.
                    data: bytes,
                };
                messages.push(this.createMessage(topic, 'sensor_msgs/CompressedImage', cameraMessage, timestamp));

            } catch (e) {
                console.error(`[MessageProcessor] Failed to decode Base64 image for topic ${topic}:`, e);
            }
        }
        return messages;
    }

    private extractRadarData(canData: any, timestamp: Time, scanIndex: number): MessageEvent<unknown>[]
    {
        const messages: MessageEvent<unknown>[] = [];
        for (const corner of ['FL', 'FR', 'RL', 'RR'])
        {
            const points = this.extractRadarPoints(canData, corner);
            if (points.length > 0)
            {
                const pointCloud = this.createPointCloud2Message(points, corner.toLowerCase(), timestamp, scanIndex);
                const topic = this.topicMappings.radar[corner];
                if (topic)
                {
                    messages.push(this.createMessage(topic, 'sensor_msgs/PointCloud2', pointCloud, timestamp));
                }
            }
        }
        return messages;
    }

    private extractRadarPoints(canData: any, corner: string): Array<{x: number, y: number, z: number, intensity: number}> {
        const points: {x: number, y: number, z: number, intensity: number}[] = [];

        for (let i = 0; i < 200; i++)
        {
            const rangeKey = `${corner}__Range_${i}`;
            if (!(rangeKey in canData))
                break;

            const range = parseFloat(canData[rangeKey] ?? 0);
            if (range <= 0.1)
                continue;

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
        for (let i = 0; i < points.length; i++)
        {
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

    private createMessage(topic: string, schemaName: string, message: unknown, receiveTime: Time): MessageEvent<unknown> {
        const msg = message ?? {};
        let sizeInBytes = 0;

        try
        {
            const jsonString = JSON.stringify(msg);

            // Calculate Bytes size
            try
            {
                sizeInBytes = new TextEncoder().encode(jsonString).length;
            }
            catch
            {
                sizeInBytes = 0;
            }
        }
        catch (error)
        {
            console.error(`[MessageProcessor] Failed to calculate size for topic ${topic}.`, error);
            console.log("[MessageProcessor] Problematic message object:", msg);
            sizeInBytes = 0;
        }

        return {topic, receiveTime, message: msg, schemaName, sizeInBytes,};
    }

    private normalizeTimestamp(timestamp: number): Time
    {
        const sec = Math.floor(timestamp);
        const nsec = Math.round((timestamp - sec) * 1e9);
        return { sec, nsec };
    }
}
