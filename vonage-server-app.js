/**
 * This script contains the logic for Vonage Video API and Genesys Cloud functions.
 * For this blueprint solution, this script is not run independent of the
 * web server but is imported and used as a module.
 */
const platformClient = require("purecloud-platform-client-v2");
const config = require("./config.js");
const { Vonage } = require("@vonage/server-sdk");

// Vonage Credentials
const appId = config.vonage.appId || config.vonage.applicationId;
const privateKey = config.vonage.privateKey;

if (!appId || !privateKey) {
  throw new Error(
    "Missing Vonage credentials. Configure vonage.appId (or vonage.applicationId) and vonage.privateKey.",
  );
}

const vonage = new Vonage({
  applicationId: appId,
  privateKey,
});

// Genesys Cloud Credentials
const client = platformClient.ApiClient.instance;
const conversationsApi = new platformClient.ConversationsApi();
let tokenInfo = {};

// Dictionary of sessions
// Key: conversation ID. Value: Session ID
// NOTE: Use an actual service to keep track of sessions.
let sessions = {};

/**
 * Returns whether a given conversation is active or not.
 * @param {String} conversationId the Genesys Cloud conversation ID.
 * @param {Promise<Boolean>} Promise object representing if the conversation is active or not.
 */
function _isConversationActive(conversationId) {
  return conversationsApi
    .getConversation(conversationId)
    .then((conversation) => {
      return conversation.endTime ? false : true;
    })
    .catch((err) => console.error("Invalid conversation: conversationId"));
}

/**
 * Create a Vonage Video Session
 * @returns {Promise<String>} the sessionId
 */
async function _createSession() {
  const session = await vonage.video.createSession({});
  return session.sessionId;
}

/**
 * Create a new Vonage Video room and return Vonage Video details (token, sessionId, etc.)
 * @param {String} conversationId Genesys Cloud conversation id
 * @param {String} userName Name of the participant
 * @param {String} participantRole logical role in app flow ('agent' or 'customer')
 * @returns {Promise<Object>} Promise representing Vonage Video details to be passed to the client app
 */
async function _createRoom(
  conversationId,
  userName,
  participantRole = "customer",
) {
  let conversationActive = config.testMode
    ? true
    : await _isConversationActive(conversationId);

  let sessionId = sessions[conversationId];

  if (!conversationActive && !config.testMode) {
    // If conversation has ended or invalid, show the error page
    throw new Error("Conversation is invalid");
  } else {
    // Create room if none created for conversation yet.
    if (!sessions[conversationId]) {
      sessionId = await _createSession();
      sessions[conversationId] = sessionId;
    }

    const tokenRole = participantRole === "agent" ? "subscriber" : "publisher";
    let token = vonage.video.generateClientToken(sessionId, {
      role: tokenRole,
      data: userName,
    });

    return {
      apiKey: appId,
      sessionId: sessionId,
      token: token,
      userName: userName,
    };
  }
}

/**
 * Send a link of the Vonage Room via Genesys Cloud Agentless SMS.
 * @param {Object} body information about the SMS to be sent
 * @returns {Promise}
 */
async function _sendSMS(body) {
  console.log("Sending SMS invitation...");

  return new Promise((resolve, reject) => {
    let smsAddress = config.genesysCloud.smsFromAddress;

    if (
      !body.conversationId ||
      !body.address ||
      !body.message ||
      smsAddress.length <= 0
    )
      reject();

    // Check if in a session
    if (!sessions[body.conversationId]) res.status(404);

    // Send agentless SMS
    let smsBody = {
      fromAddress: smsAddress,
      toAddress: body.address,
      toAddressMessengerType: "sms",
      textBody: body.message,
    };

    return conversationsApi
      .postConversationsMessagesAgentless(smsBody)
      .then((data) => {
        console.log("SMS sent");
        resolve();
      })
      .catch((err) => {
        reject(err);
      });
  });
}

/**
 * Request new token for Genesys Cloud Client Credentials
 */
function _refreshGenesysCloudCredentials() {
  client.setEnvironment(config.genesysCloud.region);

  return client
    .loginClientCredentialsGrant(
      config.genesysCloud.clientID,
      config.genesysCloud.clientSecret,
    )
    .then((data) => {
      tokenInfo = data;
      console.log(
        `Genesys Cloud authenticated. Token: ${tokenInfo.accessToken}`,
      );
    })
    .catch((err) => {
      console.log(err);
    });
}

/**
 * Function generator. Encapsulates all exposed methods to first check
 * the status of the Genesys Cloud token. Refresh credentials if needed.
 */
function executeFunction(f) {
  // The time difference between token expiration and now (ms)
  // if less than, refresh the token.
  const timeDiffToRefresh = 3600000;

  let func = async (...args) => {
    if (
      !tokenInfo.tokenExpiryTime ||
      tokenInfo.tokenExpiryTime - Date.now() <= timeDiffToRefresh
    ) {
      console.log("Refreshing Genesys Cloud Credentials...");
      await _refreshGenesysCloudCredentials();
    }

    return f(...args);
  };

  return func;
}

// Authenticat with GCloud on server startup
if (!config.testMode) {
  _refreshGenesysCloudCredentials();
}

module.exports = {
  createRoom: config.testMode ? _createRoom : executeFunction(_createRoom),
  sendSMS: executeFunction(_sendSMS),
};
