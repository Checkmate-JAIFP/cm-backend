const {
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
  S3Client,
} = require("@aws-sdk/client-s3");

const client = new S3Client({});

module.exports.s3push = async (key, body) => {
  const command = new PutObjectCommand({
    Bucket: `${process.env.SERVICE}-${process.env.STAGE}-chunks`,
    Key: key,
    Body: body,
  });

  try {
    const response = await client.send(command);
    return response;
  } catch (err) {
    console.error("S3 Error:", err);
    return false;
  }
};

module.exports.s3delete = async (key) => {
  const command = new DeleteObjectCommand({
    Bucket: `${process.env.SERVICE}-${process.env.STAGE}-chunks`,
    Key: key,
  });
  await client.send(command);
};

module.exports.s3get = async (key) => {
  const command = new GetObjectCommand({
    Bucket: `${process.env.SERVICE}-${process.env.STAGE}-chunks`,
    Key: key,
  });

  try {
    const response = await client.send(command);
    return await response.Body.transformToByteArray();
  } catch (err) {
    console.error("S3 Error:", err);
    return false;
  }
};
