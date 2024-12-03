const {
  dynamoScan,
  dynamoPutItem,
  dynamoDeleteItem,
  dynamoQuery,
} = require("../helper/dynamo");
const {
  S3Client,
  GetObjectCommand,
  ListObjectsV2Command,
  DeleteObjectsCommand,
} = require("@aws-sdk/client-s3");
const { generateReturnMessage } = require("../helper/misc");

const s3 = new S3Client({});

exports.rename = async (event) => {
  return null;
};

exports.list = async (event) => {
  const params = {
    TableName: process.env.PROJECT_TABLE,
    IndexName: "projectId-timeChanged-index",
    ScanIndexForward: false,
  };

  const result = await dynamoScan(params);

  const returnItem = [];

  result?.Items.forEach((element) => {
    returnItem.push({
      projectId: element.projectId.S,
      projectName: element.projectName.S,
      timeCreated: element.timeCreated.N,
    });
  });

  return generateReturnMessage(200, JSON.stringify(returnItem));
};

const deleteTranscriptions = async (projectId) => {
  const table = process.env.TRANSCRIPTION_TABLE;
  const params = {
    TableName: table,
    KeyConditionExpression: "#projectId = :projectId",
    ExpressionAttributeValues: {
      ":projectId": { S: `${projectId}` },
    },
    ExpressionAttributeNames: { "#projectId": "projectId" },
  };

  const result = await dynamoQuery(params);

  if (result.Count === 0) {
    return 0;
  }

  for (const item of result.Items) {
    const params = {
      Key: {
        projectId: {
          S: `${projectId}`,
        },
        seqNr: {
          N: `${item.seqNr.N}`,
        },
      },
      TableName: table,
    };
    await dynamoDeleteItem(params);
  }
  return result.Count;
};

const deleteClaims = async (projectId) => {
  const table = process.env.CLAIM_TABLE;
  const params = {
    TableName: table,
    KeyConditionExpression: "#projectId = :projectId",
    ExpressionAttributeValues: {
      ":projectId": { S: `${projectId}` },
    },
    ExpressionAttributeNames: { "#projectId": "projectId" },
  };

  const result = await dynamoQuery(params);

  if (result.Count === 0) {
    return 0;
  }

  for (const item of result.Items) {
    const params = {
      Key: {
        projectId: {
          S: `${projectId}`,
        },
        sentenceNr: {
          N: `${item.sentenceNr.N}`,
        },
      },
      TableName: table,
    };
    await dynamoDeleteItem(params);
  }
  return result.Count;
};

const deleteS3Items = async (projectId, bucket, counter) => {
  let count;
  if (!counter) {
    count = 0;
  }
  const listParams = new ListObjectsV2Command({
    Bucket: bucket,
    Prefix: `${projectId}/`,
  });

  const listedObjects = await s3.send(listParams);

  if (listedObjects.KeyCount === 0) return 0;
  count += listedObjects.Contents.length;

  const deleteParams = {
    Bucket: bucket,
    Delete: { Objects: [] },
  };

  listedObjects.Contents.forEach(({ Key }) => {
    deleteParams.Delete.Objects.push({ Key });
    console.log(deleteParams);
  });

  const command = new DeleteObjectsCommand(deleteParams);
  const response = await s3.send(command);

  console.log(response);

  if (listedObjects.IsTruncated) {
    await deleteS3Items(projectId, bucket, listedObjects.Contents.length);
  }

  return count;
};

const deleteProject = async (projectId) => {
  const params = {
    Key: {
      userId: {
        S: `000001`,
      },
      projectId: {
        S: `${projectId}`,
      },
    },
    TableName: process.env.PROJECT_TABLE,
  };
  await dynamoDeleteItem(params);

  return true;
};

exports.handler = async (event) => {
  if (event.httpMethod === "PUT") {
    const payload = JSON.parse(atob(event.body));
    if (payload.projectName) {
      const params = {
        TableName: process.env.PROJECT_TABLE,
        IndexName: "projectId-timeChanged-index",
        KeyConditionExpression: "#projectId = :projectId",
        ExpressionAttributeValues: {
          ":projectId": { S: `${event.pathParameters.projectId}` },
        },
        ExpressionAttributeNames: { "#projectId": "projectId" },
      };

      const oldObject = await dynamoQuery(params);

      if (oldObject.Count === 0) {
        return generateReturnMessage(400, "Invalid projectId");
      }

      const putObject = {
        ...oldObject.Items[0],
        projectName: { S: `${payload.projectName}` },
        timeChanged: { N: `${Date.now()}` },
      };

      await dynamoPutItem(putObject, process.env.PROJECT_TABLE);

      return generateReturnMessage(
        200,
        `Successfully changed project name to ${payload.projectName}`
      );
    }
    return generateReturnMessage(200, "PUT");
  }

  if (event.httpMethod === "DELETE") {
    const transcripts = await deleteTranscriptions(
      event.pathParameters.projectId
    );
    const claims = await deleteClaims(event.pathParameters.projectId);
    const s3Chunks = await deleteS3Items(
      event.pathParameters.projectId,
      process.env.VIDEO_CHUNK_BUCKET,
      0
    );
    const s3Audio = await deleteS3Items(
      event.pathParameters.projectId,
      process.env.AUDIO_CHUNKS_BUCKET,
      0
    );

    await deleteProject(event.pathParameters.projectId);

    return generateReturnMessage(
      200,
      `Successfully deleted ${transcripts + claims} database entries and ${
        s3Chunks + s3Audio
      } files.`
    );
  }

  return generateReturnMessage(404, "Not found");
};
