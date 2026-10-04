// Lambda 1: Log Function - saves every cleaned reading into DynamoDB + bumps the room's lastSeen.
// Triggered by the IoT Rule on topic home/+/clean (Node-RED publishes there after checking the data).
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, UpdateCommand } from '@aws-sdk/lib-dynamodb';

const db = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const TABLE = process.env.TABLE_NAME;
const KEEP_DAYS = 7; // TTL so the history doesn't just grow forever

export const handler = async (r) => {
  const expiresAt = Math.floor(r.ts / 1000) + KEEP_DAYS * 86400;

  // UpdateItem instead of PutItem because the control function writes to the same row at the same time,
  // and Put would wipe out whatever it already wrote
  await db.send(new UpdateCommand({
    TableName: TABLE,
    Key: { roomId: r.roomId, timestamp: r.ts },
    UpdateExpression: 'SET rawLux = :lux, motionDetected = :m, reportedLight = :l, expiresAt = :e',
    ExpressionAttributeValues: { ':lux': r.lux, ':m': r.motion, ':l': r.light, ':e': expiresAt },
  }));

  // timestamp 0 = the "current state" row for each room (one table, so this is my little shortcut)
  await db.send(new UpdateCommand({
    TableName: TABLE,
    Key: { roomId: r.roomId, timestamp: 0 },
    UpdateExpression: 'SET lastSeen = :ts, lastRawLux = :lux',
    ExpressionAttributeValues: { ':ts': r.ts, ':lux': r.lux },
  }));

  return { saved: `${r.roomId}#${r.ts}` };
};
