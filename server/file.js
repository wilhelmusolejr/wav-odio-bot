import fs from "fs";
import path from "path";
import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
import dotenv from "dotenv";

dotenv.config(); // ← must be before S3Client

const s3 = new S3Client({
  region: process.env.AWS_REGION,
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  },
});

async function uploadToS3(filePath, key) {
  const fileStream = fs.createReadStream(filePath);

  const command = new PutObjectCommand({
    Bucket: "bucket-kita-laham",
    Key: key,
    Body: fileStream,
    ContentType: "audio/mpeg",
  });

  await s3.send(command);
  console.log("Uploaded:", key);
}

async function uploadFolder(localDir, s3Prefix) {
  const files = fs.readdirSync(localDir);

  for (const file of files) {
    const fullPath = path.join(localDir, file);
    if (fs.statSync(fullPath).isFile()) {
      await uploadToS3(fullPath, `${s3Prefix}/${file}`);
    }
  }
}

// example
uploadFolder("../audio/output/botfrag666", "botfrag666");
