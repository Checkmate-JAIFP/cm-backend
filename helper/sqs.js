const { SQSClient, SendMessageCommand } = require("@aws-sdk/client-sqs");

module.exports.sendMessageToVideoQueue = async (id, stop, segmentSize) => {
  try {
    const client = new SQSClient({});
    const input = {
      QueueUrl: `https://sqs.eu-central-1.amazonaws.com/516400917338/${process.env.VIDEO_QUEUE}`,
      MessageBody: `{"id":"${id}","stop":${stop},"segmentSize":${segmentSize}}`,
      DelaySeconds: 1,
    };

    const command = new SendMessageCommand(input);
    const response = await client.send(command);

    return response;
  } catch (error) {
    console.error("SQS Error:", error);
    return false;
  }
};

module.exports.sendMessageToClaimQueue = async (message) => {
  try {
    const client = new SQSClient({});
    const input = {
      QueueUrl: `https://sqs.eu-central-1.amazonaws.com/516400917338/${process.env.CLAIMS_QUEUE}`,
      MessageBody: `${message}`,
      DelaySeconds: 1,
    };

    const command = new SendMessageCommand(input);
    const response = await client.send(command);

    return response;
  } catch (error) {
    console.error("SQS Error:", error);
    return false;
  }
};
