import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';

// Above what the server keeps (2.6 MP), so a photo cropped to one item still has pixels to
// spare. Capped by area, so a tall screenshot keeps its full width; about 1 MB to upload.
export const UPLOAD_MAX_PIXELS = 4_200_000;
const UPLOAD_MAX_SIDE = 3000;
const JPEG_QUALITY = 0.9;

type Photo = { uri: string; width: number; height: number };

// Shrinks a camera or gallery photo and re-encodes it as JPEG. Re-encoding also turns
// iPhone HEIC photos into JPEG, which the server can read.
export async function shrinkPhoto({ uri, width, height }: Photo): Promise<string> {
  const context = ImageManipulator.manipulate(uri);
  const scale = Math.min(
    1,
    Math.sqrt(UPLOAD_MAX_PIXELS / (width * height)),
    UPLOAD_MAX_SIDE / Math.max(width, height),
  );
  if (scale < 1) context.resize({ width: Math.round(width * scale) });
  const image = await context.renderAsync();
  const result = await image.saveAsync({ compress: JPEG_QUALITY, format: SaveFormat.JPEG });
  return result.uri;
}

// Turns an already shrunk photo a quarter turn clockwise and saves it as a new JPEG.
export async function rotatePhoto(uri: string): Promise<string> {
  const image = await ImageManipulator.manipulate(uri).rotate(90).renderAsync();
  const result = await image.saveAsync({ compress: JPEG_QUALITY, format: SaveFormat.JPEG });
  return result.uri;
}

// Cuts the part of a photo inside `box` (photo pixels) and saves it as a new JPEG.
export async function cropPhoto(
  uri: string,
  box: { x: number; y: number; width: number; height: number },
): Promise<string> {
  const image = await ImageManipulator.manipulate(uri)
    .crop({ originX: box.x, originY: box.y, width: box.width, height: box.height })
    .renderAsync();
  const result = await image.saveAsync({ compress: JPEG_QUALITY, format: SaveFormat.JPEG });
  return result.uri;
}
