/** Saves a picture from the page into the device's photo gallery. */
import { Directory, File, Paths } from 'expo-file-system';
import { Asset, requestPermissionsAsync } from 'expo-media-library';
import { Alert, Platform, ToastAndroid } from 'react-native';

import type { ImageDownload, ImageSource } from './imageDownload';

/** Android 11: the first version that lets an app add files to the gallery without a permission. */
const ANDROID_SCOPED_STORAGE_API_LEVEL = 30;

async function canAddToGallery(): Promise<boolean> {
  if (Platform.OS === 'android' && Platform.Version >= ANDROID_SCOPED_STORAGE_API_LEVEL) {
    return true;
  }
  // Only the right to add pictures is requested, never to read the gallery.
  const permission = await requestPermissionsAsync(true);
  return permission.granted;
}

function download(source: ImageSource, directory: Directory): Promise<File> {
  return File.downloadFileAsync(source.url, new File(directory, source.fileName), {
    idempotent: true,
  });
}

/** Downloads the best source that exists. Rejects with the last failure when none does. */
async function downloadFirstAvailable(image: ImageDownload): Promise<File> {
  const directory = new Directory(Paths.cache, 'images');
  directory.create({ idempotent: true, intermediates: true });

  const [best, ...fallbacks] = image;
  let attempt = download(best, directory);
  for (const fallback of fallbacks) {
    // A source that does not exist is answered with an error status.
    attempt = attempt.catch(() => download(fallback, directory));
  }
  return attempt;
}

/**
 * Downloads a picture and adds it to the gallery. Returns `false` when the
 * user refused access to the gallery, and rejects when the download or the
 * save fails.
 */
async function saveImage(image: ImageDownload): Promise<boolean> {
  if (!(await canAddToGallery())) {
    return false;
  }

  const file = await downloadFirstAvailable(image);
  try {
    await Asset.create(file.uri);
  } finally {
    // The gallery holds its own copy.
    file.delete();
  }
  return true;
}

function notify(message: string): void {
  if (Platform.OS === 'android') {
    ToastAndroid.show(message, ToastAndroid.SHORT);
  } else {
    Alert.alert(message);
  }
}

/** Asks whether to save a picture the user long-pressed, then saves it and reports the outcome. */
export function promptToSaveImage(image: ImageDownload): void {
  Alert.alert(
    'Save image',
    'Save this image to your gallery?',
    [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Save',
        onPress: () => {
          saveImage(image).then(
            (saved) => notify(saved ? 'Image saved' : 'Allow access to your photos to save images'),
            () => notify('The image could not be saved'),
          );
        },
      },
    ],
    { cancelable: true },
  );
}
