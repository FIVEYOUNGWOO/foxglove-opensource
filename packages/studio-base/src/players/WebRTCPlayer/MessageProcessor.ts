/** TODO list
 * - Add transmform and frame_id to display 3D panel (includes ego-car, track, pointcloud)
 */

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
            // Write standard ROS topic name as "/camera/image/compressed"
            'camera_1': '/camera/cam_1/image_raw/compressed',
            'camera_2': '/camera/cam_2/image_raw/compressed',
            'camera_3': '/camera/cam_3/image_raw/compressed',
            'camera_4': '/camera/cam_4/image_raw/compressed',
            'camera_5': '/camera/cam_5/image_raw/compressed',
            'camera_6': '/camera/cam_6/image_raw/compressed',
        } as Record<string, string>,

        radar:
        {
            'FL': '/radar_points_3d/fl',
            'FR': '/radar_points_3d/fr',
            'RL': '/radar_points_3d/rl',
            'RR': '/radar_points_3d/rr',
        } as Record<string, string>
    };

    /**
     * DOTO
     * below python configulation setting apply to radar_config
     */
    // self.radar_config = {
    //     'FL': {'position': (2.35, 0.95, 0.89), 'orientation': (0, -65, 0), 'azi': -65.0, 'ele': 0.0, 'fov_angle': 170, 'max_range': 250},
    //     'FR': {'position': (2.35, -0.95, 0.89), 'orientation': (0, 65, 0), 'azi': 65.0, 'ele': 0.0, 'fov_angle': 170, 'max_range': 250},
    //     'RL': {'position': (-2.35, 0.95, 0.8), 'orientation': (0, -123, 0), 'azi': -123.0, 'ele': 0.0, 'fov_angle': 170, 'max_range': 250},
    //     'RR': {'position': (-2.35, -0.95, 0.8), 'orientation': (0, 115, 0), 'azi': 115.0, 'ele': 0.0, 'fov_angle': 170, 'max_range': 250}
    // }

    private readonly radar_config = {
        'FL': { position: [2.35, 0.95, 0.89], orientation: [0, 0, 65] }, // roll, pitch, yaw (degrees)
        'FR': { position: [2.35, -0.95, 0.89], orientation: [0, 0, -65] },
        'RL': { position: [-2.35, 0.95, 0.8], orientation: [0, 0, 123] },
        'RR': { position: [-2.35, -0.95, 0.8], orientation: [0, 0, -115] }
    };

    private readonly camera_config = {
        '1': { position: [1.2, 0.5, 1.5], orientation: [0, 0, 0] },
        '2': {position: [1.0, -0.8, 1.4], orientation: [0, 0, -30]},
        '3': {position: [1.0, 0.8, 1.4], orientation: [0, 0, 30]},
        '4': {position: [-1.0, 0.8, 1.4], orientation: [0, 0, 150]},
        '5': {position: [-1.0, -0.8, 1.4], orientation: [0, 0, -150]},
        '6': {position: [-1.2, 0.0, 1.5], orientation: [0, 0, 180]}
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

        // Add TF message
        messages.push(...this.createTransforms(baseTimestamp));

        // // Add Grid map and FOV
        // messages.push(this.createGridMessage(baseTimestamp));
        // messages.push(this.createFovMessage(baseTimestamp));

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

    // // [추가] 3D 패널의 배경 Grid를 생성하는 함수
    // private createGridMessage(timestamp: Time): MessageEvent<unknown>
    // {
    //     const markerArray = { markers: [] as any[] };
    //     const gridMarker =
    //     {
    //         header: { stamp: timestamp, frame_id: "map" },
    //         ns: "background_grid",
    //         id: 0,
    //         type: 5, // LINE_LIST
    //         action: 0, // ADD
    //         points: [] as any[],
    //         scale: { x: 0.05, y: 0, z: 0 },
    //         color: { r: 0.3, g: 0.3, b: 0.3, a: 0.5 },
    //         lifetime: { sec: 1, nsec: 0 },
    //     };

    //     const gridSize = 100;
    //     const gridStep = 10;
    //     for (let i = -gridSize; i <= gridSize; i += gridStep)
    //     {
    //         gridMarker.points.push({ x: -gridSize, y: i, z: 0 });
    //         gridMarker.points.push({ x: gridSize, y: i, z: 0 });
    //         gridMarker.points.push({ x: i, y: -gridSize, z: 0 });
    //         gridMarker.points.push({ x: i, y: gridSize, z: 0 });
    //     }
    //     markerArray.markers.push(gridMarker);
    //     return this.createMessage("/visualization/grid", "visualization_msgs/MarkerArray", markerArray, timestamp);
    // }

    // // [추가] Radar의 FOV(Field of View)를 생성하는 함수
    // private createFovMessage(timestamp: Time): MessageEvent<unknown>
    // {
    //     const markerArray = { markers: [] as any[] };
    //     Object.entries(this.radar_config).forEach(([key, config], i) =>
    //     {
    //         const fovMarker =
    //         {
    //             header: { stamp: timestamp, frame_id: "base_link" },
    //             ns: "radar_fov",
    //             id: i,
    //             type: 11, // TRIANGLE_LIST
    //             action: 0, // ADD
    //             points: [] as any[],
    //             scale: { x: 1.0, y: 1.0, z: 1.0 },
    //             color: { r: 0.2, g: 1.0, b: 0.2, a: 0.15 },
    //             lifetime: { sec: 1, nsec: 0 },
    //         };

    //         const pos = config.position;
    //         const yaw = config.orientation[2]; // Yaw in degrees
    //         const fov = config.fov;
    //         const range = config.range;
    //         const segments = 20;

    //         for (let j = 0; j < segments; j++)
    //         {
    //             const angle1 = (yaw - fov / 2.0 + (j * fov / segments)) * Math.PI / 180;
    //             const angle2 = (yaw - fov / 2.0 + ((j + 1) * fov / segments)) * Math.PI / 180;

    //             fovMarker.points.push({ x: pos[0], y: pos[1], z: pos[2] });
    //             fovMarker.points.push({ x: pos[0] + range * Math.cos(angle1), y: pos[1] + range * Math.sin(angle1), z: pos[2] });
    //             fovMarker.points.push({ x: pos[0] + range * Math.cos(angle2), y: pos[1] + range * Math.sin(angle2), z: pos[2] });
    //         }
    //         markerArray.markers.push(fovMarker);
    //     });
    //     return this.createMessage("/visualization/radar_fov", "visualization_msgs/MarkerArray", markerArray, timestamp);
    // }

    private createTransforms(timestamp: Time): MessageEvent<unknown>[] {

        // Set any[] type to prevent estimating 'never' type on typescript
        const transforms: any[] = [];

        // Step 1) Set map (world)
        transforms.push({
            header: { stamp: timestamp, frame_id: "map" },
            child_frame_id: "base_link",
            transform: {translation: { x: 0, y: 0, z: 0 }, rotation: { x: 0, y: 0, z: 0, w: 1 },},
        });

        // Step 2) Set RADAR positions
        for (const [key, config] of Object.entries(this.radar_config))
        {
            transforms.push({
                header: { stamp: timestamp, frame_id: "base_link" },
                child_frame_id: `radar_${key.toLowerCase()}`,
                // transform: this.eulerToTransform(config.position[0], config.position[1], config.position[2],
                //                                  config.orientation[0], config.orientation[2], config.orientation[1])
                transform: this.eulerToTransform(
                    config.position[0] ?? 0, config.position[1] ?? 0, config.position[2] ?? 0,
                    config.orientation[0] ?? 0, config.orientation[2] ?? 0, config.orientation[1] ?? 0),});
        }

        // Step 3) Set camera positions
        for (const [key, config] of Object.entries(this.camera_config))
        {
            transforms.push({
                header: { stamp: timestamp, frame_id: "base_link" },
                child_frame_id: `camera_${key}`,
                // transform: this.eulerToTransform(config.position[0], config.position[1], config.position[2],
                //                                  config.orientation[0], config.orientation[1], config.orientation[2])
                transform: this.eulerToTransform(
                    config.position[0] ?? 0, config.position[1] ?? 0, config.position[2] ?? 0,
                    config.orientation[0] ?? 0, config.orientation[1] ?? 0, config.orientation[2] ?? 0)});
        }

        const tfMessage = { transforms };
        return [this.createMessage("/tf", "tf2_msgs/TFMessage", tfMessage, timestamp)];
    }

    private eulerToTransform(x: number, y: number, z: number, rollDeg: number, pitchDeg: number, yawDeg: number)
    {
        const roll = rollDeg * Math.PI / 180;
        const pitch = pitchDeg * Math.PI / 180;
        const yaw = yawDeg * Math.PI / 180;

        const cy = Math.cos(yaw * 0.5);
        const sy = Math.sin(yaw * 0.5);
        const cp = Math.cos(pitch * 0.5);
        const sp = Math.sin(pitch * 0.5);
        const cr = Math.cos(roll * 0.5);
        const sr = Math.sin(roll * 0.5);

        return {
            translation: { x, y, z },
            rotation: {
                w: cr * cp * cy + sr * sp * sy,
                x: sr * cp * cy - cr * sp * sy,
                y: cr * sp * cy + sr * cp * sy,
                z: cr * cp * sy - sr * sp * cy,
            }
        };
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

    private processCameraData(cameraData: Record<string, string>, timestamp: Time, scanIndex: number): MessageEvent<unknown>[]
    {
        const messages: MessageEvent<unknown>[] = [];
        for (const [cameraKey, imageData] of Object.entries(cameraData))
        {
            if (!imageData) continue;

            const topic = this.topicMappings.camera[cameraKey];
            if (!topic) continue;

            try
            {
                // Convert Base64 string to Uint8Array
                const binaryString = atob(imageData);
                const bytes = new Uint8Array(binaryString.length);
                for (let i = 0; i < binaryString.length; i++)
                {
                    bytes[i] = binaryString.charCodeAt(i);
                }

                const cameraMessage =
                {
                    // header: { stamp: timestamp, frame_id: cameraKey, seq: scanIndex },
                    header: { stamp: timestamp, frame_id: `camera_${cameraKey.replace('camera_', '')}`, seq: scanIndex },
                    format: 'jpeg',
                    // Allocate converted bytes array
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

    private extractRadarPoints(canData: any, corner: string): Array<{x: number, y: number, z: number, intensity: number}>
    {
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

            const x = range * Math.cos(elevationRad) * Math.cos(azimuthRad); // X-axis = front
            const y = range * Math.cos(elevationRad) * Math.sin(azimuthRad); // Y-axis = left
            const z = range * Math.sin(elevationRad);                        // Z-axis = right

            points.push({ x, y, z, intensity: power });
        }
        return points;
    }

    private createPointCloud2Message(
        points: Array<{x: number, y: number, z: number, intensity: number}>,
        frameId: string,
        timestamp: Time,
        scanIndex: number
    ): any {
        const pointStep = 16; // 4 floats * 4 bytes
        const rowStep = pointStep * points.length;
        const dataArray = new Float32Array(points.length * 4);

        for (let i = 0; i < points.length; i++)
        {
            const point = points[i]!;
            const offset = i * 4;
            dataArray[offset + 0] = point.x;
            dataArray[offset + 1] = point.y;
            dataArray[offset + 2] = point.z;
            dataArray[offset + 3] = point.intensity;
        }

        // Convert binary array to Base64 string types
        const byteArray = new Uint8Array(dataArray.buffer);
        let binaryString = '';
        for (let i = 0; i < byteArray.byteLength; i++)
        {
            binaryString += String.fromCharCode(byteArray[i]!);
        }
        const base64Data = btoa(binaryString);

        return {
            // header: { stamp: timestamp, frame_id: `radar_${frameId}`, seq: scanIndex },
            header: { stamp: timestamp, frame_id: frameId, seq: scanIndex },
            height: 1.7,
            width: points.length,
            fields: [
                { name: 'x', offset: 0, datatype: 7, count: 1 },
                { name: 'y', offset: 4, datatype: 7, count: 1 },
                { name: 'z', offset: 8, datatype: 7, count: 1 },
                { name: 'intensity', offset: 12, datatype: 7, count: 1 },
            ],
            is_bigendian: false,
            point_step: pointStep,
            row_step: rowStep,
            // Allocate Base64 string
            data: base64Data,
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




// /** TODO list
//  * - Add transmform and frame_id to display 3D panel (includes ego-car, track, pointcloud)
//  */

// import { MessageEvent } from "@foxglove/studio-base/players/types";
// import { Time } from "@foxglove/rostime";

// interface SensorDataMessage
// {
//     type: 'sensor_update';
//     scan_index: number;
//     timestamp: number;
//     can_data?: Record<string, any>;
//     camera_data?: Record<string, string>;
//     [key: string]: any;
// }

// export class MessageProcessor
// {
//     private readonly topicMappings =
//     {
//         camera:
//         {
//             // Write standard ROS topic name as "/camera/image/compressed"
//             'camera_1': '/camera/cam_1/image_raw/compressed',
//             'camera_2': '/camera/cam_2/image_raw/compressed',
//             'camera_3': '/camera/cam_3/image_raw/compressed',
//             'camera_4': '/camera/cam_4/image_raw/compressed',
//             'camera_5': '/camera/cam_5/image_raw/compressed',
//             'camera_6': '/camera/cam_6/image_raw/compressed',
//         } as Record<string, string>,

//         radar:
//         {
//             'FL': '/radar_points_3d/fl',
//             'FR': '/radar_points_3d/fr',
//             'RL': '/radar_points_3d/rl',
//             'RR': '/radar_points_3d/rr',
//         } as Record<string, string>
//     };

//     public processMessage(data: string | ArrayBuffer | ArrayBufferView): MessageEvent<unknown>[]
//     {
//         try
//         {
//             const textData = (typeof data === 'string') ? data : new TextDecoder().decode(data);
//             const parsedData = JSON.parse(textData) as SensorDataMessage;

//             if (parsedData && parsedData.type === 'sensor_update')
//             {
//                 return this.processSensorDataMessage(parsedData);
//             }
//             return [];
//         }
//         catch (error)
//         {
//             console.error("[MessageProcessor] Failed to parse message:", error);
//             return [];
//         }
//     }

//     private processSensorDataMessage(sensorData: SensorDataMessage): MessageEvent<unknown>[]
//     {
//         const messages: MessageEvent<unknown>[] = [];
//         const baseTimestamp = this.normalizeTimestamp(sensorData.timestamp);
//         const scanIndex = sensorData.scan_index;

//         messages.push(this.createMessage('/can/scan_index', 'std_msgs/Int32', { data: scanIndex }, baseTimestamp));

//         if (sensorData.can_data)
//         {
//             messages.push(...this.processCanData(sensorData.can_data, baseTimestamp));
//         }
//         if (sensorData.camera_data)
//         {
//             messages.push(...this.processCameraData(sensorData.camera_data, baseTimestamp, scanIndex));
//         }
//         if (sensorData.can_data)
//         {
//             messages.push(...this.extractRadarData(sensorData.can_data, baseTimestamp, scanIndex));
//         }

//         return messages;
//     }

//     private processCanData(canData: Record<string, any>, timestamp: Time): MessageEvent<unknown>[]
//     {
//         const messages: MessageEvent<unknown>[] = [];
//         for (const [signalName, value] of Object.entries(canData))
//         {
//             const topic = `/can/${signalName}`;
//             let schemaName = 'std_msgs/Float64';

//             if (Number.isInteger(value))
//             {
//                 schemaName = 'std_msgs/Int32';
//             }
//             else if (typeof value === 'string')
//             {
//                 schemaName = 'std_msgs/String';
//             }
//             messages.push(this.createMessage(topic, schemaName, { data: value }, timestamp));
//         }
//         return messages;
//     }

//     private processCameraData(cameraData: Record<string, string>, timestamp: Time, scanIndex: number): MessageEvent<unknown>[] {
//         const messages: MessageEvent<unknown>[] = [];
//         for (const [cameraKey, imageData] of Object.entries(cameraData)) {
//             if (!imageData) continue;

//             const topic = this.topicMappings.camera[cameraKey];
//             if (!topic) continue;

//             try {
//                 // Convert Base64 string to Uint8Array
//                 const binaryString = atob(imageData);
//                 const bytes = new Uint8Array(binaryString.length);
//                 for (let i = 0; i < binaryString.length; i++) {
//                     bytes[i] = binaryString.charCodeAt(i);
//                 }

//                 const cameraMessage = {
//                     header: { stamp: timestamp, frame_id: cameraKey, seq: scanIndex },
//                     format: 'jpeg',
//                     // Allocate converted bytes array
//                     data: bytes,
//                 };
//                 messages.push(this.createMessage(topic, 'sensor_msgs/CompressedImage', cameraMessage, timestamp));

//             } catch (e) {
//                 console.error(`[MessageProcessor] Failed to decode Base64 image for topic ${topic}:`, e);
//             }
//         }
//         return messages;
//     }

//     private extractRadarData(canData: any, timestamp: Time, scanIndex: number): MessageEvent<unknown>[]
//     {
//         const messages: MessageEvent<unknown>[] = [];
//         for (const corner of ['FL', 'FR', 'RL', 'RR'])
//         {
//             const points = this.extractRadarPoints(canData, corner);
//             if (points.length > 0)
//             {
//                 const pointCloud = this.createPointCloud2Message(points, corner.toLowerCase(), timestamp, scanIndex);
//                 const topic = this.topicMappings.radar[corner];
//                 if (topic)
//                 {
//                     messages.push(this.createMessage(topic, 'sensor_msgs/PointCloud2', pointCloud, timestamp));
//                 }
//             }
//         }
//         return messages;
//     }

//     private extractRadarPoints(canData: any, corner: string): Array<{x: number, y: number, z: number, intensity: number}>
//     {
//         const points: {x: number, y: number, z: number, intensity: number}[] = [];

//         for (let i = 0; i < 200; i++)
//         {
//             const rangeKey = `${corner}__Range_${i}`;
//             if (!(rangeKey in canData))
//                 break;

//             const range = parseFloat(canData[rangeKey] ?? 0);
//             if (range <= 0.1)
//                 continue;

//             const azimuth = parseFloat(canData[`${corner}__AziAng_${i}`] ?? 0);
//             const elevation = parseFloat(canData[`${corner}__EleAng_${i}`] ?? 0);
//             const power = parseFloat(canData[`${corner}__Power_${i}`] ?? 0);

//             const azimuthRad = azimuth * Math.PI / 180;
//             const elevationRad = elevation * Math.PI / 180;

//             const x = range * Math.cos(elevationRad) * Math.cos(azimuthRad);
//             const y = range * Math.cos(elevationRad) * Math.sin(azimuthRad);
//             const z = range * Math.sin(elevationRad);

//             points.push({ x, y, z, intensity: power });
//         }
//         return points;
//     }

//     private createPointCloud2Message(
//         points: Array<{x: number, y: number, z: number, intensity: number}>,
//         frameId: string,
//         timestamp: Time,
//         scanIndex: number
//     ): any {
//         const pointStep = 16; // 4 floats * 4 bytes
//         const rowStep = pointStep * points.length;
//         const dataArray = new Float32Array(points.length * 4);

//         for (let i = 0; i < points.length; i++)
//         {
//             const point = points[i]!;
//             const offset = i * 4;
//             dataArray[offset + 0] = point.x;
//             dataArray[offset + 1] = point.y;
//             dataArray[offset + 2] = point.z;
//             dataArray[offset + 3] = point.intensity;
//         }

//         // Convert binary array to Base64 string types
//         const byteArray = new Uint8Array(dataArray.buffer);
//         let binaryString = '';
//         for (let i = 0; i < byteArray.byteLength; i++)
//         {
//             binaryString += String.fromCharCode(byteArray[i]!);
//         }
//         const base64Data = btoa(binaryString);

//         return {
//             header: { stamp: timestamp, frame_id: `radar_${frameId}`, seq: scanIndex },
//             height: 1.7,
//             width: points.length,
//             fields: [
//                 { name: 'x', offset: 0, datatype: 7, count: 1 },
//                 { name: 'y', offset: 4, datatype: 7, count: 1 },
//                 { name: 'z', offset: 8, datatype: 7, count: 1 },
//                 { name: 'intensity', offset: 12, datatype: 7, count: 1 },
//             ],
//             is_bigendian: false,
//             point_step: pointStep,
//             row_step: rowStep,
//             // Allocate Base64 string
//             data: base64Data,
//             is_dense: true,
//         };
//     }


//     private createMessage(topic: string, schemaName: string, message: unknown, receiveTime: Time): MessageEvent<unknown> {
//         const msg = message ?? {};
//         let sizeInBytes = 0;

//         try
//         {
//             const jsonString = JSON.stringify(msg);

//             // Calculate Bytes size
//             try
//             {
//                 sizeInBytes = new TextEncoder().encode(jsonString).length;
//             }
//             catch
//             {
//                 sizeInBytes = 0;
//             }
//         }
//         catch (error)
//         {
//             console.error(`[MessageProcessor] Failed to calculate size for topic ${topic}.`, error);
//             console.log("[MessageProcessor] Problematic message object:", msg);
//             sizeInBytes = 0;
//         }

//         return {topic, receiveTime, message: msg, schemaName, sizeInBytes,};
//     }

//     private normalizeTimestamp(timestamp: number): Time
//     {
//         const sec = Math.floor(timestamp);
//         const nsec = Math.round((timestamp - sec) * 1e9);
//         return { sec, nsec };
//     }
// }
