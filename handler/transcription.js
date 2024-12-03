const { getAuth } = require("../helper/awsauth");
const { getTranscription } = require("../helper/assemblyAi");
const {
  dynamoGetItem,
  dynamoPutItem,
  dynamoQuery,
  dynamoDeleteItem,
} = require("../helper/dynamo");
const { glueTranscripts } = require("../helper/transcriptionGlue");
const { generateReturnMessage } = require("../helper/misc");
const { sendMessageToClaimQueue } = require("../helper/sqs");
const { all } = require("axios");

function convertToSentences(wordObject, projectId, seqNr) {
  // merge the two arrays into each other and add a source number in order to distinguish where the sources
  const previousWords = JSON.parse(wordObject.previousSeq.words.S).map(
    (item) => ({
      ...item,
      source: seqNr - 1,
    })
  );

  const currentWords = JSON.parse(wordObject.currentSeq.words.S).map(
    (item) => ({
      ...item,
      source: seqNr,
    })
  );

  const words = previousWords.concat(currentWords);

  const sentence = {
    srcSeq: null,
    start: null,
    words: [],
  };

  const sentences = [];

  let wordInSentence = 1;

  for (const word of words) {
    if (wordInSentence === 1) {
      sentence.srcSeq = word.source;
      sentence.start = word.start;
    }

    sentence.words.push(word);

    if (word.text.slice(-1) === ".") {
      sentences.push({ ...sentence, words: [...sentence.words] });
      sentence.words.length = 0;
      wordInSentence = 1;
    } else {
      wordInSentence++;
    }
  }

  const results = {
    claimsObjects: [],
    remainder: {
      projectId,
      seqNr: sentence.srcSeq,
      sentence: sentence.words.map((word) => word.text).join(" "),
      words: sentence.words,
    },
  };

  for (const singleSentence of sentences) {
    const claimsObject = {
      projectId,
      sentence: singleSentence.words.map((word) => word.text).join(" "),
      words: singleSentence.words,
      srcSeq: singleSentence.srcSeq,
      start: singleSentence.start,
    };

    results.claimsObjects.push(claimsObject);
  }

  if (
    results.remainder.words.length === 0 &&
    results.claimsObjects[results.claimsObjects.length - 1].sentence.slice(
      -1
    ) === "."
  ) {
    results.remainder = results.claimsObjects.pop();
  }

  return results;
}

async function getRecentSentences(projectId) {
  const queryParams = {
    TableName: process.env.CLAIM_TABLE,
    KeyConditionExpression: "#projectId = :projectId",
    ExpressionAttributeValues: {
      ":projectId": { S: `${projectId}` },
    },
    ExpressionAttributeNames: { "#projectId": "projectId" },
    ScanIndexForward: false,
    Limit: 5,
  };
  return await dynamoQuery(queryParams);
}

async function getAllTranscriptions(projectId) {
  const params = {
    TableName: process.env.TRANSCRIPTION_RAW_TABLE,
    KeyConditionExpression: "#projectId = :projectId",
    ExpressionAttributeValues: {
      ":projectId": { S: `${projectId}` },
    },
    ExpressionAttributeNames: { "#projectId": "projectId" },
  };

  return await dynamoQuery(params);
}

async function getProjectInfo(projectId) {
  const params = {
    TableName: process.env.PROJECT_TABLE,
    IndexName: "projectId-timeChanged-index",
    KeyConditionExpression: "#projectId = :projectId",
    ExpressionAttributeValues: {
      ":projectId": { S: `${projectId}` },
    },
    ExpressionAttributeNames: { "#projectId": "projectId" },
  };

  const projectInfo = await dynamoQuery(params);

  if (projectInfo.Items.length === 1) {
    return projectInfo.Items[0];
  }
  return null;
}

async function increaseSeqCounter(projectInfo) {
  const newCounter = parseInt(projectInfo.seqCounter.N) + 1;
  const putObject = {
    ...projectInfo,
    seqCounter: { N: `${newCounter}` },
    timeChanged: { N: `${Date.now()}` },
  };

  await dynamoPutItem(putObject, process.env.PROJECT_TABLE);

  return newCounter;
}

exports.handler = async (event) => {
  let result;

  if (event.httpMethod === "GET") {
    try {
      const item = await dynamoGetItem(
        {
          projectId: {
            S: `${event.pathParameters.projectId}`,
          },
          seqNr: {
            N: `${event.pathParameters.seqNr}`,
          },
        },
        process.env.TRANSCRIPTION_TABLE
      );

      let jsonWords = 0;
      try {
        jsonWords = JSON.parse(item.words.S);
      } catch (error) {}

      if (jsonWords.length > 0) {
        let words = [];
        JSON.parse(item.words.S).forEach(function (item, index) {
          const obj = {
            start: item.start + event.pathParameters.seqNr * 1000,
            word: item.text,
          };
          words.push(obj);
        });

        result = {
          status: "finished",
          text: item.text.S,
          words: words,
        };
      } else {
        result = {
          status: "not found",
        };
      }
    } catch (error) {
      console.error(error);
      return generateReturnMessage(
        500,
        "ERROR: Something went wrong on our side. Please contact support."
      );
    }
  }

  return generateReturnMessage(200, JSON.stringify(result));
};

exports.transcriptionCallback = async (event) => {
  const auth = await getAuth();
  const data = JSON.parse(atob(event.body));

  const transcript = await getTranscription(
    data.transcript_id,
    auth.ASSEMBLYAI_API_KEY
  );

  const fileRegex =
    /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}-\d*-\d*(?=.mp3)/;

  const params = transcript.audio_url.match(fileRegex)[0].split("-");
  const stop = params.pop();
  const start = params.pop();
  const projectId = params.join("-");
  const segmentSize = stop - start;
  const seqNr = stop / segmentSize;

  if (data.status === "completed") {
    await dynamoPutItem(
      {
        projectId: { S: `${projectId}` },
        seqNr: { N: `${seqNr}` },
        text: { S: `${transcript.text}` },
        words: { S: `${JSON.stringify(transcript.words)}` },
      },
      process.env.TRANSCRIPTION_RAW_TABLE
    );

    return generateReturnMessage(200, "Saved transcription.");
  } else {
    console.error("Transcription service reported an error", atob(event.body));

    await dynamoPutItem(
      {
        projectId: { S: `${projectId}` },
        seqNr: { N: `${seqNr}` },
        text: { S: `${transcript.text}` },
        words: { S: `[]` },
      },
      process.env.TRANSCRIPTION_RAW_TABLE
    );

    return generateReturnMessage(200, "Ok.");
  }
};

exports.transcriptionGlue = async (event) => {
  for (const record of event.Records) {
    if (record.eventName === "INSERT") {
      const currentTranscript = record.dynamodb.NewImage;

      if (currentTranscript.skip) {
        // console.log(`[ CMDEBUG ] Item needs no treatment. Skipping.`);
        // continue;
      }

      const projectInfo = await getProjectInfo(currentTranscript.projectId.S);

      const task = {
        projectId: currentTranscript.projectId.S,
        seqCounter: parseInt(projectInfo?.seqCounter?.N) | null,
        seqNr: parseInt(currentTranscript.seqNr?.N) | null,
        sentenceCounter: 0,
        allTranscripts: null,
      };

      if (task.seqCounter < task.seqNr) {
        console.log(
          `[ CMDEBUG ] seqNr is too high.`,
          task.seqCounter,
          task.seqNr
        );
        continue;
      }

      if (task.seqNr === 1 && task.seqCounter === 1) {
        await increaseSeqCounter(projectInfo);
      }

      let recentSentences;
      let previousItems = [];

      if (task.seqCounter > 1) {
        recentSentences = await getRecentSentences(task.projectId);
        task.sentenceCounter = parseInt(
          recentSentences.Items[0]?.sentenceNr?.N
        );

        if (recentSentences.Count >= 1) {
          for (const item of recentSentences.Items) {
            previousItems.push(item);
          }
        }

        if (isNaN(task.sentenceCounter)) {
          task.sentenceCounter = 0;
        }
      }

      task.allTranscripts = await getAllTranscriptions(task.projectId);

      if (task.allTranscripts.Items.length <= 1) {
        console.log("[ CMDEBUG ] No items in database. Aborting.");
        continue;
      }

      let previousTranscripts = task.allTranscripts.Items.filter(
        (filterItem) => parseInt(filterItem.seqNr.N) < task.seqCounter
      );

      let upcomingTranscripts = task.allTranscripts.Items.filter(
        (filterItem) => parseInt(filterItem.seqNr.N) > task.seqCounter
      );

      // find previous item in task.allTranscripts and glue it together with the current one
      const prevTranscriptIndex = task.allTranscripts.Items.findIndex(
        (item) => parseInt(item.seqNr.N) === task.seqCounter - 1
      );

      const currentTranscriptIndex = task.allTranscripts.Items.findIndex(
        (item) => parseInt(item.seqNr.N) === task.seqCounter
      );

      if (prevTranscriptIndex < 0 || prevTranscriptIndex === undefined) {
        console.log("No previous item. Skipping.");
        continue;
      }

      const prevTranscript = task.allTranscripts.Items[prevTranscriptIndex];

      let gluedVersion;
      try {
        gluedVersion = await glueTranscripts(
          JSON.parse(prevTranscript.words?.S),
          JSON.parse(currentTranscript.words?.S)
        );
      } catch (error) {
        console.error("Error glueing:", error);
      }

      const currentIndex = task.allTranscripts.Items.findIndex(
        (item) => parseInt(item.seqNr.N) === task.seqCounter
      );
      const previousIndex = task.allTranscripts.Items.findIndex(
        (item) => parseInt(item.seqNr.N) === task.seqCounter - 1
      );

      // change the items in the task.allTranscripts array accordingly
      if (gluedVersion?.changes > 0) {
        task.allTranscripts.Items[currentIndex] = {
          ...task.allTranscripts.Items[currentIndex],
          text: {
            S: `${gluedVersion.currentSeq.text}`,
          },
          words: {
            S: `${gluedVersion.currentSeq.words}`,
          },
        };

        task.allTranscripts.Items[previousIndex] = {
          ...task.allTranscripts.Items[previousIndex],
          text: {
            S: `${gluedVersion.previousSeq.text}`,
          },
          words: {
            S: `${gluedVersion.previousSeq.words}`,
          },
        };
      }

      const sentenceObj = convertToSentences(
        {
          previousSeq: {
            ...task.allTranscripts.Items[prevTranscriptIndex],
          },
          currentSeq: {
            ...task.allTranscripts.Items[currentTranscriptIndex],
          },
        },
        task.projectId,
        task.seqNr
      );

      // Delete previous and current item from Raw table
      const deleteItems = [
        task.allTranscripts.Items[previousIndex].seqNr.N,
        task.allTranscripts.Items[currentIndex].seqNr.N,
      ];

      for (const deletion of deleteItems) {
        const params = {
          Key: {
            projectId: {
              S: `${task.projectId}`,
            },
            seqNr: {
              N: `${deletion}`,
            },
          },
          TableName: process.env.TRANSCRIPTION_RAW_TABLE,
        };
        await dynamoDeleteItem(params);
      }

      // Remove the items from the task.allTranscripts array

      const remainderSeq = task.allTranscripts.Items[currentIndex].seqNr.N;

      task.allTranscripts.Items.splice(previousIndex, 1);
      task.allTranscripts.Items.splice(currentIndex, 1);

      // put remainder to Raw on the seq position of the current item
      await dynamoPutItem(
        {
          projectId: { S: `${sentenceObj.remainder.projectId}` },
          seqNr: { N: `${remainderSeq}` },
          skip: { BOOL: true },
          text: { S: `${sentenceObj.remainder.sentence}` },
          words: { S: `${JSON.stringify(sentenceObj.remainder.words)}` },
        },
        process.env.TRANSCRIPTION_RAW_TABLE
      );

      // put sentences to Claims by looping through sentenceObj
      for (sentenceItem of sentenceObj.claimsObjects) {
        console.log(`[ CMDEBUG ] Storing item to Claims DB`, sentenceItem);

        const putItem = {
          projectId: { S: `${sentenceItem.projectId}` },
          sentenceNr: { N: `${++task.sentenceCounter}` },
          srcSeq: { N: `${parseInt(sentenceItem.srcSeq)}` },
          startTime: {
            N: `${
              parseInt(sentenceItem.srcSeq) * 10 -
              10 +
              Math.floor(parseInt(sentenceItem.start) / 1000)
            }`,
          },
          text: { S: `${sentenceItem.sentence}` },
          words: {
            S: `${JSON.stringify(sentenceItem.words)}`,
          },
          status: { S: "pending" },
          timeCreated: { N: `${Date.now()}` },
        };

        previousItems.unshift(putItem);

        await sendMessageToClaimQueue(
          JSON.stringify(previousItems.slice(0, 5))
        );

        await dynamoPutItem(putItem, process.env.CLAIM_TABLE);
      }

      if (task.seqCounter === task.seqNr) {
        task.seqCounter = await increaseSeqCounter(projectInfo);
      }

      continue;
    }
  }
};
