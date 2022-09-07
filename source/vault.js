require("dotenv").config();

const constants = require("./constants.js");
const ethers = require("ethers");
const w3utils = require("web3-utils");
const wallet = new ethers.Wallet(constants.privateKey, constants.etherprovider);

const Vault = require("../contracts/Vault.js");
const ThalesAMM = require("../contracts/ThalesAMM.js");
const marketschecker = require("./marketschecker.js");

const { performance } = require("perf_hooks");

const Discord = require("discord.js");
const vaultBot = new Discord.Client();
vaultBot.login(process.env.VAULT_BOT_TOKEN);

const Asset = {
  ETH: 0,
  BTC: 1,
  Other: 2,
};

const thalesAMMContract = new ethers.Contract(
  process.env.THALES_AMM_CONTRACT,
  ThalesAMM.thalesAMMContract.abi,
  wallet
);

const VaultContract = new ethers.Contract(
  process.env.VAULT_CONTRACT,
  Vault.vaultContract.abi,
  wallet
);

async function processVault() {
  const round = await VaultContract.round();
  const roundEndTime = (await VaultContract.roundEndTime(round)).toString();
  let closingDate = new Date(roundEndTime * 1000.0).getTime();

  const priceUpperLimit = (await VaultContract.priceUpperLimit()) / 1e18;
  const priceLowerLimit = (await VaultContract.priceLowerLimit()) / 1e18;

  const skewImpactLimit = (await VaultContract.skewImpactLimit()) / 1e18;

  await trade(
    priceLowerLimit,
    priceUpperLimit,
    skewImpactLimit,
    round,
    closingDate
  );

  await closeRound(closingDate);
}

async function closeRound(roundEndTime) {
  console.log("Trying to close the round");
  try {
    let now = new Date();

    if (now.getTime() > roundEndTime) {
      let tx = await VaultContract.closeRound();
      await tx.wait().then((e) => {
        console.log("Round closed");
      });
    } else {
      console.log("Cannot close round yet");
    }
  } catch (e) {
    let errorBody = JSON.parse(e.error.error.body);
    console.log("Failed to close the round", errorBody.error.message);
    await sendRoundErrorMessage( errorBody.error.message);
  }
}

async function trade(
  priceLowerLimit,
  priceUpperLimit,
  skewImpactLimit,
  round,
  roundEndTime
) {
  let tradingMarkets = await marketschecker.processMarkets(
    priceLowerLimit,
    priceUpperLimit,
    roundEndTime
  );

  let t29 = performance.now();

  for (const key in tradingMarkets) {
    let market = tradingMarkets[key];

    let result = await amountToBuy(market, round, skewImpactLimit);

    console.log("Trying to buy amount", result.amount);
    console.log("Quote", result.quote);

    if (result.amount > 0) {
      try {
        let tx = await VaultContract.trade(
          market.address,
          w3utils.toWei(result.amount.toString())
        );
        let receipt = await tx.wait();
        let transactionHash = receipt.transactionHash;
        await sendTradeSuccessMessage(market, result, transactionHash);
        console.log("Trade made");
      } catch (e) {
        let errorBody = JSON.parse(e.error.error.body);
        console.log("Trade failed", errorBody);
        await sendTradeErrorMessage(market.address, errorBody.error.message);
      }
    }
  }

  let t30 = performance.now();
  console.log("Finished trading markets in " + (t30 - t29) + " milliseconds.");
}

async function amountToBuy(market, round, skewImpactLimit) {
  let amount = 0,
    finalAmount = 0,
    quote = 0,
    finalQuote = 0,
    step = 10;

  const maxAmount =
    (await thalesAMMContract.availableToBuyFromAMM(
      market.address,
      market.position
    )) / 1e18;

  const availableAllocationPerAsset =
    (await Vault.getAvailableAllocationPerAsset(round, getAsset(currencyKey))) /
    1e18;
  if (availableAllocationPerAsset < 10) {
    step = 1;
  }
  console.log("Processing market", market.address);

  while (amount < maxAmount) {
    finalAmount = amount;
    amount += step;

    let skewImpact =
      (await thalesAMMContract.buyPriceImpact(
        market.address,
        market.position,
        w3utils.toWei(amount.toString())
      )) / 1e18;

    if (skewImpact >= skewImpactLimit) break;

    finalQuote = quote;
    quote =
      (await thalesAMMContract.buyFromAmmQuote(
        market.address,
        market.position,
        w3utils.toWei(amount.toString())
      )) / 1e18;

    if (quote >= availableAllocationPerAsset) break;
  }

  return { amount: finalAmount, quote: finalQuote };
}

async function sendTradeSuccessMessage(market, result, transactionHash) {
  var message = new Discord.MessageEmbed()
    .addFields(
      {
        name: ":coin: Vault trade made :coin:",
        value: "\u200b",
      },
      {
        name: `${
          market.position == 1
            ? ":chart_with_downwards_trend:"
            : ":chart_with_upwards_trend:"
        } Bought`,
        value: `${result.amount} ${
          market.position == 1 ? "DOWN" : "UP"
        } options`,
      },
      {
        name: ":dollar: Amount spent",
        value: `${parseFloat(result.quote).toFixed(4)} sUSD`,
      },
      {
        name: ":bank: Market",
        value: market.address,
      },
      {
        name: ":receipt: Transaction",
        value: `[View on block explorer](${process.env.TX_EXPLORER_URL}${transactionHash})`,
      }
    )
    .setColor("#00ffb3");
  let vaultInfo = await vaultBot.channels.fetch(process.env.SUCCESS_CHANNEL_ID);
  vaultInfo.send(message);
}

async function sendTradeErrorMessage(address, message) {
  var message = new Discord.MessageEmbed()
    .addFields(
      {
        name: ":exclamation: Vault trade error :exclamation:",
        value: "\u200b",
      },
      {
        name: "Market",
        value: address,
      },
      {
        name: "Message",
        value: message,
      }
    )
    .setColor("#a83232");
  let vaultInfo = await vaultBot.channels.fetch(process.env.ERROR_CHANNEL_ID);
  vaultInfo.send(message);
}

async function sendRoundErrorMessage(message) {
  var message = new Discord.MessageEmbed()
    .addFields(
      {
        name: ":exclamation: Close round error :exclamation:",
        value: "\u200b",
      },
      {
        name: "Message",
        value: message,
      }
    )
    .setColor("#a83232");
  let vaultInfo = await vaultBot.channels.fetch(process.env.ERROR_CHANNEL_ID);
  vaultInfo.send(message);
}

function getAsset(currencyKey) {
  if (currencyKey == "ETH") {
    return Asset.ETH;
  } else if (currencyKey == "BTC") {
    return Asset.BTC;
  } else {
    return Asset.Other;
  }
}

function delay(time) {
  return new Promise(function (resolve) {
    setTimeout(resolve, time);
  });
}

module.exports = {
  processVault,
};
