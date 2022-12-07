require("dotenv").config();

const constants = require("../constants.js");
const thalesData = require("thales-data");
const ethers = require("ethers");
const w3utils = require("web3-utils");

const wallet = new ethers.Wallet(constants.privateKey, constants.etherprovider);

const { performance } = require("perf_hooks");

const ThalesAMM = require("../contracts/ThalesAMM.js");

let tradingMarkets = [];

const Position = {
  UP: 0,
  DOWN: 1,
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

  let minManurityValue = parseInt(new Date().getTime() / 1000);
  let positionalMarkets = await thalesData.binaryOptions.markets({
    max: Infinity,
    network: process.env.NETWORK_ID,
    minMaturity: minManurityValue,
  });

  const thalesAMMContract = new ethers.Contract(
    process.env.THALES_AMM_CONTRACT,
    ThalesAMM.thalesAMMContract.abi,
    wallet
  );

  console.log("Processing a total of " + positionalMarkets.length + " markets");
  let i = 0;

  for (const market of positionalMarkets) {
    console.log("Processing " + i + " market " + market.address);
    i++;
    if (inTradingWeek(market.maturityDate, roundEndTime)) {
      console.log("eligible");
      try {
        let buyPriceImpactUP =
          (await thalesAMMContract.buyPriceImpact(
            market.address,
            Position.UP,
            w3utils.toWei("1")
          )) / 1e18;
        let buyPriceImpactDOWN =
          (await thalesAMMContract.buyPriceImpact(
            market.address,
            Position.DOWN,
            w3utils.toWei("1")
          )) / 1e18;
        console.log("buyPriceImpactUP is " + buyPriceImpactUP);
        console.log("buyPriceImpactDOWN is " + buyPriceImpactDOWN);
        if (
          buyPriceImpactUP >= skewImpactLimit &&
          buyPriceImpactDOWN >= skewImpactLimit
        ) {
          continue;
        }

        let priceUP =
          (await thalesAMMContract.price(market.address, Position.UP)) / 1e18;
        let priceDOWN =
          (await thalesAMMContract.price(market.address, Position.DOWN)) / 1e18;

        if (
          priceUP >= priceLowerLimit &&
          priceUP <= priceUpperLimit &&
          buyPriceImpactUP < skewImpactLimit
        ) {
          tradingMarkets.push({
            address: market.address,
            position: Position.UP,
            currencyKey: market.currencyKey,
            price: priceUP,
          });
          console.log(market.address, "PriceUP", priceUP);
        } else if (
          priceDOWN >= priceLowerLimit &&
          priceDOWN <= priceUpperLimit
        ) {
          tradingMarkets.push({
            address: market.address,
            position: Position.DOWN,
            currencyKey: market.currencyKey,
            price: priceDOWN,
          });
          console.log(market.address, "PriceDOWN", priceDOWN);
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
