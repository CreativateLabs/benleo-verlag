/**
 * Clear the CMS field registry (PK=META) so pages re-register cleanly after
 * field keys change. Does NOT touch content overrides (PK=CONTENT) or any
 * other data. Client account only.
 *   AWS_PROFILE=benleo AWS_REGION=eu-central-1 node scripts/clear-meta.js
 */
const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, QueryCommand, BatchWriteCommand } = require('@aws-sdk/lib-dynamodb');
const sts = require('@aws-sdk/client-sts');
const TABLE = 'benleo-data';
const doc = DynamoDBDocumentClient.from(new DynamoDBClient({}));

(async () => {
  const who = await new sts.STSClient({}).send(new sts.GetCallerIdentityCommand({}));
  if (who.Account !== '871020805052') throw new Error('FALSCHER ACCOUNT: ' + who.Account);
  const out = await doc.send(new QueryCommand({ TableName: TABLE, KeyConditionExpression: 'PK = :p', ExpressionAttributeValues: { ':p': 'META' } }));
  const items = out.Items || [];
  for (let i = 0; i < items.length; i += 25) {
    const batch = items.slice(i, i + 25).map(it => ({ DeleteRequest: { Key: { PK: 'META', SK: it.SK } } }));
    if (batch.length) await doc.send(new BatchWriteCommand({ RequestItems: { [TABLE]: batch } }));
  }
  console.log('META-Einträge gelöscht:', items.length, '— Seiten registrieren beim nächsten Aufruf/Scan neu.');
})().catch(e => { console.error(e.message || e); process.exit(1); });
