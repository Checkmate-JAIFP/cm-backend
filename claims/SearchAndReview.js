const { z } = require("zod");
const axios = require("axios");
const extractor = require("unfluff");
const { OpenAI } = require("openai");
const { zodResponseFormat } = require("openai/helpers/zod");
const {
  getEmbedding,
  getMultipleEmbeddings,
  getEmbeddingSimilarity,
} = require("./embeddings");
const { XMLParser } = require("fast-xml-parser");
const { JSDOM } = require("jsdom");

// List of supported sources to find fact-check articles
const SOURCE_WHITE_LIST = [
  "bbc.co.uk",
  "bbc.com",
  "reuters.com",
  "news.sky.com",
  "channel4.com",
  "itv.com",
  "theguardian.com",
  "thetimes.com",
  "economist.com",
  "uk.news.yahoo.com",
  "independent.co.uk",
  "ft.com",
  "gov.uk",
  "fullfact.org",
  "factcheck.org",
  "pbs.org",
  "wsj.com",
  "abcnews.go.com",
  "apnews.com",
  "cbsnews.com",
];

// Response object from OpenAI API call containing a claim review
const claimReviewObject = z.object({
  article_section: z.string(),
  summary: z.string(),
  speaker: z.string(),
});

module.exports.searchAndReview = async (
  claim_text,
  google_api_key,
  google_search_id,
  openai_api_key,
  newscatcher_api_key,
  sources
) => {
  /**
   * Search for relevant articles and use to fact-check claim, using Google Search and an OpenAI model
   */
  // Parameters and variables
  sources = sources ?? SOURCE_WHITE_LIST;
  const generate_similarity_scores = true;
  const article_similarity_threshold = 40;

  // NewsCatcher API: send search query to find contextual article URLs and their contents
  let contextual_articles = await searchNewsCatcher(
    claim_text,
    newscatcher_api_key,
    sources
  );

  // Setup OpenAI model connection
  let openai;
  try {
    openai = new OpenAI({ apiKey: openai_api_key });
  } catch (error) {
    console.error(
      `<!> ERROR: "${error.message}". Cannot set up OpenAI connection. <!>`
    );
    return [];
  }

  // Generate similarity scores between claim and matched fact-check articles
  let claim_embedding;
  let similarity_scores;
  if (generate_similarity_scores) {
    // Get embedding of input claim to facilitate generation of similarity scores
    claim_embedding = await getEmbedding(claim_text, openai);

    // Get embeddings of matched articles
    if (contextual_articles.length > 0) {
      const article_descriptions = contextual_articles.map(
        (article) => article.description
      );
      const article_embeddings = await getMultipleEmbeddings(
        article_descriptions,
        openai
      );

      // Compute similarity score between claim and article
      similarity_scores = article_embeddings.map((embedding) =>
        Number(
          (100 * getEmbeddingSimilarity(claim_embedding, embedding)).toFixed(2)
        )
      );
    }
  }

  // NewsCatcher API: review contents of found articles using OpenAI model & fact-check the claim
  let fact_checked_claims = [];

  for (let index = 0; index < contextual_articles.length; index++) {
    const article = contextual_articles[index];
    const article_text = article.text;
    const article_url = new URL(article.url);

    const fact_check = await reviewClaimAgainstArticle(
      claim_text,
      article_text,
      openai
    );

    // If fact-checked, add to collection
    if (
      fact_check.summary !== "None" ||
      fact_check.article_section !== "None"
    ) {
      const publisher_url_href = article_url.origin;
      const publisher_name =
        article.publisher ?? article_url.hostname.replace("www.", "");

      let publish_date = new Date(article.date);
      publish_date = publish_date.toDateString();

      // const relevant_article_section = fact_check.article_section.replace(/<[^>]*>/g, '').replace(/[^\x00-\x7F]/g, '');
      // reviewArticleExtract: relevant_article_section

      let fact_check_result = {
        factCheckMethod: "Search & Review (NewsCatcher & OpenAI)",
        matchedClaim: article.title,
        claimSimilarity: "None",
        matchedClaimSpeaker: fact_check.speaker,
        publishingDate: publish_date,
        claimReview: [
          {
            publisher: {
              name: publisher_name,
              site: publisher_url_href,
            },
            url: article_url.href,
            title: article.title,
            textualRating: fact_check.summary,
            languageCode: article.lang,
          },
        ],
      };

      // Add similarity score between claim and matched article
      if (generate_similarity_scores) {
        fact_check_result.claimSimilarity = similarity_scores[index];
      }

      // Constrict output to only return relevant articles
      fact_checked_claims.push(fact_check_result);
    }
  }

  // Google News feed: if no relevant articles found using NewsCatcher, also check the Google News RSS feed
  if (fact_checked_claims.length === 0) {
    // Fetch contextual article URLs to input claim using Google News RSS feed
    let response_articles = await searchGoogleNews(claim_text, sources);

    // Generate similarity scores between claim and matched fact-check articles
    if (generate_similarity_scores && response_articles.length > 0) {
      // Get embeddings of matched articles
      const article_descriptions = response_articles.map(
        (article) => article.description
      );
      const article_embeddings = await getMultipleEmbeddings(
        article_descriptions,
        openai
      );

      // Compute similarity score between claim and article
      similarity_scores = article_embeddings.map((embedding) => {
        return Number(
          (100 * getEmbeddingSimilarity(claim_embedding, embedding)).toFixed(2)
        );
      });

      // Add similarity scores to articles
      response_articles = response_articles.map((article, index) => {
        article.similarity = similarity_scores[index];
        return article;
      });

      // Only use top 3 articles from feed
      if (response_articles.length > 3) {
        response_articles.sort(
          (article_1, article_2) =>
            article_2.claimSimilarity - article_1.claimSimilarity
        );
        response_articles = response_articles.slice(0, 3);
      }
    }

    // Format claim & article as fact-check object
    for (const article of response_articles) {
      // Extract news article URL from Google News source
      let decoded_article_source = await decodeGoogleNewsURL(article.url);

      // Get contents of news article and enact review process
      let matched_claim_speaker = "None";
      let textual_rating = "None";
      // let review_article_extract = "None";

      if (decoded_article_source.status) {
        // Get article contents using source URL
        const article_contents = await getArticleContents(
          decoded_article_source.url
        );

        // Review contents of articles found during search using OpenAI model
        if (article_contents.status) {
          const fact_check = await reviewClaimAgainstArticle(
            claim_text,
            article_contents.text,
            openai
          );
          matched_claim_speaker = fact_check.speaker;
          textual_rating = fact_check.summary;
          // review_article_extract = fact_check.article_section.replace(/<[^>]*>/g, '').replace(/[^\x00-\x7F]/g, '');
        }
      }

      let publish_date = new Date(article.date);
      publish_date = publish_date.toDateString();

      // Format fact-check object
      // reviewArticleExtract: review_article_extract
      let fact_check_result = {
        factCheckMethod: "Search & Review (Google News)",
        matchedClaim: article.title,
        claimSimilarity: article.similarity ?? "None",
        matchedClaimSpeaker: matched_claim_speaker,
        publishingDate: publish_date,
        claimReview: [
          {
            publisher: article.publisher,
            url: decoded_article_source.url ?? article.url,
            title: article.title,
            textualRating: textual_rating,
            languageCode: "en",
          },
        ],
      };

      // Constrict output to only return relevant articles
      if (
        textual_rating !== "None" ||
        fact_check_result.claimSimilarity === "None" ||
        fact_check_result.claimSimilarity > article_similarity_threshold
      ) {
        fact_checked_claims.push(fact_check_result);
      }
    }
  }

  // Sort fact-check articles by similarity with claim
  if (generate_similarity_scores) {
    fact_checked_claims.sort(
      (result_1, result_2) =>
        result_2.claimSimilarity - result_1.claimSimilarity
    );
  }

  // Constrict output to only top 3 sources
  if (fact_checked_claims.length > 3) {
    fact_checked_claims = fact_checked_claims.slice(0, 3);
  }

  return fact_checked_claims;
};

const searchNewsCatcher = async (input_claim, newscatcher_api_key, sources) => {
  /**
   * Search NewsCatcher API for article URLs and content relating to a claim
   * https://docs.newscatcherapi.com/api-docs/endpoints-1/search-news
   */
  const news_search_url = "https://v3-api.newscatcherapi.com/api/search";

  const config = {
    headers: {
      "x-api-token": newscatcher_api_key,
    },
    params: {
      q: input_claim,
      page_size: 5,
      sources: sources.join(","),
      search_in: "title,content",
    },
  };

  // Get response from NewsCatcher
  let response = [];
  try {
    response = await axios.get(news_search_url, config);
  } catch (error) {
    console.error(
      `<!> ERROR: "${error.message}". NewsCatcher API call failed. <!>`
    );
    return [];
  }

  if (response.status !== 200) {
    console.error(
      `<!> ERROR: "${response.status}". NewsCatcher API call failed. <!>`
    );
    return [];
  }

  if (Object.keys(response.data).length === 0) {
    return [];
  }

  // Parse response and extract article contents
  const article_contents_responses = response.data.articles;
  let fact_check_articles = [];

  for (const article of article_contents_responses) {
    const article_info = {
      url: article.link,
      title: article.title,
      date: article.published_date,
      publisher: article.name_source,
      lang: article.language,
      description: article.description,
      text: article.content,
    };

    fact_check_articles.push(article_info);
  }

  return fact_check_articles;
};

const searchGoogleNews = async (input_claim, sources) => {
  /**
   * Search Google News RSS feed for article URLs relating to a claim
   * https://www.newscatcherapi.com/blog/google-news-rss-search-parameters-the-missing-documentaiton#toc-8
   */
  // Parameters and variables
  const restrict_sources = true;
  const restrict_date = false;

  const news_search_url = "https://news.google.com/rss/search";
  const hl = "en-GB";
  const gl = "GB";
  const ceid = "GB:en";
  const lang_params = `hl=${hl}&gl=${gl}&ceid=${ceid}`;
  const time_threshold = "1m";

  // Format search request with parameters (query / date / sources)
  const search_query = input_claim
    .replace(/[.,!]$/, "")
    .replaceAll(" ", "+AND+");
  let query_url = news_search_url + `?${lang_params}&q=${search_query}`;

  if (restrict_date) {
    query_url += `+when:${time_threshold}`;
  }

  if (restrict_sources) {
    for (let index = 0; index < sources.length; index++) {
      let source_name = sources[index];
      source_name = source_name.replaceAll(" ", "").toLowerCase();

      let new_source_code = `+inurl:${source_name}`;
      if (index !== 0) {
        new_source_code = "+OR" + new_source_code;
      }

      query_url += new_source_code;
    }
  }

  // Send request to Google News and get response
  let response = [];
  try {
    response = await axios.get(query_url);
  } catch (error) {
    console.error(
      `<!> ERROR: "${error.message}". Google News call failed. <!>`
    );
    return [];
  }

  if (response.status !== 200) {
    console.error(
      `<!> ERROR: "${response.status}". Google News API call failed. <!>`
    );
    return [];
  }

  if (Object.keys(response.data).length === 0) {
    return [];
  }

  // Parse response to get top article links
  const xml_options = {
    ignoreAttributes: false,
    attributeNamePrefix: "@",
  };
  const feed_parser = new XMLParser(xml_options);
  let feed_data = feed_parser.parse(response.data);
  feed_data = feed_data.rss.channel.item;

  if (typeof feed_data === "undefined") {
    console.error(`<!> No articles returned by Google News. <!>`);
    return [];
  }

  if (!Array.isArray(feed_data)) {
    feed_data = [feed_data];
  }

  // Format output article object structure
  let output_article_data = feed_data.filter((search_result) =>
    sources.includes(
      search_result.source["@url"].replace("https://", "").replace("www.", "")
    )
  );

  if (output_article_data.length > 5) {
    output_article_data = output_article_data.slice(0, 5);
  }

  output_article_data = output_article_data.map((search_result) => {
    return {
      title: search_result.title,
      url: search_result.link.split("?")[0],
      date: search_result.pubDate,
      publisher: {
        name: search_result.source["#text"],
        site: search_result.source["@url"],
      },
      description: search_result.description
        .replace(/<[^>]*>/g, "")
        .replace(/[^\x00-\x7F]/g, "")
        .split("&nbsp;")[0],
    };
  });

  return output_article_data;
};

const decodeGoogleNewsURL = async (input_url) => {
  // Get base64 string
  const url = new URL(input_url);
  const path = url.pathname.split("/");

  let base64Str;
  if (
    url.hostname === "news.google.com" &&
    path.length > 1 &&
    ["articles", "read"].includes(path[path.length - 2])
  ) {
    base64Str = path[path.length - 1];
  } else {
    console.error(
      `<!> ERROR. Decoding article URL from Google News failed. <!>`
    );
    return {
      status: false,
    };
  }

  // Get decoding parameters
  const decoding_article_url = `https://news.google.com/rss/articles/${base64Str}`;
  let decodingTimestamp;
  let decodingSignature;

  try {
    const response = await axios.get(decoding_article_url);
    const dom = new JSDOM(response.data);
    const dataElement = dom.window.document.querySelector(
      "c-wiz > div[jscontroller]"
    );
    if (dataElement) {
      decodingTimestamp = dataElement.getAttribute("data-n-a-ts");
      decodingSignature = dataElement.getAttribute("data-n-a-sg");
    } else {
      console.error(
        `<!> ERROR. Decoding article URL from Google News failed. <!>`
      );
      return {
        status: false,
      };
    }
  } catch (error) {
    console.error(
      `<!> ERROR: "${error.message}". Decoding article URL from Google News failed. <!>`
    );
    return {
      status: false,
    };
  }

  // Decode URL
  const batch_execute_url =
    "https://news.google.com/_/DotsSplashUi/data/batchexecute";
  const payload = [
    "Fbv4je",
    `["garturlreq", [["X", "X", ["X", "X"], null, null, 1, 1, "US:en", null, 1, null, null, null, null, null, 0, 1], "X", "X", 1, [1, 1, 1], 1, 1, null, 0, 0, null, 0], "${base64Str}", ${decodingTimestamp}, "${decodingSignature}"]`,
  ];
  const headers = {
    "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8",
    "User-Agent":
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36",
  };

  let decoded_url;
  try {
    const response = await axios.post(
      batch_execute_url,
      `f.req=${encodeURIComponent(JSON.stringify([[payload]]))}`,
      { headers }
    );
    const data = response.data.split("\n\n")[1];
    const parsedData = JSON.parse(data)[0][2];
    decoded_url = JSON.parse(parsedData)[1];
  } catch (error) {
    console.error(
      `<!> ERROR: "${error.message}". Decoding article URL from Google News failed. <!>`
    );
    return {
      status: false,
    };
  }

  return {
    status: true,
    url: decoded_url,
  };
};

const searchGoogle = async (input_claim, google_api_key, google_search_id) => {
  /**
   * Search Google for article URLs relating to a claim
   */
  // Parameters & variables
  const ui_language = "en";
  const search_language = `lang_${ui_language}`;
  const num_search_results = 5;
  const google_search_api = "https://www.googleapis.com/customsearch/v1";

  const params = {
    num: num_search_results,
    hl: ui_language,
    lr: search_language,
    key: google_api_key,
    cx: google_search_id,
    q: input_claim,
  };

  // Send request to Google Search API and get response
  let response = [];

  try {
    response = await axios.get(google_search_api, { params });
  } catch (error) {
    console.error(
      `<!> ERROR: "${error.message}". Google Search API call failed. <!>`
    );
    return [];
  }

  if (response.status !== 200) {
    console.error(
      `<!> ERROR: "${response.status}". Google Search API call failed. <!>`
    );
    return [];
  }

  if (Object.keys(response.data).length === 0) {
    return [];
  }

  // Parse response to get top article links
  let output_article_links = response.data.items.map(
    (search_result) => search_result.link
  );

  return output_article_links;
};

const getArticleContents = async (article_url) => {
  /**
   * Extract contents of an article given its URL
   */
  // Retrieve article contents from webpage URL
  let response;
  try {
    response = await axios.get(article_url);
  } catch (error) {
    console.error(
      `<!> ERROR: "${error.message}". Cannot get article at URL "${article_url}". <!>`
    );
    return {
      status: false,
    };
  }

  // Skip erroneous article responses
  if (typeof response === "undefined" || response.status !== 200) {
    return {
      status: false,
    };
  }

  // Extract contents from article
  let article_contents;
  try {
    article_contents = extractor(response.data);
  } catch (error) {
    console.error(
      `<!> ERROR: "${error.message}". Cannot extract article at URL "${article.config.url}". <!>`
    );
    return {
      status: false,
    };
  }

  return {
    status: true,
    text: article_contents.text,
  };
};

const reviewClaimAgainstArticle = async (
  claim_text,
  article_text,
  openai_connection
) => {
  /**
   * Review article for presence of claim and use to fact-check the claim (using OpenAI)
   */
  // Define prompt to cross-reference article contents with the claim to fact-check it
  const system_prompt = `
        I will provide you with a single fact-checkable claim and the contents of a news article.

        Firstly, read the contents of the article. Locate and extract the section of the text that discusses the claim and provides evidence for or against the factuality of the claim. The may not be expicitly discussed within the article, or the article may be irrelevant, in which case no section of the text should be extracted.

        If a relevant section is located that evidences the claim, return the text of the section in the response field 'article_section' as a string. Provide the exact extract text, do not rewrite any part of the section. If no relevant section is found in the article, the 'article_section' field should be output with the value 'None'.

        Secondly, if a relevant section is located, generate a single sentence summary of the section (from output field 'article_section') that contains all the relevant information in that section of text that provides evidence on the factuality of the input claim. This should be returned in the output field 'summary'. If no relevant article section was found in the first step, the 'summary' field should be output with the value 'None'.

        Thirdly, if the article section states who originally said the input claim that is being discussed, output their name in as the 'speaker' field. If the speaker is not definitively given, the 'speaker' field should be output as 'None'.

        The output structure:
            - 'article_section': The relevant section of the article text that evidences the input claim, or 'None' if no relevant section is found.
            - 'summary': A single sentence summary of the evidence provided about the factuality of the input claim in the above article section, or 'None' if no relevant section is found.
            - 'speaker': The person who said the input claim, or 'None' if no speaker can be identified.
    `;

  const user_prompt = `
        Here is the input statement: "${claim_text}"

        Here is the input article:
        ${article_text}
    `;

  // Query OpenAI to cross-reference claim and news article to fact-check the claim
  let response;
  let claim_review = {
    article_section: "None",
    summary: "None",
  };

  if (article_text.length > 0) {
    try {
      response = await openai_connection.chat.completions.create({
        messages: [
          { role: "system", content: system_prompt },
          { role: "user", content: user_prompt },
        ],
        model: "gpt-4o",
        response_format: zodResponseFormat(claimReviewObject, "output"),
      });
    } catch (error) {
      console.error(
        `<!> ERROR: "${error.message}". Cannot get response from OpenAI. <!>`
      );
      return claim_review;
    }

    // Extract array of claim review result from OpenAI response and format for output
    response = response.choices[0].message;

    if (response.refusal) {
      return claim_review;
    } else {
      claim_review = JSON.parse(response.content);
      return claim_review;
    }
  } else {
    return claim_review;
  }
};
