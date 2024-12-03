const {
  dynamoPutItem,
  dynamoQuery,
  dynamoGetItem,
} = require("../helper/dynamo");
const { populateSentencesArray } = require("../helper/misc");
const { generateReturnMessage } = require("../helper/misc");
const { sendMessageToClaimQueue } = require("../helper/sqs");

function createElement(rawItem) {
  return {
    sentenceNr: Number(rawItem.sentenceNr.N),
    text: rawItem.text.S,
    speaker: rawItem.speaker?.S,
    time: Number(rawItem.startTime.N),
    claims: rawItem?.claim?.S,
    annotation: rawItem?.annotation?.S,
  };
}

exports.handler = async (event) => {
  if (event.httpMethod === "GET") {
    if (!event.pathParameters.projectId) {
      return generateReturnMessage(400, "No");
    }

    if (event.pathParameters.sentenceNr) {
      const item = await dynamoGetItem(
        {
          projectId: {
            S: `${event.pathParameters.projectId}`,
          },
          sentenceNr: {
            N: `${event.pathParameters.sentenceNr}`,
          },
        },
        process.env.CLAIM_TABLE
      );

      if (!item) {
        return generateReturnMessage(
          404,
          `Item with sentence number ${event.pathParameters.sentenceNr} not found.`
        );
      }

      if (item.status.S !== "ok") {
        if (Number(item.timeCreated.N) > Date.now() - 10000) {
          return generateReturnMessage(
            404,
            `Item with sentence number ${event.pathParameters.sentenceNr} not ready yet.`
          );
        }
      }

      const returnObj = {
        sentenceNr: Number(item.sentenceNr.N),
        text: item.text.S,
        speaker: item.speaker?.S,
        time: Number(item.startTime.N),
        claim: item?.claim?.S,
        annotation: item?.annotation?.S,
      };
      return generateReturnMessage(200, JSON.stringify(returnObj));
    }

    const queryParams = {
      TableName: process.env.CLAIM_TABLE,
      KeyConditionExpression: "#projectId = :projectId",
      ExpressionAttributeValues: {
        ":projectId": { S: `${event.pathParameters.projectId}` },
      },
      ExpressionAttributeNames: { "#projectId": "projectId" },
      ScanIndexForward: false,
    };
    const result = await dynamoQuery(queryParams);

    let resultObject = [];
    for (const item of result.Items) {
      resultObject.unshift(createElement(item));
    }

    return generateReturnMessage(200, JSON.stringify(resultObject));
  }
  return;
};

exports.correction = async (event) => {
  if (event.httpMethod === "POST" || event.httpMethod === "PUT") {
    if (!event.pathParameters.projectId || !event.pathParameters.sentenceNr) {
      return generateReturnMessage(400, "No");
    }

    if (!event.body) {
      return generateReturnMessage(400, "No payload was provided.");
    }

    const data = JSON.parse(atob(event.body));

    const previousItem = await dynamoGetItem(
      {
        projectId: {
          S: `${event.pathParameters.projectId}`,
        },
        sentenceNr: {
          N: `${event.pathParameters.sentenceNr}`,
        },
      },
      process.env.CLAIM_TABLE
    );

    const correctedItem = {
      projectId: { S: `${event.pathParameters.projectId}` },
      sentenceNr: { N: event.pathParameters.sentenceNr },
      claim: data?.claim ? { S: data.claim } : { S: "null" },
      text: data?.text ? { S: data.text } : { S: "null" },
      speaker: data?.speaker ? { S: data.speaker } : { S: "null" },
      annotation: data?.annotation ? { S: data.annotation } : { S: "null" },
      srcSeq: previousItem.srcSeq,
      status: previousItem.status,
      startTime: previousItem.startTime,
      words: previousItem.words,
    };

    // If sentence text has changed, run claim detection again to find any new claims
    if (data?.text !== previousItem.text.S) {
      console.log("Re-running claim detection process");

      // check for previous sentence items
      let previousItems = [];

      const queryParams = {
        TableName: process.env.CLAIM_TABLE,
        KeyConditionExpression:
          "#projectId = :projectId AND #sentenceNr < :sentenceNr",
        ExpressionAttributeValues: {
          ":projectId": correctedItem.projectId,
          ":sentenceNr": correctedItem.sentenceNr,
        },
        ExpressionAttributeNames: {
          "#projectId": "projectId",
          "#sentenceNr": "sentenceNr",
        },
        ScanIndexForward: false,
        Limit: 5,
      };
      const result = await dynamoQuery(queryParams);

      if (result.Count >= 1) {
        for (const item of result.Items) {
          previousItems.push(item);
        }
      }

      previousItems.unshift(correctedItem);

      await sendMessageToClaimQueue(JSON.stringify(previousItems));
    }

    // Put corrected item into dynamo database
    await dynamoPutItem(correctedItem, process.env.CLAIM_TABLE);

    return generateReturnMessage(200, "okay");
  }
  return;
};

// Import sentences from DynamoDB stream of the Transcription Table
exports.import = async (event) => {
  for (const record of event.Records) {
    if (record.eventName !== "INSERT") {
      continue;
    }

    const item = record.dynamodb.NewImage;

    let previousItems = [];
    let itemIsNew = true;

    let putItem;

    // check for previous sentence items
    const queryParams = {
      TableName: process.env.CLAIM_TABLE,
      KeyConditionExpression: "#projectId = :projectId",
      ExpressionAttributeValues: {
        ":projectId": item.projectId,
      },
      ExpressionAttributeNames: { "#projectId": "projectId" },
      ScanIndexForward: false,
      Limit: 5,
    };
    const result = await dynamoQuery(queryParams);

    if (result.Count >= 1) {
      for (const item of result.Items) {
        previousItems.push(item);
      }
    }

    const sentences = populateSentencesArray(item.text.S);

    for (const element of sentences) {
      if (!previousItems[0]) {
        putItem = {
          projectId: { S: `${item.projectId.S}` },
          sentenceNr: { N: `1` },
          sentence: { S: `${element}` },
          srcSeq: { N: `${item.seqNr.N}` },
          status: { S: "pending + new" },
        };
        previousItems.unshift(putItem);
      } else if (previousItems[0] && element[0] === element[0].toUpperCase()) {
        putItem = {
          projectId: { S: `${item.projectId.S}` },
          sentenceNr: { N: `${Number(previousItems[0].sentenceNr.N) + 1}` },
          sentence: { S: `${element}` },
          srcSeq: { N: `${item.seqNr.N}` },
          status: { S: "pending + UpperCase" },
        };
        previousItems.unshift(putItem);
      } else if (element[0] === element[0].toLowerCase()) {
        if (previousItems[0].sentence.S.slice(-1) === ".") {
          previousItems[0].sentence.S = previousItems[0].sentence.S.slice(
            0,
            -1
          );
        }
        putItem = {
          projectId: { S: `${item.projectId.S}` },
          sentenceNr: { N: `${Number(previousItems[0].sentenceNr.N)}` },
          sentence: { S: `${previousItems[0].sentence.S} ${element}` },
          srcSeq: { N: `${previousItems[0].srcSeq.N}` },
          status: { S: `${previousItems[0].status.S} + lowerCase` },
        };
        previousItems[0] = putItem;
        itemIsNew = false;
      }

      if (previousItems[1] && itemIsNew) {
        console.log(
          "Sending object to claim detection queue: ",
          previousItems.slice(1, previousItems.length)
        );
        await sendMessageToClaimQueue(
          JSON.stringify(previousItems.slice(1, previousItems.length))
        );
      }

      await dynamoPutItem(putItem, process.env.CLAIM_TABLE);
      continue;
    }
  }
};
