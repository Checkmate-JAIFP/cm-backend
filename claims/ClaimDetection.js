const { z } = require("zod");
const { OpenAI } = require("openai");
const { zodResponseFormat } = require("openai/helpers/zod");


// Response object from OpenAI API call containing detected claims
const claimsObject = z.object({
  claims: z.array(z.string()),
});


// Claim detection over a single transcript sentence
module.exports.sentenceClaimDetection = async (sentence, context, openai_api_key) => {
  // Define prompt for OpenAI model to extract claims from a transcript sentence (with preceding context)
  const system_prompt = `
        You will be provided with a single input sentence from a transcript. Identify whether the sentence contains any factual claims, and extract them as quotes. Return any identified claims in an array.

        A claim is a checkable part of a sentence containing facts that can be verified and determined to be true or false. There are many different types of claims: claims about quantities (e.g. "GDP has risen by 5%"), claims about cause and effect (e.g. "this policy leads to economic growth"), historical claims (e.g. "the prime minister cut the education budget by £5bn in 2023"), or predictive claims about the future (e.g. "economists say this will cost working people $100 more per year").

        Only include factually verifiable claims, not opinion, speculation, or sarcasm. Claims should be an exact quote from the transcript. Do not rewrite any part of the text.

        A string of context will be provided that contains the sentences preceding the input sentence in the transcript. This context can be used to help identify claims in the input sentence.

        If the claim references a person, place, or object (e.g. "he said"), search through the context sentences to identify the subject being referenced (e.g. "Rishi Sunak"), and replace the reference within the claim with the named subject.

        Example 1:
         * Input sentence: "I tell you Stephen, this year alone 10,000 people have crossed on boats, that's a record number, so again, he's made a promise and he's completely failed to keep it."
         * Output claims: ["this year alone, 10,000 people have crossed on boats"]

        Example 2:
         * Input sentence: "We need to smash the gangs that are running this file trade making a huge amount of money."
         * Output claims: []

        Example 3:
         * Input sentence: "Donald Trump is unburdened unburdened by the truth. He said the neo nazi rally in Charlottesville was fabricated."
         * Output claims: ["Donald Trump said the neo nazi rally in Charlottesville was fabricated"]
    `;

  const user_prompt = `
        This is the input sentence from a transcript to extract claims from:
        ${sentence}

        This is the context of preceeding sentences:
        ${context}
    `;

  // Set up connection to OpenAI API
  let openai;
  try {
    openai = new OpenAI({ apiKey: openai_api_key });
  } catch (error) {
    console.error(`<!> ERROR: "${error.message}". Cannot set up OpenAI connection. <!>`);
    return [];
  }

  // Send prompt & retrieve response from OpenAI model
  let response;
  try {
    response = await openai.chat.completions.create({
      messages: [
        { role: "system", content: system_prompt },
        { role: "user", content: user_prompt },
      ],
      model: "gpt-4o",
      response_format: zodResponseFormat(claimsObject, "claims"),
    });
  } catch (error) {
    console.error(`<!> ERROR: "${error.message}". Cannot get response from OpenAI. <!>`);
    return [];
  }

  // Extract array of claims from OpenAI response
  let detected_claims = response.choices[0].message;

  if (detected_claims.refusal) {
    return [];
  } else {
    detected_claims = JSON.parse(detected_claims.content).claims;
    detected_claims = detected_claims.map(claim => claim.replace(/[.,!]$/, ''));
    return detected_claims;
  }
};
