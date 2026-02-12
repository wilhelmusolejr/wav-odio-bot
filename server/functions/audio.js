import { safeSend } from "./helper.js";
import {
  S3Client,
  ListObjectsV2Command,
  DeleteObjectCommand,
  PutObjectCommand,
} from "@aws-sdk/client-s3";
import { fileURLToPath } from "url";
import { join, dirname } from "path";
import { readdir, readFile, unlink, rm } from "fs/promises";
import { existsSync } from "fs";
import dotenv from "dotenv";
dotenv.config();

const BUCKET_NAME = process.env.AWS_BUCKET_NAME;
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const NO_AUDIO = parseInt(process.env.NO_PLAYER) || 5;

export const s3 = new S3Client({
  region: process.env.AWS_REGION,
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  },
});

export async function getAudioFilesFromS3(username, maxRetries = 3) {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      console.log(
        `🔍 Fetching audio files for: ${username} (attempt ${attempt}/${maxRetries})`,
      );

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
        (obj) =>
          obj.Key.endsWith(".mp3") ||
          obj.Key.endsWith(".wav") ||
          obj.Key.endsWith(".ogg"),
      ).map((obj, index) => ({
        id: index + 1,
        name: obj.Key.split("/").pop(), // Get filename
        url: `https://${BUCKET_NAME}.s3.${process.env.AWS_REGION}.amazonaws.com/${obj.Key}`,
      }));

      console.log(`✅ Found ${audioFiles.length} audio files for ${username}`);
      return audioFiles;
    } catch (error) {
      console.error(
        `❌ Attempt ${attempt}/${maxRetries} failed for ${username}:`,
        error.message,
      );

      if (attempt < maxRetries) {
        const delay = attempt * 1000; // 1s, 2s, 3s backoff
        console.log(`⏳ Retrying in ${delay / 1000}s...`);
        await new Promise((resolve) => setTimeout(resolve, delay));
      } else {
        console.error(`❌ All ${maxRetries} attempts failed for ${username}`);
        return [];
      }
    }
  }
}

export async function getRandomAudioFiles(username, count = 5, maxRetries = 3) {
  const allAudios = await getAudioFilesFromS3(username, maxRetries);

  if (allAudios.length === 0) return [];

  // Fisher-Yates shuffle
  const shuffled = [...allAudios];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }

  const selected = shuffled.slice(0, Math.min(count, shuffled.length));
  console.log(
    `🎲 Selected ${selected.length} random audios from ${allAudios.length} total`,
  );
  return selected;
}

export async function deletePlayerAudios(username) {
  console.log(`\n🗑️ Step 1: Deleting S3 audios for ${username}...`);

  try {
    const listCommand = new ListObjectsV2Command({
      Bucket: BUCKET_NAME,
      Prefix: `audios/current/${username}/`,
    });

    const response = await s3.send(listCommand);

    if (!response.Contents || response.Contents.length === 0) {
      console.log(`   No existing audio files for ${username}`);
      return;
    }

    const audioFiles = response.Contents.filter(
      (obj) =>
        obj.Key.endsWith(".mp3") ||
        obj.Key.endsWith(".wav") ||
        obj.Key.endsWith(".ogg"),
    );

    console.log(`   Found ${audioFiles.length} audio files to delete`);

    for (const file of audioFiles) {
      const deleteCommand = new DeleteObjectCommand({
        Bucket: BUCKET_NAME,
        Key: file.Key,
      });

      await s3.send(deleteCommand);
      console.log(`   Deleted: ${file.Key}`);
    }

    console.log(`   Delete complete for ${username}`);
  } catch (error) {
    console.error(`   Error deleting audios for ${username}:`, error.message);
    throw error;
  }
}

export async function uploadNewAudios(username) {
  console.log(`\nStep 3: Uploading new audios for ${username}...`);

  const outputDir = join(__dirname, "..", "..", "audio", "output", username);

  try {
    const files = await readdir(outputDir);
    const audioFiles = files.filter(
      (f) => f.endsWith(".mp3") || f.endsWith(".wav") || f.endsWith(".ogg"),
    );

    if (audioFiles.length === 0) {
      console.log(`   No audio files found in ${outputDir}`);
      return;
    }

    console.log(`   Found ${audioFiles.length} audio file(s) to upload`);

    for (const file of audioFiles) {
      const filePath = join(outputDir, file);
      const fileContent = await readFile(filePath);
      const s3Key = `audios/current/${username}/${file}`;

      let contentType = "audio/mpeg";
      if (file.endsWith(".wav")) contentType = "audio/wav";
      if (file.endsWith(".ogg")) contentType = "audio/ogg";

      const uploadCommand = new PutObjectCommand({
        Bucket: BUCKET_NAME,
        Key: s3Key,
        Body: fileContent,
        ContentType: contentType,
      });

      await s3.send(uploadCommand);
      console.log(`   Uploaded: ${file} -> ${s3Key}`);

      await unlink(filePath);
      console.log(`   Deleted local: ${file}`);
    }

    console.log(`   Upload complete for ${username}`);
  } catch (error) {
    console.error(`   Error uploading audios for ${username}:`, error.message);
    throw error;
  }
}

export async function deleteLocalAudios(username) {
  console.log(`\n🗑️ Deleting local audios for ${username}...`);

  const outputDir = join(__dirname, "..", "..", "audio", "output", username);

  try {
    if (!existsSync(outputDir)) {
      console.log(`   Local folder doesn't exist for ${username}, skipping`);
      return;
    }

    const files = await readdir(outputDir);
    const audioFiles = files.filter(
      (f) => f.endsWith(".mp3") || f.endsWith(".wav") || f.endsWith(".ogg"),
    );

    if (audioFiles.length === 0) {
      console.log(`   No local audio files found for ${username}`);
      return;
    }

    console.log(`   Found ${audioFiles.length} local audio files to delete`);

    for (const file of audioFiles) {
      const filePath = join(outputDir, file);
      await unlink(filePath);
      console.log(`   Deleted local: ${file}`);
    }

    console.log(`   Local delete complete for ${username}`);
  } catch (error) {
    console.error(
      `   Error deleting local audios for ${username}:`,
      error.message,
    );
    throw error;
  }
}
