const { OpenAI } = require("openai");
const getEmbeddingSimilarity = require("compute-cosine-similarity");


// Generate a single embedding vector of a text string
const getEmbedding = async (input_text, openai_connection) => {
    input_text = input_text.replace("\n", " ");

    let embedding = await openai_connection.embeddings.create({
        model: "text-embedding-3-small",
        input: input_text,
        encoding_format: "float",
        dimensions: 256
    });

    embedding = embedding.data[0].embedding;

    return embedding;
}


// Generate multiple embedding vectors of multiple text strings
const getMultipleEmbeddings = async (input_text_array, openai_connection) => {
    let embeddings = await openai_connection.embeddings.create({
        model: "text-embedding-3-small",
        input: input_text_array,
        encoding_format: "float",
        dimensions: 256
    });

    embeddings = embeddings.data.map(resp_object => resp_object.embedding);

    return embeddings;
}


// Get the similarity score of two text strings using embeddings
const getTextSimilarity = async (input_text_1, input_text_2, openai_api_key) => {
    // Set up connection to OpenAI API embedding model
    let openai;
    try {
        openai = new OpenAI({ apiKey: openai_api_key });
    } catch (error) {
        console.error(`<!> ERROR: "${error.message}". Cannot set up OpenAI connection. <!>`);
        return 0;
    }

    // Get embedding vectors
    let embedding_1 = await getEmbedding(input_text_1, openai);
    let embedding_2 = await getEmbedding(input_text_2, openai);

    // Calculate similarity
    let similarity_score = getEmbeddingSimilarity(embedding_1, embedding_2);

    return similarity_score;
}


// Get the similarity score of two text strings using embeddings
const getClaimSimilarities = async (input_claim, claim_array, openai_api_key) => {
    // Set up connection to OpenAI API embedding model
    let openai;
    try {
        openai = new OpenAI({ apiKey: openai_api_key });
    } catch (error) {
        console.error(`<!> ERROR: "${error.message}". Cannot set up OpenAI connection. <!>`);
        return [];
    }

    const text_to_embed = [input_claim, ...claim_array];

    const all_embeddings = await getMultipleEmbeddings(text_to_embed, openai);
    const input_claim_embedding = all_embeddings[0];
    const claim_array_embeddings = all_embeddings.slice(1)

    // Compute similarity score between claim and article
    const similarity_scores = claim_array_embeddings.map(embedding => Number((100 * getEmbeddingSimilarity(input_claim_embedding, embedding)).toFixed(2)));

    return similarity_scores;
}


module.exports = {
    getEmbedding,
    getMultipleEmbeddings,
    getEmbeddingSimilarity,
    getClaimSimilarities,
    getTextSimilarity
}
