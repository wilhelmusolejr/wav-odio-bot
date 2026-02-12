import dotenv from "dotenv";
import { connectDB } from "./functions/database.js";
import { Account } from "./models/Account.js";

dotenv.config();

// Connect to MongoDB
await connectDB();

/**
 * Add a new account to the database
 * @param {Object} accountData - Account information
 * @returns {Promise<Object>} Created account or error
 */
async function addAccount(accountData) {
  try {
    // Check if username already exists
    const existingAccount = await Account.findOne({
      username: accountData.username,
    });

    if (existingAccount) {
      throw new Error(
        `❌ Username "${accountData.username}" already exists in database!`,
      );
    }

    // Create new account
    const account = new Account(accountData);
    await account.save();

    console.log("✅ Account created successfully:");
    console.log(JSON.stringify(account, null, 2));
    return account;
  } catch (error) {
    if (error.code === 11000) {
      // MongoDB duplicate key error
      console.error(`❌ Duplicate username: ${accountData.username}`);
    } else {
      console.error("❌ Error adding account:", error.message);
    }
    throw error;
  }
}

/**
 * Add multiple accounts at once
 * @param {Array} accountsArray - Array of account objects
 */
async function addMultipleAccounts(accountsArray) {
  const results = { success: [], failed: [] };

  for (const accountData of accountsArray) {
    try {
      const account = await addAccount(accountData);
      results.success.push(account.username);
    } catch (error) {
      results.failed.push({
        username: accountData.username,
        error: error.message,
      });
    }
  }

  console.log("\n📊 Summary:");
  console.log(`✅ Success: ${results.success.length}`);
  console.log(`❌ Failed: ${results.failed.length}`);

  if (results.failed.length > 0) {
    console.log("\nFailed accounts:");
    results.failed.forEach((f) => console.log(`  - ${f.username}: ${f.error}`));
  }

  return results;
}

// Example usage - Add your accounts here
/*
const newAccount = {
  username: "bot",
  discordName: "Player#1234",
  voiceType: "ai_kael",
  backgroundNoise: "white_noise",
  playerType: "initiator",
};

// Single account
addAccount(newAccount)
  .then(() => {
    console.log("\n✅ Done!");
    process.exit(0);
  })
  .catch((err) => {
    console.error("\n❌ Failed:", err.message);
    proces
    
*/

// Multiple accounts (uncomment to use)
const multipleAccounts = [
  {
    username: "dongregory0031",
    email: "gregory_569.don@hotmail.com",
    password: "",
    discordName: "dongregory",
    voiceType: "real_brendan666",
    backgroundNoise: "white_noise",
    playerType: "respondent",
  },
  {
    username: "amoramor691",
    email: "amos.884_dominique17_dallas21@hotmail.com",
    password: "",
    discordName: "amoramor691",
    voiceType: "ai_kael",
    backgroundNoise: "fan",
    playerType: "respondent",
  },
  {
    username: "dieyoung7979",
    email: "geordietgf6pva@hotmail.com",
    password: "",
    discordName: "dieyoung7979",
    voiceType: "ai_bisaya",
    backgroundNoise: "white_noise",
    playerType: "respondent",
  },
  {
    username: "hamillalamoves",
    email: "hamil-2averelldurward652@hotmail.com",
    password: "",
    discordName: "hamillalamove",
    voiceType: "ai_josh",
    backgroundNoise: "fan",
    playerType: "respondent",
  },
  {
    username: "riotinbonkwmhe",
    email: "griz.197hallsy_177.giuseppe@hotmail.com",
    password: "",
    discordName: "riotinbonkwmhe",
    voiceType: "ai_bisayang_tagalog",
    backgroundNoise: "white_noise",
    playerType: "respondent",
  },
];

// real_brendan666
// ai_kael
// ai_bisaya
// ai_josh
// ai_bisayang_tagalog

addMultipleAccounts(multipleAccounts)
  .then(() => {
    console.log("\n✅ All done!");
    process.exit(0);
  })
  .catch((err) => {
    console.error("\n❌ Process failed:", err.message);
    process.exit(1);
  });
