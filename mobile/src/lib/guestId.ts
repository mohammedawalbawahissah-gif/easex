import * as SecureStore from "expo-secure-store";

const KEY = "easex_guest_id";

/**
 * Manual UUID v4 — avoids depending on crypto.randomUUID(), which isn't
 * reliably available in Hermes without a polyfill, and avoids adding a
 * new dependency (expo-crypto) just for one random id.
 */
function uuidv4(): string {
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === "x" ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

/**
 * A stable per-device id for support chat before the user signs in.
 * Generated once, kept in SecureStore — not sent for anything but
 * support endpoints, and cleared once claimGuest() successfully folds
 * it into a real account (see AuthContext's login/register flow).
 */
export async function peekGuestId(): Promise<string | null> {
  return SecureStore.getItemAsync(KEY);
}

export async function getGuestId(): Promise<string> {
  let id = await SecureStore.getItemAsync(KEY);
  if (!id) {
    id = uuidv4();
    await SecureStore.setItemAsync(KEY, id);
  }
  return id;
}

export async function clearGuestId(): Promise<void> {
  await SecureStore.deleteItemAsync(KEY);
}
