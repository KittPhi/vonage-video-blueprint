const express = require("express");
const bodyParser = require("body-parser");
const https = require("https");
const fs = require("fs");
const app = express();
const config = require("./config.js");
const port = config.expressPort;
const vonageApp = require("./vonage-server-app.js");

// Web server
const sslOptions = {
  key: fs.readFileSync("https-requirements/localhost.key"),
  cert: fs.readFileSync("https-requirements/localhost.crt"),
  ca: fs.readFileSync("https-requirements/ca.crt"),
  requestCert: true,
  rejectUnauthorized: false,
};
const httpsServer = https.createServer(sslOptions, app);

// Constants
const appURI = config.appURI;

// Parsers
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

// set the view engine to ejs
app.set("view engine", "ejs");

app.use(express.static(__dirname + "/public"));

app.get("/", async (req, res) => {
  let emailQueueID = config.genesysCloud.emailQueueID;
  const oauthClientID = config.genesysCloud.oauthClientID;

  if (!appURI || !oauthClientID) {
    console.error("Some configuration items empty.");
    res.status(500).end();
  } else {
    res.render("index.ejs", {
      appURI: appURI,
      emailQueueID: emailQueueID,
      oauthClientID: oauthClientID,
    });
  }
});

// ── Use Case 2 ── Agent publishes audio only; Customer publishes audio + video ──
// NOTE: UC2 routes must be registered before UC1 so Express does not match
// "/room/agent/uc2/:id" as UC1 with conversation_id = "uc2".

app.get("/room/agent/uc2/:conversation_id", async (req, res) => {
  let conversation_id = req.params.conversation_id;
  let userName = req.query.username || "N/A";

  vonageApp
    .createRoom(conversation_id, userName, "agent", 2)
    .then((vonageData) => {
      res.render("agent-room-uc2.ejs", {
        vonageData: vonageData,
        roomRole: "agent",
        publishAudio: true,
        useCase: 2,
        appURI: appURI,
      });
    })
    .catch((e) => {
      console.error(e);
      res.render("error.ejs", {
        message: e && e.message ? e.message : undefined,
      });
    });
});

app.get("/room/customer/uc2/:conversation_id", async (req, res) => {
  let conversation_id = req.params.conversation_id;
  let userName = req.query.username || "N/A";

  vonageApp
    .createRoom(conversation_id, userName, "customer", 2)
    .then((vonageData) => {
      res.render("customer-room-uc2.ejs", {
        vonageData: vonageData,
        roomRole: "customer",
        publishAudio: true,
        useCase: 2,
        appURI: appURI,
      });
    })
    .catch((e) => {
      console.error(e);
      res.render("error.ejs", {
        message: e && e.message ? e.message : undefined,
      });
    });
});

// ── Use Case 1 ── Agent subscribes to customer video only; neither publishes audio ──

app.get("/room/agent/:conversation_id", async (req, res) => {
  let conversation_id = req.params.conversation_id;
  let userName = req.query.username || "N/A";

  vonageApp
    .createRoom(conversation_id, userName, "agent", 1)
    .then((vonageData) => {
      res.render("agent-room.ejs", {
        vonageData: vonageData,
        roomRole: "agent",
        publishAudio: false,
        useCase: 1,
        appURI: appURI,
      });
    })
    .catch((e) => {
      console.error(e);
      res.render("error.ejs", {
        message: e && e.message ? e.message : undefined,
      });
    });
});

app.get("/room/customer/:conversation_id", async (req, res) => {
  let conversation_id = req.params.conversation_id;
  let userName = req.query.username || "N/A";

  vonageApp
    .createRoom(conversation_id, userName, "customer", 1)
    .then((vonageData) => {
      res.render("customer-room.ejs", {
        vonageData: vonageData,
        roomRole: "customer",
        publishAudio: false,
        useCase: 1,
        appURI: appURI,
      });
    })
    .catch((e) => {
      console.error(e);
      res.render("error.ejs", {
        message: e && e.message ? e.message : undefined,
      });
    });
});

app.get("/error", (req, res) => {
  res.render("error.ejs", {});
});

// API for sending Vonage Video link via SMS
app.post("/sendlinktosms", async (req, res) => {
  vonageApp
    .sendSMS(req.body)
    .then(() => {
      res.status(200).send({ success: true });
    })
    .catch((err) => {
      console.log(err);
      res.status(400);
    });
});

// Run Node server
httpsServer.listen(port, () => {
  console.log(`Example app listening at https://localhost:${port}`);
  console.log(`Test Mode: ${config.testMode ? "ON" : "OFF"}`);
});
