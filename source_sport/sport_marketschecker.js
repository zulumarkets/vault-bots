require("dotenv").config();

const constants = require("../constants.js");
const thalesData = require("thales-data");
const ethers = require("ethers");
const w3utils = require("web3-utils");

const wallet = new ethers.Wallet(constants.privateKey, constants.etherprovider);

const { performance } = require("perf_hooks");

const SportAMM = require("../contracts/SportAMM.js");

let tradingMarkets = [];

const Position = {
  HOME: 0,
  AWAY: 1,
  DRAW: 2,
};

async function processMarkets(
  priceLowerLimit,
  priceUpperLimit,
  roundEndTime,
  skewImpactLimit
) {
  console.log(
    "--------------------Started processing markets-------------------"
  );

  const positionalMarkets = await thalesData.sportMarkets.markets({
    max: Infinity,
    network: process.env.NETWORK_ID,
    isResolved: false,
  });

  const thalesAMMContract = new ethers.Contract(
    process.env.SPORT_AMM_CONTRACT,
    SportAMM.sportAMMContract.abi,
    wallet
  );

  console.log("Processing a total of " + positionalMarkets.length + " markets");
  let i = 0;

  for (const market of positionalMarkets) {
    console.log("Processing " + i + " market");
    i++;
    if (inTradingWeek(market.maturityDate, roundEndTime)) {
      console.log("eligible");
      try {
        let buyPriceImpactHome =
          (await thalesAMMContract.buyPriceImpact(
            market.address,
            Position.HOME,
            w3utils.toWei("1")
          )) / 1e18;
        let buyPriceImpactAway =
          (await thalesAMMContract.buyPriceImpact(
            market.address,
            Position.AWAY,
            w3utils.toWei("1")
          )) / 1e18;
        console.log(market.homeTeam + " vs " + market.awayTeam);
        console.log("buyPriceImpactHome is " + buyPriceImpactHome);
        console.log("buyPriceImpactAway is " + buyPriceImpactAway);
        if (
          buyPriceImpactHome >= skewImpactLimit &&
          buyPriceImpactAway >= skewImpactLimit
        ) {
          continue;
        }

        let priceHome =
          (await thalesAMMContract.buyFromAmmQuote(
            market.address,
            Position.HOME,
            w3utils.toWei("1")
          )) / 1e18;
        let priceAway =
          (await thalesAMMContract.buyFromAmmQuote(
            market.address,
            Position.AWAY,
            w3utils.toWei("1")
          )) / 1e18;

        let skewImpact =
          (await thalesAMMContract.buyPriceImpact(
            market.address,
            Position.HOME,
            w3utils.toWei("1")
          )) / 1e18;

        if (
          priceHome >= priceLowerLimit &&
          priceHome <= priceUpperLimit &&
          skewImpact < 0
        ) {
          tradingMarkets.push({
            address: market.address,
            position: Position.HOME,
            currencyKey: market.currencyKey,
            price: priceHome,
          });
          console.log(market.address, "PriceHome", priceHome);
        } else if (
          priceAway >= priceLowerLimit &&
          priceAway <= priceUpperLimit
        ) {
          tradingMarkets.push({
            address: market.address,
            position: Position.AWAY,
            currencyKey: market.currencyKey,
            price: priceAway,
          });
          console.log(market.address, "PriceAway", priceAway);
        } else {
          continue;
        }
      } catch (e) {
        console.log(e);
      }
    }
  }

  console.log(
    "--------------------Finished processing markets-------------------"
  );

  return tradingMarkets;
}

function delay(time) {
  return new Promise(function (resolve) {
    setTimeout(resolve, time);
  });
}

function inTradingWeek(maturityDate, roundEndTime) {
  const now = Date.now();
  if (maturityDate > now && maturityDate < roundEndTime) {
    return true;
  }
  return false;
}

module.exports = {
  processMarkets,
};
