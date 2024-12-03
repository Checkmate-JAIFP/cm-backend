const {
  DynamoDBClient,
  PutItemCommand,
  GetItemCommand,
  QueryCommand,
  ScanCommand,
  UpdateItemCommand,
  DeleteItemCommand,
} = require("@aws-sdk/client-dynamodb");

const client = new DynamoDBClient({});

module.exports.dynamoGetItem = async (key, table) => {
  const input = {
    Key: key,
    ReturnConsumedCapacity: "TOTAL",
    TableName: table,
  };

  try {
    const command = new GetItemCommand(input);
    const response = await client.send(command);
    return response.Item;
  } catch (error) {
    console.error("DynamoDB Get Error", error);
    return false;
  }
};

module.exports.dynamoPutItem = async (item, table) => {
  const input = {
    Item: item,
    ReturnConsumedCapacity: "TOTAL",
    TableName: table,
  };

  try {
    const command = new PutItemCommand(input);
    const response = await client.send(command);
    return response.item;
  } catch (error) {
    console.error("DynamoDB Put Error", error);
    return false;
  }
};

module.exports.dynamoUpdateItem = async () => {};

module.exports.dynamoDeleteItem = async (params) => {
  try {
    const command = new DeleteItemCommand(params);
    const response = await client.send(command);
    return response;
  } catch (error) {
    console.error("DynamoDB Delete Error", error);
    return false;
  }
};

module.exports.dynamoQuery = async (params) => {
  try {
    const command = new QueryCommand(params);
    const response = await client.send(command);
    return response;
  } catch (error) {
    console.error("DynamoDB Query Error", error);
  }
};

module.exports.dynamoScan = async (params) => {
  try {
    const command = new ScanCommand(params);
    const response = await client.send(command);
    return response;
  } catch (error) {
    console.error("DynamoDB Scan Error", error);
  }
};

module.exports.dynamoUpdate = async (params) => {
  try {
    const command = new UpdateItemCommand(params);
    const response = await client.send(command);
    return response;
  } catch (error) {
    console.error("DynamoDB Update Error", error);
  }
};
