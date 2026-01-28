import { safeSend } from "./helper.js";
import {
  S3Client,
  ListObjectsV2Command,
  CopyObjectCommand,
  DeleteObjectCommand,
  PutObjectCommand,
} from "@aws-sdk/client-s3";
import { fileURLToPath } from "url";
import { join, dirname } from "path";
import { readdir, readFile, unlink } from "fs/promises";
import dotenv from "dotenv";
dotenv.config();

const BUCKET_NAME = process.env.AWS_BUCKET_NAME;
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

export const s3 = new S3Client({
  region: process.env.AWS_REGION,
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  },
});

export async function getAudioFilesFromS3(username) {
  try {
    console.log(`🔍 Fetching audio files for: ${username}`);

    const command = new ListObjectsV2Command({
      Bucket: BUCKET_NAME,
      Prefix: `audios/current/${username}/`,
    });

    const response = await s3.send(command);

    if (!response.Contents || response.Contents.length === 0) {
      console.warn(`⚠️ No audio files found for ${username}`);
      return [];
    }

    // Filter only audio files and create URLs
    const audioFiles = response.Contents.filter(
      (obj) => obj.Key.endsWith(".mp3") || obj.Key.endsWith(".wav"),
    ).map((obj, index) => ({
      id: index + 1,
      name: obj.Key.split("/").pop(), // Get filename
      url: `https://${BUCKET_NAME}.s3.${process.env.AWS_REGION}.amazonaws.com/${obj.Key}`,
    }));

    console.log(`✅ Found ${audioFiles.length} audio files for ${username}`);
    return audioFiles;
  } catch (error) {
    console.error(`❌ Error fetching audio from S3:`, error.message);
    return [];
  }
}

export async function archivePlayerAudios(username) {
  console.log(`\n📦 Step 1: Archiving audios for ${username}...`);

  try {
    // List all current audio files
    const listCommand = new ListObjectsV2Command({
      Bucket: BUCKET_NAME,
      Prefix: `audios/current/${username}/`,
    });

    const response = await s3.send(listCommand);

    if (!response.Contents || response.Contents.length === 0) {
      console.log(`   ⚠️ No audio files found for ${username}`);
      return;
    }

    const audioFiles = response.Contents.filter(
      (obj) => obj.Key.endsWith(".mp3") || obj.Key.endsWith(".wav"),
    );

    console.log(`   📁 Found ${audioFiles.length} audio files to archive`);

    // Copy each file to archive
    for (const file of audioFiles) {
      const fileName = file.Key.split("/").pop();
      const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
      const archiveKey = `audios/archive/${username}/${timestamp}_${fileName}`;

      // Copy to archive
      const copyCommand = new CopyObjectCommand({
        Bucket: BUCKET_NAME,
        CopySource: `${BUCKET_NAME}/${file.Key}`,
        Key: archiveKey,
      });

      await s3.send(copyCommand);
      console.log(`   ✅ Archived: ${fileName} → ${archiveKey}`);

      // Delete from current
      const deleteCommand = new DeleteObjectCommand({
        Bucket: BUCKET_NAME,
        Key: file.Key,
      });

      await s3.send(deleteCommand);
      console.log(`   🗑️ Deleted from current: ${file.Key}`);
    }

    console.log(`   ✅ Archiving complete for ${username}`);
  } catch (error) {
    console.error(
      `   ❌ Error archiving audios for ${username}:`,
      error.message,
    );
    throw error;
  }
}

export async function uploadNewAudios(username) {
  console.log(`\n☁️ Step 3: Uploading new audios for ${username}...`);

  const outputDir = join(
    __dirname,
    "..",
    "..",
    "new_audio",
    "output",
    username,
  );

  try {
    // Read all files from the output directory
    const files = await readdir(outputDir);
    const audioFiles = files.filter(
      (f) => f.endsWith(".mp3") || f.endsWith(".wav"),
    );

    if (audioFiles.length === 0) {
      console.log(`   ⚠️ No audio files found in ${outputDir}`);
      return;
    }

    console.log(`   📁 Found ${audioFiles.length} audio file(s) to upload`);

    for (const file of audioFiles) {
      const filePath = join(outputDir, file);
      const fileContent = await readFile(filePath);
      const s3Key = `audios/current/${username}/${file}`;

      // Upload to S3
      const uploadCommand = new PutObjectCommand({
        Bucket: BUCKET_NAME,
        Key: s3Key,
        Body: fileContent,
        ContentType: file.endsWith(".mp3") ? "audio/mpeg" : "audio/wav",
      });

      await s3.send(uploadCommand);
      console.log(`   ✅ Uploaded: ${file} → ${s3Key}`);

      // Delete local file after successful upload
      await unlink(filePath);
      console.log(`   🗑️ Deleted local: ${filePath}`);
    }

    console.log(`   ✅ Upload complete for ${username}`);
  } catch (error) {
    console.error(
      `   ❌ Error uploading audios for ${username}:`,
      error.message,
    );
    throw error;
  }
}
