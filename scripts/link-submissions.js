#!/usr/bin/env node
/**
 * One-time / idempotent migration: attach every existing SUBMISSION to the USER
 * account that shares its email address (sets userId + GSI1 link + FILE owner).
 * Submissions whose email has no account stay loose. Safe to re-run.
 *
 * Guarded to the client account 871020805052 so it can never touch anything else.
 *   node scripts/link-submissions.js            (dry-run: only reports)
 *   node scripts/link-submissions.js --apply     (writes the links)
 */
const { STSClient, GetCallerIdentityCommand } = require('@aws-sdk/client-sts');
const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, QueryCommand, ScanCommand, PutCommand } = require('@aws-sdk/lib-dynamodb');

const REGION = 'eu-central-1';
const ACCOUNT = '871020805052';
const TABLE = 'benleo-data';
const APPLY = process.argv.includes('--apply');

const doc = DynamoDBDocumentClient.from(new DynamoDBClient({ region: REGION }));

(async () => {
  const id = await new STSClient({ region: REGION }).send(new GetCallerIdentityCommand({}));
  if (id.Account !== ACCOUNT) { console.error('ABBRUCH — falscher Account:', id.Account); process.exit(1); }

  const users = (await doc.send(new ScanCommand({ TableName: TABLE, FilterExpression: 'SK = :u', ExpressionAttributeValues: { ':u': 'USER' } }))).Items || [];
  const byEmail = new Map(users.map(u => [String(u.email || '').toLowerCase(), u.id]));

  const subs = (await doc.send(new QueryCommand({ TableName: TABLE, KeyConditionExpression: 'PK = :p', ExpressionAttributeValues: { ':p': 'SUBMISSION' } }))).Items || [];

  let linked = 0, loose = 0, already = 0;
  for (const s of subs) {
    const uid = byEmail.get(String(s.email || '').toLowerCase());
    if (!uid) { loose++; console.log('  · lose (kein Profil):', s.email); continue; }
    if (s.userId === uid) { already++; continue; }
    console.log(`  · verknüpfe ${s.email} -> Profil ${uid}` + (APPLY ? '' : '  [dry-run]'));
    if (APPLY) {
      await doc.send(new PutCommand({ TableName: TABLE, Item: { ...s, userId: uid, GSI1PK: 'SUBUSER#' + uid, GSI1SK: s.createdAt || s.SK } }));
      if (s.fileKey) await doc.send(new PutCommand({ TableName: TABLE, Item: { PK: 'FILE#' + s.fileKey, SK: 'FILE', submissionId: s.id, userId: uid } }));
    }
    linked++;
  }
  console.log(`\n${APPLY ? 'Verknüpft' : 'Würde verknüpfen'}: ${linked} | bereits verknüpft: ${already} | lose: ${loose}`);
  if (!APPLY && linked) console.log('Erneut mit --apply ausführen, um zu schreiben.');
})().catch(e => { console.error(e); process.exit(1); });
