import {
  AutoProcessor,
  env,
  RawImage,
  SiglipVisionModel,
  type Tensor,
} from "@huggingface/transformers";
import { EMBEDDING_MODEL } from "./embedding-model";

// Marqo-FashionSigLIP: a SigLIP model fine-tuned on fashion products (Apache 2.0). It runs
// locally in the worker through ONNX Runtime, so embedding a photo costs nothing per call.
// The 8-bit quantized weights (~90 MB for images) rank as well as full precision on our
// test photos at a third of the time (~70 ms a photo on a laptop CPU).

// Every embedding goes through a module like this one, so tests swap in a stub and never load
// the model.
export interface ItemEmbedder {
  // A unit-length vector: cosine similarity between two photos is their dot product.
  embedImage(image: Uint8Array): Promise<number[]>;
}

type Loaded = {
  processor: Awaited<ReturnType<typeof AutoProcessor.from_pretrained>>;
  vision: SiglipVisionModel;
};

// Downloads the weights into cacheDir the first time, then loads them from there.
export function createFashionSiglipEmbedder(cacheDir: string): ItemEmbedder {
  let loading: Promise<Loaded> | undefined;

  // Loaded once, on the first job, and shared by every job after it. A failed load (no network
  // on the first run) is forgotten, so the job's retry tries again.
  function load() {
    loading ??= (async () => {
      env.cacheDir = cacheDir;
      const [processor, vision] = await Promise.all([
        AutoProcessor.from_pretrained(EMBEDDING_MODEL),
        SiglipVisionModel.from_pretrained(EMBEDDING_MODEL, { dtype: "q8" }),
      ]);
      return { processor, vision };
    })().catch((error: unknown) => {
      loading = undefined;
      throw error;
    });
    return loading;
  }

  return {
    async embedImage(image) {
      const { processor, vision } = await load();
      const raw = await RawImage.fromBlob(new Blob([image]));
      // The model call is typed loosely by the library; SigLIP's vision model returns image_embeds.
      const output = (await vision(await processor(raw))) as { image_embeds: Tensor };
      return (output.image_embeds.normalize().tolist() as number[][])[0]!;
    },
  };
}
