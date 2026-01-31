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
    username: "botfrag666",
    email: "wilhelmus.olejr@gmail.com",
    password: "",
    discordName: "† 𝖻𝗋𝖾𝗇𝖽⍺𝗇 ♡",
    voiceType: "real_brendan666",
    backgroundNoise: "none",
    playerType: "respondent",
  },
  {
    username: "jeroam",
    email: "jerome.poal@hotmail.com",
    password: "",
    discordName: "titenijeroammabango",
    voiceType: "ai_kael",
    backgroundNoise: "white_noise",
    playerType: "initiator",
  },
  {
    username: "echogreg",
    email: "gregory.yames@gmail.com",
    password: "",
    discordName: "Ryuzakiss",
    voiceType: "real_brendan666",
    backgroundNoise: "fan",
    playerType: "respondent",
  },
  {
    username: "jennyhums30",
    email: "jenny.humbong@gmail.com",
    password: "",
    discordName: "𝕵𝖊𝖓𝖓𝖞𝕳𝖚𝖒𝖘",
    voiceType: "ai_kael",
    backgroundNoise: "none",
    playerType: "initiator",
  },
  {
    username: "elooo2092",
    email: "sumlehliw.elo@gmail.com",
    password: "",
    discordName: "Elooo",
    voiceType: "real_brendan666",
    backgroundNoise: "white_noise",
    playerType: "respondent",
  },
  {
    username: "g3ooorge",
    email: "george.wils666n@gmail.com",
    password: "",
    discordName: "G3☾RG£",
    voiceType: "real_brendan666",
    backgroundNoise: "white_noise",
    playerType: "respondent",
  },
  {
    username: "koooooalaid",
    email: "brendan.eich666@gmail.com",
    password: "",
    discordName: "koooooalaid",
    voiceType: "real_brendan666",
    backgroundNoise: "none",
    playerType: "respondent",
  },
  {
    username: "totoyoymonaxia",
    email: "totoyoy.monaxia@gmail.com",
    password: "",
    discordName: "Andy",
    voiceType: "ai_kael",
    backgroundNoise: "fan",
    playerType: "initiator",
  },
];

addMultipleAccounts(multipleAccounts)
  .then(() => {
    console.log("\n✅ All done!");
    process.exit(0);
  })
  .catch((err) => {
    console.error("\n❌ Process failed:", err.message);
    process.exit(1);
  });
