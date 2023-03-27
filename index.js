require("dotenv").config();

const vault = require("./source/vault.js");

let vaults = process.env.VAULT_CONTRACTS.split(",");

async function doLoop() {
  while (true) {
    try {
      await doMain();
      await delay(1000 * 60 * process.env.DELAY_IN_MINUTES);
    } catch (e) {
      console.log(e);
    }
  }
}

async function doMain() {
  console.log(
    "==================== START PROCESSING VAULT ===================="
  );

  for (let v in vaults) {
    await vault.processVault(vaults[v]);
  }

  console.log("==================== END PROCESSING VAULT ====================");
}

doLoop();

function delay(time) {
  return new Promise(function (resolve) {
    setTimeout(resolve, time);
  });
}
