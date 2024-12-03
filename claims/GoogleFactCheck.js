const axios = require("axios");
const { getClaimSimilarities } = require("./embeddings");


module.exports.googleFactCheck = async (claim_text, google_fact_check_api_key, openai_api_key) => {
    // Parameters and variables
    let generate_similarity_scores = false;

    // Call Google Fact Check API to match input claim to known fact-checked claims
    const claim_language = "en";
    const fact_check_api = "https://factchecktools.googleapis.com/v1alpha1/claims:search";

    const params = {
        key: google_fact_check_api_key,
        languageCode: claim_language,
        query: claim_text
    };

    let response;
    try {
        response = await axios.get(fact_check_api, {params});
    } catch (error) {
        console.error(
            `<!> ERROR: "${error.message}". Google Fact Check API call failed. <!>`
          );
          return [];
    }
    response = response.data;

    if (Object.keys(response).length === 0) {
        return [];
    }

    // Generate 'similarity score' between input claim and matched claims
    let fact_checked_claims = response['claims'];

    if (generate_similarity_scores) {
        // Get score
        const matched_claims = fact_checked_claims.map(result => result.text);

        const claim_similarities = await getClaimSimilarities(claim_text, matched_claims, openai_api_key);

        // Add score to claim object
        fact_checked_claims = fact_checked_claims.map((result, index) => {
            result.similarity_score = claim_similarities[index];
            return result;
        });

        // Sort claims by score
        fact_checked_claims.sort((result_1, result_2) => result_2.similarity_score - result_1.similarity_score);
    }

    // Constrict output to only top 3 sources
    if (fact_checked_claims.length > 3) {
        fact_checked_claims = fact_checked_claims.slice(0, 3);
    }

    // Extract relevant fact-check info from response and format into output data structure
    const rating_terms_mapping = {
        "Pants on Fire": "False",
        "One Pinocchio": "Mostly true: some omissions and exaggerations, but no outright falsehoods.",
        "Two Pinocchios": "Half true: significant omissions and/or exaggerations.",
        "Three Pinocchios": "Mostly false: significant factual error and/or obvious contradictions.",
        "Four Pinocchios": "False",
        "Geppetto Checkmark": "True",
        "Verdict Pending": "Verdict pending: judgement cannot be fully rendered"
    }

    let fact_check_output = [];

    for (const result of fact_checked_claims) {
        // Format fact-check results
        result.claimReview = result.claimReview.map(review => {
            // Replace vaguage ratings
            if (rating_terms_mapping.hasOwnProperty(review.textualRating)) {
                review.textualRating = rating_terms_mapping[review.textualRating];
            }

            // Replace null publishers
            if (!review.publisher.name) {
                const article_url = new URL(matched_claim_data.url.S);
                review.publisher.name = article_url.hostname.replace('www.', '');
            }

            return review;
        })

        // Output object of fact-check process per response to the claim
        let fact_check_object = {
            factCheckMethod: "Google Fact Check",
            matchedClaim: result.text,
            claimSimilarity: "None",
            matchedClaimSpeaker: result.claimant,
            publishingDate: "None",
            claimReview: result.claimReview
        };

        // Add associated similary score of matched claim
        if (generate_similarity_scores) {
            fact_check_object.claimSimilarity = result.similarity_score;
        }

        fact_check_output.push(fact_check_object);
    }

    // Constrict output to only top 3 sources
    if (fact_checked_claims.length > 3) {
        fact_checked_claims = fact_checked_claims.slice(0, 3);
    }

    return fact_check_output;
};
