// One-off: create the LoyaltyClass in Google Wallet if it doesn't exist.
import "dotenv/config";
import { ensureLoyaltyClass } from "../src/lib/google-wallet.js";

ensureLoyaltyClass()
  .then(() => {
    console.log("loyalty class ready");
  })
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
