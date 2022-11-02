require("dotenv").config();

const constants = require("../constants.js");
const thalesData = require("thales-data");
const ethers = require("ethers");

const wallet = new ethers.Wallet(constants.privateKey, constants.etherprovider);

const { performance } = require("perf_hooks");

const ThalesAMM = require("../contracts/ThalesAMM.js");

let tradingMarkets = [];

const Position = {
  UP: 0,
  DOWN: 1,
};

async function processMarkets(priceLowerLimit, priceUpperLimit, roundEndTime) {
  console.log(
    "--------------------Started processing markets-------------------"
  );
  const positionalMarkets = await thalesData.binaryOptions.markets({
    max: Infinity,
    network: process.env.NETWORK_ID,
  });

  const thalesAMMContract = new ethers.Contract(
    process.env.THALES_AMM_CONTRACT,
    ThalesAMM.thalesAMMContract.abi,
    wallet
  );

  for (const market of positionalMarkets) {
    if (inTradingWeek(market.maturityDate, roundEndTime)) {
      try {
        let priceUP =
          (await thalesAMMContract.price(market.address, Position.UP)) / 1e18;
        let priceDOWN =
          (await thalesAMMContract.price(market.address, Position.DOWN)) / 1e18;

        if (priceUP >= priceLowerLimit && priceUP <= priceUpperLimit) {
          tradingMarkets.push({
            address: market.address,
            position: Position.UP,
            currencyKey: market.currencyKey,
            price: priceUP,
          });
          console.log(market.address, "PriceUp", priceUP);
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
          console.log(market.address, "PriceDown", priceDOWN);
        } else {
          continue;
        }
      } catch (e) {
        console.log(e);
      }
    }
  }

  console.log("Finished processing markets");

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
