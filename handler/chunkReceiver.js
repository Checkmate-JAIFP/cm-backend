const { s3push } = require("../helper/s3");
const { sendMessageToVideoQueue } = require("../helper/sqs");
const { generateReturnMessage } = require("../helper/misc");
const { dynamoPutItem } = require("../helper/dynamo");

const segmentSize = 10;

exports.handler = async (event) => {
  if (!event.headers["x-video-seq"] || !event.headers["x-video-id"]) {
    return generateReturnMessage(
      400,
      "ERROR: Video ID or sequence number are missing."
    );
  }

  const videoId = `${event.headers["x-video-id"]}`;
  const videoSeq = event.headers["x-video-seq"];
  const chunkId = `${videoId}/raw/${videoSeq}.webm`;
  const remainder = videoSeq % segmentSize;

  if (videoSeq === "1") {
    const putItem = {
      projectId: { S: `${videoId}` },
      projectName: { S: "Unnamed project" },
      timeCreated: { N: `${Date.now()}` },
      timeChanged: { N: `${Date.now()}` },
      seqCounter: { N: "1" },
      userId: { S: "000001" },
    };

    await dynamoPutItem(putItem, process.env.PROJECT_TABLE);
  }

  if (remainder === 0) {
    await sendMessageToVideoQueue(videoId, videoSeq, segmentSize);
  }

  const buffer = Buffer.from(event.body, "base64");

  await s3push(chunkId, buffer);

  return generateReturnMessage(200, "OKAY");
};
