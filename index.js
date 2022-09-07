require("dotenv").config();

const vault = require("./source/vault.js");

async function doLoop() {
  while (true) {
    try {
      await doMain();
    } catch (e) {
      console.log(e);
    }
  }
}

async function doMain() {
  console.log("==================== START PROCESSING VAULT ====================");
  
  await vault.processVault();

  console.log("==================== END PROCESSING VAULT ====================");
}

doLoop();

function delay(time) {
  return new Promise(function (resolve) {
    setTimeout(resolve, time);
  });
}
