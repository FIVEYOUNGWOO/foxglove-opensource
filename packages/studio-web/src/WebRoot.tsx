// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { useMemo } from "react";

import {
  AppBarProps,
  AppSetting,
  IDataSourceFactory,
  Ros1LocalBagDataSourceFactory,
  Ros2LocalBagDataSourceFactory,
  RosbridgeDataSourceFactory,
  RemoteDataSourceFactory,
  FoxgloveWebSocketDataSourceFactory,
  UlogLocalDataSourceFactory,
  McapLocalDataSourceFactory,
  SampleNuscenesDataSourceFactory,
  WebRTCDataSourceFactory,
  SharedRoot,
} from "@foxglove/studio-base";

import LocalStorageAppConfiguration from "./services/LocalStorageAppConfiguration";

const isDevelopment = process.env.NODE_ENV === "development";

export function WebRoot(props: {
  extraProviders: JSX.Element[] | undefined;
  dataSources: IDataSourceFactory[] | undefined;
  AppBarComponent?: (props: AppBarProps) => JSX.Element;
  children: JSX.Element;
}): JSX.Element {
  const appConfiguration = useMemo(
    () =>
      new LocalStorageAppConfiguration({
        defaults: {
          [AppSetting.SHOW_DEBUG_PANELS]: isDevelopment,
        },
      }),
    [],
  );

  const dataSources = useMemo(() => {
    const sources: IDataSourceFactory[] = [
      new Ros1LocalBagDataSourceFactory(),
      new Ros2LocalBagDataSourceFactory(),
      new FoxgloveWebSocketDataSourceFactory(),
      new RosbridgeDataSourceFactory(),
      new UlogLocalDataSourceFactory(),
      new SampleNuscenesDataSourceFactory(),
      new WebRTCDataSourceFactory(),
      new McapLocalDataSourceFactory(),
      new RemoteDataSourceFactory(),
    ];

    return props.dataSources ?? sources;
  }, [props.dataSources]);

  return (
    <SharedRoot
      enableLaunchPreferenceScreen
      deepLinks={[window.location.href]}
      // Fix: Cast dataSources to readonly to satisfy SharedRoot props type
      dataSources={dataSources as readonly IDataSourceFactory[]}
      appConfiguration={appConfiguration}
      enableGlobalCss
      extraProviders={props.extraProviders}
      AppBarComponent={props.AppBarComponent}
    >
      {props.children}
    </SharedRoot>
  );
}

// // This Source Code Form is subject to the terms of the Mozilla Public
// // License, v2.0. If a copy of the MPL was not distributed with this
// // file, You can obtain one at http://mozilla.org/MPL/2.0/

// import { useMemo } from "react";

// import {
//   AppBarProps,
//   AppSetting,
//   IDataSourceFactory,
//   Ros1LocalBagDataSourceFactory,
//   Ros2LocalBagDataSourceFactory,
//   RosbridgeDataSourceFactory,
//   RemoteDataSourceFactory,
//   FoxgloveWebSocketDataSourceFactory,
//   UlogLocalDataSourceFactory,
//   McapLocalDataSourceFactory,
//   SampleNuscenesDataSourceFactory,
//   WebRTCDataSourceFactory,
//   SharedRoot,
// } from "@foxglove/studio-base";

// import LocalStorageAppConfiguration from "./services/LocalStorageAppConfiguration";

// const isDevelopment = process.env.NODE_ENV === "development";

// export function WebRoot(props: {
//   extraProviders: JSX.Element[] | undefined;
//   dataSources: IDataSourceFactory[] | undefined;
//   AppBarComponent?: (props: AppBarProps) => JSX.Element;
//   children: JSX.Element;
// }): JSX.Element {
//   const appConfiguration = useMemo(
//     () =>
//       new LocalStorageAppConfiguration({
//         defaults: {
//           [AppSetting.SHOW_DEBUG_PANELS]: isDevelopment,
//         },
//       }),
//     [],
//   );

//   const dataSources = useMemo(() => {
//     const sources = [
//       new Ros1LocalBagDataSourceFactory(),
//       new Ros2LocalBagDataSourceFactory(),
//       new FoxgloveWebSocketDataSourceFactory(),
//       new RosbridgeDataSourceFactory(),
//       new UlogLocalDataSourceFactory(),
//       new SampleNuscenesDataSourceFactory(),
//       new WebRTCDataSourceFactory(),
//       new McapLocalDataSourceFactory(),
//       new RemoteDataSourceFactory(),
//     ];

//     return props.dataSources ?? sources;
//   }, [props.dataSources]);

//   return (
//     <SharedRoot
//       enableLaunchPreferenceScreen
//       deepLinks={[window.location.href]}


//       // ERROR in ./packages/studio-web/src/WebRoot.tsx:63:7
//       // TS2322: Type 'IDataSourceFactory[] | (FoxgloveWebSocketDataSourceFactory | Ros1LocalBagDataSourceFactory | ... 6 more ... | WebRTCDataSourceFactory)[]' is not assignable to type 'readonly IDataSourceFactory[]'.
//       //   Type '(FoxgloveWebSocketDataSourceFactory | Ros1LocalBagDataSourceFactory | Ros2LocalBagDataSourceFactory | ... 5 more ... | WebRTCDataSourceFactory)[]' is not assignable to type 'readonly IDataSourceFactory[]'.
//       //     Type 'FoxgloveWebSocketDataSourceFactory | Ros1LocalBagDataSourceFactory | Ros2LocalBagDataSourceFactory | ... 5 more ... | WebRTCDataSourceFactory' is not assignable to type 'IDataSourceFactory'.
//       //       Type 'WebRTCDataSourceFactory' is not assignable to type 'IDataSourceFactory'.
//       //         The types of 'formConfig.fields' are incompatible between these types.
//       //           Type '({ id: string; label: string; defaultValue: string; validate: (newValue: string) => Error | undefined; type?: undefined; } | { id: string; label: string; type: "boolean"; defaultValue: boolean; validate?: undefined; })[]' is not assignable to type 'Field[]'.
//       //             Type '{ id: string; label: string; defaultValue: string; validate: (newValue: string) => Error | undefined; type?: undefined; } | { id: string; label: string; type: "boolean"; defaultValue: boolean; validate?: undefined; }' is not assignable to type 'Field'.
//       //               Type '{ id: string; label: string; type: "boolean"; defaultValue: boolean; validate?: undefined; }' is not assignable to type 'Field'.
//       //                 Types of property 'defaultValue' are incompatible.
//       //                   Type 'boolean' is not assignable to type 'string'.
//       //     61 |       enableLaunchPreferenceScreen
//       //     62 |       deepLinks={[window.location.href]}
//       //   > 63 |       dataSources={dataSources}
//       //        |       ^^^^^^^^^^^
//       //     64 |       appConfiguration={appConfiguration}
//       //     65 |       enableGlobalCss
//       //     66 |       extraProviders={props.extraProviders}

//       dataSources={dataSources}
//       appConfiguration={appConfiguration}
//       enableGlobalCss
//       extraProviders={props.extraProviders}
//       AppBarComponent={props.AppBarComponent}
//     >
//       {props.children}
//     </SharedRoot>
//   );
// }
