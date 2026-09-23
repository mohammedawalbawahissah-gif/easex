import { Platform, ActionSheetIOS, Alert } from "react-native";
import * as ImagePicker from "expo-image-picker";
import * as DocumentPicker from "expo-document-picker";
import type { RNFilePart } from "@easex/shared";

async function pickFromLibrary(multiple: boolean): Promise<RNFilePart[] | null> {
  const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
  if (!perm.granted) return null;
  const result = await ImagePicker.launchImageLibraryAsync({
    mediaTypes: ImagePicker.MediaTypeOptions.All,
    quality: 0.8,
    allowsMultipleSelection: multiple,
    selectionLimit: multiple ? 6 : 1,
  });
  if (result.canceled || !result.assets?.length) return null;
  return result.assets.map((asset, i) => ({
    uri: asset.uri,
    name: asset.fileName ?? `media-${Date.now()}-${i}.${asset.type === "video" ? "mp4" : "jpg"}`,
    type: asset.mimeType ?? (asset.type === "video" ? "video/mp4" : "image/jpeg"),
  }));
}

async function pickFromCamera(): Promise<RNFilePart[] | null> {
  const perm = await ImagePicker.requestCameraPermissionsAsync();
  if (!perm.granted) return null;
  const result = await ImagePicker.launchCameraAsync({ quality: 0.8 });
  if (result.canceled || !result.assets?.[0]) return null;
  const asset = result.assets[0];
  return [
    {
      uri: asset.uri,
      name: asset.fileName ?? `capture-${Date.now()}.${asset.type === "video" ? "mp4" : "jpg"}`,
      type: asset.mimeType ?? (asset.type === "video" ? "video/mp4" : "image/jpeg"),
    },
  ];
}

async function pickFromFiles(multiple: boolean): Promise<RNFilePart[] | null> {
  // Files on iOS (which itself offers On My iPhone, iCloud Drive, and any
  // other cloud provider apps the user has installed as locations) and the
  // equivalent system file browser on Android.
  const result = await DocumentPicker.getDocumentAsync({
    type: ["image/*", "video/*", "application/pdf"],
    copyToCacheDirectory: true,
    multiple,
  });
  if (result.canceled || !result.assets?.length) return null;
  return result.assets.map((asset) => ({
    uri: asset.uri,
    name: asset.name || "attachment",
    type: asset.mimeType || "application/octet-stream",
  }));
}

/**
 * Shows a source picker — Photo/Video Library, Take Photo/Video, or Browse
 * Files — and returns whatever the user picked, or null if they cancelled
 * at any point (either the source sheet itself, or the picker it opened).
 * `multiple`: whether the library/files pickers allow selecting more than
 * one item at once (camera capture is always exactly one).
 *
 * Used by both the support chat attachment button and the gift-card photo
 * fields, so every attachment point in the app offers the same sources
 * rather than each screen picking a different subset.
 */
export function pickMedia(multiple = false): Promise<RNFilePart[] | null> {
  const options = ["Photo or Video Library", "Take Photo or Video", "Browse Files", "Cancel"];
  const handlers = [
    () => pickFromLibrary(multiple),
    () => pickFromCamera(),
    () => pickFromFiles(multiple),
    () => Promise.resolve(null),
  ];

  return new Promise((resolve) => {
    if (Platform.OS === "ios") {
      ActionSheetIOS.showActionSheetWithOptions(
        { options, cancelButtonIndex: 3 },
        (index) => {
          handlers[index]().then(resolve);
        }
      );
    } else {
      Alert.alert("Attach", undefined, [
        { text: options[0], onPress: () => handlers[0]().then(resolve) },
        { text: options[1], onPress: () => handlers[1]().then(resolve) },
        { text: options[2], onPress: () => handlers[2]().then(resolve) },
        { text: "Cancel", style: "cancel", onPress: () => resolve(null) },
      ]);
    }
  });
}
