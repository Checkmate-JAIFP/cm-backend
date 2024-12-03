const { GetParameterCommand, SSMClient } = require("@aws-sdk/client-ssm");

const ssmClient = new SSMClient();

module.exports.getAuth = async (name) => {
  const params = {
    Name: name ?? `/${process.env.SERVICE}/${process.env.STAGE}/keys`,
    WithDecryption: true,
  };

  try {
    const auth = await ssmClient.send(new GetParameterCommand(params));

    return JSON.parse(auth.Parameter.Value);
  } catch (ex) {
    console.error("AWS SSM Error:", ex);

    return false;
  }
};
