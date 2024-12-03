const { getAuth } = require("../helper/awsauth");
const { sentenceClaimDetection } = require("../claims/ClaimDetection");
const { googleFactCheck } = require("../claims/GoogleFactCheck");
const { searchAndReview } = require("../claims/SearchAndReview");
const { factCheckDatabase } = require("../claims/FactCheckDatabase");
const { dynamoPutItem } = require("../helper/dynamo");
const util = require("util");

exports.detectClaims = async (event) => {
  // Get authentication keys for OpenAI model
  const auth = await getAuth();

  // Get sentence from input event
  const sentences = JSON.parse(event.Records[0].body);
  const sentenceObj = sentences.shift();

  if (!sentenceObj.text) {
    return false;
  }
  const sentence = sentenceObj.text.S;

  // Construct context of previous sentences
  let contextArray = [];
  for (const sentence of sentences) {
    contextArray.unshift(sentence.text.S);
  }
  const context = contextArray.join(" ");

  // Claim detection process
  const sentence_length = countWordsInSentence(sentence);
  if (sentence_length <= 3) {
    const putItem = {
      ...sentenceObj,
      projectId: { S: `${sentenceObj.projectId.S}` },
      sentenceNr: { N: `${Number(sentenceObj.sentenceNr.N)}` },
      text: { S: `${sentence}` },
      srcSeq: { N: `${Number(sentenceObj.srcSeq.N)}` },
      status: { S: "ok" },
    };
    await dynamoPutItem(putItem, process.env.CLAIM_TABLE);
    return true;
  }

  try {
    // Use OpenAI GPT model to detect & extract claims in the transcript
    let detected_claims = await sentenceClaimDetection(
      sentence,
      context,
      auth.OPENAI_API_KEY
    );

    // Check if any claims already attached to sentence (if re-running detection)
    let existing_claims = sentenceObj?.claim?.S;
    if (
      existing_claims &&
      existing_claims.includes("[") &&
      existing_claims.includes("]")
    ) {
      existing_claims = JSON.parse(existing_claims);
      existing_claims = existing_claims.filter(
        (claim) => !detected_claims.includes(claim)
      );
      detected_claims.unshift(...existing_claims);
    }

    if (detected_claims.length === 0) {
      const putItem = {
        ...sentenceObj,
        projectId: { S: `${sentenceObj.projectId.S}` },
        sentenceNr: { N: `${Number(sentenceObj.sentenceNr.N)}` },
        text: { S: `${sentence}` },
        srcSeq: { N: `${Number(sentenceObj.srcSeq.N)}` },
        status: { S: "ok" },
      };
      await dynamoPutItem(putItem, process.env.CLAIM_TABLE);
      return true;
    }

    // Add claims to the AWS claim database
    const putItem = {
      ...sentenceObj,
      projectId: { S: `${sentenceObj.projectId.S}` },
      sentenceNr: { N: `${Number(sentenceObj.sentenceNr.N)}` },
      text: { S: `${sentence}` },
      srcSeq: { N: `${Number(sentenceObj.srcSeq.N)}` },
      claim: { S: `${JSON.stringify(detected_claims)}` },
      status: { S: "ok" },
    };

    await dynamoPutItem(putItem, process.env.CLAIM_TABLE);
    return true;
  } catch (error) {
    console.error(
      `<!> ERROR: "${error.message}". Failed to detect claims in transcript. <!>`
    );
    return false;
  }
};

exports.factCheck = async (event) => {
  // Get authentication keys for Google API
  const auth = await getAuth();

  // Extract input claim and initialise fact-check structures
  const original_claim = event.queryStringParameters.claim;
  let claim = event.queryStringParameters.claim;
  const claim_speaker = event.queryStringParameters.speaker ?? "";
  let fact_check_service = event.queryStringParameters.service ?? "any";
  fact_check_service = fact_check_service.replaceAll(" ", "").toLowerCase();
  let fact_check = [];

  // Replace self references in the claim with the speaker's name (if known)
  if (claim_speaker !== "") {
    const first_person_speaker_terms = ["I", "We", "My", "Our"];

    for (let match_term of first_person_speaker_terms) {
      match_term = `${match_term} `;
      let speaker_term = claim_speaker;

      if (match_term === "My" || match_term === "Our") {
        speaker_term = `${speaker_term}'s `;
      } else {
        speaker_term = `${speaker_term} `;
      }

      claim = claim.replace(match_term, speaker_term);
      if (claim.startsWith(match_term.toLowerCase())) {
        claim = claim.replace(match_term.toLowerCase(), speaker_term);
      }

      match_term = ` ${match_term}`;
      speaker_term = ` ${speaker_term}`;

      claim = claim.replace(match_term, speaker_term);
      claim = claim.replace(match_term.toLowerCase(), speaker_term);
    }

    if (claim !== original_claim) {
      console.log(`Claim reformatted with speaker: "${claim}"`);
    }
  }

  // Pass input claim to the automated fact-checking process
  if (
    fact_check_service === "googlefactcheck" ||
    fact_check_service === "google"
  ) {
    // Use Google Fact Check to verify claim
    console.log("Using 'Google Fact Check' to fact-check claim.");

    try {
      fact_check = await googleFactCheck(
        claim,
        auth.GOOGLE_API_KEY,
        auth.OPENAI_API_KEY
      );
    } catch (error) {
      console.error(
        `<!> ERROR: "${error.message}". Failed to fact-check claim using 'Google Fact Check'. <!>`
      );
    }
  } else if (
    fact_check_service === "factcheckdatabase" ||
    fact_check_service === "database"
  ) {
    // Use own fact check database to verify claim
    console.log("Using 'Fact Check Database' to fact-check claim.");

    try {
      fact_check = await factCheckDatabase(claim, auth.OPENAI_API_KEY);
    } catch (error) {
      console.error(
        `<!> ERROR: "${error.message}". Failed to fact-check claim using 'Fact Check Database'. <!>`
      );
    }
  } else if (
    fact_check_service === "searchandreview" ||
    fact_check_service === "search&review" ||
    fact_check_service === "search"
  ) {
    // Use Search and Review method to verify claim
    console.log("Using 'Search & Review' to fact-check claim.");

    try {
      fact_check = await searchAndReview(
        claim,
        auth.GOOGLE_API_KEY,
        auth.GOOGLE_SEARCH_ENGINE_ID,
        auth.OPENAI_API_KEY,
        auth.NEWSCATCHER_API_KEY
      );
    } catch (error) {
      console.error(
        `<!> ERROR: "${error.message}". Failed to fact-check claim using 'Search and Review'. <!>`
      );
    }
  } else if (fact_check_service === "any" || fact_check_service === "all") {
    // Use exhaustive fact-check pipeline that combines all preceding methods to check a claim
    // Initially try primary check method: fact-check database
    console.log("Trying primary check service: Fact Check Database");
    try {
      fact_check = await factCheckDatabase(claim, auth.OPENAI_API_KEY);
    } catch (error) {
      console.error(
        `<!> ERROR: "${error.message}". Failed to fact-check claim using 'Fact Check Database'. <!>`
      );
    }

    // If no fact-check found, fall back to secondary check method
    if (fact_check.length === 0) {
      // Secondary check method: google fact check
      console.log("Trying secondary check service: Google Fact Check");
      try {
        fact_check = await googleFactCheck(
          claim,
          auth.GOOGLE_API_KEY,
          auth.OPENAI_API_KEY
        );
      } catch (error) {
        console.error(
          `<!> ERROR: "${error.message}". Failed to fact-check claim using 'Google Fact Check'. <!>`
        );
      }

      // If no fact-check found, fall back to tertiary check method
      if (fact_check.length === 0) {
        // Tertiary check method: search & review
        console.log("Trying tertiary check service: Search & Review");
        try {
          fact_check = await searchAndReview(
            claim,
            auth.GOOGLE_API_KEY,
            auth.GOOGLE_SEARCH_ENGINE_ID,
            auth.OPENAI_API_KEY,
            auth.NEWSCATCHER_API_KEY
          );
        } catch (error) {
          console.error(
            `<!> ERROR: "${error.message}". Failed to fact-check claim using 'Search and Review'. <!>`
          );
        }
      }
    }
  }

  // Format fact-check response to server
  const fact_checked_claim = {
    transcriptClaim: original_claim,
    factCheckResults: fact_check,
  };

  console.log(
    "Fact check result:",
    util.inspect(fact_checked_claim, {
      showHidden: false,
      depth: null,
      colors: false,
    })
  );

  const response = {
    statusCode: 200,
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Credentials": true,
    },
    body: JSON.stringify(fact_checked_claim),
  };

  return response;
};

const countWordsInSentence = (sentence) => {
  const no_words = sentence.trim().split(/\s+/).length;
  return no_words;
};
