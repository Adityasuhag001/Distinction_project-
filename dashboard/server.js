// tiny dashboard - reads each room's current state row (timestamp 0) + recent history from DynamoDB
// runs on my laptop with my AWS creds (fine for a demo, see report for what I'd do properly)
const express = require('express');
const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, BatchGetCommand, QueryCommand } = require('@aws-sdk/lib-dynamodb');
const cfg = require('../config');

const db = DynamoDBDocumentClient.from(new DynamoDBClient({ region: cfg.region }));
const app = express();
app.use(express.static(__dirname + '/public'));

app.get('/api/rooms', async (_req, res) => {
  const out = await db.send(new BatchGetCommand({ RequestItems: { [cfg.table]: { Keys: cfg.rooms.map(r => ({ roomId: r.id, timestamp: 0 })) } } }));
  const rows = out.Responses[cfg.table];
  res.json(cfg.rooms.map(r => {
    const s = rows.find(x => x.roomId === r.id) || {};
    return { ...s, roomId: r.id, online: !!s.lastSeen && Date.now() - s.lastSeen < cfg.offlineAfterMs };
  }));
});

app.get('/api/history/:room', async (req, res) => {
  const out = await db.send(new QueryCommand({
    TableName: cfg.table, KeyConditionExpression: 'roomId = :r AND #t > :z',
    ExpressionAttributeNames: { '#t': 'timestamp' }, ExpressionAttributeValues: { ':r': req.params.room, ':z': 0 },
    ScanIndexForward: false, Limit: 20,
  }));
  res.json(out.Items);
});

app.listen(3000, () => console.log('dashboard on http://localhost:3000'));
