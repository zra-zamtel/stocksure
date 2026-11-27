// Taking a product photo and keeping it. The picker's copy lives in a cache
// folder Android may clear, so the photo is copied into the app's own
// documents folder and that path is what the product stores.
import { Directory, File, Paths } from 'expo-file-system';
import * as ImagePicker from 'expo-image-picker';

export type PhotoSource = 'camera' | 'library';

export type PhotoResult =
  | { status: 'saved'; uri: string }
  | { status: 'cancelled' }
  | { status: 'denied' };

/** Square, compressed: a product tile is small, and cheap phones have little space. */
const PICKER_OPTIONS: ImagePicker.ImagePickerOptions = {
  mediaTypes: ['images'],
  allowsEditing: true,
  aspect: [1, 1],
  quality: 0.6,
};

export async function takeProductPhoto(source: PhotoSource, name: string): Promise<PhotoResult> {
  if (source === 'camera') {
    const permission = await ImagePicker.requestCameraPermissionsAsync();
    if (!permission.granted) return { status: 'denied' };
  }
  const result =
    source === 'camera'
      ? await ImagePicker.launchCameraAsync(PICKER_OPTIONS)
      : await ImagePicker.launchImageLibraryAsync(PICKER_OPTIONS);
  const picked = result.canceled ? undefined : result.assets?.[0];
  if (!picked) return { status: 'cancelled' };
  return { status: 'saved', uri: await keepPhoto(picked.uri, name) };
}

/** Copies a picked image into documents/product-photos and returns the kept file's URI. */
async function keepPhoto(pickedUri: string, name: string): Promise<string> {
  const folder = new Directory(Paths.document, 'product-photos');
  if (!folder.exists) folder.create({ intermediates: true });
  // A timestamp keeps a retaken photo from colliding with the old file.
  const target = new File(folder, `${slug(name)}-${Date.now()}.jpg`);
  await new File(pickedUri).copy(target);
  return target.uri;
}

/**
 * Deletes a kept photo that has been replaced, so retakes do not pile up on a
 * phone with little space. Only files in our own folder; anything else (or a
 * file already gone) is left alone.
 */
export function discardPhoto(uri: string | null | undefined): void {
  if (!uri || !uri.includes('/product-photos/')) return;
  try {
    const file = new File(uri);
    if (file.exists) file.delete();
  } catch {
    // Not worth bothering the owner about: the space is reclaimed next time.
  }
}

function slug(name: string): string {
  return (
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 40) || 'product'
  );
}
