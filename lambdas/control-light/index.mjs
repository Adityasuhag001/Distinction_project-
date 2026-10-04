// Lambda 2: Control Function - decides if the light should be on or off and sends the command back down.
// Triggered by the same IoT Rule as the log function (home/+/clean).
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, QueryCommand, GetCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { IoTDataPlaneClient, PublishCommand } from '@aws-sdk/client-iot-data-plane';

const db = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const iot = new IoTDataPlaneClient({ endpoint: `https://${process.env.IOT_ENDPOINT}` });
const TABLE = process.env.TABLE_NAME;

const DARK = 250;            // lux - below this the room counts as dark
const OFF_DELAY_MS = 30000;  // wait 30s after the last motion before switching off

export const handler = async (r) => {
  // smoothing: average this reading with the previous 2.
  // (the log function runs in parallel so this reading might not be in the table yet - that's why I add r.lux myself)
  const prev = await db.send(new QueryCommand({
    TableName: TABLE,
    KeyConditionExpression: 'roomId = :id AND #t BETWEEN :from AND :to',
    ExpressionAttributeNames: { '#t': 'timestamp' },
    ExpressionAttributeValues: { ':id': r.roomId, ':from': 1, ':to': r.ts - 1 },
    ScanIndexForward: false, // newest first
    Limit: 2,
  }));
  const luxes = [r.lux, ...prev.Items.map(i => i.rawLux).filter(x => x != null)];
  const avgLux = Math.round(luxes.reduce((a, b) => a + b, 0) / luxes.length);

  const state = (await db.send(new GetCommand({ TableName: TABLE, Key: { roomId: r.roomId, timestamp: 0 } }))).Item || {};
  const lastMotionAt = r.motion ? r.ts : (state.lastMotionAt || 0);
  const motionRecent = r.ts - lastMotionAt < OFF_DELAY_MS;

  // the actual rule: someone's been here recently AND it's dark -> on, otherwise off
  const decision = motionRecent && avgLux < DARK ? 'on' : 'off';
  const reason = !motionRecent ? 'no motion for 30s' : avgLux < DARK ? `dark (avg ${avgLux} lux) + motion` : `bright enough (avg ${avgLux} lux)`;

  // only send a command if the light isn't already in the right state
  if (decision !== r.light) {
    await iot.send(new PublishCommand({
      topic: `home/${r.roomId}/cmd`,
      qos: 1,
      payload: JSON.stringify({ state: decision, reason, avgLux, basedOn: r.ts }),
    }));
  }

  await db.send(new UpdateCommand({
    TableName: TABLE,
    Key: { roomId: r.roomId, timestamp: r.ts },
    UpdateExpression: 'SET lightLevel = :avg, lightState = :s',
    ExpressionAttributeValues: { ':avg': avgLux, ':s': decision },
  }));
  await db.send(new UpdateCommand({
    TableName: TABLE,
    Key: { roomId: r.roomId, timestamp: 0 },
    UpdateExpression: 'SET lightState = :s, lightLevel = :avg, lastMotionAt = :lm, motionDetected = :m, reason = :why',
    ExpressionAttributeValues: { ':s': decision, ':avg': avgLux, ':lm': lastMotionAt, ':m': r.motion, ':why': reason },
  }));

  return { roomId: r.roomId, decision, avgLux, sentCommand: decision !== r.light };
};
