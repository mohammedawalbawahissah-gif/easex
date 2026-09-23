import { useEffect, useState } from "react";
import { Keyboard, Platform } from "react-native";

/**
 * The actual on-screen keyboard height in px, live-updated as it opens
 * and closes. Uses 'keyboardWillShow'/'keyboardWillHide' on iOS (fires
 * before the animation completes, so the UI moves in sync with the
 * keyboard rather than snapping after) and 'keyboardDidShow'/'keyboardDidHide'
 * on Android (the 'will' events don't exist there).
 *
 * This exists instead of relying on KeyboardAvoidingView's `behavior`
 * prop because that component's own layout measurement has been
 * unreliable in practice — particularly inside a Modal (see
 * FloatingSupportWidget) and under a React Navigation header, where its
 * internal offset calculation doesn't always match the screen's real
 * geometry. Listening to the OS's own reported height and applying it
 * directly as padding/margin sidesteps that guesswork entirely: it's
 * the same 8 lines of logic behind every call site, driven by a number
 * the OS is authoritative about.
 */
export function useKeyboardHeight(): number {
  const [height, setHeight] = useState(0);

  useEffect(() => {
    const showEvent = Platform.OS === "ios" ? "keyboardWillShow" : "keyboardDidShow";
    const hideEvent = Platform.OS === "ios" ? "keyboardWillHide" : "keyboardDidHide";

    const showSub = Keyboard.addListener(showEvent, (e) => {
      setHeight(e.endCoordinates?.height ?? 0);
    });
    const hideSub = Keyboard.addListener(hideEvent, () => {
      setHeight(0);
    });

    return () => {
      showSub.remove();
      hideSub.remove();
    };
  }, []);

  return height;
}
