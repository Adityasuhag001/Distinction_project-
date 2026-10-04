// pulls the CloudWatch graphs for a load test run straight from AWS (GetMetricWidgetImage) + the raw numbers (GetMetricData)
//   node loadtest/cloudwatch-graphs.js evidence/loadtest_XXXX.json
const { execFileSync } = require('child_process');
const fs = require('fs');

const run = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const t0 = new Date(run.startedAt), t1 = new Date(run.endedAt);
const start = new Date(t0 - 4 * 60000).toISOString();   // 4 min of baseline before
const end = new Date(+t1 + 5 * 60000).toISOString();    // 5 min of cool-down after
const out = __dirname + '/../evidence/cloudwatch';
fs.mkdirSync(out, { recursive: true });

// vertical lines where each step started/ended
const marks = run.steps.map((s, k) => ({ label: `${s} rooms`, value: new Date(+t0 + k * run.stepSecs * 1000).toISOString(), color: '#7b1020' }));
marks.push({ label: 'load test stops', value: run.endedAt, color: '#555555' });

const fns = ['lighting-log-reading', 'lighting-control-light'];
const lambda = (metric) => fns.map(f => ['AWS/Lambda', metric, 'FunctionName', f, { label: f.replace('lighting-', '') }]);

const graphs = {
  lambda_concurrency: { title: 'Lambda concurrent executions (max per minute)', stat: 'Maximum', metrics: [...lambda('ConcurrentExecutions'), ['AWS/Lambda', 'ConcurrentExecutions', { label: 'whole account (limit = 10)', color: '#d62728' }]] },
  lambda_invocations: { title: 'Lambda invocations per minute', stat: 'Sum', metrics: lambda('Invocations') },
  lambda_duration: { title: 'Lambda duration (ms, average)', stat: 'Average', metrics: lambda('Duration') },
  lambda_throttles: { title: 'Lambda throttles per minute', stat: 'Sum', metrics: [...lambda('Throttles'), ['AWS/Lambda', 'Throttles', { label: 'whole account' }]] },
  lambda_async_age: { title: 'Async event age (ms) - how long IoT events waited before Lambda ran them', stat: 'Maximum', metrics: lambda('AsyncEventAge') },
  iot_messages: { title: 'IoT Core messages per minute', stat: 'Sum', metrics: [
    ['AWS/IoT', 'PublishIn.Success', 'Protocol', 'MQTT', { label: 'published in (rooms + Node-RED)' }],
    ['AWS/IoT', 'PublishOut.Success', 'Protocol', 'MQTT', { label: 'delivered out (to Node-RED + rooms)' }],
    ['AWS/IoT', 'TopicMatch', 'RuleName', 'LightingReadings', { label: 'IoT Rule matches' }]] },
  dynamodb_writes: { title: 'DynamoDB consumed write capacity per minute', stat: 'Sum', metrics: [['AWS/DynamoDB', 'ConsumedWriteCapacityUnits', 'TableName', 'SmartLighting', { label: 'write units' }],
    ['AWS/DynamoDB', 'ConsumedReadCapacityUnits', 'TableName', 'SmartLighting', { label: 'read units' }]] },
};

for (const [name, g] of Object.entries(graphs)) {
  const widget = { width: 900, height: 330, start, end, period: 60, stat: g.stat, view: 'timeSeries', title: g.title, metrics: g.metrics,
    annotations: { vertical: marks }, yAxis: { left: { min: 0 } }, legend: { position: 'bottom' }, timezone: '+1100' };
  const b64 = execFileSync('aws', ['cloudwatch', 'get-metric-widget-image', '--metric-widget', JSON.stringify(widget), '--output', 'text', '--query', 'MetricWidgetImage']).toString();
  fs.writeFileSync(`${out}/${name}.png`, Buffer.from(b64, 'base64'));
  console.log('saved', name + '.png');
}

// raw numbers (per minute) so I can put actual values in the report, not just squint at graphs
const queries = [];
const q = (id, ns, metric, dims, stat) => queries.push({ Id: id, MetricStat: { Metric: { Namespace: ns, MetricName: metric, Dimensions: dims }, Period: 60, Stat: stat } });
fns.forEach((f, i) => {
  const d = [{ Name: 'FunctionName', Value: f }];
  q(`conc${i}`, 'AWS/Lambda', 'ConcurrentExecutions', d, 'Maximum');
  q(`inv${i}`, 'AWS/Lambda', 'Invocations', d, 'Sum');
  q(`dur${i}`, 'AWS/Lambda', 'Duration', d, 'Average');
  q(`p99${i}`, 'AWS/Lambda', 'Duration', d, 'p99');
  q(`thr${i}`, 'AWS/Lambda', 'Throttles', d, 'Sum');
  q(`age${i}`, 'AWS/Lambda', 'AsyncEventAge', d, 'Maximum');
  q(`drop${i}`, 'AWS/Lambda', 'AsyncEventsDropped', d, 'Sum');
  q(`recv${i}`, 'AWS/Lambda', 'AsyncEventsReceived', d, 'Sum');
});
q('accConc', 'AWS/Lambda', 'ConcurrentExecutions', [], 'Maximum');
q('pubIn', 'AWS/IoT', 'PublishIn.Success', [{ Name: 'Protocol', Value: 'MQTT' }], 'Sum');
q('ruleMatch', 'AWS/IoT', 'TopicMatch', [{ Name: 'RuleName', Value: 'LightingReadings' }], 'Sum');
q('wcu', 'AWS/DynamoDB', 'ConsumedWriteCapacityUnits', [{ Name: 'TableName', Value: 'SmartLighting' }], 'Sum');
const data = JSON.parse(execFileSync('aws', ['cloudwatch', 'get-metric-data', '--start-time', start, '--end-time', end, '--metric-data-queries', JSON.stringify(queries), '--output', 'json']).toString());
fs.writeFileSync(`${out}/metric_data.json`, JSON.stringify(data, null, 2));

// one row per minute
const rows = {};
for (const r of data.MetricDataResults) r.Timestamps.forEach((t, i) => { (rows[t] ||= {})[r.Id] = Math.round(r.Values[i] * 10) / 10; });
const table = Object.keys(rows).sort().map(t => ({ minute: new Date(t).toLocaleTimeString('en-AU', { hour12: false, timeZone: 'Australia/Melbourne' }).slice(0, 5), ...rows[t] }));
console.table(table);
fs.writeFileSync(`${out}/per_minute.json`, JSON.stringify(table, null, 2));
