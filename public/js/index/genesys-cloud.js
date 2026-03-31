import controller from "./notifications-controller.js";
import view from "./view.js";

// Obtain a reference to the platformClient object
const platformClient = require("platformClient");
const client = platformClient.ApiClient.instance;
client.setPersistSettings(true, "VonageIntegration");

// Constants
const ENV_QUERY_PARAM = "environment";

function normalizePcEnvironment(envParam) {
  if (!envParam) return null;

  try {
    if (envParam.startsWith("http")) {
      envParam = new URL(envParam).hostname;
    }
  } catch (e) {
    // Keep original value when URL parsing fails.
  }

  return envParam.replace(/^apps\./, "");
}

// Client App instance
let vonageClientApp = null;

// API instances
const usersApi = new platformClient.UsersApi();
const conversationsApi = new platformClient.ConversationsApi();

// Globals
let userMe = null;
let currentConversation = null;
let currentConversationId = "";

/**
 * Add Vonage Video Session ID in conversation notes
 * @param {String} conversationId
 * @param {String} participantId
 */
function patchConversation(conversationId, participantId, sessionId) {
  // Just return if no session started in vonage
  if (!sessionId) return;

  let body = {
    wrapup: {
      code: "",
      name: "",
      notes: "Vonage Video Session ID: " + sessionId,
    },
  };

  return conversationsApi.patchConversationParticipant(
    conversationId,
    participantId,
    body,
  );
}

/**
 * Get Vonage session assosciated witht he conversation
 * @param {String} conversationId
 */
function getSessionId(conversationId) {
  let sessionId = null;
  let iframeContainer = document.getElementById(`${conversationId}-room`);

  // Get session ID if it still exists
  if (iframeContainer) {
    let roomIframe = iframeContainer.querySelectorAll("iframe")[0];
    sessionId = roomIframe.contentWindow["sessionId"];
  }

  return sessionId;
}

/**
 * Set-up the channel for conversations
 */
function setupChannel() {
  return controller.createChannel().then((data) => {
    // Subscribe to conversation notifications
    return controller.addSubscription(
      `v2.users.${userMe.id}.conversations`,

      // Callback function
      (data) => {
        console.log(data);
        let conversation = data.eventBody;
        let participants = conversation.participants;
        let conversationId = conversation.id;
        let agentParticipant = participants.find((p) => p.purpose == "agent");
        let customerParticipant = participants.find(
          (p) => p.purpose == "customer",
        );

        // Ignore if email
        if (agentParticipant.emails) return;

        // If chat has ended display meeting has ended
        if (
          agentParticipant.endTime ||
          agentParticipant.chats?.[0].state == "disconnected"
        ) {
          // Add Vonage Video Session ID in conversation notes
          let sessionId = getSessionId(conversationId);

          if (sessionId) {
            patchConversation(
              conversationId,
              customerParticipant.id,
              sessionId,
            ).catch((e) => console.error(e));
          }

          view.uncheckScreenShare();
          view.hideVonageSession();
          view.showErrorIframe("No Active Interaction");
        }
      },
    );
  });
}

/**
 * Generate the invitation message that's sent ot the customer
 */
function getInvitationMessage() {
  const conversationId = currentConversation.id;
  const customerParticipant = currentConversation.participants.find(
    (p) => p.purpose == "customer",
  );
  const customerName = customerParticipant.name || "<No Name>";
  const message = `Please join my Vonage Video Room at: ${appURI.replace(/\/+$/, "")}/room/customer/${conversationId}?username=${encodeURIComponent(customerName)}`;

  return message;
}

/**
 * Send the link to the room in the chat if interaction is chat.
 */
function sendLinkToChat() {
  let conversationId = currentConversation.id;
  let communicationId = "";

  view.showInfoModal("Sending Link...");

  // Check if the conversation is chat, if not show a message
  // TODO: Use currentconersation
  return conversationsApi
    .getConversation(conversationId)
    .then((data) => {
      let customerParticipant = data.participants.find(
        (p) => p.purpose == "customer",
      );
      let agentParticipant = data.participants.find(
        (p) => p.purpose == "agent",
      );
      let customerName = customerParticipant.name || "<No Name>";

      // Determine if the conversation is a chat by checking 'chats'
      // property of the agent participant
      if (!agentParticipant || !agentParticipant.chats) {
        view.showInfoModal("Sorry. This conversation is not a Webchat.");
        return null;
      }
      let chats = agentParticipant.chats;

      // Get last id just in case there are multiple
      communicationId = chats[chats.length - 1].id;

      // Send the chat message
      return conversationsApi.postConversationsChatCommunicationMessages(
        conversationId,
        communicationId,
        {
          body: `Please join my Vonage Video Room at: ${appURI.replace(/\/+$/, "")}/room/customer/${conversationId}?username=${encodeURIComponent(customerName)}`,
          bodyType: "standard",
        },
      );
    })
    .then((success) => {
      if (success) {
        view.showInfoModal("Successfully sent!");
      }
    })
    .catch((e) => console.error(e));
}

/**
 * Send chat link to email
 * @param {String} address email address
 */
function sendLinkToEmail(address) {
  view.hideEmailModal();
  view.showInfoModal("Sending Link...");

  // emailQueueID is passed from server as a window global variable.
  const queueId = emailQueueID;

  return new Promise((resolve, reject) => {
    if (!queueId) {
      view.showInfoModal(
        "No queue has been configured for sending the Email invitation.",
      );
      reject();
    }

    const emailConvBody = {
      queueId: queueId,
      provider: "PureCloud Email",
      toAddress: address,
      direction: "OUTBOUND",
    };

    const emailBody = {
      to: [
        {
          email: address,
        },
      ],
      subject: "Vonage Room Invitation",
      textBody: getInvitationMessage(),
    };

    let conversationId = "";

    conversationsApi
      .postConversationsEmails(emailConvBody)
      .then((data) => {
        conversationId = data.id;

        return conversationsApi.postConversationsEmailMessages(
          conversationId,
          emailBody,
        );
      })
      .then((data) => {
        return conversationsApi.getConversation(conversationId);
      })
      .then((conversation) => {
        let agent = conversation.participants.find((p) => p.purpose == "agent");

        return conversationsApi.patchConversationsEmailParticipant(
          conversationId,
          agent.id,
          {
            state: "disconnected",
            wrapupSkipped: true,
          },
        );
      })
      .then(() => {
        view.showInfoModal("Link sent!");
        resolve();
      })
      .catch((e) => {
        console.error(e);
        reject();
      });
  });
}

/**
 * Send link through server sms
 * @param {String} address
 */
function sendLinkToSMS(address) {
  view.hideSMSModal();
  view.showInfoModal("Sending Link...");

  return fetch(`${appURI.replace(/\/+$/, "")}/sendlinktosms`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      conversationId: currentConversation.id,
      address: address,
      message: getInvitationMessage(),
    }),
  }).then((response) => response.json());
}

/**
 * Get the best customer phone number for SMS based on call direction.
 */
function getCurrentCustomerANI() {
  const customer = currentConversation?.participants?.find(
    (p) => p.purpose === "customer",
  );

  if (!customer) return null;

  const stripTel = (value) =>
    typeof value === "string" ? value.replace(/^tel:/, "") : null;

  // Prefer a non-terminated call leg when multiple call objects exist.
  const call =
    customer.calls?.find(
      (c) => (c.state || "").toLowerCase() !== "terminated",
    ) || customer.calls?.[0];

  if (call?.direction) {
    const direction = call.direction.toLowerCase();

    if (direction === "outbound") {
      // Outbound: customer is the dialed destination.
      return stripTel(customer.dnis) || stripTel(customer.address) || null;
    }

    if (direction === "inbound") {
      // Inbound: customer is the caller, but only accept ANI when it is a tel: address.
      const aniTel =
        typeof customer.ani === "string" && customer.ani.startsWith("tel:")
          ? stripTel(customer.ani)
          : null;

      return (
        aniTel || stripTel(customer.address) || stripTel(customer.dnis) || null
      );
    }
  }

  // Fallback when direction is unavailable.
  const fallbackAni =
    typeof customer.ani === "string" && customer.ani.startsWith("tel:")
      ? stripTel(customer.ani)
      : null;

  return (
    stripTel(customer.dnis) || stripTel(customer.address) || fallbackAni || null
  );
}

/**
 * If the current conversation is chat return the email attribute
 * If not return not
 */
function getCurrentCustomerEmail() {
  let customer = currentConversation.participants.find(
    (p) => p.purpose == "customer",
  );
  return customer.attributes["context.email"];
}

/**
 * Client App SDK initialization
 */
function initializeClientApp() {
  let ClientApp = window.purecloud.apps.ClientApp;
  let envParam = normalizePcEnvironment(urlParams.get(ENV_QUERY_PARAM));

  if (!envParam) {
    envParam =
      localStorage.getItem("clientAppEnvironment") || "mypurecloud.com";
  }
  vonageClientApp = new ClientApp({ pcEnvironment: envParam });
  localStorage.setItem("clientAppEnvironment", envParam);
}

function getOAuthClientID() {
  return typeof oauthClientID !== "undefined" ? oauthClientID : "";
}

function buildAuthErrorMessage(error) {
  const authData = client && client.authData ? client.authData : {};
  const authError = authData.error || "";
  const authDescription =
    authData.error_description || authData.errorDescription || "";
  const message = error && error.message ? error.message : "";
  const details = authDescription || message;

  if (/redirect/i.test(details)) {
    return "Genesys authentication failed because the redirect URI does not match the OAuth client configuration. Please contact your administrator.";
  }

  if (
    /access_denied|denied/i.test(authError) ||
    /access denied/i.test(details)
  ) {
    return "Genesys authentication was denied. Please sign in again or contact your administrator if the issue persists.";
  }

  if (/invalid_client|client/i.test(authError) || /client id/i.test(details)) {
    return "Genesys authentication failed because the OAuth client configuration is invalid. Please contact your administrator.";
  }

  if (/state/i.test(authError) || /state/i.test(details)) {
    return "Genesys authentication failed because the login state could not be validated. Please reopen the integration and sign in again.";
  }

  if (/expired|session/i.test(details)) {
    return "Your Genesys session has expired. Please sign in again to continue.";
  }

  if (details) {
    return `Genesys authentication failed: ${details}`;
  }

  return "Genesys authentication failed. Please retry sign-in.";
}

async function loginWithPKCE(clientId, redirectUri, state) {
  if (typeof client.loginPKCEGrant !== "function") {
    throw new Error(
      "Genesys SDK loginPKCEGrant is unavailable. Update the platform client SDK to use PKCE.",
    );
  }

  const options = { state };

  // SDK PKCE login uses redirect flow.
  return client.loginPKCEGrant(clientId, redirectUri, options);
}

/**
 * OAuth flow
 */
function initializeApp() {
  // Determine environment for Genesys Cloud
  let gCloudEnv = normalizePcEnvironment(urlParams.get(ENV_QUERY_PARAM));
  if (!gCloudEnv) {
    gCloudEnv =
      localStorage.getItem("clientAppEnvironment") || "mypurecloud.com";
  }
  localStorage.setItem("clientAppEnvironment", gCloudEnv);

  client.setEnvironment(gCloudEnv);
  const clientId = getOAuthClientID();
  if (!clientId) {
    return Promise.reject(
      new Error(
        "Missing Genesys OAuth client ID. Set genesysCloud.oauthClientID in config.js.",
      ),
    );
  }

  return loginWithPKCE(clientId, appURI, currentConversationId)
    .then((data) => {
      console.log(data);
      // Assign conversation id
      currentConversationId = data?.state || currentConversationId;
      console.log(`Conversation ID: ${currentConversationId}`);

      // Get Details of current User
      return usersApi.getUsersMe();
    })
    .then((data) => {
      userMe = data;

      // Get current conversation
      return conversationsApi.getConversation(currentConversationId);
    })
    .then((conv) => {
      currentConversation = conv;

      // Create the channel conversation notifications
      return setupChannel();
    })
    .then((data) => {
      view.showVonageSession(currentConversationId, userMe.name);
    })
    .catch((e) => {
      console.error(e);
      view.showErrorIframe(buildAuthErrorMessage(e));
      throw e;
    });
}

/** --------------------------------------------------------------
 *                       EVENT HANDLERS
 * -------------------------------------------------------------- */
document
  .getElementById("btn-email")
  .addEventListener("click", () =>
    view.showEmailModal(getCurrentCustomerEmail()),
  );
document
  .getElementById("btn-sms")
  .addEventListener("click", () => view.showSMSModal(getCurrentCustomerANI()));
document
  .getElementById("btn-chat")
  .addEventListener("click", () => sendLinkToChat());

document.getElementById("btn-send-email").addEventListener("click", () => {
  let email = document.getElementById("inputEmail").value;
  sendLinkToEmail(email).then(() =>
    view.showInfoModal("Successfully sent link!"),
  );
});

document.getElementById("btn-send-sms").addEventListener("click", () => {
  let address = document.getElementById("inputSMS").value;
  sendLinkToSMS(address).then((data) => {
    if (data.success) view.showInfoModal("Successfully sent link!");
  });
});
/** --------------------------------------------------------------
 *                       INITIAL SETUP
 * -------------------------------------------------------------- */
const urlParams = new URLSearchParams(window.location.search);
currentConversationId = urlParams.get("conversationid");

window.addEventListener("load", () => {
  initializeClientApp();
  initializeApp()
    .then(() => {
      console.log("App initialized.");
      vonageClientApp.lifecycle.bootstrapped();
    })
    .catch((e) => console.error(e));
});
