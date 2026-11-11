/**
 * @format
 */

import { AppRegistry } from 'react-native';
import App from './App';
import { name as appName } from './app.json';
import { runShareHeadlessTask } from './src/context/sharePipeline';

AppRegistry.registerComponent(appName, () => App);
AppRegistry.registerHeadlessTask('DryWatchShareTask', () => runShareHeadlessTask);
