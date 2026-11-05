// Downloads both embedding models into MODEL_CACHE_DIR while the Docker image is built.
import sharp from "sharp";
import { createFashionSiglipEmbedder } from "../ai/item-embedder";

const embedder = createFashionSiglipEmbedder(process.env.MODEL_CACHE_DIR ?? ".models");
const white = await sharp({
  create: { width: 32, height: 32, channels: 3, background: "white" },
})
  .png()
  .toBuffer();
await embedder.embedImage(white);
await embedder.embedText("white cotton shirt");
console.log("embedding models ready");
process.exit(0);
