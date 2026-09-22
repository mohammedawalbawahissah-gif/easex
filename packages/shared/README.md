# @easex/shared

Shared types, API client, and validation schemas used by both
`web` (React) and `mobile` (Expo). This package is the mechanism
that keeps the two frontends functionally identical — a change
here updates both apps at once instead of drifting apart.

## Usage

Each app must supply its own `TokenStorage` implementation, since
web and mobile persist tokens differently.

### Web example
```ts
import { createEaseXApi, type TokenStorage } from "@easex/shared";

const webTokenStorage: TokenStorage = {
  getAccessToken: async () => localStorage.getItem("access"),
  getRefreshToken: async () => localStorage.getItem("refresh"),
  setTokens: async (access, refresh) => {
    localStorage.setItem("access", access);
    localStorage.setItem("refresh", refresh);
  },
  clearTokens: async () => {
    localStorage.removeItem("access");
    localStorage.removeItem("refresh");
  },
};

export const easex = createEaseXApi({
  baseUrl: import.meta.env.VITE_API_URL,
  tokenStorage: webTokenStorage,
  onAuthExpired: () => { window.location.href = "/login"; },
});
```

### Mobile example (Expo)
Use `expo-secure-store`, NOT AsyncStorage — tokens are sensitive.
```ts
import * as SecureStore from "expo-secure-store";
import { createEaseXApi, type TokenStorage } from "@easex/shared";

const mobileTokenStorage: TokenStorage = {
  getAccessToken: () => SecureStore.getItemAsync("access"),
  getRefreshToken: () => SecureStore.getItemAsync("refresh"),
  setTokens: async (access, refresh) => {
    await SecureStore.setItemAsync("access", access);
    await SecureStore.setItemAsync("refresh", refresh);
  },
  clearTokens: async () => {
    await SecureStore.deleteItemAsync("access");
    await SecureStore.deleteItemAsync("refresh");
  },
};

export const easex = createEaseXApi({
  baseUrl: process.env.EXPO_PUBLIC_API_URL!,
  tokenStorage: mobileTokenStorage,
  onAuthExpired: () => { /* navigate to login screen */ },
});
```

### Calling the API (identical on both platforms)
```ts
const wallets = await easex.wallets.list();
const result = await easex.giftcards.submit({
  brand: "amazon",
  card_code: "XXXX-XXXX-XXXX",
  face_value: "100.00",
  offered_rate: "0.85",
});
```

## Why amounts are strings
`Wallet.balance`, `Transaction.amount`, etc. are transmitted as
decimal strings, not JS numbers, to avoid floating-point precision
loss on money values (this matches the backend's DecimalField).
Use a decimal library (e.g. `decimal.js`) for any arithmetic —
never `parseFloat` for calculations, only for display formatting.

## Building
```
npm run build
```
Both `web` and `mobile` should depend on this via the npm
workspace (`"@easex/shared": "*"` in their package.json), so
changes here are picked up on next build without publishing
anywhere.
