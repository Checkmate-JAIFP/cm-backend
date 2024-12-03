const { OpenAI } = require("openai");
const { dynamoScan, dynamoQuery, dynamoUpdate } = require("../helper/dynamo");
const { getEmbedding, getEmbeddingSimilarity } = require("./embeddings");

// Search a proprietary database of known fact-checks for an input claim
module.exports.factCheckDatabase = async (input_claim, openai_api_key) => {
  // Set up connection to OpenAI API embedding model
  let openai;
  try {
    openai = new OpenAI({ apiKey: openai_api_key });
  } catch (error) {
    console.error(
      `<!> ERROR: "${error.message}". Cannot set up OpenAI connection. <!>`
    );
    return [];
  }

  // Get fact-check database from AWS
  let queryParams = {
    TableName: process.env.FACT_CHECK_TABLE,
    ProjectionExpression: "#claimID, #claim, #embedding",
    ExpressionAttributeNames: {
      "#claimID": "claimID",
      "#claim": "claim",
      "#embedding": "embedding",
    },
    Select: "SPECIFIC_ATTRIBUTES",
  };

  let aws_table_data;
  try {
    aws_table_data = await dynamoScan(queryParams);
    aws_table_data = aws_table_data.Items;
  } catch (error) {
    console.error(
      `<!> ERROR: "${error.message}". Cannot connect to fact-check database. <!>`
    );
    return [];
  }

  // Get claim embeddings from database or generate via OpenAI
  const regenerate_embeddings = false;
  let claim_embeddings = [];

  for (const row of aws_table_data) {
    let embedding = [];

    if (!regenerate_embeddings && row.embedding && row.embedding.S !== "") {
      // Get embedding from database for this claim
      embedding = JSON.parse(row.embedding.S);
    } else {
      // Generate new embedding
      try {
        embedding = await getEmbedding(row.claim.S, openai);
      } catch (error) {
        console.error(
          `<!> ERROR: "${error.message}". Cannot generate embeddings. <!>`
        );
        return [];
      }

      // Add new embedding to database
      queryParams = {
        ExpressionAttributeNames: {
          "#embedding": "embedding",
        },
        ExpressionAttributeValues: {
          ":e": { S: JSON.stringify(embedding) },
        },
        Key: {
          claimID: row.claimID,
        },
        ReturnValues: "ALL_NEW",
        TableName: process.env.FACT_CHECK_TABLE,
        UpdateExpression: "SET #embedding = :e",
      };

      try {
        await dynamoUpdate(queryParams);
      } catch (error) {
        console.error(
          `<!> ERROR: "${error.message}". Cannot update fact-check database. <!>`
        );
        return [];
      }
    }

    claim_embeddings.push(embedding);
  }

  let input_embedding;
  try {
    input_embedding = await getEmbedding(input_claim, openai);
  } catch (error) {
    console.error(
      `<!> ERROR: "${error.message}". Cannot generate embeddings. <!>`
    );
    return [];
  }

  // Generate similarity scores between input claim and all claims in database
  let similarity_scores = claim_embeddings.map((embedding) =>
    getEmbeddingSimilarity(input_embedding, embedding)
  );

  // Match the input claim to database claim with maximum similarity score (above threshold)
  const match_threshold = 0.6;
  const max_similarity = Math.max(...similarity_scores);

  if (max_similarity < match_threshold) {
    return [];
  }

  const max_index = similarity_scores.indexOf(max_similarity);
  const matched_claim_id = aws_table_data[max_index].claimID;

  // Retrive fact-check data associated with the matched claim from fact-check database
  queryParams = {
    TableName: process.env.FACT_CHECK_TABLE,
    KeyConditionExpression: "#claimID = :claimID",
    ExpressionAttributeValues: {
      ":claimID": matched_claim_id,
    },
    ExpressionAttributeNames: { "#claimID": "claimID" },
    ScanIndexForward: false,
  };

  let matched_claim_data;
  try {
    matched_claim_data = await dynamoQuery(queryParams);
  } catch (error) {
    console.error(
      `<!> ERROR: "${error.message}". Cannot connect to fact-check database. <!>`
    );
    return [];
  }
  matched_claim_data = matched_claim_data.Items[0];

  // Format fact-check data into output data structure
  const article_url = new URL(matched_claim_data.url.S);
  const publisher_url_href = article_url.origin;
  const publisher_name = article_url.hostname.replace("www.", "");

  // reviewArticleExtract: "None"
  const fact_check_results = [
    {
      factCheckMethod: "Fact check database",
      matchedClaim: matched_claim_data.claim?.S,
      claimSimilarity: Number((100 * max_similarity).toFixed(2)),
      matchedClaimSpeaker: matched_claim_data.speaker?.S,
      publishingDate: matched_claim_data.publishingDate?.S ?? "None",
      claimReview: [
        {
          publisher: {
            name: publisher_name,
            site: publisher_url_href,
          },
          url: article_url.href,
          title: matched_claim_data.title?.S,
          textualRating: matched_claim_data.textualRating?.S,
          languageCode: matched_claim_data.languageCode?.S,
        },
      ],
    },
  ];

  return fact_check_results;
};
