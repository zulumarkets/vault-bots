require("dotenv").config();

const constants = require("../constants.js");
const ethers = require("ethers");
const w3utils = require("web3-utils");
const wallet = new ethers.Wallet(constants.privateKey, constants.etherprovider);

const Vault = require("../contracts/ParlayVault.js"); 
const SportAMM = require("../contracts/SportAMM.js");
const ParlayAMM = require("../contracts/ParlayAMM.js");
const marketschecker = require("./parlay_marketschecker.js");

const { performance } = require("perf_hooks");
const { isGeneratorFunction } = require("util/types");

// const Discord = require("discord.js");
// const vaultBot = new Discord.Client();
// vaultBot.login(process.env.VAULT_BOT_TOKEN);

const parlayAMMContract = new ethers.Contract(
  process.env.PARLAY_AMM_CONTRACT,
  ParlayAMM.parlayMarketsAMMContract.abi,
  wallet
);

const sportAMMContract = new ethers.Contract(
  process.env.SPORT_AMM_CONTRACT,
  SportAMM.sportAMMContract.abi,
  wallet
);

const vaultContract = new ethers.Contract(
  process.env.PARLAY_VAULT_CONTRACT,
  Vault.parlayVaultContract.abi,
  wallet
);

async function processVault() {
  let gasp = await constants.etherprovider.getGasPrice();
  const round = await vaultContract.round();
  const roundEndTime = (await vaultContract.getCurrentRoundEnd()).toString();
  let closingDate = new Date(roundEndTime * 1000.0).getTime();

  const priceUpperLimit = (await vaultContract.priceUpperLimit()) / 1e18;
  const priceLowerLimit = (await vaultContract.priceLowerLimit()) / 1e18;

  const skewImpactLimit = (await vaultContract.skewImpactLimit()) / 1e18;

  await trade(
    priceLowerLimit,
    priceUpperLimit,
    skewImpactLimit,
    round,
    closingDate,
    gasp
  );

  await closeRound(closingDate);
}

async function closeRound(roundEndTime) {
  console.log("Trying to close the round");
  try {
    let now = new Date();

    if (now.getTime() > roundEndTime) {
      let canCloseRound = await vaultContract.canCloseCurrentRound();
      if (canCloseRound) {
        let tx = await vaultContract.closeRound();
        await tx.wait().then((e) => {
          console.log("Round closed");
        });
      }
    } else {
      console.log("Cannot close round yet");
    }
  } catch (e) {
    let errorBody = JSON.parse(e.error.error.body);
    console.log("Failed to close the round", errorBody.error.message);
    await sendRoundErrorMessage(errorBody.error.message);
  }
}

async function trade(
  priceLowerLimit,
  priceUpperLimit,
  skewImpactLimit,
  round,
  roundEndTime,
  gasp
) {
  let tradingMarkets = await marketschecker.processMarkets(
    priceLowerLimit,
    priceUpperLimit,
    roundEndTime,
    skewImpactLimit
  );

  let parlayMarkets = await getMarketCombinationsForParlays(tradingMarkets, round);

  console.log(tradingMarkets);
  console.log(parlayMarkets);
  console.log(parlayMarkets.length);

  for (let key in parlayMarkets) {
    let markets = parlayMarkets[key][0];
    let positions = parlayMarkets[key][1];

    let result = await prepareTrade(
      markets,
      positions,
      process.env.SUSD_AMOUNT_TO_PAY
    );

    console.log("---------------------- ATTEMPTING TRADE ----------------------");

    console.log("Total Quote", result.totalQuote);
    console.log("Total Buy Amount", result.totalBuyAmount);
    console.log("Markets", markets[0], markets[1]);
    console.log("Positions", positions[0], markets[1]);

    if (result.totalBuyAmount > 0) {
      try {
        let tx = await vaultContract.trade(
          markets,
          positions,
          process.env.SUSD_AMOUNT_TO_PAY,
          {
            gasLimit: 10000000,
            gasPrice: gasp.add(gasp.div(5)),
          }
        );
        let receipt = await tx.wait();
        let transactionHash = receipt.transactionHash;
        console.log("---------------------- TRADE MADE ----------------------");
      } catch (e) {
        if (!("error" in e)) {
            console.log(e);
          } else {
            let errorBody = JSON.parse(e.error.body);
            console.log(
              "Trade failed, message - ",
              errorBody.error.message
            );
            await sendTradeErrorMessage(markets, errorBody.error.message);
          }
      }
    }
  }
  console.log("Finished trading markets ");
}

async function getMarketCombinationsForParlays(sportMarkets, round) {
  let marketCombinations = [];

  for (let i = 0; i < sportMarkets.length - 1; i++) {
    for (let j = i + 1; j < sportMarkets.length; j++) {
      let markets = [sportMarkets[i].address, sportMarkets[j].address];
      let positions = [sportMarkets[i].position, sportMarkets[j].position];

      let inTrading = await vaultContract.parlayExistsInARound(round, markets);
      if(inTrading) continue;

      marketCombinations.push([markets, positions]);
    }
  }
  return marketCombinations;
}

async function prepareTrade(markets, positions, sUSDPaid, skewImpactLimit) {
  let totalBuyAmount = 0,
    totalQuote = 0,
    sUSDAfterFees = 0,
    eligible = true;

  try {
    let result = await parlayAMMContract.buyQuoteFromParlay(
      markets,
      positions,
      sUSDPaid
    );

    for (let i in markets) {
      let skewImpact =
        (await sportAMMContract.buyPriceImpact(
          markets[i],
          positions[i],
          result.amountsToBuy[i]
        )) / 1e18;

      if (skewImpact >= skewImpactLimit) {
        eligible = false;
        break;
      }
    }

    if (eligible) {
      totalBuyAmount = result.totalBuyAmount / 1e18;
      totalQuote = result.totalQuote / 1e18;
      sUSDAfterFees = result.sUSDAfterFees / 1e18;
    }
  } catch (e) {
    if (!("error" in e)) {
      console.log(e);
    } else {
      let errorBody = JSON.parse(e.error.body);
      console.log(
        `Quote failed, message -`,
        errorBody.error.message
      );
    }
  }

  return { totalBuyAmount, totalQuote, sUSDAfterFees };
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

async function sendTradeErrorMessage(markets, message) {
  var message = new Discord.MessageEmbed()
    .addFields(
      {
        name: ":exclamation: ParlayVault trade error :exclamation:",
        value: "\u200b",
      },
      {
        name: "Markets",
        value: `${markets[0]} ${markets[1]}`,
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

function delay(time) {
  return new Promise(function (resolve) {
    setTimeout(resolve, time);
  });
}

module.exports = {
  processVault,
};
