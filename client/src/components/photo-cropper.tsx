import { Image } from 'expo-image';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Modal, StyleSheet, Text, View } from 'react-native';
import { Gesture, GestureDetector, GestureHandlerRootView } from 'react-native-gesture-handler';
import Animated, { clamp, useAnimatedStyle, useSharedValue } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { PressableScale } from '@/components/pressable-scale';
import { cropPhoto } from '@/lib/shrink-photo';
import { colors, fonts } from '@/theme';

type Size = { width: number; height: number };
export type CropBox = { x: number; y: number; width: number; height: number };

type Props = {
  // The photo to crop; the cropper is open while it is set.
  uri: string | null;
  onCancel: () => void;
  // The cropped copy, saved as a new JPEG.
  onDone: (uri: string) => void;
};

// The frame never gets smaller than this on screen, so the corners stay apart.
const MIN_SIDE = 64;
const HANDLE = 44;
const BRACKET = 22;
const LINE = 3;

// The photo fitted into the area, centred, and the scale from photo pixels to the screen.
function fitted(photo: Size, area: Size) {
  const scale = Math.min(area.width / photo.width, area.height / photo.height);
  const width = photo.width * scale;
  const height = photo.height * scale;
  return { scale, width, height, left: (area.width - width) / 2, top: (area.height - height) / 2 };
}

// A frame drawn on screen → the same part of the photo in pixels, kept inside the photo.
export function toPixels(box: CropBox, scale: number, photo: Size): CropBox {
  const within = (value: number, min: number, max: number) => Math.min(Math.max(value, min), max);
  const x = within(Math.round(box.x / scale), 0, photo.width - 1);
  const y = within(Math.round(box.y / scale), 0, photo.height - 1);
  return {
    x,
    y,
    width: within(Math.round(box.width / scale), 1, photo.width - x),
    height: within(Math.round(box.height / scale), 1, photo.height - y),
  };
}

// Full-screen cropper for a photo before it is saved: drag the corners or the frame onto the
// one item the app should look at. Runs on the phone (expo-image-manipulator), nothing uploads.
export function PhotoCropper({ uri, onCancel, onDone }: Props) {
  return (
    <Modal
      visible={uri !== null}
      animationType="fade"
      presentationStyle="fullScreen"
      onRequestClose={onCancel}
    >
      {/* A modal is its own native root, so gestures need a root view inside it. */}
      <GestureHandlerRootView style={styles.root}>
        {uri && <Cropper key={uri} uri={uri} onCancel={onCancel} onDone={onDone} />}
      </GestureHandlerRootView>
    </Modal>
  );
}

function Cropper({ uri, onCancel, onDone }: Props & { uri: string }) {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const [photo, setPhoto] = useState<Size | null>(null);
  const [area, setArea] = useState<Size | null>(null);
  const [busy, setBusy] = useState(false);
  const fit = photo && area ? fitted(photo, area) : null;
  const fitWidth = fit?.width ?? 0;
  const fitHeight = fit?.height ?? 0;

  // The frame, in screen points from the photo's top left corner. Gestures move it on the UI
  // thread; `start` is the frame when the finger went down.
  const x = useSharedValue(0);
  const y = useSharedValue(0);
  const w = useSharedValue(0);
  const h = useSharedValue(0);
  const start = useSharedValue<CropBox>({ x: 0, y: 0, width: 0, height: 0 });
  const bounds = useSharedValue<Size>({ width: 0, height: 0 });

  // The frame starts around the whole photo.
  useEffect(() => {
    x.set(0);
    y.set(0);
    w.set(fitWidth);
    h.set(fitHeight);
    bounds.set({ width: fitWidth, height: fitHeight });
  }, [fitWidth, fitHeight, x, y, w, h, bounds]);

  const remember = () => {
    'worklet';
    start.set({ x: x.get(), y: y.get(), width: w.get(), height: h.get() });
  };

  const move = Gesture.Pan()
    .onStart(remember)
    .onUpdate((e) => {
      const s = start.get();
      const b = bounds.get();
      x.set(clamp(s.x + e.translationX, 0, b.width - s.width));
      y.set(clamp(s.y + e.translationY, 0, b.height - s.height));
    });

  // A corner moves its two edges; the opposite corner stays put.
  const corner = (left: boolean, top: boolean) =>
    Gesture.Pan()
      .onStart(remember)
      .onUpdate((e) => {
        const s = start.get();
        const b = bounds.get();
        if (left) {
          const nx = clamp(s.x + e.translationX, 0, s.x + s.width - MIN_SIDE);
          x.set(nx);
          w.set(s.x + s.width - nx);
        } else {
          w.set(clamp(s.width + e.translationX, MIN_SIDE, b.width - s.x));
        }
        if (top) {
          const ny = clamp(s.y + e.translationY, 0, s.y + s.height - MIN_SIDE);
          y.set(ny);
          h.set(s.y + s.height - ny);
        } else {
          h.set(clamp(s.height + e.translationY, MIN_SIDE, b.height - s.y));
        }
      });

  // Photo pixels aren't mirrored in RTL, so the frame uses left / top, not start.
  const frame = useAnimatedStyle(() => ({
    left: x.get(),
    top: y.get(),
    width: w.get(),
    height: h.get(),
  }));
  const shadeTop = useAnimatedStyle(() => ({ height: y.get() }));
  const shadeBottom = useAnimatedStyle(() => ({ top: y.get() + h.get() }));
  const shadeLeft = useAnimatedStyle(() => ({ top: y.get(), height: h.get(), width: x.get() }));
  const shadeRight = useAnimatedStyle(() => ({
    top: y.get(),
    height: h.get(),
    left: x.get() + w.get(),
  }));

  async function done() {
    if (!fit || !photo) return;
    const box = toPixels(
      { x: x.get(), y: y.get(), width: w.get(), height: h.get() },
      fit.scale,
      photo,
    );
    // The frame wasn't moved: nothing to crop or upload again.
    if (box.width >= photo.width - 1 && box.height >= photo.height - 1) return onCancel();
    setBusy(true);
    try {
      onDone(await cropPhoto(uri, box));
    } catch (cause) {
      if (__DEV__) console.warn('Cropping the photo failed', cause);
      onCancel();
    } finally {
      setBusy(false);
    }
  }

  return (
    <View style={[styles.root, { paddingTop: insets.top, paddingBottom: insets.bottom + 16 }]}>
      <View style={styles.bar}>
        <PressableScale style={styles.barButton} onPress={onCancel} accessibilityRole="button">
          <Text style={styles.cancel}>{t('closet.cancel')}</Text>
        </PressableScale>
        <Text style={styles.title} accessibilityRole="header">
          {t('crop.title')}
        </Text>
        <PressableScale
          style={[styles.barButton, styles.done]}
          onPress={done}
          disabled={!fit || busy}
          accessibilityRole="button"
        >
          <Text style={styles.doneText}>{t('crop.done')}</Text>
        </PressableScale>
      </View>

      <View
        style={styles.area}
        onLayout={(e) =>
          setArea({ width: e.nativeEvent.layout.width, height: e.nativeEvent.layout.height })
        }
      >
        <View
          style={[
            styles.photo,
            fit
              ? { left: fit.left, top: fit.top, width: fit.width, height: fit.height }
              : StyleSheet.absoluteFill,
          ]}
        >
          <Image
            source={{ uri }}
            style={StyleSheet.absoluteFill}
            contentFit="fill"
            onLoad={(e) => setPhoto({ width: e.source.width, height: e.source.height })}
            accessibilityIgnoresInvertColors
          />
          {fit && (
            <>
              <Animated.View style={[styles.shade, styles.shadeTop, shadeTop]} />
              <Animated.View style={[styles.shade, styles.shadeBottom, shadeBottom]} />
              <Animated.View style={[styles.shade, styles.shadeLeft, shadeLeft]} />
              <Animated.View style={[styles.shade, styles.shadeRight, shadeRight]} />
              <GestureDetector gesture={move}>
                <Animated.View style={[styles.frame, frame]}>
                  <GestureDetector gesture={corner(true, true)}>
                    <View style={[styles.handle, styles.topLeft]}>
                      <View style={[styles.bracket, styles.bracketTopLeft]} />
                    </View>
                  </GestureDetector>
                  <GestureDetector gesture={corner(false, true)}>
                    <View style={[styles.handle, styles.topRight]}>
                      <View style={[styles.bracket, styles.bracketTopRight]} />
                    </View>
                  </GestureDetector>
                  <GestureDetector gesture={corner(true, false)}>
                    <View style={[styles.handle, styles.bottomLeft]}>
                      <View style={[styles.bracket, styles.bracketBottomLeft]} />
                    </View>
                  </GestureDetector>
                  <GestureDetector gesture={corner(false, false)}>
                    <View style={[styles.handle, styles.bottomRight]}>
                      <View style={[styles.bracket, styles.bracketBottomRight]} />
                    </View>
                  </GestureDetector>
                </Animated.View>
              </GestureDetector>
            </>
          )}
        </View>
      </View>

      <Text style={styles.hint}>{t('crop.hint')}</Text>
    </View>
  );
}

// Corner brackets sit on the frame's corners: a handle is centred on the corner, its bracket
// starts LINE inside the handle's centre so the lines run along the frame's edges.
const INSET = HANDLE / 2 - LINE;

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: colors.text,
  },
  bar: {
    height: 52,
    paddingHorizontal: 12,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  barButton: {
    minHeight: 36,
    paddingHorizontal: 14,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cancel: {
    fontFamily: fonts.body,
    fontSize: 15,
    color: colors.onAccent,
  },
  title: {
    fontFamily: fonts.bodyMedium,
    fontSize: 15,
    color: colors.onAccent,
  },
  done: {
    backgroundColor: colors.bead,
  },
  doneText: {
    fontFamily: fonts.bodySemiBold,
    fontSize: 15,
    color: colors.onBead,
  },
  // Room around the photo so the corners can be reached at its edges.
  area: {
    flex: 1,
    margin: 28,
  },
  photo: {
    position: 'absolute',
  },
  shade: {
    position: 'absolute',
    backgroundColor: 'rgba(18, 18, 18, 0.62)',
  },
  shadeTop: {
    top: 0,
    left: 0,
    right: 0,
  },
  shadeBottom: {
    bottom: 0,
    left: 0,
    right: 0,
  },
  shadeLeft: {
    left: 0,
  },
  shadeRight: {
    right: 0,
  },
  frame: {
    position: 'absolute',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.onAccent,
  },
  handle: {
    position: 'absolute',
    width: HANDLE,
    height: HANDLE,
  },
  topLeft: { left: -HANDLE / 2, top: -HANDLE / 2 },
  topRight: { right: -HANDLE / 2, top: -HANDLE / 2 },
  bottomLeft: { left: -HANDLE / 2, bottom: -HANDLE / 2 },
  bottomRight: { right: -HANDLE / 2, bottom: -HANDLE / 2 },
  bracket: {
    position: 'absolute',
    width: BRACKET,
    height: BRACKET,
    borderColor: colors.ground,
  },
  bracketTopLeft: { left: INSET, top: INSET, borderTopWidth: LINE, borderLeftWidth: LINE },
  bracketTopRight: { right: INSET, top: INSET, borderTopWidth: LINE, borderRightWidth: LINE },
  bracketBottomLeft: {
    left: INSET,
    bottom: INSET,
    borderBottomWidth: LINE,
    borderLeftWidth: LINE,
  },
  bracketBottomRight: {
    right: INSET,
    bottom: INSET,
    borderBottomWidth: LINE,
    borderRightWidth: LINE,
  },
  hint: {
    paddingHorizontal: 24,
    fontFamily: fonts.body,
    fontSize: 13,
    lineHeight: 18,
    color: colors.onAccent,
    opacity: 0.75,
    textAlign: 'center',
  },
});
