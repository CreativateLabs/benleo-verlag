/**
 * S3 helpers — presigned uploads (browser → S3 direct, up to 200 MB) and
 * presigned downloads. @aws-sdk provided by the Lambda runtime.
 */
const crypto = require('crypto');
const { S3Client, PutObjectCommand, GetObjectCommand } = require('@aws-sdk/client-s3');
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');

const BUCKET = process.env.UPLOAD_BUCKET;
const s3 = new S3Client({});

function makeKey(prefix, filename) {
  const ext = (String(filename || '').match(/\.[a-zA-Z0-9]{1,8}$/) || [''])[0];
  return `${prefix}/${Date.now()}-${crypto.randomUUID()}${ext}`;
}

async function presignPut(key, contentType) {
  const cmd = new PutObjectCommand({ Bucket: BUCKET, Key: key, ContentType: contentType || 'application/octet-stream' });
  return getSignedUrl(s3, cmd, { expiresIn: 900 }); // 15 min to upload
}
async function presignGet(key, filename) {
  const cmd = new GetObjectCommand({ Bucket: BUCKET, Key: key, ...(filename ? { ResponseContentDisposition: `attachment; filename="${filename}"` } : {}) });
  return getSignedUrl(s3, cmd, { expiresIn: 3600 });
}

module.exports = { makeKey, presignPut, presignGet, BUCKET };
