const { generateReturnMessage } = require("../helper/misc");
const { sendMessageToVideoQueue } = require("../helper/sqs");

const segmentSize = 10;

exports.handler = async (event) => {
  let data = atob(event.body);

  try {
    data = JSON.parse(data);
  } catch (error) {
    return generateReturnMessage(400, `ERROR: Malformed request.\n ${error}`);
  }

  if (!data.videoId) {
    return generateReturnMessage(400, "ERROR: No videoId was provided.");
  }

  if (!data.seqNr) {
    return generateReturnMessage(400, "ERROR: No seqNr was provided.");
  }

  await sendMessageToVideoQueue(data.videoId, data.seqNr, segmentSize);

  return generateReturnMessage(200, JSON.stringify(data));
};
