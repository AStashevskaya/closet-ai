// Which model makes the embeddings, kept apart from the model code so the database schema can
// import the dimensions without loading ONNX Runtime. Changing the model means a new column
// size and re-embedding every photo.
export const EMBEDDING_MODEL = "Marqo/marqo-fashionSigLIP";
export const EMBEDDING_DIMENSIONS = 768;
