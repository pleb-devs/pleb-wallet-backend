const LndGrpc = require("lnd-grpc");
const dotenv = require("dotenv");
const Invoice = require("./db/models/invoice");

dotenv.config();

const options = {
  lndconnectUri: process.env.LND_CONNECT_URI
};

const lnd = new LndGrpc(options);

const connect = async () => {
  try {
    await lnd.connect();

    if (lnd.state !== "active") {
      throw new Error(
        "LND did not reach 'active' state within the expected time"
      );
    }
    
    console.log(`LND gRPC connection state: ${lnd.state}`);

    // Start the invoice event stream on successful connection
    // We want to always be listening for invoice events while the server is running
    invoiceEventStream();
  } catch (e) {
    console.log("error", e);
  }
};

const getBalance = async () => {
  const balance = await lnd.services.Lightning.walletBalance();
  return balance;
};

const getChannelBalance = async () => {
  const channelBalance = await lnd.services.Lightning.channelBalance();
  return channelBalance;
};

const createInvoice = async ({ value, memo, user_id }) => {
  // Use the 'addInvoice' method from the Lightning service of the 'grpc' module to create an invoice.
  // This method requires an object parameter with 'value' and 'memo' properties.
  // This method is asynchronous, so we use 'await' to pause execution until it completes.
  const invoice = await lnd.services.Lightning.addInvoice({
    value: value,
    memo: memo,
  });

  // After creating the invoice with the Lightning service, we create a record in our own database using the 'Invoice' model's 'create' method.
  // This method requires an object parameter with properties for 'payment_request', 'value', 'memo', 'settled', 'send', and 'user_id'.
  // Note that 'settled' is set to false (since the invoice has just been created and is not yet paid), and 'send' is also false (since we haven't sent the invoice yet).
  // This operation is also asynchronous, so we use 'await' again.
  await Invoice.create({
    payment_request: invoice.payment_request,
    value: value,
    memo: memo,
    settled: false,
    send: false,
    user_id: user_id,
  });

  // Finally, the function returns the invoice that was created with the Lightning service.
  // This includes the 'payment_request' string that can be used to pay the invoice.
  return invoice;
};

const payInvoice = async ({ payment_request }) => {
  const paidInvoice = await lnd.services.Lightning.sendPaymentSync({
    payment_request: payment_request,
  });

  return paidInvoice;
};

const invoiceEventStream = async () => {
  await lnd.services.Lightning.subscribeInvoices({
    add_index: 0,
    settle_index: 0,
  })
    .on("data", async (data) => {
      console.log("on data:", data);
      if (data.settled) {
        // Check if the invoice exists in the database
        const existingInvoice = await Invoice.findOne(data.payment_request);

        // If the invoice exists, update it in the database
        if (existingInvoice) {
          const settleDate = new Date(data.settle_date * 1000).toISOString();
          await Invoice.update(data.payment_request, {
            settled: data.settled,
            settle_date: settleDate,
          });
        } else {
          console.log("Invoice not found in the database");
        }
      }
    })
    .on("error", (err) => {
      console.log(err);
    });
};

module.exports = {
  connect,
  getBalance,
  getChannelBalance,
  createInvoice,
  payInvoice,
  invoiceEventStream,
};
