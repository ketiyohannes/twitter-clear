import { SafeAreaProvider } from 'react-native-safe-area-context';

import { TwitterWebView } from './src/components/TwitterWebView';

export default function App() {
  return (
    <SafeAreaProvider>
      <TwitterWebView />
    </SafeAreaProvider>
  );
}
