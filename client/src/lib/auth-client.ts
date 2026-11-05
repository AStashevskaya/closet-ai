import { expoClient } from '@better-auth/expo/client';
import { inferAdditionalFields } from 'better-auth/client/plugins';
import { createAuthClient } from 'better-auth/react';
import * as SecureStore from 'expo-secure-store';

import { apiUrl } from './api-url';

// The session cookie lives in SecureStore (Keychain / Keystore), never in plain AsyncStorage.
export const authClient = createAuthClient({
  baseURL: apiUrl(),
  plugins: [
    inferAdditionalFields({ user: { privacyConsent: { type: 'string', required: false } } }),
    expoClient({
      // Must match `scheme` in app.json and the trusted origin on the server.
      scheme: 'closetai',
      storagePrefix: 'closetai',
      storage: SecureStore,
    }),
  ],
});
