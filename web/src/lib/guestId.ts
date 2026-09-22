const KEY = "easex_guest_id";

/**
 * A stable per-browser id for support chat before the user signs in.
 * Generated once, kept in localStorage — NOT sent for anything but
 * support endpoints, and cleared once claimGuest() successfully folds
 * it into a real account (see AuthContext's login/register flow).
 */
export function peekGuestId(): string | null {
  return localStorage.getItem(KEY);
}

export function getGuestId(): string {
  let id = localStorage.getItem(KEY);
  if (!id) {
    id = crypto.randomUUID();
    localStorage.setItem(KEY, id);
  }
  return id;
}

export function clearGuestId() {
  localStorage.removeItem(KEY);
}
