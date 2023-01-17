require("dotenv").config();

const constants = require("../constants.js");
const thalesData = require("thales-data");
const ethers = require("ethers");
const w3utils = require("web3-utils");

const wallet = new ethers.Wallet(constants.privateKey, constants.etherprovider);

const { performance } = require("perf_hooks");

const SportAMM = require("../contracts/SportAMM.js");

let tradingMarkets = [];

let marketsToIgnore = new Set();

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
    if (
      !marketsToIgnore.has(market.address) &&
      inTradingWeek(market.maturityDate, roundEndTime)
    ) {
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
        let buyPriceImpactDraw =
          (await thalesAMMContract.buyPriceImpact(
            market.address,
            Position.DRAW,
            w3utils.toWei("1")
          )) / 1e18;
        console.log(market.homeTeam + " vs " + market.awayTeam);
        console.log("buyPriceImpactHome is " + buyPriceImpactHome);
        console.log("buyPriceImpactAway is " + buyPriceImpactAway);
        console.log("buyPriceImpactDraw is " + buyPriceImpactDraw);
        if (
          buyPriceImpactHome >= skewImpactLimit &&
          buyPriceImpactAway >= skewImpactLimit &&
          buyPriceImpactDraw >= skewImpactLimit
        ) {
          continue;
        }

        let priceHome =
          (await thalesAMMContract.obtainOdds(market.address, Position.HOME)) /
          1e18;
        let priceAway =
          (await thalesAMMContract.obtainOdds(market.address, Position.AWAY)) /
          1e18;
        let priceDraw =
          (await thalesAMMContract.obtainOdds(market.address, Position.DRAW)) /
          1e18;

        if (
          priceDraw >= priceLowerLimit &&
          priceDraw <= priceUpperLimit &&
          buyPriceImpactDraw < skewImpactLimit
        ) {
          tradingMarkets.push({
            address: market.address,
            position: Position.DRAW,
            currencyKey: market.currencyKey,
            price: priceDraw,
          });
          console.log(market.address, "priceDraw", priceDraw);
        }
        if (
          priceHome >= priceLowerLimit &&
          priceHome <= priceUpperLimit &&
          buyPriceImpactHome < skewImpactLimit
        ) {
          tradingMarkets.push({
            address: market.address,
            position: Position.HOME,
            currencyKey: market.currencyKey,
            price: priceHome,
          });
          console.log(market.address, "PriceHome", priceHome);
        }
        if (
          priceAway >= priceLowerLimit &&
          priceAway <= priceUpperLimit &&
          buyPriceImpactAway < skewImpactLimit
        ) {
          tradingMarkets.push({
            address: market.address,
            position: Position.AWAY,
            currencyKey: market.currencyKey,
            price: priceAway,
          });
          console.log(market.address, "PriceAway", priceAway);
        }
      } catch (e) {
        console.log(e);
      }
    } else {
      marketsToIgnore.add(market.address);
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
