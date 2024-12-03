const {
  S3Client,
  GetObjectCommand,
  ListObjectsV2Command,
} = require("@aws-sdk/client-s3");
const { getSignedUrl } = require("@aws-sdk/s3-request-presigner");
const { generateReturnMessage } = require("../helper/misc");

const client = new S3Client({});

exports.getVideo = async (event) => {
  const projectID = event.pathParameters.projectId;

  const command = new ListObjectsV2Command({
    Bucket: process.env.VIDEO_CHUNK_BUCKET,
    MaxKeys: "1",
    Prefix: `${projectID}/wip/${projectID}`,
  });
  const response = await client.send(command);

  const signCommand = new GetObjectCommand({
    Bucket: process.env.VIDEO_CHUNK_BUCKET,
    Key: response.Contents[0].Key,
  });

  const url = await getSignedUrl(client, signCommand, {
    expiresIn: 86400,
  });

  return generateReturnMessage(200, url);
};
